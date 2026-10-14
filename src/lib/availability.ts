import { DateTime } from 'luxon';
import { db, type Sql } from './db';
import { accessibleUnitIds, atLeast } from './access';
import { forbidden, notFound } from './errors';
import { listEvents } from './events';
import { addDays, todaySeoul } from './time';
import { tenantOf, type SessionUser } from './types';

const TZ = 'Asia/Seoul';
/** 근무 시간 기준: 09:00~18:00, 점심 12:00~13:00 제외 = 하루 8시간 */
export const WORK = [{ s: 9 * 60, e: 12 * 60 }, { s: 13 * 60, e: 18 * 60 }];
export const DAY_CAPACITY_MIN = 480;

export type DayLoad = {
  date: string; workday: boolean; holiday: string | null; away: boolean;
  meetingMinutes: number; blockMinutes: number; capacity: number; freeMinutes: number;
};

type Interval = { s: number; e: number; kind: 'meeting' | 'block' };

/** 그 사람이 바쁜 시간(회의·업무 시간 블록)과 휴가·출장 날짜. 다른 사람 일정은 시간만 쓰고 제목은 돌려주지 않는다 */
export async function busyOf(userId: string, from: Date, to: Date, sql: Sql) {
  const [p] = await sql<any[]>`select id, email, name, role, status, tenant, is_demo as "isDemo" from users where id = ${userId}`;
  if (!p) throw notFound('사용자가 없습니다');
  const evs = await listEvents({ ...p, timezone: TZ, sessionId: '' } as SessionUser, from, to);
  const intervals: Interval[] = [];
  const away = new Set<string>();
  for (const e of evs) {
    const mine = e.attendees.some((a: any) => a.user_id === userId && a.response !== 'declined') || e.calendarType === 'personal'
      || ((e.kind === 'vacation' || e.kind === 'half_day' || e.kind === 'outside' || e.kind === 'business_trip' || e.kind === 'task_block') && e.createdBy === userId);
    if (!mine) continue;
    const s = new Date(e.start).getTime(), en = new Date(e.end).getTime();
    if (e.kind === 'vacation' || e.kind === 'business_trip') { // 반차·외근은 하루 부재가 아니라 그 시간만 바쁨
      for (let d = DateTime.fromMillis(s).setZone(TZ).startOf('day'); d.toMillis() < en; d = d.plus({ days: 1 })) away.add(d.toISODate()!);
      continue;
    }
    if (e.allDay) continue;
    intervals.push({ s, e: en, kind: e.kind === 'task_block' ? 'block' : 'meeting' });
  }
  return { intervals, away };
}

function merge(xs: { s: number; e: number }[]) {
  const out: { s: number; e: number }[] = [];
  for (const x of [...xs].sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1];
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e); else out.push({ ...x });
  }
  return out;
}
const len = (xs: { s: number; e: number }[]) => xs.reduce((a, x) => a + (x.e - x.s) / 60000, 0);

/** 날짜별 근무 가능 시간·회의·업무 블록 (fromDate~toDate 포함). notBefore 이후 시간만 남은 가용으로 센다 */
export async function dayLoads(userId: string, fromDate: string, toDate: string, opts: { notBefore?: Date } = {}, sql: Sql = db()): Promise<DayLoad[]> {
  const from = DateTime.fromISO(fromDate, { zone: TZ }).startOf('day');
  const to = DateTime.fromISO(toDate, { zone: TZ }).plus({ days: 1 }).startOf('day');
  const holidays = new Map((await sql<{ date: string; name: string }[]>`select to_char(date, 'YYYY-MM-DD') as date, name from holidays where date between ${fromDate} and ${toDate}`).map((h) => [h.date, h.name]));
  const { intervals, away } = await busyOf(userId, from.toJSDate(), to.toJSDate(), sql);
  const out: DayLoad[] = [];
  const nb = opts.notBefore?.getTime() ?? 0;
  for (let d = from; d < to; d = d.plus({ days: 1 })) {
    const date = d.toISODate()!;
    const holiday = holidays.get(date) ?? null;
    const isAway = away.has(date);
    const workday = d.weekday <= 5 && !holiday && !isAway;
    let free = 0, capacity = 0;
    // 회의·업무 블록 시간은 그날 실제 길이(점심시간 포함), 남은 가용은 근무 구간 안에서만 계산
    const ds = d.toMillis(), de = d.plus({ days: 1 }).toMillis();
    const dayClip = (kind: Interval['kind']) => merge(intervals.filter((x) => x.kind === kind).map((x) => ({ s: Math.max(x.s, ds), e: Math.min(x.e, de) })).filter((x) => x.e > x.s));
    const meeting = len(dayClip('meeting'));
    const block = len(dayClip('block'));
    if (workday) {
      for (const w of WORK) {
        const ws = d.plus({ minutes: w.s }).toMillis(), we = d.plus({ minutes: w.e }).toMillis();
        capacity += (we - ws) / 60000;
        // 남은 가용: 근무 구간 - (회의 ∪ 업무 블록), notBefore 이전 시간 제외
        const start = Math.max(ws, nb);
        if (start < we) free += (we - start) / 60000 - len(merge(intervals.map((x) => ({ s: Math.max(x.s, start), e: Math.min(x.e, we) })).filter((x) => x.e > x.s)));
      }
    }
    out.push({ date, workday, holiday, away: isAway, meetingMinutes: Math.round(meeting), blockMinutes: Math.round(block), capacity, freeMinutes: Math.max(0, Math.round(free)) });
  }
  return out;
}

