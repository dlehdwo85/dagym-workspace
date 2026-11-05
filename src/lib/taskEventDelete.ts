import { db, type Sql } from './db';
import { activity } from './log';
import { notify } from './notifications';
import type { SessionUser } from './types';

/**
 * 361차(대표 #977 '일정과 연동된 업무를 지우면 일정도 자연스럽게'): 업무 삭제 창 하나에 '연결된 일정 n개도 함께 지우기' 목록.
 * - 대상: 지울 업무(+ 함께 지워지는 하위 업무)에 연결된 모든 일정 — 업무에도 추가(sync)·미팅 장소·일정에서 만든 업무·회의 준비·후속·반복 회의 회차.
 *   '업무 시간' 칸(task_block)은 예전처럼 업무와 함께 숨겼다 되살림(hideTaskBlocks)이라 목록에 안 넣는다.
 * - 기본 체크: 이 업무가 주인인 일정 = '업무에도 추가'(sync) 또는 업무에서 만든 일정(미팅 장소처럼 업무보다 나중에 만들면서 바로 연결).
 *   일정에서 만든 업무·회의 준비·후속·반복 회의 회차는 일정이 주인이라 체크 해제(원하면 체크).
 * - 남김(체크 해제): 다른 살아 있는 업무에도 연결된 일정. 고를 수 없음: 지울 권한이 없는 일정, 반복 일정 전체(회차가 아닌 연결 — 시리즈는 안 지움).
 * - 반복 일정의 회차에서 만든 업무(occurrence_start) = 그 회차만 지움.
 * - 지운 것은 task_event_deletions 에 남겨, 업무를 되살리면(되돌리기·휴지통) 일정도 되살린다(참석자에게 '다시 잡힘' 알림, 외부 캘린더 동기화).
 */
export type PlanEvent = {
  key: string; id: string; taskId: string; title: string; start: string; end: string; allDay: boolean; occurrenceStart: string | null;
  calendarId: string; attendees: number; checked: boolean; disabled: boolean;
  kind: 'own' | 'from_event' | 'shared' | 'no_perm' | 'series'; note: string | null;
};
const keyOf = (id: string, occ: Date | string | null) => (occ ? `${id}@${new Date(occ).toISOString()}` : id);

/** 지울 업무 id(뿌리 + 함께 지워지는 하위 업무) */
async function deletingIds(sql: Sql, rootIds: string[]) {
  return (await sql<{ id: string }[]>`select id from tasks where (id = any(${rootIds}::uuid[]) or parent_id = any(${rootIds}::uuid[])) and deleted_at is null`).map((r) => r.id);
}

