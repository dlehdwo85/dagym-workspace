import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { accessibleUnitIds, taskVisibleSql, atLeast } from '@/lib/access';
import { todaySeoul, weekRangeSeoul, seoulMidnight, addDays } from '@/lib/time';
import { listEvents } from '@/lib/events';

/** 대표 대시보드 (권한 범위 내 집계). 대표·본사 관리자는 전사, 그 외는 자기 조직 범위 */
export const GET = handler(async ({ user, req }) => {
  const sql = db();
  const units = await accessibleUnitIds(user, sql);
  const vis = taskVisibleSql(sql, user, units);
  const today = todaySeoul();
  const week = weekRangeSeoul();
  const brand = req.nextUrl.searchParams.get('brand');
  const bf = brand ? sql`and t.brand_id = ${brand}` : sql``;
  const base = sql`from tasks t left join users au on au.id = t.assignee_id left join org_units o on o.id = t.org_unit_id
    where t.deleted_at is null and t.parent_id is null and ${vis} ${bf}`;
  const cols = sql`t.id, t.title, t.status, t.priority, t.due_date, t.assignee_id, au.name as assignee_name, o.name as org_unit_name, t.brand_id`;
  const [important, overdue, review, bySite, workload, completion, events] = await Promise.all([
    sql`select ${cols} ${base} and t.status <> 'done' and (t.due_date <= ${today} or t.priority in ('urgent','high') and t.due_date <= ${addDays(today, 3)})
        order by t.priority = 'urgent' desc, t.due_date limit 20`,
    sql`select ${cols} ${base} and t.status <> 'done' and t.due_date < ${today} order by t.due_date limit 50`,
    sql`select ${cols}, t.review_requested_at ${base} and t.status = 'review' order by t.review_requested_at limit 50`,
    sql`select o.id, o.name, o.type, o.brand_id,
          count(*) filter (where t.status <> 'done')::int as open,
          count(*) filter (where t.status <> 'done' and t.due_date < ${today})::int as overdue,
          count(*) filter (where t.status = 'review')::int as review,
          count(*) filter (where t.status = 'on_hold')::int as on_hold,
          count(*) filter (where t.priority = 'urgent' and t.status <> 'done')::int as urgent
        ${base} group by o.id, o.name, o.type, o.brand_id order by overdue desc, open desc`,
    sql`select au.id, au.name,
          count(*) filter (where t.status <> 'done')::int as open,
          count(*) filter (where t.status <> 'done' and t.due_date < ${today})::int as overdue,
          count(*) filter (where t.status <> 'done' and t.due_date between ${week.start} and ${week.end})::int as this_week,
          count(*) filter (where t.status = 'done' and t.completed_at > now() - interval '7 days')::int as done_7d
        ${base} and t.assignee_id is not null group by au.id, au.name order by open desc limit 50`,
    sql`select to_char(date_trunc('day', t.completed_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') as day, count(*)::int as done
        ${base} and t.status = 'done' and t.completed_at > now() - interval '28 days' group by 1 order by 1`,
    listEvents(user, seoulMidnight(week.start), seoulMidnight(addDays(week.end, 1))),
  ]);
  const [totals] = await sql`select count(*) filter (where t.status <> 'done')::int as open,
      count(*) filter (where t.status = 'done' and t.completed_at > now() - interval '30 days')::int as done_30d,
      count(*) filter (where t.status <> 'done' and t.due_date < ${today})::int as overdue,
      count(*) filter (where t.status = 'review')::int as review,
      count(*) filter (where t.status = 'done' and t.completed_at > now() - interval '7 days')::int as done_7d,
      count(*) filter (where t.status = 'done' and t.completed_at between now() - interval '14 days' and now() - interval '7 days')::int as done_prev7d,
      count(*) filter (where t.created_at > now() - interval '7 days')::int as created_7d,
      count(*) filter (where t.created_at between now() - interval '14 days' and now() - interval '7 days')::int as created_prev7d,
      count(*) filter (where t.status = 'todo')::int as s_todo, count(*) filter (where t.status = 'in_progress')::int as s_in_progress,
      count(*) filter (where t.status = 'on_hold')::int as s_on_hold ${base}`;
  return {
    scope: units === null ? 'company' : 'units', canApprove: atLeast(user, 'site_manager'), today, week,
    totals, important, overdue, review, bySite, workload, completion,
    events: events.filter((e) => e.kind !== 'task_block' || e.createdBy === user.id).slice(0, 60),
  };
});