/** 다른 사람의 가용 시간을 볼 수 있는지: 본인, 또는 그 사람 소속 조직에 권한이 있는 현장 관리자 이상 */
export async function assertCanSeeUser(u: SessionUser, userId: string, sql: Sql = db()) {
  if (u.id === userId) return;
  if (!atLeast(u, 'site_manager')) throw forbidden('다른 사람의 일정 시간은 관리자만 볼 수 있습니다');
  const units = await accessibleUnitIds(u, sql);
  if (atLeast(u, 'admin') && (await sql`select 1 from users where id = ${userId} and tenant = ${tenantOf(u)}`).length) return;
  const ok = await sql`select 1 from memberships where user_id = ${userId} and org_unit_id = any(${units}::uuid[]) limit 1`;
  if (!ok.length) throw notFound('사용자를 찾을 수 없습니다');
}

/** S-7 업무 배정 시 경고용: 그날 회의·업무 블록·남은 가용 */
export async function availabilityOn(u: SessionUser, userId: string, date: string) {
  await assertCanSeeUser(u, userId);
  const [d] = await dayLoads(userId, date, date);
  return d;
}

/**
 * S-6 마감 위험: 남은 예상 시간(예상 - 배정된 업무 시간) 이 마감까지 담당자의 남은 가용 시간보다 크면 위험.
 * 예상 시간이 없거나 완료면 null.
 */
export async function deadlineRisk(t: { id: string; status: string; due_date: string | null; estimate_minutes: number | null; scheduled_minutes?: number; assignee_id: string | null }, now = new Date()) {
  if (!t.estimate_minutes || !t.due_date || t.status === 'done' || !t.assignee_id) return null;
  const remaining = Math.max(0, t.estimate_minutes - (t.scheduled_minutes ?? 0));
  const today = todaySeoul(now);
  if (t.due_date < today) return { remaining, available: 0, risk: remaining > 0, overdue: true };
  if (!remaining) return { remaining: 0, available: null, risk: false, overdue: false };
  const days = await dayLoads(t.assignee_id, today, t.due_date, { notBefore: now });
  const available = days.reduce((a, d) => a + d.freeMinutes, 0);
  return { remaining, available, risk: remaining > available, overdue: false };
}

/** 정기 실행: 마감 위험 업무를 담당자·현장 관리자에게 (업무·마감일당 1번) */
export async function riskNotifyJob(now = new Date()) {
  const sql = db();
  const today = todaySeoul(now);
  const rows = await sql<any[]>`
    select t.id, t.title, t.status, to_char(t.due_date, 'YYYY-MM-DD') as due_date, t.estimate_minutes, t.assignee_id, t.org_unit_id,
      (select coalesce(sum(extract(epoch from (be.end_at - be.start_at)) / 60), 0)::int from events be
        where be.deleted_at is null and be.kind = 'task_block' and (be.task_id = t.id or be.id in (select event_id from event_tasks where task_id = t.id and role = 'block'))) as scheduled_minutes
    from tasks t where t.deleted_at is null and t.status not in ('done') and t.estimate_minutes > 0 and t.assignee_id is not null
      and t.due_date between ${today} and ${addDays(today, 14)}`;
  const { notify } = await import('./notifications');
  let n = 0;
  for (const t of rows) {
    const r = await deadlineRisk(t, now);
    if (!r?.risk) continue;
    const managers = (await sql<{ id: string }[]>`with recursive up as (select id, parent_id from org_units where id = ${t.org_unit_id}
        union select o.id, o.parent_id from org_units o join up on o.id = up.parent_id)
      select distinct u.id from users u join memberships m on m.user_id = u.id where m.org_unit_id in (select id from up) and u.status = 'active' and u.role in ('site_manager','dept_lead')`).map((x) => x.id);
    const h = (m: number) => `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`;
    const created = await notify(sql, { userIds: [t.assignee_id, ...managers], type: 'due_soon', title: `마감 위험: ${t.title}`,
      body: `남은 예상 ${h(r.remaining)} · 마감(${t.due_date})까지 가용 ${h(r.available ?? 0)}`, link: `/tasks/${t.id}`, entityType: 'task', entityId: t.id,
      actorId: null, dedupeKey: `risk:${t.id}:${t.due_date}` });
    if (created.length) n++;
  }
  return { notified: n };
}
