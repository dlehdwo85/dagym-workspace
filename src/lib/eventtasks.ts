import { z } from 'zod';
import { DateTime } from 'luxon';
import { db, type Sql } from './db';
import { accessibleUnitIds, loadTaskForUser, taskVisibleSql } from './access';
import { badRequest, forbidden } from './errors';
import { activity } from './log';
import { notify } from './notifications';
import { loadEvent } from './events';
import { occurrences } from './recurrence';
import { TASK_COLS, TASK_FROM, createTask } from './tasks';
import { addDays } from './time';
import { zDate, zUuid } from './api';
import type { SessionUser } from './types';

const TZ = 'Asia/Seoul';
const seoulDateOf = (d: Date | string) => DateTime.fromJSDate(new Date(d)).setZone(TZ).toISODate()!;

/** 일정 준비 업무 묶음 (S-8). 일정 시작일 기준 D-n 마감 */
export const PREP_PRESETS: Record<string, { label: string; items: { title: string; daysBefore: number }[] }> = {
  gx_open: { label: 'GX 개강', items: [{ title: '개강 공지·회원 안내', daysBefore: 7 }, { title: '강사 일정 확정', daysBefore: 5 }, { title: '음향·장비 점검', daysBefore: 1 }] },
  site_inspection: { label: '현장 점검', items: [{ title: '점검표 준비', daysBefore: 3 }, { title: '현장 담당자 공지', daysBefore: 1 }] },
  contract_meeting: { label: '계약 미팅', items: [{ title: '계약서 초안 검토', daysBefore: 2 }, { title: '미팅 자료 출력', daysBefore: 1 }] },
  event_promo: { label: '행사·프로모션', items: [{ title: '홍보물 제작', daysBefore: 10 }, { title: 'SNS·문자 공지', daysBefore: 5 }, { title: '현장 준비물 확인', daysBefore: 1 }] },
};

async function eventCtx(u: SessionUser, eventId: string, sql: Sql = db()) {
  const { event, perms } = await loadEvent(u, eventId, sql);
  const masterId = event.recurring_event_id ?? event.id;
  const [cal] = await sql<{ type: string; org_unit_id: string | null }[]>`select type, org_unit_id from calendars where id = ${event.calendar_id}`;
  return { event, perms, masterId, cal, canWork: perms.edit || perms.attendee };
}

/** 일정에 연결된 업무 (보는 사람에게 권한 있는 것만). 반복 일정은 시리즈 전체 + 이 회차 연결 */
export async function linkedTasks(u: SessionUser, eventId: string, occurrenceStart?: string | null) {
  const sql = db();
  const { masterId, event } = await eventCtx(u, eventId, sql);
  const units = await accessibleUnitIds(u, sql);
  const occ = occurrenceStart ? new Date(occurrenceStart) : event.original_start ?? null;
  return sql<any[]>`
    select ${TASK_COLS(sql)}, et.role as link_role, et.offset_days, et.note_line, et.occurrence_start
    ${TASK_FROM(sql)} join event_tasks et on et.task_id = t.id
    where et.event_id in (${masterId}, ${event.id}) and t.deleted_at is null and ${taskVisibleSql(sql, u, units)}
      and (et.occurrence_start is null or ${occ === null ? sql`true` : sql`et.occurrence_start = ${occ}`})
    order by case et.role when 'prep' then 0 when 'block' then 1 when 'link' then 2 else 3 end, t.due_date nulls last, t.created_at`;
}

/** 업무에 연결된 일정 (보는 사람에게 권한 있는 것만) */
export async function linkedEvents(u: SessionUser, taskId: string) {
  const sql = db();
  await loadTaskForUser(u, taskId, sql);
  const rows = await sql<any[]>`
    select distinct on (e.id) e.id, e.title, e.start_at, e.end_at, e.all_day, e.kind, e.rrule, c.color, c.name as calendar_name, et.role, et.occurrence_start, et.sync
    from event_tasks et join events e on e.id = et.event_id join calendars c on c.id = e.calendar_id
    where et.task_id in (select ${taskId}::uuid union select recurrence_source_id from tasks where id = ${taskId} and recurrence_source_id is not null) and e.deleted_at is null order by e.id, e.start_at`;
  const out = [];
  for (const r of rows) {
    try { await loadEvent(u, r.id, sql); out.push(r); } catch { /* 권한 밖 일정은 숨김 */ }
  }
  return out.sort((a, b) => +new Date(a.occurrence_start ?? a.start_at) - +new Date(b.occurrence_start ?? b.start_at));
}