export async function deletePlan(u: SessionUser, rootIds: string[], sql: Sql = db()): Promise<PlanEvent[]> {
  const ids = await deletingIds(sql, rootIds);
  if (!ids.length) return [];
  const rows = await sql<{ event_id: string; task_id: string; role: string; sync: boolean; occurrence_start: Date | null; task_at: Date; ev_at: Date; link_at: Date;
    title: string; start_at: Date; end_at: Date; all_day: boolean; rrule: string | null; calendar_id: string }[]>`
    select et.event_id, et.task_id, et.role, et.sync, et.occurrence_start, t.created_at as task_at, e.created_at as ev_at, et.created_at as link_at,
      e.title, e.start_at, e.end_at, e.all_day, e.rrule, e.calendar_id
    from event_tasks et join events e on e.id = et.event_id join tasks t on t.id = et.task_id
    where et.task_id = any(${ids}::uuid[]) and et.role <> 'block' and e.kind <> 'task_block' and e.deleted_at is null
    order by e.start_at`;
  const { loadEvent } = await import('./events');
  const out: PlanEvent[] = []; const seen = new Set<string>();
  for (const r of rows) {
    const key = keyOf(r.event_id, r.occurrence_start);
    if (seen.has(key)) continue; seen.add(key);
    let perms: { edit: boolean } | null = null;
    try { perms = (await loadEvent(u, r.event_id, sql)).perms; } catch { continue; } // 볼 수 없는 일정은 목록에도 안 보임(남음)
    const occ = r.occurrence_start;
    // 다른 살아 있는 업무가 같은 일정(같은 회차)에 연결돼 있나 — 반복 업무 회차는 원래 업무의 연결을 같이 씀
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from (
      select t2.id from event_tasks et2 join tasks t2 on t2.id = et2.task_id
        where et2.event_id = ${r.event_id} and t2.deleted_at is null and not (t2.id = any(${ids}::uuid[]))
          and (${occ}::timestamptz is null or et2.occurrence_start is null or et2.occurrence_start = ${occ}::timestamptz)
      union select t3.id from tasks t3 where t3.recurrence_source_id = ${r.task_id} and t3.deleted_at is null and not (t3.id = any(${ids}::uuid[]))) x`;
    const [{ a }] = await sql<{ a: number }[]>`select count(*)::int a from event_attendees where event_id = ${r.event_id} and user_id <> ${u.id}`;
    // 이 업무가 주인 = '업무에도 추가'(sync) 또는 업무보다 뒤에 만들어지면서 곧바로 연결된 일정(미팅 장소). 이미 있던 일정에 나중에 연결한 것은 일정이 주인
    const own = r.sync || (r.role === 'link' && +r.ev_at >= +r.task_at && Math.abs(+r.link_at - +r.ev_at) < 60_000);
    let kind: PlanEvent['kind'] = own ? 'own' : 'from_event'; let disabled = false; let note: string | null;
    if (!perms.edit) { kind = 'no_perm'; disabled = true; note = '지울 권한이 없는 일정이라 남겨요'; }
    else if (r.rrule && !occ) { kind = 'series'; disabled = true; note = '반복 일정 전체는 지우지 않아요 — 캘린더에서 지워 주세요'; }
    else if (n > 0) { kind = 'shared'; note = `다른 업무 ${n}개에도 연결돼 있어 남겨요`; }
    else if (occ) note = own ? '반복 일정의 이 회차만 지워요' : '반복 회의의 이 회차 — 체크하면 이 회차만 지워요';
    else note = own ? null : '일정에서 만든 업무라 일정은 남기는 게 기본이에요';
    const start = occ ?? r.start_at;
    out.push({ key, id: r.event_id, taskId: r.task_id, title: r.title, start: start.toISOString(), end: new Date(+start + (+r.end_at - +r.start_at)).toISOString(),
      allDay: r.all_day, occurrenceStart: occ ? occ.toISOString() : null, calendarId: r.calendar_id, attendees: a, checked: kind === 'own', disabled, kind, note });
  }
  return out;
}

/** 고른 일정 키 → 실제로 지울 목록(계획에 있고 고를 수 있는 것만). 'default' = 기본 체크 그대로 */
export function pickEvents(plan: PlanEvent[], picks: string[] | 'default' | 'none') {
  if (picks === 'none') return [];
  const want = picks === 'default' ? new Set(plan.filter((p) => p.checked).map((p) => p.key)) : new Set(picks);
  return plan.filter((p) => !p.disabled && want.has(p.key));
}

/** 업무를 지운 뒤 고른 일정을 지움(권한·회차 규칙은 deleteEvent 가 다시 확인) + 되살릴 기록. 지운 캘린더 id 를 돌려줌(외부 캘린더 동기화) */
export async function deletePickedEvents(u: SessionUser, picked: PlanEvent[]) {
  const sql = db(); const { deleteEvent } = await import('./events');
  let deleted = 0; const calendars = new Set<string>(); const failed: string[] = [];
  for (const p of picked) {
    try {
      await deleteEvent(u, p.id, p.occurrenceStart ? { scope: 'this', occurrenceStart: p.occurrenceStart } : { scope: 'all' });
      await sql`insert into task_event_deletions (task_id, event_id, occurrence_start, deleted_by) values (${p.taskId}, ${p.id}, ${p.occurrenceStart}, ${u.id})`;
      await activity(sql, 'event', p.id, u.id, 'deleted_with_task', { taskId: p.taskId, occurrenceStart: p.occurrenceStart });
      deleted++; calendars.add(p.calendarId);
    } catch { failed.push(p.title); }
  }
  return { deleted, failed, calendars: [...calendars] };
}

/** 업무를 되살릴 때 함께 지웠던 일정도 되살림(되살릴 권한이 있는 것만, 이미 따로 되살린 것은 건너뜀) */
export async function restoreTaskEvents(u: SessionUser, taskIds: string[]) {
  if (!taskIds.length) return { restored: 0, calendars: [] as string[] };
  const sql = db(); const { eventPerms } = await import('./events');
  const rows = await sql<{ id: number; event_id: string; occurrence_start: Date | null; deleted_at: Date }[]>`
    select id, event_id, occurrence_start, deleted_at from task_event_deletions
    where task_id = any(${taskIds}::uuid[]) and restored_at is null and deleted_at > now() - interval '30 days' order by id`;
  let restored = 0; const calendars = new Set<string>();
  for (const r of rows) {
    await sql.begin(async (tx) => {
      const [e] = await tx<any[]>`select * from events where id = ${r.event_id}`;
      if (!e || !(await eventPerms(u, e, tx)).edit) return;
      let back = false;
      if (r.occurrence_start) {
        if (e.deleted_at) return; // 시리즈 전체가 그 뒤에 지워졌으면 회차만 되살릴 수 없음
        const x = await tx`update events set exdates = array_remove(exdates, ${r.occurrence_start}::timestamptz), version = version + 1, updated_at = now()
          where id = ${e.id} and ${r.occurrence_start}::timestamptz = any(exdates) returning id`;
        await tx`update events set deleted_at = null, version = version + 1, updated_at = now() where recurring_event_id = ${e.id} and original_start = ${r.occurrence_start} and deleted_at is not null`;
        back = x.length > 0;
      } else if (e.deleted_at) {
        // 함께 지운 그때 지워진 회차 변경 줄만(그 전에 '이번 일정만' 지운 회차는 그대로) — restoreEvent 와 같은 규칙
        await tx`update events x set deleted_at = null, version = x.version + 1, updated_at = now()
          where (x.id = ${e.id} or (x.recurring_event_id = ${e.id} and not coalesce(x.original_start = any(${e.exdates ?? []}::timestamptz[]), false)))
            and x.deleted_at >= ${e.deleted_at}::timestamptz - interval '5 seconds'`;
        back = true;
      }
      await tx`update task_event_deletions set restored_at = now() where id = ${r.id}`;
      if (!back) return;
      const attendeeIds = (await tx<{ user_id: string }[]>`select user_id from event_attendees where event_id = ${e.id}`).map((a) => a.user_id);
      await notify(tx, { userIds: attendeeIds, type: 'event_changed', title: `일정 다시 잡힘: ${e.title}`, body: `${u.name}님이 업무를 되살리면서 일정도 되살렸습니다`,
        link: `/calendar`, entityType: 'event', entityId: e.id, actorId: u.id, dedupeKey: `evrestore:${e.id}:${r.id}` });
      await activity(tx, 'event', e.id, u.id, 'restored', { withTask: true, occurrenceStart: r.occurrence_start });
      restored++; calendars.add(e.calendar_id);
    });
  }
  return { restored, calendars: [...calendars] };
}

/** 지운·되살린 일정의 캘린더를 외부(구글) 캘린더로 곧바로 반영 — 라우트의 after() 에서 */
export async function syncCalendars(calendarIds: string[]) {
  const { syncCalendarSoon } = await import('./google/hooks');
  for (const c of calendarIds) await syncCalendarSoon(c).catch(() => {});
}

/** 주소의 고른 일정: events=default|none|키,키… · 예전 앱(?alsoEvent=1) = 기본 체크 그대로 · 아무것도 없으면 일정은 남김 */
export function picksFrom(sp: URLSearchParams): string[] | 'default' | 'none' {
  const ev = sp.get('events');
  if (ev === 'default' || (!ev && sp.get('alsoEvent') === '1')) return 'default';
  if (!ev || ev === 'none') return 'none';
  return ev.split(',').map((k) => k.trim()).filter((k) => /^[0-9a-f-]{36}(@[\d\-T:.Z]+)?$/i.test(k)).slice(0, 50);
}

/** 업무 삭제 창용: 지울 업무(묶음이면 같이 만든 업무 모두)의 연결 일정 계획 */
export async function deletePlanFor(u: SessionUser, taskId: string, batch: boolean) {
  const sql = db();
  const { loadTaskForUser } = await import('./access');
  await loadTaskForUser(u, taskId, sql); // 볼 수 없으면 404
  const [{ batch_id: batchId }] = await sql<{ batch_id: string | null }[]>`select batch_id from tasks where id = ${taskId}`;
  const roots = batch && batchId ? (await sql<{ id: string }[]>`select id from tasks where batch_id = ${batchId} and deleted_at is null`).map((r) => r.id) : [taskId];
  const [{ subs }] = await sql<{ subs: number }[]>`select count(*)::int subs from tasks where parent_id = any(${roots}::uuid[]) and deleted_at is null`;
  return { taskIds: roots, subtasks: subs, events: await deletePlan(u, roots, sql) };
}
