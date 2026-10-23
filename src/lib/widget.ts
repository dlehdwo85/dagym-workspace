// 로컬 10/20 휴대폰 바탕화면 위젯용 가벼운 API: 오늘·지난 업무 최대 5, 오늘 남은 일정 3, 지남·오늘·승인 대기 수, 다음 일정 시각.
// 권한 범위는 그대로(내 담당 업무·내 캘린더), 응답 2KB 안, 15분 캐시 허용. 네이티브(Android AppWidget·iOS WidgetKit)는 로컬이 만든다.
import { DateTime } from 'luxon';
import { db } from './db';
import { todaySeoul } from './time';
import type { SessionUser } from './types';
import { assignedOpenSql } from './taskAssignees';

const TZ = 'Asia/Seoul';
const SPACE_COLOR: Record<string, string> = { work: '#0F766E', sales: '#2563EB', marketing: '#7C3AED' };
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export async function widgetToday(u: SessionUser) {
  const sql = db();
  const today = todaySeoul();
  const now = new Date();
  const [tasks, [c], evs] = await Promise.all([
    sql<{ id: string; title: string; due_date: string | null; due_time: string | null; status: string; priority: string; space: string | null }[]>`
      select t.id, t.title, to_char(t.due_date, 'YYYY-MM-DD') due_date, to_char(t.due_time, 'HH24:MI') due_time, t.status, t.priority, t.space from tasks t
      where t.deleted_at is null and ${assignedOpenSql(sql, u.id)} and t.status not in ('on_hold') -- #475 공동 담당(내 몫 완료 전)도
        and ((t.status <> 'done' and (t.due_date <= ${today} or t.start_date <= ${today})) or (t.status = 'done' and t.completed_at >= (${today}::date::timestamp at time zone 'Asia/Seoul')))
      order by (t.status = 'done'), (t.due_date < ${today}) desc, t.priority = 'urgent' desc, t.priority = 'high' desc, t.due_time nulls last, t.created_at limit 5`,
    sql<{ late: number; today: number; approvals: number }[]>`
      select count(*) filter (where t.status <> 'done' and t.due_date < ${today})::int as late,
        count(*) filter (where t.status <> 'done' and t.due_date = ${today})::int as today,
        (select count(*)::int from tasks r where r.deleted_at is null and r.status = 'review' and r.requested_by = ${u.id} and r.assignee_id <> ${u.id})
          + (select count(*)::int from task_approvals a join tasks ta on ta.id = a.task_id where a.status = 'pending' and a.approver_user_id = ${u.id} and ta.deleted_at is null) as approvals
      from tasks t where t.deleted_at is null and ${assignedOpenSql(sql, u.id)} and t.status <> 'on_hold'`,
    (await import('./briefing')).eventsOfDay(sql, u.id, today),
  ]);
  const left = evs.filter((e) => e.allDay || e.start.getTime() >= now.getTime() - 15 * 60_000);
  const hm = (d: Date) => DateTime.fromJSDate(d).setZone(TZ).toFormat('HH:mm');
  const next = left.find((e) => !e.allDay && e.start.getTime() > now.getTime());
  return {
    date: today,
    tasks: tasks.map((t) => ({ id: t.id, title: cut(t.title, 40), due: t.due_date === today ? (t.due_time ?? '오늘') : t.due_date && t.due_date < today ? '지남' : t.due_date?.slice(5).replace('-', '/') ?? '', late: !!t.due_date && t.due_date < today && t.status !== 'done', done: t.status === 'done', color: SPACE_COLOR[t.space ?? 'work'] ?? SPACE_COLOR.work, priority: t.priority })),
    events: left.slice(0, 3).map((e) => ({ title: cut(e.title, 30), time: e.allDay ? '종일' : hm(e.start), allDay: e.allDay })),
    counts: { late: c.late, today: c.today, approvals: c.approvals },
    next: next ? { time: hm(next.start), title: cut(next.title, 30) } : null,
    links: { task: 'workos://tasks/{id}', newTask: 'workos://tasks?new=1', today: 'workos://calendar?view=timeGridDay', ai: 'workos://assistant' },
  };
}

/** 위젯 체크: 내 업무 완료(권한·검토 규칙은 updateTask 그대로 — 검토 필요 업무는 검토 요청 상태로) */
export async function widgetDone(u: SessionUser, id: string) {
  const sql = db();
  const [t] = await sql<{ version: number; status: string; approval_required: boolean }[]>`select version, status, approval_required from tasks where id = ${id} and deleted_at is null`;
  const { notFound } = await import('./errors');
  if (!t) throw notFound('업무가 없습니다');
  const { updateTask } = await import('./tasks');
  const r = await updateTask(u, id, { status: t.status === 'done' ? 'in_progress' : t.approval_required ? 'review' : 'done', version: t.version });
  const [after] = await sql<{ status: string }[]>`select status from tasks where id = ${id}`;
  return { ok: true, status: after.status, version: r.version };
}