export const linkInput = z.object({ taskId: zUuid, occurrenceStart: z.string().datetime({ offset: true }).optional() });
export async function linkTask(u: SessionUser, eventId: string, i: z.infer<typeof linkInput>) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  if (!c.canWork) throw forbidden('일정 작성자·편집 권한자·참석자만 업무를 연결할 수 있습니다');
  await loadTaskForUser(u, i.taskId, sql);
  await sql`insert into event_tasks (event_id, task_id, role, occurrence_start, created_by)
    values (${c.masterId}, ${i.taskId}, 'link', ${i.occurrenceStart ? new Date(i.occurrenceStart) : null}, ${u.id}) on conflict do nothing`;
  await activity(sql, 'task', i.taskId, u.id, 'event_linked', { eventId: c.masterId, title: c.event.title });
  return { ok: true };
}
export async function unlinkTask(u: SessionUser, eventId: string, taskId: string) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  if (!c.canWork) throw forbidden('연결을 해제할 권한이 없습니다');
  await loadTaskForUser(u, taskId, sql);
  await sql`delete from event_tasks where event_id in (${c.masterId}, ${c.event.id}) and task_id = ${taskId}`;
  return { ok: true };
}

/** 업무를 만들 소속: 조직 캘린더면 그 조직, 아니면 담당자(없으면 만든 사람)의 첫 소속 */
async function defaultUnit(sql: Sql, cal: { type: string; org_unit_id: string | null }, assigneeId: string | null | undefined, u: SessionUser) {
  if (cal.type === 'org_unit' && cal.org_unit_id) return cal.org_unit_id;
  const who = assigneeId ?? u.id;
  const [m] = await sql<{ org_unit_id: string }[]>`select org_unit_id from memberships where user_id = ${who} order by org_unit_id limit 1`;
  return m?.org_unit_id;
}

/** S-1·S-2 일정에서 새 업무 만들기 (회의 메모 줄 → 후속 업무 포함). 만든 업무는 자동 연결 */
export const eventTaskInput = z.object({
  title: z.string().trim().min(1, '제목을 입력하세요').max(200),
  assigneeId: zUuid.nullable().optional(),
  dueDate: zDate.nullable().optional(),
  orgUnitId: zUuid.optional(),
  noteLine: z.string().max(500).optional(),
  occurrenceStart: z.string().datetime({ offset: true }).optional(),
  estimateMinutes: z.number().int().min(0).max(100000).optional(),
});
export async function createTaskFromEvent(u: SessionUser, eventId: string, i: z.infer<typeof eventTaskInput>) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  if (!c.canWork) throw forbidden('일정 작성자·편집 권한자·참석자만 업무를 만들 수 있습니다');
  const occ = i.occurrenceStart ? new Date(i.occurrenceStart) : c.event.original_start ?? c.event.start_at;
  const due = i.dueDate === undefined ? addDays(seoulDateOf(occ), 3) : i.dueDate;
  const orgUnitId = i.orgUnitId ?? (await defaultUnit(sql, c.cal, i.assigneeId, u));
  const role = i.noteLine ? 'followup' : 'link';
  const { id } = await createTask(u, {
    title: i.title, assigneeId: i.assigneeId ?? null, dueDate: due, orgUnitId, approvalRequired: false,
    description: i.noteLine ? `회의 '${c.event.title}' (${seoulDateOf(occ)}) 메모에서 만든 후속 업무` : `일정 '${c.event.title}' 에서 만든 업무`,
    ...(i.estimateMinutes !== undefined ? { estimateMinutes: i.estimateMinutes } : {}),
  } as never);
  await sql`insert into event_tasks (event_id, task_id, role, note_line, occurrence_start, created_by)
    values (${c.masterId}, ${id}, ${role}, ${i.noteLine ?? null}, ${c.event.rrule || c.event.recurring_event_id ? occ : null}, ${u.id}) on conflict do nothing`;
  return { id };
}

