import { z } from 'zod';
import { db, type Sql } from './db';
import { accessibleUnitIds, calendarPerms, type CalendarRow } from './access';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { activity } from './log';
import { notify } from './notifications';
import { hasOccurrenceFrom, normalizeRule, occurrences, ruleRemainingFrom, ruleUntilBefore } from './recurrence';
import type { SessionUser } from './types';
import { zUuid } from './api';

export const eventInput = z.object({
  calendarId: zUuid,
  title: z.string().trim().min(1, '제목을 입력하세요').max(200),
  description: z.string().max(20000).optional(),
  location: z.string().max(300).optional(),
  kind: z.enum(['normal', 'vacation', 'business_trip', 'task_block']).optional(),
  allDay: z.boolean().optional(),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }),
  rrule: z.string().max(300).nullable().optional(),
  attendeeIds: z.array(zUuid).max(100).optional(),
  /** 일정별 알림(분). null = 사용자 기본 설정. 시리즈(반복 전체) 단위로 저장 */
  reminderMinutes: z.array(z.number().int().min(0).max(40320)).max(5).nullable().optional(),
  taskId: zUuid.nullable().optional(),
  version: z.number().int().optional(),
});
export type EventInput = z.infer<typeof eventInput>;

export const scopeSchema = z.object({
  scope: z.enum(['this', 'following', 'all']).default('all'),
  occurrenceStart: z.string().datetime({ offset: true }).optional(),
});

interface EventRow {
  id: string;
  calendar_id: string;
  title: string;
  description: string;
  location: string;
  kind: string;
  all_day: boolean;
  start_at: Date;
  end_at: Date;
  rrule: string | null;
  exdates: Date[];
  recurring_event_id: string | null;
  original_start: Date | null;
  cancelled: boolean;
  task_id: string | null;
  version: number;
  created_by: string;
}

async function loadCalendar(sql: Sql, id: string) {
  const [c] = await sql<(CalendarRow & { name: string; color: string })[]>`
    select id, type, org_unit_id, owner_user_id, name, color from calendars where id = ${id}`;
  if (!c) throw notFound('캘린더가 없습니다');
  return c;
}

async function eventPerms(u: SessionUser, e: EventRow, sql: Sql) {
  const cal = await loadCalendar(sql, e.calendar_id);
  const cp = await calendarPerms(u, cal);
  const masterId = e.recurring_event_id ?? e.id;
  const attendee = (await sql`select 1 from event_attendees where event_id = ${masterId} and user_id = ${u.id}`).length > 0;
  return { view: cp.view || attendee || e.created_by === u.id, edit: cp.edit || e.created_by === u.id, attendee, calendar: cal };
}

export async function loadEvent(u: SessionUser, id: string, sql: Sql = db()) {
  if (!zUuid.safeParse(id).success) throw notFound('일정을 찾을 수 없습니다');
  const [e] = await sql<EventRow[]>`select * from events where id = ${id} and deleted_at is null`;
  if (!e) throw notFound('일정을 찾을 수 없습니다');
  const perms = await eventPerms(u, e, sql);
  if (!perms.view) throw notFound('일정을 찾을 수 없습니다');
  return { event: e, perms };
}

