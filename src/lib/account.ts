import { z } from 'zod';
import { db } from './db';
import { badRequest, forbidden } from './errors';
import { verifyPassword } from './crypto';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';

/**
 * V15 계정 관리(개인정보 보호법): 내 데이터 내려받기 · 회원 탈퇴 · 공간(회사) 삭제.
 * 기본 회사(다짐·하이링크)와 체험 조직 직원은 스스로 탈퇴하지 않고 회사 관리자가 비활성화한다.
 */
const INTERNAL = ['default', 'demo'];

export async function exportMine(u: SessionUser) {
  const sql = db();
  const [profile] = await sql`select id, email, name, title, role, timezone, created_at, last_login_at from users where id = ${u.id}`;
  const [tasks, events, comments, messages, consents] = await Promise.all([
    sql`select id, title, description, status, priority, start_date, due_date, due_time, completed_at, created_at, updated_at,
          (assignee_id = ${u.id}) as assigned_to_me, (created_by = ${u.id}) as created_by_me, (requested_by = ${u.id}) as requested_by_me
        from tasks where deleted_at is null and (assignee_id = ${u.id} or created_by = ${u.id} or requested_by = ${u.id}) order by created_at`,
    sql`select e.id, e.title, e.description, e.location, e.start_at, e.end_at, e.all_day, e.rrule, e.created_at from events e
        where e.deleted_at is null and (e.created_by = ${u.id} or exists (select 1 from event_attendees a where a.event_id = e.id and a.user_id = ${u.id})) order by e.start_at`,
    sql`select task_id, body, created_at from comments where author_id = ${u.id} order by created_at`,
    sql`select room_id, body, file_name, created_at from chat_messages where author_id = ${u.id} order by id`,
    sql`select kind, version, agreed, created_at from consents where user_id = ${u.id}`,
  ]);
  await audit(sql, u.id, 'account.export', 'user', u.id, { tasks: tasks.length, events: events.length }, null);
  return { exportedAt: new Date().toISOString(), note: '첨부파일 원본은 각 업무·자료실에서 내려받으세요', profile, tasks, events, comments, chatMessages: messages, consents };
}

export const deleteInput = z.object({ password: z.string().max(200).default(''), confirm: z.literal('탈퇴합니다', { errorMap: () => ({ message: '확인 문구 "탈퇴합니다"를 입력하세요' }) }) });
export const deleteSpaceInput = z.object({ password: z.string().max(200).default(''), confirmName: z.string().trim().min(1) });

async function checkPassword(u: SessionUser, password: string) {
  const [r] = await db()<{ password_hash: string | null }[]>`select password_hash from users where id = ${u.id}`;
  // V29 소셜로만 가입한 사람(비밀번호 없음): 비밀번호 대신 "방금(15분 안) 로그인한 세션"으로 본인 확인
  if (!r?.password_hash) {
    const [s] = await db()<{ ok: boolean }[]>`select created_at > now() - interval '15 minutes' ok from sessions where id = ${u.sessionId ?? ''}`;
    if (!s?.ok) throw badRequest('본인 확인을 위해 로그아웃 후 소셜 계정으로 다시 로그인하고 15분 안에 진행해 주세요');
    return;
  }
  if (!(await verifyPassword(password, r.password_hash))) throw badRequest('비밀번호가 올바르지 않습니다');
}

