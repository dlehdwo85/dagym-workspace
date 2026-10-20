import { z } from 'zod';
import { db } from './db';
import { badRequest, forbidden, notFound } from './errors';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';
import { assertHomeUser } from './admin';
import { zUuid } from './api';

/**
 * 대표 10/20 오후 7) 사용자 관리 — 퇴사 처리 / 계정 인수인계
 * [퇴사 처리] 날짜 지정 → 로그인 차단·세션 만료·푸시 끔·초대 취소·Google 연동 멈춤·팀·대화방에서 빠짐(메신저 자동 제거), 라이선스 인원 제외(status 'left' 는 활성 수에 안 들어감), 알림 수신 중지(notify 는 active 만).
 * [인수인계] 담당 업무·내가 요청한 업무·참여 업무·리드·일정·결재선·반복 업무·연락처·프로젝트를 항목별로(웹 문의는 업무로 연결되어 업무 이전에 포함) 골라 한 사람에게 일괄 이전. 자료실 파일은 회사 소유 그대로(지우지 않음), 메일·문자 발송 기록 보존.
 * [복직] 퇴사일부터 30일 안. 모든 동작 감사 기록.
 */
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const plusDays = (date: string, n: number) => ymd(new Date(Date.parse(`${date}T12:00:00+09:00`) + n * 864e5));

async function requireEdit(actor: SessionUser) { await (await import('./menuPerms')).requireMenu(actor, 'admin_users', 'edit'); }

export const leaveInput = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), toUserId: zUuid.optional(), items: z.array(z.string().max(30)).max(20).optional() });
export async function leaveUser(actor: SessionUser, id: string, i: z.infer<typeof leaveInput>, ip: string | null) {
  await requireEdit(actor);
  const sql = db(); await assertHomeUser(actor, id, sql);
  if (id === actor.id) throw badRequest('본인 계정은 퇴사 처리할 수 없습니다');
  const [cur] = await sql<{ role: string; status: string; name: string }[]>`select role, status, name from users where id = ${id}`;
  if (!cur) throw notFound('사용자가 없습니다');
  if (cur.status === 'left') throw badRequest('이미 퇴사 처리된 계정입니다');
  if (cur.role === 'owner') {
    if (actor.role !== 'owner') throw forbidden('대표 계정은 대표만 바꿀 수 있습니다');
    const owners = await sql`select 1 from users where role = 'owner' and status = 'active' and id <> ${id} and tenant = ${tenantOf(actor)}`;
    if (!owners.length) throw badRequest('마지막 대표 계정은 퇴사 처리할 수 없습니다');
  }
  const date = i.date ?? ymd(new Date());
  let handover: Awaited<ReturnType<typeof doHandover>> | null = null;
  await sql.begin(async (tx) => {
    await tx`update users set status = 'left', left_at = ${date}, left_by = ${actor.id}, rejoin_until = ${plusDays(date, 30)}, updated_at = now() where id = ${id}`;
    await tx`update sessions set revoked_at = now() where user_id = ${id} and revoked_at is null`;
    await tx`update push_subscriptions set disabled_at = now() where user_id = ${id} and disabled_at is null`;
    await tx`update invitations set revoked_at = now() where user_id = ${id} and accepted_at is null and revoked_at is null`;
    await tx`update google_calendar_links set status = 'paused' where user_id = ${id}`;
    // 메신저·팀에서 자동 제거(대화 기록은 남음). 팀장이었으면 팀은 그대로 두고 사람만 빠짐 — 새 팀장은 부서·팀 화면에서
    for (const r of await tx<{ room_id: string }[]>`select cm.room_id from chat_members cm join chat_rooms r on r.id = cm.room_id where cm.user_id = ${id} and r.kind in ('group', 'team', 'company')`) {
      await tx`insert into chat_messages (room_id, author_id, body, kind) values (${r.room_id}, null, ${`${cur.name}님이 퇴사하여 나갔습니다`}, 'system')`; // 메신저 1차 시스템 메시지
      await tx`update chat_rooms set owner_id = (select user_id from chat_members where room_id = ${r.room_id} and user_id <> ${id} order by joined_at limit 1) where id = ${r.room_id} and owner_id = ${id}`;
    }
    await tx`delete from chat_members where user_id = ${id}`;
    await tx`delete from team_members where user_id = ${id}`;
    await tx`delete from team_view_grants where user_id = ${id}`;
    await audit(tx, actor.id, 'user.leave', 'user', id, { date, name: cur.name }, ip);
  });
  if (i.toUserId && i.items?.length) handover = await doHandover(actor, id, { toUserId: i.toUserId, items: i.items }, ip);
  return { ok: true, leftAt: date, rejoinUntil: plusDays(date, 30), handover };
}