/** S-2 회의 메모 (회차별) */
export async function getNotes(u: SessionUser, eventId: string, occurrenceStart?: string | null) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  const occ = c.event.rrule && occurrenceStart ? new Date(occurrenceStart).toISOString() : '';
  const [n] = await sql<{ body: string; updated_at: Date; updated_by_name: string | null }[]>`
    select n.body, n.updated_at, uu.name as updated_by_name from event_notes n left join users uu on uu.id = n.updated_by where n.event_id = ${c.event.id} and n.occ = ${occ}`;
  return { body: n?.body ?? '', updatedAt: n?.updated_at ?? null, updatedBy: n?.updated_by_name ?? null, canEdit: c.canWork };
}
export const notesInput = z.object({ body: z.string().max(20000), occurrenceStart: z.string().datetime({ offset: true }).optional() });
export async function saveNotes(u: SessionUser, eventId: string, i: z.infer<typeof notesInput>) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  if (!c.canWork) throw forbidden('회의 메모는 참석자·편집 권한자만 작성합니다');
  const occ = c.event.rrule && i.occurrenceStart ? new Date(i.occurrenceStart).toISOString() : '';
  await sql`insert into event_notes (event_id, occ, body, updated_by) values (${c.event.id}, ${occ}, ${i.body}, ${u.id})
    on conflict (event_id, occ) do update set body = excluded.body, updated_by = excluded.updated_by, updated_at = now()`;
  // V8 7번: 회의 메모의 "@이름" → 이 일정을 볼 수 있는 사람(참석자·주인·만든 사람)에게 알림, 같은 메모 안 같은 사람은 한 번
  const names = [...new Set([...i.body.matchAll(/@([가-힣A-Za-z]{2,20})/g)].map((m) => m[1]))];
  if (names.length) {
    const cands = await sql<{ id: string; name: string }[]>`select u.id, u.name from users u where u.status = 'active' and (
      u.id in (select user_id from event_attendees where event_id = ${c.masterId}) or u.id = ${c.event.created_by}
      or u.id = (select owner_user_id from calendars where id = ${c.event.calendar_id}))`;
    const hit = cands.filter((x) => names.some((n) => n === x.name || n.startsWith(x.name)));
    if (hit.length) {
      await notify(sql, { userIds: hit.map((x) => x.id), type: 'mention', title: `${u.name}님이 회의 메모에서 회원님을 언급했습니다`, body: c.event.title,
        link: `/calendar?event=${c.masterId}`, entityType: 'event', entityId: c.masterId, actorId: u.id, dedupeKey: `evmention:${c.masterId}:${occ}:${hit.map((x) => x.id).sort().join(',')}:${i.body.length}` });
    }
  }
  return { ok: true };
}

/** S-8 일정 준비 업무 만들기 (D-n 마감). 일정 날짜가 바뀌면 shiftPrepTasks 가 따라 옮긴다 */
export const prepInput = z.object({
  preset: z.string().optional(),
  items: z.array(z.object({ title: z.string().trim().min(1).max(200), daysBefore: z.number().int().min(0).max(60), assigneeId: zUuid.nullable().optional() })).max(10).optional(),
  assigneeId: zUuid.nullable().optional(),
});
export async function createPrepTasks(u: SessionUser, eventId: string, i: z.infer<typeof prepInput>) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  if (!c.perms.edit) throw forbidden('일정 편집 권한이 있어야 준비 업무를 만들 수 있습니다');
  if (c.event.rrule) throw badRequest('반복 일정은 "회차마다 만드는 업무"를 사용하세요');
  const items = i.items?.length ? i.items : i.preset && PREP_PRESETS[i.preset] ? PREP_PRESETS[i.preset].items : null;
  if (!items) throw badRequest('준비 업무 묶음이나 항목을 고르세요');
  const day = seoulDateOf(c.event.start_at);
  const ids: string[] = [];
  for (const it of items) {
    const assignee: string | null = (it as { assigneeId?: string | null }).assigneeId ?? i.assigneeId ?? null;
    const orgUnitId = await defaultUnit(sql, c.cal, assignee, u);
    const { id } = await createTask(u, { title: `${it.title} · ${c.event.title}`, assigneeId: assignee, dueDate: addDays(day, -it.daysBefore), orgUnitId, approvalRequired: false,
      description: `일정 '${c.event.title}' (${day}) 준비 업무 — 일정 날짜가 바뀌면 마감도 함께 옮겨집니다` } as never);
    await sql`insert into event_tasks (event_id, task_id, role, offset_days, created_by) values (${c.masterId}, ${id}, 'prep', ${it.daysBefore}, ${u.id}) on conflict do nothing`;
    ids.push(id);
  }
  return { ids };
}

