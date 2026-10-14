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
  const cols = sql`t.id, t.title, t.status, t.priority, t.due_date, t.assignee_id, au.name as assignee_name, o.name as org_unit_name, t.brand_id, t.requested_by, (select name from users ru where ru.id = t.requested_by) as requested_by_name`;
  // 홈 "오늘 할 일" 전체: 오늘 마감 + 기한 지난 미완료 (권한 범위 전체)
  const todayAll = sql`select ${cols}, t.due_time, t.version, t.approval_required, t.approval_line_id ${base} and t.status <> 'done' and t.due_date <= ${today}
    order by t.due_date, t.priority = 'urgent' desc limit 30`;
  // 최근 활동: 업무 생성·완료·댓글 (보이는 업무만) 10건
  const recent = sql`select * from (
      select 'created' as kind, t.id as task_id, t.title, t.created_at as at, cu.id as actor_id, cu.name as actor_name, null::text as body
        from tasks t left join users cu on cu.id = t.created_by left join org_units o on o.id = t.org_unit_id
        where t.deleted_at is null and ${vis} ${bf} and t.created_at > now() - interval '30 days'
      union all
      select 'done', t.id, t.title, t.completed_at, au.id, au.name, null from tasks t left join users au on au.id = t.assignee_id left join org_units o on o.id = t.org_unit_id
        where t.deleted_at is null and ${vis} ${bf} and t.status = 'done' and t.completed_at > now() - interval '30 days'
      union all
      select 'comment', t.id, t.title, c.created_at, cu.id, cu.name, left(c.body, 80) from comments c join tasks t on t.id = c.task_id left join users cu on cu.id = c.author_id left join org_units o on o.id = t.org_unit_id
        where c.deleted_at is null and t.deleted_at is null and ${vis} ${bf} and c.created_at > now() - interval '30 days'
    ) a order by at desc limit 10`;
  const [important, overdue, review, bySite, workload, completion, events, todayTasks, activity] = await Promise.all([
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
          count(*) filter (where t.status <> 'done' and t.due_date = ${today})::int as due_today,
          count(*) filter (where t.status = 'done' and t.completed_at >= ${seoulMidnight(week.start)})::int as done_week,
          count(*) filter (where t.status = 'done' and t.completed_at > now() - interval '7 days')::int as done_7d
        ${base} and t.assignee_id is not null group by au.id, au.name order by open desc limit 50`,
    sql`select to_char(date_trunc('day', t.completed_at at time zone 'Asia/Seoul'), 'YYYY-MM-DD') as day, count(*)::int as done
        ${base} and t.status = 'done' and t.completed_at > now() - interval '28 days' group by 1 order by 1`,
    listEvents(user, seoulMidnight(week.start), seoulMidnight(addDays(week.end, 1))),
    todayAll, recent,
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
    totals, important, overdue, review, bySite, workload, completion, todayAll: todayTasks, activity,
    events: events.filter((e) => e.kind !== 'task_block' || e.createdBy === user.id).slice(0, 60),
  };
});