/** 범위 내 일정 인스턴스 목록 (반복 전개 포함) */
export async function listEvents(u: SessionUser, from: Date, to: Date, calendarIds?: string[]) {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const calFilter = calendarIds?.length ? sql`and c.id = any(${calendarIds}::uuid[])` : sql``;
  const rows = await sql<(EventRow & { cal_name: string; color: string; cal_type: string })[]>`
    select e.*, c.name as cal_name, c.color, c.type as cal_type
    from events e join calendars c on c.id = e.calendar_id
    where e.deleted_at is null and e.recurring_event_id is null
      and (e.rrule is not null or (e.start_at < ${to} and e.end_at > ${from}))
      and (
        c.type = 'company'
        or (c.type = 'personal' and c.owner_user_id = ${u.id})
        or (c.type = 'org_unit' and ${units === null ? sql`true` : sql`c.org_unit_id = any(${units}::uuid[])`})
        or exists (select 1 from event_attendees a where a.event_id = e.id and a.user_id = ${u.id})
      ) ${calFilter}`;
  const ids = rows.map((r) => r.id);
  const exceptions = ids.length
    ? await sql<EventRow[]>`select * from events where recurring_event_id = any(${ids}::uuid[]) and deleted_at is null`
    : [];
  const attendees = ids.length
    ? await sql<{ event_id: string; user_id: string; name: string; response: string }[]>`
        select a.event_id, a.user_id, u.name, a.response from event_attendees a join users u on u.id = a.user_id
        where a.event_id = any(${ids}::uuid[])`
    : [];
  const out: any[] = [];
  for (const e of rows) {
    const att = attendees.filter((a) => a.event_id === e.id);
    const base = {
      calendarId: e.calendar_id, calendarName: e.cal_name, color: e.color, calendarType: e.cal_type,
      kind: e.kind, taskId: e.task_id, attendees: att, createdBy: e.created_by,
    };
    if (!e.rrule) {
      out.push({ ...base, id: e.id, seriesId: null, title: e.title, location: e.location, description: e.description,
        start: e.start_at, end: e.end_at, allDay: e.all_day, recurring: false, version: e.version, originalStart: null });
      continue;
    }
    const dur = e.end_at.getTime() - e.start_at.getTime();
    const exs = exceptions.filter((x) => x.recurring_event_id === e.id);
    const skip = new Set([...e.exdates.map((d) => new Date(d).getTime()), ...exs.map((x) => x.original_start!.getTime())]);
    const fromAdj = new Date(from.getTime() - dur);
    for (const s of occurrences(e.rrule, e.start_at, fromAdj, to)) {
      if (skip.has(s.getTime())) continue;
      const end = new Date(s.getTime() + dur);
      if (end <= from && !(s >= from)) continue;
      out.push({ ...base, id: e.id, seriesId: e.id, title: e.title, location: e.location, description: e.description,
        start: s, end, allDay: e.all_day, recurring: true, rrule: e.rrule, version: e.version, originalStart: s });
    }
    for (const x of exs) {
      if (x.cancelled || x.start_at >= to || x.end_at <= from) continue;
      out.push({ ...base, id: x.id, seriesId: e.id, title: x.title, location: x.location, description: x.description,
        start: x.start_at, end: x.end_at, allDay: x.all_day, recurring: true, exception: true, rrule: e.rrule,
        version: x.version, originalStart: x.original_start, kind: x.kind });
    }
  }
  out.sort((a, b) => +new Date(a.start) - +new Date(b.start));
  return out;
}

/** 같은 참석자/작성자의 겹치는 시간 일정 (종일 일정 제외) */
export async function findConflicts(u: SessionUser, userIds: string[], start: Date, end: Date, excludeIds: string[] = []) {
  if (end <= start) return [];
  const sql = db();
  const ids = [...new Set([u.id, ...userIds])];
  const rows = await sql<(EventRow & { cal_type: string; owner_user_id: string | null })[]>`
    select e.*, c.type as cal_type, c.owner_user_id from events e join calendars c on c.id = e.calendar_id
    where e.deleted_at is null and e.recurring_event_id is null and not e.all_day and e.kind <> 'task_block'
      and (e.rrule is not null or (e.start_at < ${end} and e.end_at > ${start}))
      and (exists (select 1 from event_attendees a where a.event_id = e.id and a.user_id = any(${ids}::uuid[]))
           or (c.type = 'personal' and c.owner_user_id = any(${ids}::uuid[])))
      and not (e.id = any(${excludeIds}::uuid[]))`;
  const users = await sql<{ id: string; name: string }[]>`select id, name from users where id = any(${ids}::uuid[])`;
  const out: { eventId: string; title: string; start: Date; end: Date; who: string[] }[] = [];
  for (const e of rows) {
    const att = (await sql<{ user_id: string }[]>`select user_id from event_attendees where event_id = ${e.id}`).map((a) => a.user_id);
    const who = ids.filter((i) => att.includes(i) || (e.cal_type === 'personal' && e.owner_user_id === i));
    const vis = e.cal_type === 'personal' && e.owner_user_id !== u.id && !att.includes(u.id);
    const dur = e.end_at.getTime() - e.start_at.getTime();
    const starts = e.rrule ? occurrences(e.rrule, e.start_at, new Date(start.getTime() - dur), end) : [e.start_at];
    for (const s of starts) {
      const en = new Date(s.getTime() + dur);
      if (s < end && en > start) {
        out.push({ eventId: e.id, title: vis ? '(비공개 일정)' : e.title, start: s, end: en, who: users.filter((x) => who.includes(x.id)).map((x) => x.name) });
        break;
      }
    }
  }
  return out;
}