/** 일정 시작일이 바뀌었을 때 준비 업무(미완료) 마감을 따라 옮김. updateEvent 트랜잭션 안에서 호출 */
export async function shiftPrepTasks(sql: Sql, eventId: string, newStart: Date, actorId: string) {
  const day = seoulDateOf(newStart);
  const rows = await sql<{ task_id: string; offset_days: number; due_date: string | null }[]>`
    select et.task_id, et.offset_days, t.due_date from event_tasks et join tasks t on t.id = et.task_id
    where et.event_id = ${eventId} and et.role = 'prep' and t.status <> 'done' and t.deleted_at is null`;
  for (const r of rows) {
    const nd = addDays(day, -(r.offset_days ?? 0));
    if (nd === r.due_date) continue;
    await sql`update tasks set due_date = ${nd}, start_date = case when start_date > ${nd} then null else start_date end, version = version + 1, updated_at = now() where id = ${r.task_id}`;
    await activity(sql, 'task', r.task_id, actorId, 'updated', { dueDate: { from: r.due_date, to: nd }, note: '연결 일정 날짜 변경으로 자동 이동' });
  }
  return rows.length;
}

/** S-9 반복 회의마다 만드는 업무 규칙 */
export const seriesInput = z.object({ title: z.string().trim().min(1).max(200), daysBefore: z.number().int().min(0).max(60), assigneeId: zUuid.nullable().optional() });
export async function addSeriesRule(u: SessionUser, eventId: string, i: z.infer<typeof seriesInput>) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  if (!c.perms.edit) throw forbidden('일정 편집 권한이 있어야 합니다');
  const [m] = await sql<{ rrule: string | null }[]>`select rrule from events where id = ${c.masterId}`;
  if (!m?.rrule) throw badRequest('반복 일정에만 쓸 수 있습니다');
  const [r] = await sql<{ id: string }[]>`insert into event_series_tasks (event_id, title, days_before, assignee_id, created_by)
    values (${c.masterId}, ${i.title}, ${i.daysBefore}, ${i.assigneeId ?? null}, ${u.id}) returning id`;
  await seriesTasksJob(new Date(), r.id);
  return { id: r.id };
}
export async function listSeriesRules(u: SessionUser, eventId: string) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  return sql`select s.id, s.title, s.days_before, s.assignee_id, uu.name as assignee_name, s.active from event_series_tasks s
    left join users uu on uu.id = s.assignee_id where s.event_id = ${c.masterId} order by s.created_at`;
}
export async function removeSeriesRule(u: SessionUser, eventId: string, ruleId: string) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  if (!c.perms.edit) throw forbidden('일정 편집 권한이 있어야 합니다');
  await sql`update event_series_tasks set active = false where id = ${ruleId} and event_id = ${c.masterId}`;
  // 아직 시작 안 한 앞으로의 회차 업무는 정리
  await sql`update tasks set deleted_at = now() where id in (select task_id from event_tasks where series_rule_id = ${ruleId} and occurrence_start > now())
    and status = 'todo' and deleted_at is null`;
  return { ok: true };
}