/** 인수인계 항목: key → 라벨·개수 SQL·이전 SQL */
const ITEMS: Record<string, { label: string; count: (sql: ReturnType<typeof db>, id: string) => Promise<number>; move: (sql: ReturnType<typeof db>, id: string, to: string) => Promise<number> }> = {
  tasks: { label: '담당 업무(진행 중)', count: async (sql, id) => n(await sql`select count(*)::int as n from tasks where assignee_id = ${id} and status <> 'done' and deleted_at is null`),
    move: async (sql, id, to) => n(await sql`with u as (update tasks set assignee_id = ${to}, updated_at = now() where assignee_id = ${id} and status <> 'done' and deleted_at is null returning 1) select count(*)::int as n from u`) },
  requested: { label: '내가 요청한 업무(진행 중)', count: async (sql, id) => n(await sql`select count(*)::int as n from tasks where requested_by = ${id} and status <> 'done' and deleted_at is null`),
    move: async (sql, id, to) => n(await sql`with u as (update tasks set requested_by = ${to}, updated_at = now() where requested_by = ${id} and status <> 'done' and deleted_at is null returning 1) select count(*)::int as n from u`) },
  collab: { label: '참여 중인 업무', count: async (sql, id) => n(await sql`select count(*)::int as n from task_collaborators c join tasks t on t.id = c.task_id where c.user_id = ${id} and t.status <> 'done' and t.deleted_at is null`),
    move: async (sql, id, to) => n(await sql`with d as (delete from task_collaborators c using tasks t where t.id = c.task_id and c.user_id = ${id} and t.status <> 'done' and t.deleted_at is null returning c.task_id),
      i as (insert into task_collaborators (task_id, user_id) select task_id, ${to} from d on conflict do nothing returning 1) select count(*)::int as n from d`) },
  recurring: { label: '반복 업무', count: async (sql, id) => n(await sql`select count(*)::int as n from tasks where assignee_id = ${id} and recurrence_rule is not null and not coalesce(recurrence_stopped, false) and deleted_at is null`),
    move: async (sql, id, to) => n(await sql`with u as (update tasks set assignee_id = ${to}, updated_at = now() where assignee_id = ${id} and recurrence_rule is not null and not coalesce(recurrence_stopped, false) and deleted_at is null returning 1) select count(*)::int as n from u`) },
  approvals: { label: '결재선(대기 중인 승인 단계)', count: async (sql, id) => n(await sql`select count(*)::int as n from task_approvals where approver_user_id = ${id} and status in ('waiting', 'pending')`),
    move: async (sql, id, to) => n(await sql`with u as (update task_approvals set approver_user_id = ${to} where approver_user_id = ${id} and status in ('waiting', 'pending') returning 1) select count(*)::int as n from u`) },
  leads: { label: '영업 리드·거래처', count: async (sql, id) => n(await sql`select count(*)::int as n from sales_leads where owner_id = ${id}`),
    move: async (sql, id, to) => n(await sql`with u as (update sales_leads set owner_id = ${to}, updated_at = now() where owner_id = ${id} returning 1) select count(*)::int as n from u`) },
  events: { label: '앞으로의 일정(만든 사람)', count: async (sql, id) => n(await sql`select count(*)::int as n from events where created_by = ${id} and end_at >= now() and not cancelled and recurring_event_id is null`),
    move: async (sql, id, to) => n(await sql`with u as (update events set created_by = ${to} where created_by = ${id} and end_at >= now() and not cancelled returning 1) select count(*)::int as n from u`) },
  contacts: { label: '담당 연락처', count: async (sql, id) => n(await sql`select count(*)::int as n from contacts where owner_id = ${id}`),
    move: async (sql, id, to) => n(await sql`with u as (update contacts set owner_id = ${to} where owner_id = ${id} returning 1) select count(*)::int as n from u`) },
  projects: { label: '프로젝트 책임', count: async (sql, id) => n(await sql`select count(*)::int as n from projects where owner_id = ${id} and not archived`),
    move: async (sql, id, to) => n(await sql`with u as (update projects set owner_id = ${to} where owner_id = ${id} and not archived returning 1) select count(*)::int as n from u`) },
};
const n = (r: { n: number }[]) => Number(r[0]?.n ?? 0);