function validateTimes(i: { start: string; end: string; allDay?: boolean }) {
  const s = new Date(i.start), e = new Date(i.end);
  if (e < s) throw badRequest('종료 시각이 시작 시각보다 빠릅니다');
  if (e.getTime() - s.getTime() > 1000 * 86400 * 366) throw badRequest('일정 기간이 너무 깁니다');
  return { s, e };
}

async function setAttendees(sql: Sql, eventId: string, ids: string[]) {
  const before = (await sql<{ user_id: string }[]>`select user_id from event_attendees where event_id = ${eventId}`).map((r) => r.user_id);
  const want = [...new Set(ids)];
  await sql`delete from event_attendees where event_id = ${eventId} and not (user_id = any(${want}::uuid[]))`;
  for (const id of want) await sql`insert into event_attendees (event_id, user_id) values (${eventId}, ${id}) on conflict do nothing`;
  return { added: want.filter((x) => !before.includes(x)), all: want };
}

export async function createEvent(u: SessionUser, i: EventInput) {
  const sql = db();
  const cal = await loadCalendar(sql, i.calendarId);
  const cp = await calendarPerms(u, cal);
  if (!cp.edit) throw forbidden('이 캘린더에 일정을 등록할 권한이 없습니다');
  const { s, e } = validateTimes(i);
  const rule = normalizeRule(i.rrule);
  if (i.taskId) {
    const { loadTaskForUser } = await import('./access');
    await loadTaskForUser(u, i.taskId, sql);
  }
  return sql.begin(async (tx) => {
    const [ev] = await tx<{ id: string }[]>`
      insert into events (calendar_id, title, description, location, kind, all_day, start_at, end_at, rrule, task_id, created_by, reminder_minutes)
      values (${i.calendarId}, ${i.title}, ${i.description ?? ''}, ${i.location ?? ''}, ${i.kind ?? (i.taskId ? 'task_block' : 'normal')},
        ${i.allDay ?? false}, ${s}, ${e}, ${rule}, ${i.taskId ?? null}, ${u.id}, ${normReminders(i.reminderMinutes)})
      returning id`;
    if (i.attendeeIds?.length) {
      await setAttendees(tx, ev.id, i.attendeeIds);
      await tx`update event_attendees set response = 'accepted' where event_id = ${ev.id} and user_id = ${u.id}`;
      await notify(tx, { userIds: i.attendeeIds, type: 'event_changed', title: `일정 초대: ${i.title}`,
        body: `${u.name}님이 일정에 초대했습니다`, link: `/calendar?event=${ev.id}`, entityType: 'event', entityId: ev.id,
        actorId: u.id, dedupeKey: `evinv:${ev.id}` });
    }
    await activity(tx, 'event', ev.id, u.id, 'created', { title: i.title, start: s, end: e, rrule: rule });
    return { id: ev.id };
  });
}

const EDIT_FIELDS: [keyof EventInput, string][] = [
  ['title', 'title'], ['description', 'description'], ['location', 'location'], ['kind', 'kind'], ['allDay', 'all_day'],
];

/**
 * 일정 수정. 반복 일정은 scope 로 이번 일정만(this) / 이후 일정(following) / 전체(all) 를 고른다.
 * 이동(start/end 변경)도 같은 경로로 원본 데이터에 반영된다.
 */