/**
 * 정기 실행: 앞으로 14일 안의 반복 회차마다 규칙 업무를 1건씩 만들고(중복 없음),
 * 취소·삭제된 회차의 미완료 업무는 정리한다.
 */
export async function seriesTasksJob(now = new Date(), onlyRuleId?: string) {
  const sql = db();
  const horizon = new Date(now.getTime() + 14 * 86400000);
  const rules = await sql<any[]>`select s.*, e.rrule, e.start_at, e.end_at, e.exdates, e.title as event_title, e.deleted_at as event_deleted,
      e.calendar_id, c.type as cal_type, c.org_unit_id as cal_unit
    from event_series_tasks s join events e on e.id = s.event_id join calendars c on c.id = e.calendar_id
    where s.active ${onlyRuleId ? sql`and s.id = ${onlyRuleId}` : sql``}`;
  let created = 0, cancelled = 0;
  for (const r of rules) {
    const gone = (await sql<{ task_id: string; occurrence_start: Date }[]>`select task_id, occurrence_start from event_tasks where series_rule_id = ${r.id}`);
    const valid = new Set<number>();
    if (!r.event_deleted && r.rrule) {
      const exs = await sql<{ original_start: Date; cancelled: boolean }[]>`select original_start, cancelled from events where recurring_event_id = ${r.event_id} and deleted_at is null`;
      const skip = new Set([...(r.exdates ?? []).map((d: Date) => new Date(d).getTime()), ...exs.filter((x) => x.cancelled).map((x) => x.original_start.getTime())]);
      for (const s of occurrences(r.rrule, r.start_at, new Date(now.getTime() - 86400000), horizon)) {
        if (skip.has(s.getTime())) continue;
        valid.add(s.getTime());
        if (gone.some((g) => g.occurrence_start.getTime() === s.getTime())) continue;
        const occDay = seoulDateOf(s);
        const due = addDays(occDay, -r.days_before);
        const assignee = r.assignee_id ?? r.created_by;
        let unit = r.cal_type === 'org_unit' ? r.cal_unit : null;
        if (!unit) unit = (await sql<{ org_unit_id: string }[]>`select org_unit_id from memberships where user_id = ${assignee} order by org_unit_id limit 1`)[0]?.org_unit_id;
        if (!unit) continue;
        await sql.begin(async (tx) => {
          const [t] = await tx<{ id: string }[]>`insert into tasks (org_unit_id, title, description, assignee_id, due_date, created_by, approval_required, sort_order)
            values (${unit}, ${`${r.title} · ${r.event_title} ${occDay.slice(5).replace('-', '/')}`}, ${`반복 일정 '${r.event_title}' ${occDay} 회차 업무 (회의 ${r.days_before}일 전 마감). 회차가 취소되면 함께 정리됩니다.`},
              ${assignee}, ${due}, ${r.created_by}, false, extract(epoch from now())) returning id`;
          const ins = await tx`insert into event_tasks (event_id, task_id, role, occurrence_start, series_rule_id, created_by)
            values (${r.event_id}, ${t.id}, 'series', ${s}, ${r.id}, ${r.created_by}) on conflict do nothing returning task_id`;
          if (!ins.length) { await tx`delete from tasks where id = ${t.id}`; return; }
          await activity(tx, 'task', t.id, null, 'created', { title: r.title, source: 'event_series', eventId: r.event_id });
          await notify(tx, { userIds: [assignee], type: 'task_assigned', title: `반복 회의 업무: ${r.title}`, body: `${r.event_title} ${occDay} · 마감 ${due}`,
            link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id, actorId: null, dedupeKey: `series:${r.id}:${s.toISOString()}` });
          created++;
        });
      }
    }
    // 사라진 회차(취소·삭제·반복 규칙 변경)의 미완료 업무 정리 — 지난 회차는 그대로 둔다
    for (const g of gone) {
      if (g.occurrence_start < now || g.occurrence_start > horizon || valid.has(g.occurrence_start.getTime())) continue;
      const res = await sql`update tasks set deleted_at = now() where id = ${g.task_id} and status <> 'done' and deleted_at is null returning id`;
      if (res.length) { await activity(sql, 'task', g.task_id, null, 'deleted', { note: '연결된 반복 회의 회차가 취소되어 정리' }); cancelled++; }
    }
  }
  return { created, cancelled };
}

