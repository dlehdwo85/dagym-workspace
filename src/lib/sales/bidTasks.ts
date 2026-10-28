// 결정 15-35(대표 10/26 17:00 확정): 입찰은 업무로, 현장 영업은 영업 진행(리드)으로 나눈다 — 입찰 공고가 리드 '신규리드'로 섞이던 길을 끊음.
// [입찰 업무로 넘기기] = 공고 하나에 입찰 업무 1건(첫 사람 주 담당, 나머지 공동 담당). 리드는 만들지 않는다.
//   기한은 공고 일정을 따라간다: 다가오는 참가신청(없으면 입찰) 마감의 전날 → 마감이 다 지나면 개찰일.
//   체크리스트(공고 검토·현장설명회·참가신청·입찰서 제출·개찰 결과 확인) · 회사 공용 캘린더 일정 · 공고 첨부(#507) · 배정 알림.
// 정기 점검(bidTasksTick, 정기 실행마다): 공고 취소 → 업무·일정 취소 + 알림 · 정정(날짜 바뀜) → 일정·기한 따라감(사람이 바꾼 기한은 그대로) ·
//   개찰 결과(낙찰자) → 우리 회사인지(사업자번호, 없으면 회사·브랜드 이름) → 낙찰이면 계약 기록 + 계약 업무, 아니면 결과를 남기고 입찰 업무를 마침.
//   사람이 [낙찰]·[미낙찰]·[유찰]로 바로잡을 수 있음(setBidResult).
// 재계약 사후관리(contractCareTick): 우리 계약(계약 기록)의 종료일 120일 전이 되면 '[재계약] … 재계약 준비' 업무 1건(기한 = 종료 90일 전).
// 리드 다음 연락(leadNextTick): 업무가 한 번도 없던 리드(예전 자료 이관분 등)도 다음 연락일이 가까우면 '다음 연락' 업무를 조용히 만듦 → 업무 목록·오늘 할 일에 보임.
import { z } from 'zod';
import { db, type Sql } from '../db';
import { zDate, zUuid } from '../api';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { activity, audit } from '../log';
import { notify } from '../notifications';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';
import { writesOpen } from './cutover';
import { latestCancelled, latestLive, noKey } from './noticeGroups';
import { BID_STATUS, workRecord } from './work';

export { BID_STATUS };
export const BID_RESULT_STATUS = { won: '낙찰', lost: '미낙찰', failed: '유찰', canceled: '공고 취소' } as const;
export type BidResult = 'won' | 'lost' | 'failed';
const SRC = 'opportunity_work';
/** 246차 #772 기한 규칙 표시 — 이 값이 없는 예전 입찰 업무는 정기 점검이 한 번 새 규칙(마감일 당일·마감 시각)으로 다시 계산 */
const DUE_RULE = 'close_day';
/** 넘기기로 붙는 진행 기록 칸 — 되돌리면 지움 */
const BID_KEYS = ['bid_task_id', 'bid_due_auto', 'bid_due_time', 'bid_due_rule', 'bid_name', 'bid_agency', 'bid_dates', 'bid_events', 'bid_result', 'handoff_by', 'handoff_at', 'assignees', 'handoff_prev_status'];

