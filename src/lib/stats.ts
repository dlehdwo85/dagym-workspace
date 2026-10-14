import { db } from './db';
import { accessibleUnitIds, taskVisibleSql } from './access';
import { addDays, todaySeoul } from './time';
import { tenantOf, type SessionUser } from './types';

/** V6 7번 달성률: 기간(이번 주/이번 달)과 그 전 기간 비교. 보이는 업무만, 삭제 제외 */
export async function achievement(u: SessionUser, period: 'week' | 'month') {
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const today = todaySeoul();
  const d = new Date(today + 'T00:00:00Z');
  let start: string, end: string, pStart: string, pEnd: string;
  if (period === 'week') {
    start = addDays(today, -((d.getUTCDay() + 6) % 7)); end = addDays(start, 6); pStart = addDays(start, -7); pEnd = addDays(start, -1);
  } else {
    start = today.slice(0, 8) + '01';
    const n = new Date(start + 'T00:00:00Z'); n.setUTCMonth(n.getUTCMonth() + 1); end = addDays(n.toISOString().slice(0, 10), -1);
    const p = new Date(start + 'T00:00:00Z'); p.setUTCMonth(p.getUTCMonth() - 1); pStart = p.toISOString().slice(0, 10); pEnd = addDays(start, -1);
  }
  const vis = taskVisibleSql(sql, u, units);
  // 완료율 = 기간에 마감이 온(오늘까지) 업무 중 완료, 기한 준수율 = 그중 완료된 것 중 마감일까지 완료
  const metric = (s: string, e: string) => sql<{ due: number; done: number; on_time: number; avg_days: number | null }[]>`
    select count(*)::int as due,
      count(*) filter (where t.status = 'done')::int as done,
      count(*) filter (where t.status = 'done' and (t.completed_at at time zone 'Asia/Seoul')::date <= t.due_date)::int as on_time,
      round(avg(extract(epoch from (t.completed_at - t.created_at)) / 86400) filter (where t.status = 'done')::numeric, 1)::float as avg_days
    from tasks t where t.deleted_at is null and t.parent_id is null and t.due_date between ${s} and ${e < today ? e : today} and ${vis}`;
  const [[cur], [prev], [over], people, projects, mine, cal] = await Promise.all([
    metric(start, end), metric(pStart, pEnd),
    sql<{ n: number }[]>`select count(*)::int n from tasks t where t.deleted_at is null and t.status <> 'done' and t.due_date < ${today} and ${vis}`,
    // 사람별 (본사 사람 + 이번 기간 마감 업무가 있는 사람)
    sql<{ id: string; name: string; due: number; done: number; on_time: number; overdue: number }[]>`
      select a.id, a.name, count(*)::int as due, count(*) filter (where t.status = 'done')::int as done,
        count(*) filter (where t.status = 'done' and (t.completed_at at time zone 'Asia/Seoul')::date <= t.due_date)::int as on_time,
        count(*) filter (where t.status <> 'done' and t.due_date < ${today})::int as overdue
      from tasks t join users a on a.id = t.assignee_id
      where t.deleted_at is null and t.parent_id is null and t.due_date between ${start} and ${end < today ? end : today} and ${vis} and a.tenant = ${tenantOf(u)}
      group by a.id, a.name order by a.name`,
    // 프로젝트 진행률 (완료/전체, 하위 업무 제외)
    sql<{ id: string; name: string; color: string; total: number; done: number }[]>`
      select p.id, p.name, p.color, count(t.id)::int as total, count(t.id) filter (where t.status = 'done')::int as done
      from projects p join tasks t on t.project_id = p.id and t.deleted_at is null and t.parent_id is null
      where not p.archived and ${vis} group by p.id, p.name, p.color order by p.name limit 20`,
    // 내가 지시한 업무 현황
    sql<{ open: number; late: number; done_period: number }[]>`
      select count(*) filter (where t.status <> 'done')::int as open,
        count(*) filter (where t.status <> 'done' and t.due_date < ${today})::int as late,
        count(*) filter (where t.status = 'done' and (t.completed_at at time zone 'Asia/Seoul')::date between ${start} and ${end})::int as done_period
      from tasks t where t.deleted_at is null and t.requested_by = ${u.id} and t.assignee_id is distinct from ${u.id}`,
    // 캘린더: 사람별 기간 일정 시간 합계·회의(참석자 2명 이상) 비율 — 반복 일정은 원본 1회만 셈(대략)
    sql<{ id: string; name: string; minutes: number; meeting_minutes: number }[]>`
      select ow.id, ow.name, coalesce(sum(extract(epoch from (e.end_at - e.start_at)) / 60), 0)::int as minutes,
        coalesce(sum(extract(epoch from (e.end_at - e.start_at)) / 60) filter (where (select count(*) from event_attendees x where x.event_id = e.id) >= 2), 0)::int as meeting_minutes
      from events e join calendars c on c.id = e.calendar_id join users ow on ow.id = coalesce(c.owner_user_id, e.created_by)
      where e.deleted_at is null and not e.all_day and e.recurring_event_id is null and e.rrule is null and ow.tenant = ${tenantOf(u)}
        and (e.start_at at time zone 'Asia/Seoul')::date between ${start} and ${end}
        and (c.type <> 'personal' or c.owner_user_id = ${u.id} or exists (select 1 from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = c.owner_user_id and o.type = 'hq'))
      group by ow.id, ow.name order by minutes desc limit 10`,
  ]);
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  return {
    period, start, end,
    completion: rate(cur.done, cur.due), completionPrev: rate(prev.done, prev.due),
    onTime: rate(cur.on_time, cur.done), onTimePrev: rate(prev.on_time, prev.done),
    due: cur.due, done: cur.done, overdue: over.n, avgDays: cur.avg_days,
    people: people.map((p) => ({ ...p, completion: rate(p.done, p.due) })),
    projects: projects.map((p) => ({ ...p, progress: rate(p.done, p.total) ?? 0 })),
    requested: mine[0], calendar: cal,
  };
}