/** 사람 하나를 지운 것으로: 이메일·이름·비밀번호 제거(같은 이메일로 다시 가입 가능), 세션·푸시·연동 끊기 */
export async function anonymize(tx: any, userId: string) {
  await tx`update users set status = 'left', deleted_at = now(), email = ${`deleted+${userId}@deleted.invalid`}, name = '탈퇴한 사용자', title = null,
    password_hash = null, totp_secret = null, totp_enabled_at = null, updated_at = now() where id = ${userId}`;
  await tx`update sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
  await tx`update push_subscriptions set disabled_at = now() where user_id = ${userId} and disabled_at is null`;
  await tx`delete from google_calendar_links where user_id = ${userId}`;
}

export async function deleteAccount(u: SessionUser, i: z.infer<typeof deleteInput>, ip: string | null) {
  if (INTERNAL.includes(tenantOf(u))) throw forbidden('회사 계정은 회사 관리자가 정리합니다. 관리자에게 요청하세요.');
  await checkPassword(u, i.password);
  const sql = db();
  const others = await sql`select 1 from users where tenant = ${tenantOf(u)} and status in ('active','invited') and id <> ${u.id}`;
  const owners = await sql`select 1 from users where tenant = ${tenantOf(u)} and status = 'active' and role = 'owner' and id <> ${u.id}`;
  if (u.role === 'owner' && others.length && !owners.length) throw badRequest('다른 구성원이 있습니다. 다른 사람을 대표로 지정하거나 "공간 삭제"를 하세요.');
  await sql.begin(async (tx) => {
    if (!others.length) await tx`update tenants set status = 'deleted', deleted_at = now() where id = ${tenantOf(u)}`;
    await anonymize(tx, u.id);
    await audit(tx, u.id, 'account.delete', 'user', u.id, { tenantDeleted: !others.length }, ip);
  });
  return { ok: true };
}

export async function deleteSpace(u: SessionUser, i: z.infer<typeof deleteSpaceInput>, ip: string | null) {
  if (INTERNAL.includes(tenantOf(u)) || u.role !== 'owner') throw forbidden('공간 대표만 삭제할 수 있습니다');
  await checkPassword(u, i.password);
  const sql = db();
  const [t] = await sql<{ name: string }[]>`select name from tenants where id = ${tenantOf(u)}`;
  if (t?.name !== i.confirmName) throw badRequest('공간 이름이 일치하지 않습니다');
  await sql.begin(async (tx) => {
    await tx`update tenants set status = 'deleted', deleted_at = now() where id = ${tenantOf(u)}`;
    for (const r of await tx<{ id: string }[]>`select id from users where tenant = ${tenantOf(u)}`) await anonymize(tx, r.id);
    await audit(tx, u.id, 'tenant.delete', null, null, { tenant: tenantOf(u) }, ip);
  });
  return { ok: true };
}

/** 개인 공간 → 팀(회사) 공간: 데이터는 그대로, 이름·요금제(팀 무료)만 바뀌고 직원 초대가 열린다 */
export async function upgradeToTeam(u: SessionUser, company: string, ip: string | null) {
  if (!u.personal || u.role !== 'owner') throw forbidden('개인 공간 대표만 바꿀 수 있습니다');
  const name = company.trim().slice(0, 60);
  if (!name) throw badRequest('회사(팀) 이름을 입력하세요');
  const t = tenantOf(u);
  await db().begin(async (tx) => {
    await tx`update tenants set kind = 'company', name = ${name} where id = ${t}`;
    await tx`update tenant_subscriptions set plan_code = 'team', updated_at = now() where tenant = ${t} and plan_code = 'personal'`;
    await tx`update org_units set name = ${name} where tenant = ${t} and type = 'hq'`;
    await tx`insert into calendars (type, name, color, tenant) values ('company', ${name + ' 공용'}, '#0F766E', ${t}) on conflict do nothing`;
    await audit(tx, u.id, 'tenant.upgrade', null, null, { tenant: t, name }, ip);
  });
  return { ok: true };
}

// ---------------- V28-5 계정 삭제 요청(스토어 필수: 앱 밖 웹 주소 + 회사 계정은 관리자에게 요청) ----------------
export const deletionRequestInput = z.object({
  email: z.string().trim().toLowerCase().email('이메일 형식이 아닙니다').max(200),
  name: z.string().trim().max(50).optional(),
  reason: z.string().trim().max(1000).optional(),
});
const DONE_MSG = '삭제 요청을 받았습니다. 본인 확인 후 영업일 기준 7일 안에 처리하고 결과를 이메일로 알려 드립니다.';
/**
 * 로그인 못 하는 사람(웹 폼) · 회사 계정 직원(앱 설정)의 삭제 요청 — 개인정보 담당 메일 + (로그인한 회사 직원이면) 회사 대표·관리자 알림.
 * 응답은 항상 같은 문구(가입 여부를 드러내지 않음). IP 당 시간 5회.
 */
export async function requestDeletion(u: SessionUser | null, i: z.infer<typeof deletionRequestInput>, ip: string | null) {
  const sql = db();
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from audit_logs where action = 'account.deletion_request' and ip is not distinct from ${ip} and created_at > now() - interval '1 hour'`;
  if (n >= 5) throw badRequest('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
  await audit(sql, u?.id ?? null, 'account.deletion_request', 'user', u?.id ?? null, { email: i.email, loggedIn: !!u, tenant: u ? tenantOf(u) : null }, ip);
  const to = process.env.COMPANY_PRIVACY_EMAIL || process.env.SUPPORT_EMAIL;
  const body = `계정 삭제 요청\n\n이메일: ${i.email}\n이름: ${i.name || '-'}\n로그인 상태: ${u ? `예 (${u.name}, 회사 ${tenantOf(u)})` : '아니오(웹 요청)'}\n사유: ${i.reason || '-'}\n\n본인 확인 후 처리: 회사 계정이면 회사 관리자에게 비활성화·삭제 요청, 개인·가입 공간이면 플랫폼 운영 화면에서 처리.`;
  if (to) { const { sendMail } = await import('./mail'); await sendMail(to, '[워크인] 계정 삭제 요청', body).catch(() => {}); }
  if (u) {
    const admins = (await sql<{ id: string }[]>`select id from users where tenant = ${tenantOf(u)} and status = 'active' and role in ('owner','admin') and id <> ${u.id} and not is_demo`).map((r) => r.id);
    const { notify } = await import('./notifications');
    await notify(sql, { userIds: admins, type: 'account_request', title: `계정 삭제 요청: ${u.name}`, body: i.reason ? `사유: ${i.reason}` : '사용자 관리에서 계정을 비활성화·삭제해 주세요',
      link: '/admin/users', entityType: 'user' as never, entityId: u.id, actorId: u.id, dedupeKey: `delreq:${u.id}:${new Date().toISOString().slice(0, 10)}` });
  }
  return { ok: true, message: DONE_MSG };
}

/** V15-6 (#279) 탈퇴(익명 처리) 30일 뒤 실제 정리: 전화·회사 메일·설정·알림·세션·푸시·구글 연동까지 지우고 purged_at. 업무·댓글 기록은 '탈퇴한 사용자'로 남긴다 */
export async function purgeDeletedAccounts(now = new Date()) {
  const sql = db();
  const rows = await sql<{ id: string }[]>`select id from users where deleted_at is not null and deleted_at < ${now}::timestamptz - interval '30 days' and purged_at is null and email like 'deleted+%' limit 100`;
  for (const r of rows) {
    await sql.begin(async (tx) => {
      await tx`delete from sessions where user_id = ${r.id}`;
      await tx`delete from push_subscriptions where user_id = ${r.id}`;
      await tx`delete from notification_prefs where user_id = ${r.id}`;
      await tx`delete from notifications where user_id = ${r.id}`;
      await tx`delete from user_settings where user_id = ${r.id}`;
      await tx`delete from google_calendar_links where user_id = ${r.id}`;
      await tx`update users set phone = null, work_email = null, title_short = null, purged_at = ${now}, updated_at = now() where id = ${r.id}`;
      await audit(tx, null, 'account.purged', 'user', r.id, { after: '30d' }, null);
    });
  }
  return { purged: rows.length };
}