export const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return null; };
export const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
export const addDay = (day: string, n: number) => ymd(new Date(Date.parse(`${day}T12:00:00+09:00`) + n * 864e5));
export type When = { day: string; start: string; end: string; allDay: boolean };
/** 날짜(또는 일시) 문자열 → {day, start/end(ISO)} — 시각이 없으면 하루 종일, 오프셋 없는 시각은 서울 */
export function when(v: unknown): When | null {
  const s = String(v ?? '').trim(); if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (!m) { const d = new Date(s); if (Number.isNaN(d.getTime())) return null; return { day: ymd(d), start: d.toISOString(), end: new Date(d.getTime() + 3600e3).toISOString(), allDay: false }; }
  if (m[2]) { const st = /[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? new Date(s) : new Date(`${m[1]}T${m[2]}:${m[3]}:00+09:00`); return { day: ymd(st), start: st.toISOString(), end: new Date(st.getTime() + 3600e3).toISOString(), allDay: false }; }
  const st = new Date(`${m[1]}T00:00:00+09:00`); return { day: m[1], start: st.toISOString(), end: new Date(st.getTime() + 864e5).toISOString(), allDay: true };
}
export type MilestoneKey = 'briefing' | 'apply' | 'close' | 'open';
export type Milestone = { key: MilestoneKey; label: string; w: When };
const MS: [MilestoneKey, string, string[]][] = [
  ['briefing', '현장설명회', ['site_briefing_at', 'briefing_at', 'explanation_at', 'field_briefing_at', 'site_visit_at']],
  ['apply', '참가신청 마감', ['participation_deadline_at', 'registration_deadline_at', 'application_deadline_at']],
  ['close', '입찰 마감', ['deadline_at', 'close_at', 'bid_close_at', 'closing_date', 'end_date']],
  ['open', '개찰', ['opening_at', 'open_at', 'opening_date']],
];
/** 공고 일정(원천마다 칸 이름이 달라 후보 순서로) */
// 239차(#744 로컬 10/28 19:45): 현장설명이 '없음'이면 일정에서 빼고, 필수·임의면 이름에 붙임('현장설명회(필수)') — K-apt 상세 칸
export const bidMilestones = (r: any): Milestone[] => MS.flatMap(([key, label, keys]) => {
  if (key === 'briefing' && r?.site_briefing_kind === '없음') return [];
  const w = when(pick(r, ...keys)); if (!w) return [];
  // 242차 #761: 필수·임의·공고문 참조 모두 이름에 붙여 일정에서 바로 알게
  return [{ key, label: key === 'briefing' && ['필수', '임의', '공고문 참조'].includes(String(r?.site_briefing_kind ?? '')) ? `${label}(${r.site_briefing_kind})` : label, w }];
});
const hm = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export type Due = { day: string; time: string | null };
/** 246차 #772(대표 결정 10/28 21:10 '공고 마감일 당일 · 14시인지 17시인지 마감 시각에 맞춰'): 기한 = 다가오는 입찰 마감(없으면 참가신청 마감)의 날·시각
 *  → 마감이 다 지났으면 개찰일 → 그것도 지났으면 null(그대로 둠). (예전 규칙: 참가신청·입찰 마감 전날) */
export function bidDue(ms: Milestone[], today: string): Due | null {
  const next = (k: MilestoneKey) => ms.find((m) => m.key === k && m.w.day >= today);
  const m = next('close') ?? next('apply') ?? next('open');
  return m ? { day: m.w.day, time: m.w.allDay ? null : hm(m.w.start) } : null;
}
/** 246차 #771(대표 '입찰마감일정에 맞게 일정과 업무 · 현장설명회 일시가 있으면 현설 일정도 · 현설이 없으면 안 만듦'): 회사 캘린더에 만드는 일정 = 입찰 마감(없으면 참가신청 마감) + 현장설명회(일시가 있고 '없음'이 아닐 때) */
export function bidEventMs(ms: Milestone[]): Milestone[] {
  const close = ms.find((m) => m.key === 'close') ?? ms.find((m) => m.key === 'apply');
  return ms.filter((m) => m.key === 'briefing' || m === close);
}
/** '11/2(월) 17:00' — 기한 표시 */
export const fmtDue = (d: Due) => fmtWhen(d.time ? { day: d.day, start: new Date(`${d.day}T${d.time}:00+09:00`).toISOString(), end: '', allDay: false } : { day: d.day, start: '', end: '', allDay: true });
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function fmtWhen(w: When) {
  const md = `${Number(w.day.slice(5, 7))}/${Number(w.day.slice(8, 10))}(${DOW[new Date(`${w.day}T12:00:00+09:00`).getUTCDay()]})`;
  if (w.allDay) return md;
  return `${md} ${hm(w.start)}`;
}
const ITEM: Record<MilestoneKey, string> = { briefing: '현장설명회 참석', apply: '참가신청', close: '입찰서 제출', open: '개찰 결과 확인' };
/** 체크리스트: 공고 검토 + 아직 오지 않은 일정 + (개찰 일정이 없으면) 결과 확인 */
export function bidChecklist(ms: Milestone[], today: string) {
  const items = ['공고문·참가 자격 검토', ...ms.filter((m) => m.w.day >= today).map((m) => `${ITEM[m.key]} · ${fmtWhen(m.w)}`)];
  if (!ms.some((m) => m.key === 'open' && m.w.day >= today)) items.push('개찰 결과 확인');
  return items;
}
/** 242차 #761: 넘기기 창 미리 보기 — 이 공고로 만들 다가오는 일정(246차 #771: 현장설명회·입찰 마감만). 공고 줄은 공용 자료 */
export async function bidSchedulePreview(id: string) {
  const [r] = await db()<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id.slice(0, 200)}`;
  if (!r) return [];
  const today = ymd(new Date());
  return bidEventMs(bidMilestones(r.row)).filter((m) => m.w.day >= today).map((m) => ({ key: m.key, label: m.label, when: fmtWhen(m.w) }));
}
export const bidName = (r: any) => [pick(r, 'complex_name', 'facility_name'), pick(r, 'title', 'notice_title', 'bid_name')].filter(Boolean).join(' ').trim() || '입찰 공고';
const bidLink = (id: string) => `/s/sales/hub?tab=bids&bt=working&bq=${encodeURIComponent(id)}`;
const won = (n: unknown) => { const v = Number(String(n ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(v) && v > 0 ? `${Math.round(v).toLocaleString('ko-KR')}원` : null; };

/** 세션 없이(정기 점검) 업무를 만들 때 쓰는 사람 — 계정이 막혔으면 null */
export async function actorOf(sql: Sql, userId: string | null | undefined): Promise<SessionUser | null> {
  if (!userId) return null;
  const [r] = await sql<any[]>`select u.id, u.email, u.name, u.role, u.status, u.timezone, u.is_demo, u.platform_admin, u.tenant, t.kind from users u join tenants t on t.id = u.tenant where u.id = ${userId} and u.status = 'active'`;
  return r ? ({ id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, timezone: r.timezone, sessionId: '', isDemo: r.is_demo, platformAdmin: r.platform_admin, tenant: r.tenant, personal: r.kind === 'personal' } as SessionUser) : null;
}
export async function adminOf(sql: Sql, tenant: string) {
  const [r] = await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and status = 'active' and role in ('owner', 'admin') and not is_demo order by (role = 'owner') desc, created_at limit 1`;
  return actorOf(sql, r?.id);
}
/** 239차(#744): 넘긴 뒤에 알게 된 일정(K-apt 상세에서 읽은 현장설명 등) — 넘길 때와 같은 회사 공용 캘린더·담당자 참석. 넘긴 사람(없으면 관리자) 이름으로 */
async function addBidEvent(sql: Sql, tenant: string, d: any, m: Milestone, noticeId: string): Promise<string | null> {
  const ids: string[] = Array.isArray(d.assignees) ? d.assignees.filter((x: unknown): x is string => typeof x === 'string') : [];
  const u = (await actorOf(sql, d.handoff_by)) ?? (await adminOf(sql, tenant)); if (!u || u.tenant !== tenant || !ids.length) return null;
  const [cal] = await sql<{ id: string }[]>`select id from calendars where type = 'company' and tenant = ${tenant} order by created_at limit 1`; if (!cal) return null;
  const people = await sql<{ name: string }[]>`select name from users where tenant = ${tenant} and id = any(${ids}::uuid[])`;
  const { createEvent } = await import('../events');
  const ev: any = await createEvent(u, { calendarId: cal.id, title: `[입찰] ${m.label} · ${String(d.bid_name ?? '입찰')}`.slice(0, 200), description: `입찰 일정 — 담당 ${people.map((p) => p.name).join('·')}\n업무: /tasks/${d.bid_task_id}\n공고: ${bidLink(noticeId)}`,
    start: m.w.start, end: m.w.end, allDay: m.w.allDay, attendeeIds: ids, reminderMinutes: m.w.allDay ? [1440] : [1440, 60] } as never);
  return String(ev?.id ?? ev?.event?.id ?? '') || null;
}
const soonEvents = (d: any) => Object.values(d?.bid_events ?? {}).filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
/** 열린 입찰 업무·일정 취소(소프트 삭제 + 활동 기록) */
async function cancelTaskAndEvents(sql: Sql, d: any, actorId: string | null, reason: string, noticeId: string) {
  const tasks = d?.bid_task_id ? await sql<{ id: string }[]>`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = ${d.bid_task_id} and deleted_at is null and status <> 'done' returning id` : [];
  for (const tk of tasks) await activity(sql, 'task', tk.id, actorId, 'canceled', { reason, noticeId });
  const ev = soonEvents(d);
  const events = ev.length ? await sql<{ id: string }[]>`update events set deleted_at = now(), updated_at = now(), version = version + 1 where id = any(${ev}::uuid[]) and deleted_at is null returning id` : [];
  for (const e of events) await activity(sql, 'event', e.id, actorId, 'canceled', { reason, noticeId });
  return { tasks: tasks.length, events: events.length };
}