export async function handoverSummary(actor: SessionUser, id: string) {
  await (await import('./menuPerms')).requireMenu(actor, 'admin_users', 'view');
  const sql = db(); await assertHomeUser(actor, id, sql);
  const [u] = await sql<{ name: string; status: string; left_at: string | null; rejoin_until: string | null; handover_to: string | null }[]>`select name, status, left_at::text, rejoin_until::text, handover_to from users where id = ${id}`;
  if (!u) throw notFound('사용자가 없습니다');
  const items = [];
  for (const [key, it] of Object.entries(ITEMS)) items.push({ key, label: it.label, count: await it.count(sql, id) });
  const candidates = await sql<{ id: string; name: string; title: string | null }[]>`select id, name, title from users where tenant = ${tenantOf(actor)} and status = 'active' and id <> ${id} and not is_demo order by name`;
  return { user: { id, ...u, canRejoin: u.status === 'left' && !!u.rejoin_until && u.rejoin_until >= ymd(new Date()) }, items, candidates };
}

export const handoverInput = z.object({ toUserId: zUuid, items: z.array(z.string().max(30)).min(1).max(20) });
export async function doHandover(actor: SessionUser, id: string, i: z.infer<typeof handoverInput>, ip: string | null) {
  await requireEdit(actor);
  const sql = db(); await assertHomeUser(actor, id, sql);
  if (i.toUserId === id) throw badRequest('본인에게는 넘길 수 없습니다');
  const [to] = await sql<{ name: string }[]>`select name from users where id = ${i.toUserId} and tenant = ${tenantOf(actor)} and status = 'active'`;
  if (!to) throw badRequest('받을 사람은 같은 회사의 사용 중인 계정이어야 합니다');
  const keys = i.items.filter((k) => k in ITEMS);
  if (!keys.length) throw badRequest('넘길 항목을 고르세요');
  const counts: Record<string, number> = {};
  await sql.begin(async (tx) => {
    for (const k of keys) counts[k] = await ITEMS[k].move(tx as never, id, i.toUserId);
    await tx`update users set handover_to = ${i.toUserId}, updated_at = now() where id = ${id}`;
    await audit(tx, actor.id, 'user.handover', 'user', id, { toUserId: i.toUserId, toName: to.name, counts }, ip);
  });
  return { ok: true, counts, to: { id: i.toUserId, name: to.name } };
}

export async function rejoinUser(actor: SessionUser, id: string, ip: string | null) {
  await requireEdit(actor);
  const sql = db(); await assertHomeUser(actor, id, sql);
  const [u] = await sql<{ status: string; rejoin_until: string | null; name: string }[]>`select status, rejoin_until::text, name from users where id = ${id}`;
  if (!u) throw notFound('사용자가 없습니다');
  if (u.status !== 'left') throw badRequest('퇴사 처리된 계정만 복직할 수 있습니다');
  if (!u.rejoin_until || u.rejoin_until < ymd(new Date())) throw badRequest('복직 기한(퇴사일부터 30일)이 지났습니다 — 새로 초대해 주세요');
  await (await import('./plans')).assertSeat(tenantOf(actor)); // 요금제 인원 안에서만 복직
  await sql.begin(async (tx) => {
    await tx`update users set status = 'active', left_at = null, left_by = null, rejoin_until = null, updated_at = now() where id = ${id}`;
    await tx`update google_calendar_links set status = 'active' where user_id = ${id} and status = 'paused'`;
    await audit(tx, actor.id, 'user.rejoin', 'user', id, { name: u.name }, ip);
  });
  return { ok: true };
}