// ---- V5 일정 ↔ 업무 연동 ("업무에도 추가") ----
const seoulHM = (d: Date) => DateTime.fromJSDate(d).setZone(TZ).toFormat('HH:mm');
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/**
 * 일정과 같은 내용의 업무를 만들고 날짜 동기화 연결(sync)한다.
 * 마감 = 일정 날짜(종일이 아니면 시작 시각), 담당 = 지정한 사람(없으면 나), 요청자 = 나.
 * 반복 일정이면 같은 규칙의 반복 업무 하나로 연결한다(회차마다 따로 만들지 않음).
 */
export async function createSyncTask(u: SessionUser, eventId: string, assigneeId?: string | null, opt: { requestedById?: string | null; priority?: string } = {}) {
  const sql = db();
  const c = await eventCtx(u, eventId, sql);
  if (!c.canWork) throw forbidden('일정 작성자·편집 권한자·참석자만 업무를 만들 수 있습니다');
  const [m] = await sql<{ title: string; start_at: Date; all_day: boolean; rrule: string | null }[]>`select title, start_at, all_day, rrule from events where id = ${c.masterId}`;
  // V14 47: 담당자마다 연결 업무 1건(같은 사람에게 두 번 만들지 않음)
  const [already] = await sql<{ id: string }[]>`select t.id from event_tasks et join tasks t on t.id = et.task_id
    where et.event_id = ${c.masterId} and et.sync and t.deleted_at is null and t.assignee_id = ${assigneeId ?? u.id}`;
  if (already) return { id: already.id };
  const orgUnitId = await defaultUnit(sql, c.cal, assigneeId, u);
  const { id } = await createTask(u, {
    title: m.title, assigneeId: assigneeId ?? u.id, requestedById: opt.requestedById ?? u.id, orgUnitId, approvalRequired: false, priority: opt.priority ?? 'normal',
    dueDate: seoulDateOf(m.start_at), dueTime: m.all_day ? null : seoulHM(m.start_at), recurrenceRule: m.rrule ?? null,
    description: `일정 '${m.title}' 과 연결된 업무 — 날짜를 바꾸면 일정도 함께 바뀝니다`,
  } as never);
  await sql`insert into event_tasks (event_id, task_id, role, sync, created_by) values (${c.masterId}, ${id}, 'link', true, ${u.id})
    on conflict (event_id, task_id) do update set sync = true`;
  return { id };
}

/** 일정 시간이 바뀌면 연결 업무(반복이면 아직 안 끝난 회차들)의 마감을 같은 만큼 옮긴다 */
export async function syncTasksFromEvent(tx: Sql, eventId: string, oldStart: Date, newStart: Date, allDay: boolean, actorId: string) {
  const shift = dayDiff(seoulDateOf(oldStart), seoulDateOf(newStart));
  const time = allDay ? null : seoulHM(newStart);
  const rows = await tx<{ id: string; due_date: string | null; due_time: string | null }[]>`
    select t.id, to_char(t.due_date, 'YYYY-MM-DD') as due_date, to_char(t.due_time, 'HH24:MI') as due_time
    from event_tasks et join tasks t on (t.id = et.task_id or t.recurrence_source_id = et.task_id)
    where et.event_id = ${eventId} and et.sync and t.deleted_at is null and t.status <> 'done' and t.due_date is not null`;
  for (const r of rows) {
    const due = shift ? addDays(r.due_date!, shift) : r.due_date!;
    if (due === r.due_date && time === r.due_time) continue;
    await tx`update tasks set due_date = ${due}, due_time = ${time}, version = version + 1, updated_at = now() where id = ${r.id}`;
    await activity(tx, 'task', r.id, actorId, 'updated', { dueDate: { from: r.due_date, to: due }, dueTime: { from: r.due_time, to: time }, via: 'event', eventId });
  }
  return rows.length;
}