export const bidHandoffInput = z.object({ id: z.string().min(1).max(100), assigneeIds: z.array(zUuid).min(1).max(10), note: z.string().trim().max(500).optional() });
/** [입찰 업무로 넘기기] — 담당자 고르기 → 입찰 업무 1건(공동 담당) · 진행 기록 '입찰 진행' · 일정 · 첨부 · 알림. 리드는 만들지 않음 */
export async function handoffBid(u: SessionUser, i: z.infer<typeof bidHandoffInput>) {
  await assertSpace(u, 'sales'); const t = tenantOf(u); const sql = db();
  const [row] = await sql<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${i.id} and not gone`;
  if (!row) throw notFound('대상을 찾을 수 없습니다');
  if (!(await writesOpen(t))) throw new HttpError(409, 'sales_read_only', '영업관리 전환 전이라 워크인에서는 넘길 수 없습니다');
  const r = row.row; const cur = await workRecord(sql, t, 'bid', i.id);
  if (cur?.lead_id) throw new HttpError(409, 'already', '이미 영업 진행으로 넘긴 건입니다 — 리드에서 이어서 진행하세요');
  if (cur?.status === BID_STATUS && cur.data?.bid_task_id) throw new HttpError(409, 'already', '이미 입찰 업무로 넘긴 공고입니다 — 업무에서 이어서 진행하세요');
  const ids = [...new Set(i.assigneeIds)];
  const people = (await (await import('./handoff')).handoffPeople(u)).people.filter((p) => ids.includes(p.id));
  if (people.length !== ids.length) throw badRequest('담당자는 영업 공간 구성원·관리자 중에서 골라야 합니다');
  const name = bidName(r); const today = ymd(new Date());
  const ms = bidMilestones(r); const future = ms.filter((m) => m.w.day >= today);
  const dueAt = bidDue(ms, today); const due = dueAt?.day ?? addDay(today, 3); const dueTime = dueAt?.time ?? null;
  const agency = pick(r, 'issuer', 'agency', 'demand_agency', 'org_name');
  const link = bidLink(i.id);
  const desc = ['입찰 공고에서 넘어온 업무입니다. 기한은 입찰 마감 일시에 맞춰 자동으로 바뀌고, 공고가 취소되면 이 업무도 함께 취소됩니다.',
    agency ? `기관: ${agency}` : null, future.length ? `일정: ${future.map((m) => `${m.label} ${fmtWhen(m.w)}`).join(' · ')}` : null,
    i.note ? `메모: ${i.note}` : null, `공고: ${link}`].filter(Boolean).join('\n');
  const { createTask } = await import('../tasks');
  const task = await createTask(u, { title: `[입찰] ${name}`.slice(0, 200), description: desc, space: 'sales', assigneeId: ids[0], coAssigneeIds: ids.slice(1), requestedById: u.id, dueDate: due, dueTime,
    approvalRequired: false, tags: ['입찰'], checklist: bidChecklist(ms, today) } as never, { quiet: true, skipQuota: true });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: i.id, name, bid: true, handoff: true })} where id = ${task.id}`;
  // 넘기기 전에 상태 버튼(검토중·연락중)으로 생긴 자동 업무는 이 업무가 이어받음(같은 공고 업무 두 건 방지)
  const prev = await sql<{ id: string }[]>`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id <> ${task.id} and deleted_at is null and status <> 'done'
    and sales_ref->>'kind' = 'bid' and sales_ref->>'id' = ${i.id} and created_by in (select id from users where tenant = ${t}) returning id`;
  for (const p of prev) await activity(sql, 'task', p.id, u.id, 'merged_into', { into: task.id, reason: 'bid_handoff' });
  // 일정: 회사 공용 캘린더(없으면 건너뜀) — 참석 = 담당자, 알림 하루 전·1시간 전
  const events: Partial<Record<MilestoneKey, string>> = {}; const eventErrors: string[] = [];
  const evMs = bidEventMs(ms).filter((m) => m.w.day >= today); // 246차 #771: 입찰 마감 + 현장설명회(일시가 있을 때)만
  if (evMs.length) {
    const [cal] = await sql<{ id: string }[]>`select id from calendars where type = 'company' and tenant = ${t} order by created_at limit 1`;
    if (cal) { const { createEvent } = await import('../events');
      for (const m of evMs) {
        try { const ev: any = await createEvent(u, { calendarId: cal.id, title: `[입찰] ${m.label} · ${name}`.slice(0, 200), description: `입찰 일정 — 담당 ${people.map((p) => p.name).join('·')}\n업무: /tasks/${task.id}\n공고: ${link}`,
          start: m.w.start, end: m.w.end, allDay: m.w.allDay, attendeeIds: ids, reminderMinutes: m.w.allDay ? [1440] : [1440, 60] } as never); const eid = String(ev?.id ?? ev?.event?.id ?? ''); if (eid) events[m.key] = eid; }
        catch (e: any) { eventErrors.push(`${m.label}: ${String(e?.message ?? e).slice(0, 120)}`); }
      }
    } else eventErrors.push('회사 공용 캘린더가 없어 일정은 만들지 않았습니다');
  }
  const d = { ...(cur?.data ?? {}), status: BID_STATUS, notice_id: i.id, bid_task_id: task.id, bid_due_auto: due, bid_due_time: dueTime, bid_due_rule: DUE_RULE, bid_name: name, bid_agency: agency ?? null,
    bid_dates: Object.fromEntries(ms.map((m) => [m.key, m.w.start])), bid_events: events, bid_result: null, handoff_by: u.id, handoff_at: new Date().toISOString(), assignees: ids, handoff_prev_status: cur?.status ?? null };
  await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, lead_id, data) values (${t}, ${SRC}, ${cur?.src_id ?? `w:bid:${i.id}`}, ${i.id}, ${BID_STATUS}, null, ${sql.json(d)})
    on conflict (tenant, src_tbl, src_id) do update set status = excluded.status, lead_id = null, data = excluded.data, updated_at = now()`;
  // #507 공고 첨부: 응답 뒤에 받아 자료실 '영업/공고/…'에 한 번 저장 → 이 업무에 연결
  const auto = await import('./autoAttach');
  const files = auto.sourceFiles(r.attachment_urls ?? r.attachments, r.notice_file_url).length;
  auto.attachSourceFilesLater(u, { kind: 'bid', id: i.id, taskIds: [task.id] });
  await notify(sql, { userIds: ids.filter((x) => x !== u.id), type: 'task_assigned', space: 'sales', title: `입찰 업무: ${name.slice(0, 60)}`,
    body: `${u.name}님이 입찰 공고를 업무로 넘겼습니다 — 기한 ${fmtDue({ day: due, time: dueTime })}${ids.length > 1 ? ` · 공동 담당 ${ids.length}명` : ''}`, link: `/tasks/${task.id}`, entityType: 'task', entityId: task.id, actorId: u.id, push: true, dedupeKey: `sales:bid:${i.id}:${task.id}` } as never).catch(() => {});
  return { status: BID_STATUS, leadId: null, taskId: task.id, taskIds: [task.id], eventIds: Object.values(events), eventErrors, due, dueTime, dueText: fmtDue({ day: due, time: dueTime }), dates: future.map((m) => ({ label: m.label, day: m.w.day })), files, merged: prev.length };
}

export const bidRevertInput = z.object({ kind: z.literal('bid'), id: z.string().min(1).max(100), reason: z.string().trim().max(300).optional() });
/** 입찰 업무 넘기기 되돌리기(결과가 나오기 전) — 업무·일정 취소, 진행 기록은 넘기기 전 상태로 · 담당자·넘긴 사람·관리자 */
export async function revertBidHandoff(u: SessionUser, i: z.infer<typeof bidRevertInput>) {
  await assertSpace(u, 'sales'); const t = tenantOf(u); const sql = db();
  const cur = await workRecord(sql, t, 'bid', i.id);
  if (!cur?.data?.bid_task_id) throw notFound('입찰 업무로 넘긴 공고가 아닙니다');
  if (cur.status !== BID_STATUS) throw new HttpError(409, 'already', `이미 '${cur.status}'(으)로 끝난 공고라 되돌릴 수 없습니다`);
  const d = cur.data; const assignees: string[] = Array.isArray(d.assignees) ? d.assignees : [];
  if (!(['owner', 'admin'].includes(u.role) || d.handoff_by === u.id || assignees.includes(u.id))) throw forbidden('배정된 담당자·넘긴 사람·관리자만 되돌릴 수 있습니다');
  const prev = typeof d.handoff_prev_status === 'string' && d.handoff_prev_status && d.handoff_prev_status !== BID_STATUS ? d.handoff_prev_status : null;
  const out = await sql.begin(async (tx) => {
    const n = await cancelTaskAndEvents(tx as unknown as Sql, d, u.id, 'bid_handoff_revert', i.id);
    const nd = { ...d }; for (const k of BID_KEYS) delete nd[k];
    nd.status = prev; nd.reverted_at = new Date().toISOString(); nd.reverted_by = u.id; if (i.reason) nd.reverted_reason = i.reason;
    if (prev) await tx`update sales_work_records set status = ${prev}, data = ${tx.json(nd)}, updated_at = now() where tenant = ${t} and src_tbl = ${SRC} and src_id = ${cur.src_id}`;
    else await tx`delete from sales_work_records where tenant = ${t} and src_tbl = ${SRC} and src_id = ${cur.src_id}`;
    return n;
  });
  await notify(sql, { userIds: assignees.filter((x) => x !== u.id), type: 'task_assigned', space: 'sales', title: `입찰 업무 취소: ${String(d.bid_name ?? '입찰 공고').slice(0, 60)}`,
    body: `${u.name}님이 넘기기 이전으로 되돌렸습니다${i.reason ? ` — ${i.reason}` : ''}. 업무 ${out.tasks}건·일정 ${out.events}건은 취소되었습니다.`, link: bidLink(i.id), actorId: u.id, dedupeKey: `sales:bid:revert:${i.id}:${d.bid_task_id}` } as never).catch(() => {});
  return { ok: true, status: prev, ...out };
}

// ── 우리 회사 판정(개찰 결과) ─────────────────────────────────────────────
const CORP = /\(주\)|㈜|주식회사|\(유\)|유한회사|유한책임회사|합자회사|합명회사|\(사\)|사단법인|재단법인|\(재\)|협동조합/g;
/** 회사 이름 비교용: 법인 표시·띄어쓰기·기호를 뺀 이름 */
export const corpName = (v: unknown) => String(v ?? '').replace(CORP, '').replace(/[^0-9A-Za-z가-힣]/g, '').toLowerCase();
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '');
/** 이 회사 이름들(회사 정보·회사 프로필·지원사업 프로필의 브랜드)과 사업자번호 · 이름별로 아는 사업자번호 · 사업자번호 없는 회사 프로필(화면 안내) */
export async function ourIdentity(sql: Sql, tenant: string) {
  const names = new Set<string>(); const biz = new Set<string>(); const nameBiz = new Map<string, Set<string>>(); const labels = new Map<string, string>(); const noBiz: string[] = [];
  const add = (v: unknown, b = '') => { const n = corpName(v); if (n.length < 2) return; names.add(n); if (!labels.has(n)) labels.set(n, String(v).trim());
    if (b) nameBiz.set(n, (nameBiz.get(n) ?? new Set<string>()).add(b)); };
  const [tn] = await sql<{ name: string | null }[]>`select name from tenants where id = ${tenant}`; add(tn?.name);
  for (const p of await sql<{ name: string | null; biz_no: string | null }[]>`select name, biz_no from company_profiles where tenant = ${tenant} order by is_default desc, key`) {
    const b = digits(p.biz_no); if (b.length === 10) biz.add(b); else if (p.name) noBiz.push(p.name); add(p.name, b.length === 10 ? b : ''); }
  for (const s of await sql<{ brands: string[] | null }[]>`select brands from support_profiles where tenant = ${tenant}`) for (const b of s.brands ?? []) add(b);
  return { names, biz, nameBiz, labels: [...labels.values()], noBiz };
}
/** 사업자번호가 우리 것 → 우리 회사 · 이름이 같으면 우리 회사 — 단 그 이름의 사업자번호를 알고 있는데 낙찰 사업자번호가 다르면 같은 이름의 다른 회사
 *  (227차 로컬 10/28 '하이링크 낙찰 0': 전에는 우리 사업자번호가 하나라도 있으면 사업자번호만 봐서, 사업자번호를 안 넣은 회사 프로필의 낙찰을 못 찾음) */
export function isOurs(award: { name?: unknown; biz?: unknown }, me: { names: Set<string>; biz: Set<string>; nameBiz?: Map<string, Set<string>> }) {
  const b = digits(award.biz); if (b.length === 10 && me.biz.has(b)) return true;
  const n = corpName(award.name); if (n.length < 2 || !me.names.has(n)) return false;
  return b.length !== 10 || !me.nameBiz?.get(n)?.size;
}
type ResultIn = { result: BidResult; winner?: string | null; winnerBiz?: string | null; amount?: number | string | null; awardDate?: string | null; contractStart?: string | null; contractEnd?: string | null; note?: string | null };
/** 결과 반영(사람 또는 정기 점검) — 입찰 업무 마침 · 낙찰이면 계약 기록 + 계약 업무 · 낙찰이 아니게 바뀌면 자동 계약 기록·업무 정리 · 알림 */
async function applyResult(sql: Sql, tenant: string, rec: { src_id: string; status: string; data: any }, noticeId: string, res: ResultIn, by: SessionUser | null) {
  const d = rec.data ?? {}; const name = String(d.bid_name ?? '입찰 공고');
  const assignees: string[] = Array.isArray(d.assignees) ? d.assignees : [];
  const actor = by ?? (await actorOf(sql, d.handoff_by)) ?? (await actorOf(sql, assignees[0])) ?? (await adminOf(sql, tenant));
  const today = ymd(new Date()); const actorId = by?.id ?? null;
  let contractId: string | null = d.bid_contract_id ?? null, contractTaskId: string | null = d.bid_contract_task_id ?? null;
  if (d.bid_result === 'won' && res.result !== 'won') { // 낙찰 → 다른 결과로 바로잡음: 자동으로 만든 계약 기록·업무 정리
    const care = contractId ? (await sql<{ care: string | null }[]>`select data->>'care_task_id' as care from sales_lead_records where id = ${contractId} and tenant = ${tenant}`)[0]?.care ?? null : null;
    if (contractId) await sql`delete from sales_lead_records where id = ${contractId} and tenant = ${tenant} and data->'source'->>'id' = ${noticeId}`;
    for (const tid of [contractTaskId, care].filter((x): x is string => !!x)) // 계약 업무·재계약 준비 업무도 정리(끝난 것은 그대로)
      for (const x of await sql<{ id: string }[]>`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = ${tid} and deleted_at is null and status <> 'done' returning id`) await activity(sql, 'task', x.id, actorId, 'canceled', { reason: 'bid_result_changed', noticeId });
    contractId = null; contractTaskId = null;
  }
  // 입찰 업무는 결과가 나오면 마침(열려 있을 때만)
  for (const x of await sql<{ id: string; status: string }[]>`update tasks t set status = 'done', completed_at = now(), updated_at = now(), version = t.version + 1 from (select id, status from tasks where id = ${d.bid_task_id ?? null} and deleted_at is null and status <> 'done') o where t.id = o.id returning t.id, o.status`)
    await activity(sql, 'task', x.id, actorId, 'updated', { status: { from: x.status, to: 'done' }, reason: 'bid_result', result: res.result });
  const amount = res.amount != null && String(res.amount).trim() !== '' ? Number(String(res.amount).replace(/[^0-9.]/g, '')) || null : null;
  if (res.result === 'won' && contractId && (res.contractStart || res.contractEnd || amount != null)) { // 낙찰 뒤 계약 기간·금액을 나중에 넣음 → 그 계약 기록에
    await sql`update sales_lead_records set data = data || ${sql.json({ ...(res.contractStart ? { start_date: res.contractStart } : {}), ...(res.contractEnd ? { end_date: res.contractEnd } : {}), ...(amount != null ? { amount } : {}) })} where id = ${contractId} and tenant = ${tenant}`;
  }
  if (res.result === 'won' && !contractId) {
    const day = res.awardDate && /^\d{4}-\d{2}-\d{2}$/.test(res.awardDate) ? res.awardDate : today;
    const [c] = await sql<{ id: string }[]>`insert into sales_lead_records (tenant, kind, lead_id, occurred_at, data) values (${tenant}, 'contracts', null, ${`${day}T00:00:00+09:00`}, ${sql.json({
      title: name, amount, contract_date: day, status: '계약', start_date: res.contractStart ?? null, end_date: res.contractEnd ?? null, renew_stage: '영업 전', lead_name: d.bid_agency ?? null,
      created_by: actor?.id ?? null, memo: '입찰 낙찰로 자동 등록 — 계약 기간(시작·종료일)을 넣으면 종료 120일 전에 재계약 준비 업무가 생깁니다', source: { kind: 'bid', id: noticeId } })}) returning id`;
    contractId = c.id;
    if (actor) {
      const { createTask } = await import('../tasks');
      const tk = await createTask(actor, { title: `[계약] ${name} — 계약 체결·계약 기간 입력`.slice(0, 200), space: 'sales', assigneeId: assignees[0] ?? actor.id, coAssigneeIds: assignees.slice(1), requestedById: d.handoff_by ?? actor.id,
        description: `입찰에서 낙찰된 건입니다. 계약을 맺고 계약 기간(시작·종료일)을 계약 기록에 넣으면, 종료 120일 전에 재계약 준비 업무가 자동으로 생깁니다.\n계약 기록: /s/sales/deals\n공고: ${bidLink(noticeId)}`,
        dueDate: addDay(today, 7), approvalRequired: false, tags: ['입찰', '계약'], checklist: ['계약서 체결', '계약 기간(시작·종료일) 계약 기록에 입력', '착수 준비'] } as never, { quiet: true, skipQuota: true });
      await sql`update tasks set sales_ref = ${sql.json({ kind: 'contract', id: contractId, name, bidId: noticeId })} where id = ${tk.id}`;
      contractTaskId = tk.id;
    }
  }
  const status = BID_RESULT_STATUS[res.result];
  const nd = { ...d, status, bid_result: res.result, bid_result_at: new Date().toISOString(), bid_result_by: actorId, bid_result_auto: !by, bid_winner: res.winner ?? null, bid_winner_biz: res.winnerBiz ?? null,
    bid_amount: res.amount ?? null, bid_award_date: res.awardDate ?? null, bid_contract_id: contractId, bid_contract_task_id: contractTaskId, ...(res.note ? { bid_result_note: res.note } : {}) };
  await sql`update sales_work_records set status = ${status}, data = ${sql.json(nd)}, updated_at = now() where tenant = ${tenant} and src_tbl = ${SRC} and src_id = ${rec.src_id}`;
  const amt = won(res.amount);
  const msg = res.result === 'won' ? { title: `낙찰: ${name.slice(0, 60)}`, body: `개찰 결과 우리 회사가 낙찰되었습니다${amt ? `(${amt})` : ''}. 계약 기록과 계약 업무(기한 ${addDay(today, 7)})를 만들었습니다.` }
    : res.result === 'failed' ? { title: `유찰: ${name.slice(0, 60)}`, body: '유찰되었습니다. 입찰 업무는 마쳤습니다 — 재공고가 올라오면 다시 넘겨 주세요.' }
      : { title: `개찰 결과: ${name.slice(0, 60)}`, body: `${res.winner ? `낙찰 ${res.winner}${amt ? `(${amt})` : ''} — ` : ''}입찰 업무를 마쳤습니다. 우리 회사가 낙찰된 것이면 입찰 화면에서 [낙찰]로 바로잡아 주세요.` };
  await notify(sql, { userIds: [...new Set([...assignees, d.handoff_by].filter(Boolean))], type: 'bid_update', space: 'sales', ...msg, link: contractTaskId ? `/tasks/${contractTaskId}` : bidLink(noticeId),
    entityType: 'task', entityId: contractTaskId ?? d.bid_task_id ?? null, actorId, push: true, dedupeKey: `sales:bid:result:${noticeId}:${res.result}:${contractTaskId ?? ''}` } as never).catch(() => {});
  return { ok: true, status, result: res.result, contractId, contractTaskId };
}

export const bidResultInput = z.object({ id: z.string().min(1).max(100), result: z.enum(['won', 'lost', 'failed']), winner: z.string().trim().max(100).nullable().optional(), amount: z.number().min(0).max(1e13).nullable().optional(),
  contractStart: zDate.nullable().optional(), contractEnd: zDate.nullable().optional(), note: z.string().trim().max(300).optional() });
/** [낙찰]·[미낙찰]·[유찰] — 사람이 결과를 넣거나 자동 판정을 바로잡음 · 담당자·넘긴 사람·관리자 */
export async function setBidResult(u: SessionUser, i: z.infer<typeof bidResultInput>) {
  await assertSpace(u, 'sales'); const t = tenantOf(u); const sql = db();
  if (!(await writesOpen(t))) throw new HttpError(409, 'sales_read_only', '영업관리 전환 전이라 워크인에서는 고칠 수 없습니다');
  const cur = await workRecord(sql, t, 'bid', i.id);
  if (!cur?.data?.bid_task_id) throw notFound('입찰 업무로 넘긴 공고가 아닙니다');
  if (cur.status === BID_RESULT_STATUS.canceled) throw badRequest('취소된 공고입니다 — 다시 진행하려면 공고를 다시 넘겨 주세요');
  const d = cur.data; const assignees: string[] = Array.isArray(d.assignees) ? d.assignees : [];
  if (!(['owner', 'admin'].includes(u.role) || d.handoff_by === u.id || assignees.includes(u.id))) throw forbidden('배정된 담당자·넘긴 사람·관리자만 결과를 바꿀 수 있습니다');
  if (i.contractStart && i.contractEnd && i.contractEnd < i.contractStart) throw badRequest('계약 종료일이 시작일보다 앞입니다');
  const r = await applyResult(sql, t, cur, i.id, { result: i.result, winner: i.winner ?? d.bid_winner ?? null, winnerBiz: d.bid_winner_biz ?? null, amount: i.amount ?? d.bid_amount ?? null,
    awardDate: d.bid_award_date ?? null, contractStart: i.contractStart ?? null, contractEnd: i.contractEnd ?? null, note: i.note ?? null }, u);
  await audit(sql, u.id, 'sales.bid_result', 'sales_bid', i.id, { from: d.bid_result ?? null, to: i.result, auto: false }).catch(() => {});
  return r;
}

/** 같은 공고 묶음(나라장터·누리장터: 같은 번호, 차수만 다른 정정·취소 공고) — 정기 점검 한 번에 모아 읽음 */
async function groupsOf(sql: Sql, rows: { id: string; row: any }[]) {
  const keys = new Map<string, string[]>(); // 'source|base' → 공고 id 들
  for (const r of rows) { const k = noKey(r.row).key; if (k && /^(g2b_bid|nuri_bid)\|/.test(k)) keys.set(k, [...(keys.get(k) ?? []), r.id]); }
  const out = new Map<string, any[]>(rows.map((r) => [r.id, [{ ...r.row, id: r.id }]]));
  if (!keys.size) return out;
  const bases = [...keys.keys()].map((k) => k.split('|').slice(1).join('|'));
  const more = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone
    and row->>'source_type' in ('g2b_bid', 'nuri_bid') and regexp_replace(coalesce(row->>'source_external_id', ''), '-[0-9]{1,3}$', '') = any(${bases}::text[]) limit 2000`;
  for (const m of more) { const k = noKey(m.row).key; for (const id of (k && keys.get(k)) || []) { const g = out.get(id)!; if (!g.some((x) => String(x.id) === m.src_id)) g.push({ ...m.row, id: m.src_id }); } }
  return out;
}
const awardOf = (rows: any[]) => rows.find((x) => String(pick(x, 'winner_name', 'award_company', 'successful_bidder') ?? '').trim()) ?? null;