export async function updateEvent(u: SessionUser, id: string, i: Partial<EventInput>, scope: z.infer<typeof scopeSchema>) {
  const sql = db();
  return sql.begin(async (tx) => {
    const { event: e, perms } = await loadEvent(u, id, tx);
    if (!perms.edit) throw forbidden('이 일정을 수정할 권한이 없습니다');
    if (i.version !== undefined && i.version !== e.version) {
      throw conflict('다른 곳에서 먼저 수정되었습니다. 새로고침 후 다시 시도하세요.', { currentVersion: e.version });
    }
    if (i.calendarId && i.calendarId !== e.calendar_id) {
      const cal = await loadCalendar(tx, i.calendarId);
      if (!(await calendarPerms(u, cal)).edit) throw forbidden('옮길 캘린더에 권한이 없습니다');
    }
    const master = e.recurring_event_id
      ? (await tx<EventRow[]>`select * from events where id = ${e.recurring_event_id}`)[0]
      : e;
    const isSeries = !!master.rrule;
    let target: string = id;
    let result: Record<string, unknown> = {};

    const applyFields = (base: EventRow, delta?: { s: Date; e: Date }) => {
      const set: Record<string, unknown> = {};
      for (const [k, col] of EDIT_FIELDS) if (i[k] !== undefined) set[col] = i[k];
      if (i.calendarId) set.calendar_id = i.calendarId;
      if (delta) { set.start_at = delta.s; set.end_at = delta.e; }
      return set;
    };

    if (!isSeries || (scope.scope === 'this' && e.recurring_event_id)) {
      // 단일 일정 또는 이미 분리된 예외 행
      let times: { s: Date; e: Date } | undefined;
      if (i.start && i.end) times = validateTimes({ start: i.start, end: i.end });
      const set = applyFields(e, times);
      if (!isSeries && i.rrule !== undefined) set.rrule = normalizeRule(i.rrule);
      if (Object.keys(set).length) {
        set.updated_at = new Date();
        await tx`update events set ${tx(set as never, ...(Object.keys(set) as never[]))}, version = version + 1 where id = ${id}`;
      }
    } else if (scope.scope === 'this') {
      if (!scope.occurrenceStart) throw badRequest('반복 일정의 어느 회차인지(occurrenceStart) 필요합니다');
      const occ = new Date(scope.occurrenceStart);
      const dur = master.end_at.getTime() - master.start_at.getTime();
      const times = i.start && i.end ? validateTimes({ start: i.start, end: i.end }) : { s: occ, e: new Date(occ.getTime() + dur) };
      const [x] = await tx<{ id: string }[]>`
        insert into events (calendar_id, title, description, location, kind, all_day, start_at, end_at,
          recurring_event_id, original_start, task_id, created_by)
        values (${i.calendarId ?? master.calendar_id}, ${i.title ?? master.title}, ${i.description ?? master.description},
          ${i.location ?? master.location}, ${i.kind ?? master.kind}, ${i.allDay ?? master.all_day}, ${times.s}, ${times.e},
          ${master.id}, ${occ}, ${master.task_id}, ${u.id})
        on conflict (recurring_event_id, original_start) where recurring_event_id is not null and deleted_at is null
        do update set title = excluded.title, description = excluded.description, location = excluded.location,
          kind = excluded.kind, all_day = excluded.all_day, start_at = excluded.start_at, end_at = excluded.end_at,
          version = events.version + 1, updated_at = now()
        returning id`;
      target = x.id;
      await tx`update events set version = version + 1, updated_at = now() where id = ${master.id}`;
    } else if (scope.scope === 'following' && scope.occurrenceStart && new Date(scope.occurrenceStart) > master.start_at) {
      const occ = new Date(scope.occurrenceStart);
      const dur = master.end_at.getTime() - master.start_at.getTime();
      const times = i.start && i.end ? validateTimes({ start: i.start, end: i.end }) : { s: occ, e: new Date(occ.getTime() + dur) };
      const newRule = i.rrule !== undefined ? normalizeRule(i.rrule) : ruleRemainingFrom(master.rrule!, master.start_at, occ);
      const cutRule = ruleUntilBefore(master.rrule!, occ);
      await tx`update events set rrule = ${cutRule}, version = version + 1, updated_at = now() where id = ${master.id}`;
      const [n] = await tx<{ id: string }[]>`
        insert into events (calendar_id, title, description, location, kind, all_day, start_at, end_at, rrule, task_id, created_by, reminder_minutes)
        values (${i.calendarId ?? master.calendar_id}, ${i.title ?? master.title}, ${i.description ?? master.description},
          ${i.location ?? master.location}, ${i.kind ?? master.kind}, ${i.allDay ?? master.all_day}, ${times.s}, ${times.e},
          ${newRule}, ${master.task_id}, ${u.id}, ${(master as any).reminder_minutes ?? null})
        returning id`;
      await tx`insert into event_attendees (event_id, user_id, response) select ${n.id}, user_id, response from event_attendees where event_id = ${master.id}`;
      // 분할 지점 이후 예외 행은 새 시리즈로 이동
      await tx`update events set recurring_event_id = ${n.id} where recurring_event_id = ${master.id} and original_start >= ${occ}`;
      if (!hasOccurrenceFrom(cutRule, master.start_at, master.start_at)) {
        await tx`update events set deleted_at = now() where id = ${master.id}`;
      }
      target = n.id;
      result.newSeriesId = n.id;
    } else {
      // 전체 일정: 시간 이동량을 마스터에 적용
      let times: { s: Date; e: Date } | undefined;
      if (i.start && i.end) {
        const t = validateTimes({ start: i.start, end: i.end });
        const ref = scope.occurrenceStart ? new Date(scope.occurrenceStart) : (e.original_start ?? master.start_at);
        const shift = t.s.getTime() - ref.getTime();
        const dur = t.e.getTime() - t.s.getTime();
        const ns = new Date(master.start_at.getTime() + shift);
        times = { s: ns, e: new Date(ns.getTime() + dur) };
      }
      const set = applyFields(master, times);
      if (i.rrule !== undefined) {
        set.rrule = normalizeRule(i.rrule);
        if (!set.rrule) set.exdates = [];
      }
      if (times && times.s.getTime() !== master.start_at.getTime()) {
        // 시작 시각이 바뀌면 기존 회차 기준의 예외는 의미가 없어진다
        await tx`update events set deleted_at = now() where recurring_event_id = ${master.id}`;
        set.exdates = [];
      }
      set.updated_at = new Date();
      await tx`update events set ${tx(set as never, ...(Object.keys(set) as never[]))}, version = version + 1 where id = ${master.id}`;
      target = master.id;
    }

    if (i.attendeeIds) {
      const seriesTarget = (await tx<{ id: string; recurring_event_id: string | null }[]>`select id, recurring_event_id from events where id = ${target}`)[0];
      const attTarget = seriesTarget.recurring_event_id ?? seriesTarget.id;
      const { added } = await setAttendees(tx, attTarget, i.attendeeIds);
      if (added.length) {
        await notify(tx, { userIds: added, type: 'event_changed', title: `일정 초대: ${i.title ?? master.title}`,
          body: `${u.name}님이 일정에 초대했습니다`, link: `/calendar?event=${attTarget}`, entityType: 'event', entityId: attTarget,
          actorId: u.id, dedupeKey: `evinv:${attTarget}:${Date.now()}` });
      }
    }
    if (i.reminderMinutes !== undefined) {
      const seriesId = (result.newSeriesId as string | undefined) ?? master.id;
      await tx`update events set reminder_minutes = ${normReminders(i.reminderMinutes)}, updated_at = now() where id = ${seriesId}`;
    }
    const [after] = await tx<{ version: number }[]>`select version from events where id = ${target}`;
    const attendeeIds = (await tx<{ user_id: string }[]>`select user_id from event_attendees where event_id = ${master.id}`).map((r) => r.user_id);
    await notify(tx, { userIds: attendeeIds, type: 'event_changed', title: `일정 변경: ${i.title ?? master.title}`,
      body: `${u.name}님이 일정을 변경했습니다`, link: `/calendar?event=${target}`, entityType: 'event', entityId: target,
      actorId: u.id, dedupeKey: `evchg:${target}:${after.version}` });
    await activity(tx, 'event', master.id, u.id, 'updated', { scope: scope.scope, occurrenceStart: scope.occurrenceStart ?? null, fields: i });
    return { id: target, version: after.version, ...result };
  });
}