/** 업무 마감이 바뀌면 연결된 (반복 아닌) 일정을 그 날짜·시각으로 옮긴다. 길이 유지, 시각이 없으면 날짜만 이동 */
export async function syncEventsFromTask(tx: Sql, taskId: string, dueDate: string | null, dueTime: string | null, actorId: string) {
  if (!dueDate) return 0;
  const evs = await tx<{ id: string; start_at: Date; end_at: Date; all_day: boolean }[]>`
    select e.id, e.start_at, e.end_at, e.all_day from event_tasks et join events e on e.id = et.event_id
    where et.task_id = ${taskId} and et.sync and e.deleted_at is null and e.rrule is null and e.recurring_event_id is null`;
  for (const e of evs) {
    const dur = e.end_at.getTime() - e.start_at.getTime();
    let ns: Date;
    if (e.all_day || !dueTime) ns = new Date(e.start_at.getTime() + dayDiff(seoulDateOf(e.start_at), dueDate) * 86400000);
    else ns = DateTime.fromISO(`${dueDate}T${dueTime}`, { zone: TZ }).toJSDate();
    if (ns.getTime() === e.start_at.getTime()) continue;
    await tx`update events set start_at = ${ns}, end_at = ${new Date(ns.getTime() + dur)}, version = version + 1, updated_at = now() where id = ${e.id}`;
    await activity(tx, 'event', e.id, actorId, 'updated', { start: ns, via: 'task', taskId });
  }
  return evs.length;
}

/** 연결(sync) 상대 id 목록: 업무 삭제 확인·일정 삭제 확인용 */
export async function syncedTaskIds(sql: Sql, eventId: string) {
  return (await sql<{ id: string }[]>`select t.id from event_tasks et join tasks t on (t.id = et.task_id or t.recurrence_source_id = et.task_id)
    where et.event_id = ${eventId} and et.sync and t.deleted_at is null`).map((r) => r.id);
}
export async function syncedEventIds(sql: Sql, taskId: string) {
  return (await sql<{ id: string }[]>`select e.id from tasks t join event_tasks et on et.task_id = coalesce(t.recurrence_source_id, t.id) and et.sync
    join events e on e.id = et.event_id where t.id = ${taskId} and e.deleted_at is null`).map((r) => r.id);
}

// ---------------- V37 8 미팅 업무의 장소(대표 10/17): 업무에 장소 칸 대신 장소 있는 연결 일정 ----------------
export const meetingInput = z.object({
  location: z.string().trim().min(1, '장소를 넣어 주세요').max(300),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  title: z.string().trim().max(200).optional(),
});
/** 업무 → 미팅 일정(내 개인 캘린더, 담당·요청자 참석, 30분 전 알림) + 업무와 연결. 캘린더에는 이 일정 블록 하나(장소 = 이동 강조·출발 권장) */
export async function createMeeting(u: SessionUser, taskId: string, i: z.infer<typeof meetingInput>) {
  const { perms } = await loadTaskForUser(u, taskId);
  if (!perms.edit) throw forbidden('미팅 일정은 요청자·담당자만 만들 수 있습니다');
  const sql = db();
  const [t] = await sql<{ title: string; assignee_id: string | null; requested_by: string | null }[]>`select title, assignee_id, requested_by from tasks where id = ${taskId}`;
  const { ensurePersonalCalendar } = await import('./access');
  const { createEvent } = await import('./events');
  const calendarId = await ensurePersonalCalendar(u.id, u.name, sql);
  const attendeeIds = [...new Set([t.assignee_id, t.requested_by].filter((x): x is string => !!x && x !== u.id))];
  const ev = await createEvent(u, { calendarId, title: i.title || t.title, location: i.location, start: i.start, end: i.end, kind: 'normal', reminderMinutes: [30], ...(attendeeIds.length ? { attendeeIds } : {}) });
  await sql`insert into event_tasks (event_id, task_id, role, created_by) values (${ev.id}, ${taskId}, 'link', ${u.id}) on conflict do nothing`;
  await activity(sql, 'task', taskId, u.id, 'meeting_created', { location: i.location, start: i.start });
  return { id: ev.id };
}