/**
 * 정기 점검(정기 실행마다) — '입찰 진행' 진행 기록만. 공고 취소 → 업무·일정 취소 · 개찰 결과 → 판정 · 날짜 정정 → 일정·기한 따라감.
 * 기한은 지금 기한이 지난번 자동 기한과 같을 때만 옮김(사람이 바꾼 기한은 그대로).
 */
export async function bidTasksTick(now = new Date()) {
  const sql = db(); const today = ymd(now);
  const recs = await sql<{ tenant: string; src_id: string; ref_id: string | null; status: string; data: any }[]>`select tenant, src_id, ref_id, status, data from sales_work_records
    where src_tbl = ${SRC} and status = ${BID_STATUS} and data ? 'bid_task_id' order by updated_at limit 300`;
  if (!recs.length) return { checked: 0 };
  const ids = [...new Set(recs.map((r) => String(r.ref_id ?? r.data?.notice_id ?? '')).filter(Boolean))];
  const own = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = any(${ids}::text[])`;
  const groups = await groupsOf(sql, own.map((o) => ({ id: o.src_id, row: o.row })));
  const me = new Map<string, Awaited<ReturnType<typeof ourIdentity>>>();
  let canceled = 0, results = 0, moved = 0; const errors: string[] = [];
  for (const rec of recs) {
    const id = String(rec.ref_id ?? rec.data?.notice_id ?? ''); const g = groups.get(id); if (!g) continue;
    try {
      const d = rec.data ?? {};
      // 넘긴 공고 줄 자신은 원천 상태가 '취소'일 때만 취소로 봄 — 제목에 '취소'가 든 일반 공고(notice_kind 추정)를 잘못 지우지 않게. 같은 번호의 다른 차수 취소 공고는 그대로
      const g0 = g.map((x) => (String(x.id) === id && x.notice_kind === 'cancel' && !/취소/.test(String(x.current_status ?? '')) ? { ...x, notice_kind: null } : x));
      if (latestCancelled(g0)) {
        const n = await cancelTaskAndEvents(sql, d, null, 'notice_canceled', id);
        await sql`update sales_work_records set status = ${BID_RESULT_STATUS.canceled}, data = ${sql.json({ ...d, status: BID_RESULT_STATUS.canceled, bid_result: 'canceled', bid_canceled_at: new Date().toISOString() })}, updated_at = now()
          where tenant = ${rec.tenant} and src_tbl = ${SRC} and src_id = ${rec.src_id}`;
        if (n.tasks) await notify(sql, { userIds: [...new Set([...(d.assignees ?? []), d.handoff_by].filter(Boolean))], type: 'bid_update', space: 'sales', title: `공고 취소: ${String(d.bid_name ?? '입찰 공고').slice(0, 60)}`,
          body: `발주처가 공고를 취소해 입찰 업무와 일정 ${n.events}건을 취소했습니다.`, link: bidLink(id), actorId: null, push: true, dedupeKey: `sales:bid:cancel:${id}` } as never).catch(() => {});
        canceled++; continue;
      }
      const award = awardOf(g);
      const failed = !award && g.some((x) => /유찰/.test(String(x?.current_status ?? '')));
      if (award || failed) {
        if (!me.has(rec.tenant)) me.set(rec.tenant, await ourIdentity(sql, rec.tenant));
        const res: ResultIn = award ? { result: isOurs({ name: pick(award, 'winner_name', 'award_company', 'successful_bidder'), biz: pick(award, 'winner_biz_no', 'winner_bizno') }, me.get(rec.tenant)!) ? 'won' : 'lost',
          winner: String(pick(award, 'winner_name', 'award_company', 'successful_bidder') ?? '') || null, winnerBiz: pick(award, 'winner_biz_no', 'winner_bizno'), amount: pick(award, 'winner_amount', 'award_amount', 'winning_amount'),
          awardDate: when(pick(award, 'award_date', 'opening_at', 'open_at'))?.day ?? null } : { result: 'failed' };
        await applyResult(sql, rec.tenant, rec, id, res, null);
        await audit(sql, null, 'sales.bid_result', 'sales_bid', id, { to: res.result, auto: true, winner: res.winner ?? null }).catch(() => {});
        results++; continue;
      }
      // 날짜 정정 → 일정 옮김 · 기한 따라감
      const live = latestLive(g) ?? g[0]; const ms = bidMilestones(live);
      const dates = Object.fromEntries(ms.map((m) => [m.key, m.w.start])) as Record<string, string>;
      let touched = false; const added: Record<string, string> = {}; const none: Record<string, boolean> = {};
      const want = new Set(bidEventMs(ms).map((m) => m.key)); // 246차 #771: 새로 만드는 일정은 입찰 마감·현장설명회만(예전에 만든 참가신청·개찰 일정은 날짜만 따라감)
      for (const m of ms) {
        const ev = (d.bid_events ?? {})[m.key]; const same = (d.bid_dates ?? {})[m.key] === m.w.start;
        // 242차 #761: 날짜는 그대로여도 일정이 없는 다가오는 일정(리드에서 옮긴 입찰 등)은 한 번 만듦 — 못 만들면(캘린더·담당 없음) 표시해 다시 시도하지 않음
        const missing = !ev && want.has(m.key) && m.w.day >= today && !(d.bid_event_none ?? {})[m.key];
        if (same && !missing) continue; touched = true;
        if (ev) await sql`update events set start_at = ${m.w.start}, end_at = ${m.w.end}, all_day = ${m.w.allDay}, updated_at = now(), version = version + 1 where id = ${ev} and deleted_at is null`;
        // 239차(#744): 넘긴 뒤에 새로 알게 된 일정은 한 번 만듦(날짜를 아래에서 기억하므로 다음 점검에서 다시 만들지 않음)
        else if (want.has(m.key) && m.w.day >= today) { const eid = await addBidEvent(sql, rec.tenant, d, m, id).catch((e) => { errors.push(`${id} 일정: ${String((e as Error)?.message ?? e).slice(0, 80)}`); return null; }); if (eid) added[m.key] = eid; else none[m.key] = true; }
      }
      const auto = bidDue(ms, today);
      // 246차 #772: 예전 규칙(마감 전날)으로 만든 열린 업무는 한 번 새 규칙(마감일 당일·마감 시각)으로 — 사람이 옮긴 기한도(대표 '이미 만든 입찰 업무도 다시 계산')
      const relaid = d.bid_due_rule !== DUE_RULE;
      if (auto && (relaid || auto.day !== d.bid_due_auto || auto.time !== (d.bid_due_time ?? null))) {
        touched = true;
        const mv = await sql<{ id: string; from: string | null; fromTime: string | null }[]>`update tasks x set due_date = ${auto.day}, due_time = ${auto.time}::time, updated_at = now(), version = x.version + 1
          from tasks o where o.id = x.id and x.id = ${d.bid_task_id} and x.deleted_at is null and x.status <> 'done'
            and (${relaid} or (x.due_date = ${d.bid_due_auto ?? null}::date and to_char(x.due_time, 'HH24:MI') is not distinct from ${d.bid_due_time ?? null}::text))
            and (x.due_date is distinct from ${auto.day}::date or to_char(x.due_time, 'HH24:MI') is distinct from ${auto.time}::text)
          returning x.id, o.due_date::text as from, to_char(o.due_time, 'HH24:MI') as "fromTime"`;
        for (const x of mv) await activity(sql, 'task', x.id, null, 'updated', { dueDate: { from: x.from, to: auto.day }, dueTime: { from: x.fromTime, to: auto.time }, reason: relaid ? 'bid_rule_close_day' : 'bid_schedule' });
        if (mv.length) moved++;
      }
      if (touched || relaid) await sql`update sales_work_records set data = ${sql.json({ ...d, bid_dates: { ...(d.bid_dates ?? {}), ...dates }, bid_events: { ...(d.bid_events ?? {}), ...added }, ...(Object.keys(none).length ? { bid_event_none: { ...(d.bid_event_none ?? {}), ...none } } : {}),
        bid_due_auto: auto?.day ?? d.bid_due_auto ?? null, bid_due_time: auto ? auto.time : d.bid_due_time ?? null, bid_due_rule: DUE_RULE })}, updated_at = now()
        where tenant = ${rec.tenant} and src_tbl = ${SRC} and src_id = ${rec.src_id}`;
    } catch (e) { errors.push(`${id}: ${String((e as Error)?.message ?? e).slice(0, 120)}`); }
  }
  if (errors.length) await (await import('../log')).logError('tick:bidTasks', new Error(errors.slice(0, 5).join(' | '))).catch(() => {});
  return { checked: recs.length, canceled, results, moved, errors: errors.length };
}

/**
 * 재계약 사후관리 — 우리 계약(워크인에서 등록한 계약 기록 — 입찰 낙찰 포함, 예전 영업관리에서 옮겨 온 기록은 제외 · 상태 종료·해지 아님)의 종료일이 120일 안으로 들어오면
 * '[재계약] … 재계약 준비' 업무 1건(기한 = 종료 90일 전, 지났으면 오늘).
 * 담당 = 리드 담당 → 입찰 담당 → 적은 사람 → 관리자. 한 계약에 한 번(care_task_id).
 */
export async function contractCareTick(now = new Date()) {
  const sql = db(); const today = ymd(now);
  const rows = await sql<{ id: string; tenant: string; lead_id: string | null; data: any; owner_id: string | null }[]>`select r.id, r.tenant, r.lead_id, r.data, l.owner_id from sales_lead_records r left join sales_leads l on l.id = r.lead_id
    where r.kind = 'contracts' and r.src_id is null and coalesce(r.data->>'end_date', '') between ${today} and ${addDay(today, 120)} and coalesce(r.data->>'care_task_id', '') = ''
      and coalesce(r.data->>'status', '계약') not in ('종료', '해지') order by r.data->>'end_date' limit 50`;
  let made = 0;
  for (const r of rows) {
    const d = r.data ?? {}; const end = String(d.end_date); const title = String(d.title ?? '계약');
    let bidOwner: string | null = null;
    if (d.source?.kind === 'bid' && d.source?.id) { const [w] = await sql<{ data: any }[]>`select data from sales_work_records where tenant = ${r.tenant} and src_tbl = ${SRC} and ref_id = ${String(d.source.id)} order by updated_at desc limit 1`; bidOwner = w?.data?.assignees?.[0] ?? null; }
    const actor = (await actorOf(sql, r.owner_id)) ?? (await actorOf(sql, bidOwner)) ?? (await actorOf(sql, d.created_by)) ?? (await adminOf(sql, r.tenant));
    if (!actor || actor.tenant !== r.tenant) continue;
    const due = addDay(end, -90) > today ? addDay(end, -90) : today;
    const { createTask } = await import('../tasks');
    const tk = await createTask(actor, { title: `[재계약] ${title} — 재계약 준비`.slice(0, 200), space: 'sales', assigneeId: actor.id, requestedById: actor.id, dueDate: due, approvalRequired: false, tags: ['재계약'],
      description: `계약 종료일 ${end} — 종료 전에 재계약(재입찰) 준비를 시작하세요.\n계약: ${title}${d.lead_name ? ` (${d.lead_name})` : ''}${r.lead_id ? `\n거래처: /s/sales/leads?id=${r.lead_id}` : ''}\n계약 기록: /s/sales/deals`,
      checklist: ['발주처·거래처 담당자 연락', '재계약·재입찰 일정 확인', '제안·견적 준비', `계약 종료 · ${fmtWhen(when(end)!)}`] } as never, { quiet: true, skipQuota: true });
    await sql`update tasks set sales_ref = ${sql.json({ kind: 'contract', id: r.id, name: title })}, lead_id = ${r.lead_id} where id = ${tk.id}`;
    await sql`update sales_lead_records set data = data || ${sql.json({ care_task_id: tk.id, care_at: new Date().toISOString() })} where id = ${r.id}`;
    await notify(sql, { userIds: [actor.id], type: 'task_assigned', space: 'sales', title: `재계약 준비: ${title.slice(0, 60)}`, body: `계약 종료 ${end} — 재계약 준비 업무를 만들었습니다(기한 ${due}).`,
      link: `/tasks/${tk.id}`, entityType: 'task', entityId: tk.id, actorId: null, push: true, dedupeKey: `sales:contract:care:${r.id}` } as never).catch(() => {});
    made++;
  }
  return { checked: rows.length, made };
}

/**
 * 리드 다음 연락 → 업무(결정 15-35 '영업 진행의 다음 연락은 업무 목록·오늘 할 일에도'). 리드를 만들거나 고칠 때는 이미 업무가 생기므로,
 * 업무가 한 번도 없던 진행 중 리드(예전 자료 이관분 등)만 — 다음 연락일이 2주 전 ~ 7일 뒤인 것, 정기 실행마다 30건까지, 알림 없이.
 */
export async function leadNextTick(now = new Date()) {
  const sql = db(); const today = ymd(now);
  const leads = await sql<{ id: string; name: string; status: string | null; owner_id: string; next: string }[]>`select l.id, l.name, l.status, l.owner_id, l.next_contact_date::text as next
    from sales_leads l join sales_cutover c on c.tenant = l.tenant and c.writes_open
    where l.deleted_at is null and l.owner_id is not null and l.next_contact_date between ${addDay(today, -14)}::date and ${addDay(today, 7)}::date
      and coalesce(l.status, '') not in ('계약완료', '보류', '실패', '되돌림', '대상아님', '대상 아님')
      and not exists (select 1 from tasks t where t.lead_id = l.id or (t.sales_ref->>'kind' = 'lead' and t.sales_ref->>'id' = l.id::text))
    order by l.next_contact_date limit 30`;
  let made = 0;
  const { syncSalesTask } = await import('./autoTasks');
  for (const l of leads) {
    const actor = await actorOf(sql, l.owner_id); if (!actor) continue;
    const r = await syncSalesTask(sql, actor, { kind: 'lead', id: l.id, name: l.name, status: l.status, nextDate: l.next, nextAction: '다음 연락', assigneeId: l.owner_id, leadId: l.id, quiet: true });
    if (r.action === 'created') made++;
  }
  return { checked: leads.length, made };
}

// ── 예전 자료 정리(결정 15-35) ───────────────────────────────────────────
// 이 결정 전에 입찰 공고에서 넘어와 리드가 된 건(넘기기·진행영업 전환) — 관리자가 미리 보고 고른 것만 입찰 업무로 옮긴다.
// 옮길 수 있는 것 = 아직 '신규리드'·'1차연락완료'이고 상담·제안·계약 기록이 없는 리드. 그 밖은 현장 영업으로 진행한 것이라 그대로 둠.
const EARLY = new Set(['신규리드', '1차연락완료']);
type BidLeadRow = { id: string; name: string; status: string | null; owner_id: string | null; owner_name: string | null; src: any; created_at: Date; src_id: string; ref_id: string | null; work_data: any; recs: number; open_tasks: number };
async function bidLeadRows(sql: Sql, tenant: string) {
  return sql<BidLeadRow[]>`select l.id, l.name, l.status, l.owner_id, ou.name as owner_name, l.src, l.created_at, w.src_id, w.ref_id, w.data as work_data,
      (select count(*)::int from sales_lead_records x where x.lead_id = l.id and x.kind in ('sales_activities', 'proposals', 'contracts')) as recs,
      (select count(*)::int from tasks k where k.deleted_at is null and k.status <> 'done' and (k.lead_id = l.id or (k.sales_ref->>'kind' = 'bid' and k.sales_ref->>'id' = w.ref_id))) as open_tasks
    from sales_leads l join sales_work_records w on w.tenant = l.tenant and w.lead_id = l.id and w.src_tbl = ${SRC}
    left join users ou on ou.id = l.owner_id
    where l.tenant = ${tenant} and l.deleted_at is null and coalesce(l.src->>'from', '') = 'bid' and coalesce(l.status, '') <> '되돌림'
    order by l.created_at desc limit 200`;
}
const whyKeep = (r: BidLeadRow) => !EARLY.has(String(r.status ?? '')) ? `'${r.status ?? '단계 없음'}'까지 진행한 리드라 현장 영업으로 그대로 둡니다` : r.recs ? `상담·제안·계약 기록 ${r.recs}건이 있어 그대로 둡니다` : null;
async function assertAdmin(u: SessionUser) { await assertSpace(u, 'sales'); if (!['owner', 'admin'].includes(u.role)) throw forbidden('관리자만 할 수 있습니다'); }
/** 미리 보기: 입찰 공고에서 넘어온 리드 목록 · 옮길 수 있는지·이유 */
export async function bidLeadsPreview(u: SessionUser) {
  await assertAdmin(u);
  const rows = await bidLeadRows(db(), tenantOf(u));
  return { items: rows.map((r) => ({ id: r.id, name: r.name, status: r.status, owner: r.owner_name, noticeId: r.ref_id, createdAt: r.created_at, records: r.recs, openTasks: r.open_tasks, movable: !whyKeep(r), why: whyKeep(r) })) };
}
export const moveBidLeadsInput = z.object({ leadIds: z.array(zUuid).min(1).max(200) });
/** 고른 리드를 입찰 업무로 옮김 — 넘기기로 만든 입찰 업무는 리드 연결만 끊고, 리드 업무('첫 연락')는 입찰 업무로 바꿈(하나만) · 진행 기록 '입찰 진행' · 리드는 보관함('되돌림', 사유) */
export async function moveBidLeads(u: SessionUser, i: z.infer<typeof moveBidLeadsInput>) {
  await assertAdmin(u); const t = tenantOf(u); const sql = db();
  if (!(await writesOpen(t))) throw new HttpError(409, 'sales_read_only', '영업관리 전환 전이라 워크인에서는 고칠 수 없습니다');
  const want = new Set(i.leadIds);
  const rows = (await bidLeadRows(sql, t)).filter((r) => want.has(r.id));
  const moved: { id: string; name: string; taskId: string | null }[] = []; const skipped: { id: string; name: string; why: string }[] = [];
  for (const r of rows) {
    const why = whyKeep(r); if (why || !r.ref_id) { skipped.push({ id: r.id, name: r.name, why: why ?? '연결된 공고가 없습니다' }); continue; }
    const noticeId = r.ref_id;
    const [nrow] = await sql<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = ${noticeId}`;
    const ms = nrow ? bidMilestones(nrow.row) : [];
    const due = bidDue(ms, ymd(new Date())); // 242차 #762 → 246차 #772: 리드 업무를 입찰 업무로 바꿀 때 기한도 넘기기와 같은 규칙(입찰 마감일 당일·마감 시각)으로
    const taskId = await sql.begin(async (tx) => {
      // 넘기기로 만든 입찰 업무(담당자마다 1건이던 예전 방식) — 리드 연결만 끊음
      const bidT = await tx<{ id: string; status: string; due: string | null }[]>`update tasks set lead_id = null, sales_ref = coalesce(sales_ref, '{}'::jsonb) || ${tx.json({ bid: true })}, updated_at = now(), version = version + 1
        where deleted_at is null and sales_ref->>'kind' = 'bid' and sales_ref->>'id' = ${noticeId} and (lead_id = ${r.id} or lead_id is null)
          and created_by in (select id from users where tenant = ${t}) returning id, status, due_date::text as due`;
      let main = bidT.find((x) => x.status !== 'done') ?? null;
      // 리드 업무('첫 연락' 등) — 열린 입찰 업무가 없으면 첫 번째를 입찰 업무로 바꾸고, 나머지는 그 업무로 합침
      for (const lt of await tx<{ id: string; status: string; due: string | null }[]>`select id, status, due_date::text as due from tasks where deleted_at is null and lead_id = ${r.id} and status <> 'done' order by created_at`) {
        if (!main) {
          await tx`update tasks set title = ${`[입찰] ${r.name}`.slice(0, 200)}, lead_id = null, sales_ref = ${tx.json({ kind: 'bid', id: noticeId, name: r.name, bid: true })},
            due_date = coalesce(${due?.day ?? null}::date, due_date), due_time = case when ${due?.day ?? null}::date is null then due_time else ${due?.time ?? null}::time end, updated_at = now(), version = version + 1 where id = ${lt.id}`;
          await activity(tx as unknown as Sql, 'task', lt.id, u.id, 'updated', { reason: 'moved_to_bid', leadId: r.id, ...(due && due.day !== lt.due ? { due: { from: lt.due, to: due.day } } : {}) }); main = { ...lt, due: due?.day ?? lt.due };
        } else {
          await tx`update tasks set deleted_at = now(), updated_at = now(), version = version + 1 where id = ${lt.id}`;
          await activity(tx as unknown as Sql, 'task', lt.id, u.id, 'merged_into', { into: main.id, reason: 'moved_to_bid' });
        }
      }
      // 예전 일정(제목 '[영업] 현장설명회 · …')은 그대로 두고 리드 연결만 끊음 — 정기 점검이 날짜를 따라가도록 일정 종류를 기억
      const evIds: string[] = Array.isArray(r.src?.eventIds) ? r.src.eventIds.filter((x: unknown) => typeof x === 'string') : [];
      const evs = evIds.length ? await tx<{ id: string; title: string }[]>`select id, title from events where id = any(${evIds}::uuid[]) and deleted_at is null` : [];
      const events: Record<string, string> = {};
      for (const e of evs) { const label = e.title.replace(/^\[[^\]]*\]\s*/, '').split(' · ')[0]; const k = MS.find(([, l]) => l === label || label.startsWith(`${l}(`))?.[0]; if (k) events[k] = e.id; } // 239차 '현장설명회(필수)'
      await tx`update events set lead_id = null where lead_id = ${r.id}`;
      const wd = { ...(r.work_data ?? {}) }; for (const k of ['lead_id', 'converted_by', 'converted_at']) delete wd[k];
      const assignees: string[] = Array.isArray(r.src?.assignees) && r.src.assignees.length ? r.src.assignees : r.owner_id ? [r.owner_id] : [];
      const prevSt = typeof wd.handoff_prev_status === 'string' && wd.handoff_prev_status ? wd.handoff_prev_status : '검토중';
      const st = main ? BID_STATUS : prevSt;
      const nd = main ? { ...wd, status: st, notice_id: noticeId, bid_task_id: main.id, bid_due_auto: main.due ?? null, bid_due_time: due && main.due === due.day ? due.time : null, bid_name: r.name, bid_agency: wd.bid_agency ?? null, bid_dates: Object.fromEntries(ms.map((m) => [m.key, m.w.start])),
        bid_events: events, bid_result: null, handoff_by: r.src?.by ?? wd.handoff_by ?? u.id, handoff_at: wd.handoff_at ?? new Date(r.created_at).toISOString(), assignees, handoff_prev_status: null, moved_from_lead: r.id }
        : { ...wd, status: st, moved_from_lead: r.id };
      await tx`update sales_work_records set status = ${st}, lead_id = null, data = ${tx.json(nd)}, updated_at = now() where tenant = ${t} and src_tbl = ${SRC} and src_id = ${r.src_id}`;
      await tx`update sales_leads set status = '되돌림', src = coalesce(src, '{}'::jsonb) || ${tx.json({ moved_to_bid: { at: new Date().toISOString(), by: u.id, taskId: main?.id ?? null } })}, updated_at = now() where id = ${r.id}`;
      await tx`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${t}, ${r.id}, ${r.status}, '되돌림', '입찰은 업무로 관리 — 입찰 업무로 옮김', ${u.id})`;
      return main?.id ?? null;
    });
    moved.push({ id: r.id, name: r.name, taskId });
  }
  for (const id of want) if (!rows.some((r) => r.id === id)) skipped.push({ id, name: '', why: '입찰 공고에서 넘어온 리드가 아니거나 이미 옮겼습니다' });
  await audit(sql, u.id, 'sales.bid_leads_move', 'tenant', t, { moved: moved.map((m) => m.id), skipped: skipped.length }).catch(() => {});
  return { ok: true, moved, skipped };
}

export type { Sql };