export async function deleteEvent(u: SessionUser, id: string, scope: z.infer<typeof scopeSchema>) {
  const sql = db();
  return sql.begin(async (tx) => {
    const { event: e, perms } = await loadEvent(u, id, tx);
    if (!perms.edit) throw forbidden('이 일정을 삭제할 권한이 없습니다');
    const master = e.recurring_event_id ? (await tx<EventRow[]>`select * from events where id = ${e.recurring_event_id}`)[0] : e;
    if (!master.rrule || scope.scope === 'all') {
      await tx`update events set deleted_at = now(), version = version + 1 where id = ${master.id} or recurring_event_id = ${master.id}`;
    } else if (scope.scope === 'this') {
      const occ = e.recurring_event_id ? e.original_start! : scope.occurrenceStart ? new Date(scope.occurrenceStart) : null;
      if (!occ) throw badRequest('삭제할 회차(occurrenceStart)가 필요합니다');
      await tx`update events set exdates = array_append(exdates, ${occ}::timestamptz), version = version + 1, updated_at = now() where id = ${master.id}`;
      await tx`update events set deleted_at = now() where recurring_event_id = ${master.id} and original_start = ${occ}`;
    } else {
      const occ = e.recurring_event_id ? e.original_start! : scope.occurrenceStart ? new Date(scope.occurrenceStart) : null;
      if (!occ) throw badRequest('기준 회차(occurrenceStart)가 필요합니다');
      if (occ <= master.start_at) {
        await tx`update events set deleted_at = now(), version = version + 1 where id = ${master.id} or recurring_event_id = ${master.id}`;
      } else {
        await tx`update events set rrule = ${ruleUntilBefore(master.rrule, occ)}, version = version + 1, updated_at = now() where id = ${master.id}`;
        await tx`update events set deleted_at = now() where recurring_event_id = ${master.id} and original_start >= ${occ}`;
      }
    }
    const attendeeIds = (await tx<{ user_id: string }[]>`select user_id from event_attendees where event_id = ${master.id}`).map((r) => r.user_id);
    await notify(tx, { userIds: attendeeIds, type: 'event_changed', title: `일정 취소: ${master.title}`,
      body: `${u.name}님이 일정을 취소했습니다${scope.scope !== 'all' && master.rrule ? ` (${scope.scope === 'this' ? '이번 일정' : '이후 일정'})` : ''}`,
      link: `/calendar`, entityType: 'event', entityId: master.id, actorId: u.id, dedupeKey: `evdel:${master.id}:${scope.scope}:${scope.occurrenceStart ?? ''}` });
    await activity(tx, 'event', master.id, u.id, 'deleted', { scope: scope.scope, occurrenceStart: scope.occurrenceStart ?? null });
    return { ok: true };
  });
}

export async function respondEvent(u: SessionUser, id: string, response: 'accepted' | 'declined' | 'tentative') {
  const sql = db();
  const { event: e } = await loadEvent(u, id, sql);
  const masterId = e.recurring_event_id ?? e.id;
  const r = await sql`update event_attendees set response = ${response} where event_id = ${masterId} and user_id = ${u.id} returning 1`;
  if (!r.length) throw forbidden('참석자로 초대된 일정만 응답할 수 있습니다');
  await sql`update events set version = version + 1, updated_at = now() where id = ${masterId}`;
  return { ok: true };
}

/** 알림 분 목록 정리: 중복 제거·오름차순, 빈 배열은 '알림 없음'([]), null 은 기본값 */
function normReminders(v: number[] | null | undefined): number[] | null {
  if (v === undefined || v === null) return null;
  return [...new Set(v)].sort((a, b) => a - b);
}
