import { db } from './db';
import { accessibleUnitIds, atLeast, isAdmin } from './access';
import { forbidden, notFound } from './errors';
import { listEvents } from './events';
import { notify } from './notifications';
import { addDays, seoulMidnight, todaySeoul, weekRangeSeoul } from './time';
import type { SessionUser } from './types';
import { DateTime } from 'luxon';

const TZ = 'Asia/Seoul';
const r1 = (n: number | null) => (n === null || Number.isNaN(n) ? null : Math.round(n * 10) / 10);

/**
 * B-14 현장 비교: 최근 N주 현장(지점·위탁현장)별 기한 준수율·평균 처리 일수·지연·미해결 민원·점검 수행률 + 주별 추이.
 * 현장 관리자 이상, 자기 권한 범위의 현장만.
 */
export async function siteComparison(u: SessionUser, weeks = 4, brand?: string | null) {
  if (!atLeast(u, 'site_manager')) throw forbidden('현장 비교는 현장 관리자 이상이 봅니다');
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const today = todaySeoul();
  const thisMonday = weekRangeSeoul().start;
  const from = addDays(thisMonday, -7 * (weeks - 1));
  const fromTs = seoulMidnight(from);
  const unitFilter = units === null ? sql`true` : sql`o.id = any(${units}::uuid[])`;
  const brandFilter = brand ? sql`and o.brand_id = ${brand}` : sql``;
  const sites = await sql<{ id: string; name: string; type: string; brand_id: string | null }[]>`
    select o.id, o.name, o.type, o.brand_id from org_units o where o.active and o.type in ('branch','site') and ${unitFilter} ${brandFilter} order by o.name`;
  if (!sites.length) return { from, to: today, weeks: [] as string[], sites: [] };
  const ids = sites.map((s) => s.id);
  const stats = await sql<any[]>`
    select t.org_unit_id,
      count(*) filter (where t.status = 'done' and t.completed_at >= ${fromTs} and t.due_date is not null)::int as done_with_due,
      count(*) filter (where t.status = 'done' and t.completed_at >= ${fromTs} and t.due_date is not null
        and (t.completed_at at time zone ${TZ})::date <= t.due_date)::int as done_on_time,
      count(*) filter (where t.status = 'done' and t.completed_at >= ${fromTs})::int as done,
      avg(extract(epoch from t.completed_at - t.created_at) / 86400) filter (where t.status = 'done' and t.completed_at >= ${fromTs})::float8 as avg_days,
      count(*) filter (where t.status <> 'done')::int as open,
      count(*) filter (where t.status <> 'done' and t.due_date < ${today})::int as overdue,
      count(*) filter (where t.status <> 'done' and '회원 민원' = any(t.tags))::int as open_complaints,
      count(*) filter (where t.task_type = 'inspection' and t.due_date between ${from} and ${today})::int as insp_total,
      count(*) filter (where t.task_type = 'inspection' and t.due_date between ${from} and ${today} and t.status = 'done')::int as insp_done
    from tasks t where t.deleted_at is null and t.parent_id is null and t.org_unit_id = any(${ids}::uuid[]) group by t.org_unit_id`;
  const trend = await sql<{ org_unit_id: string; wk: string; done: number; on_time: number; with_due: number }[]>`
    select t.org_unit_id, to_char(date_trunc('week', t.completed_at at time zone ${TZ}), 'YYYY-MM-DD') as wk,
      count(*)::int as done,
      count(*) filter (where t.due_date is not null and (t.completed_at at time zone ${TZ})::date <= t.due_date)::int as on_time,
      count(*) filter (where t.due_date is not null)::int as with_due
    from tasks t where t.deleted_at is null and t.parent_id is null and t.status = 'done' and t.completed_at >= ${fromTs}
      and t.org_unit_id = any(${ids}::uuid[]) group by 1, 2`;
  const weekList = Array.from({ length: weeks }, (_, i) => addDays(from, i * 7));
  return {
    from, to: today, weeks: weekList,
    sites: sites.map((s) => {
      const st = stats.find((x) => x.org_unit_id === s.id) ?? {};
      return {
        ...s,
        done: st.done ?? 0, open: st.open ?? 0, overdue: st.overdue ?? 0, openComplaints: st.open_complaints ?? 0,
        onTimeRate: st.done_with_due ? Math.round((st.done_on_time / st.done_with_due) * 100) : null,
        avgDays: r1(st.avg_days ?? null),
        inspectionRate: st.insp_total ? Math.round((st.insp_done / st.insp_total) * 100) : null,
        inspection: { done: st.insp_done ?? 0, total: st.insp_total ?? 0 },
        trend: weekList.map((w) => {
          const x = trend.find((r) => r.org_unit_id === s.id && r.wk === w);
          return { week: w, done: x?.done ?? 0, onTimeRate: x?.with_due ? Math.round((x.on_time / x.with_due) * 100) : null };
        }),
      };
    }),
  };
}

/**
 * B-16 업무량: 사람별 그 주의 마감 업무 수·지연·일정 시간 합계·휴가/출장 일수, 과부하 표시.
 * 직원은 자기 것만, 현장 관리자 이상은 권한 범위 조직의 사람. 다른 사람의 개인 일정은 제목 없이 시간만 합산.
 */
export async function workload(u: SessionUser, weekStart?: string) {
  const sql = db();
  const start = weekStart && /^\d{4}-\d{2}-\d{2}$/.test(weekStart) ? weekRangeSeoul(seoulMidnight(weekStart)).start : weekRangeSeoul().start;
  const end = addDays(start, 6);
  const units = await accessibleUnitIds(u, sql);
  const people = !atLeast(u, 'site_manager')
    ? await sql<any[]>`select id, email, name, role, status, title from users where id = ${u.id}`
    : await sql<any[]>`select distinct u.id, u.email, u.name, u.role, u.status, u.title from users u left join memberships m on m.user_id = u.id
        where u.status = 'active' and ${units === null ? sql`true` : sql`m.org_unit_id = any(${units}::uuid[])`} order by u.name`;
  const ids = people.map((p) => p.id);
  const holidays = await sql<{ date: string; name: string }[]>`select to_char(date, 'YYYY-MM-DD') as date, name from holidays where date between ${start} and ${end}`;
  const tasks = ids.length ? await sql<any[]>`
    select t.assignee_id, count(*) filter (where t.due_date between ${start} and ${end})::int as due_week,
      count(*) filter (where t.due_date < ${todaySeoul()})::int as overdue,
      count(*) filter (where t.priority in ('urgent','high') and t.due_date between ${start} and ${end})::int as hot
    from tasks t where t.deleted_at is null and t.status <> 'done' and t.assignee_id = any(${ids}::uuid[]) group by t.assignee_id` : [];
  const from = seoulMidnight(start), to = seoulMidnight(addDays(end, 1));
  const workdays = 5 - holidays.filter((h) => { const d = DateTime.fromISO(h.date).weekday; return d <= 5; }).length;
  const out = [];
  for (const p of people) {
    const evs = await listEvents({ ...p, timezone: TZ, sessionId: '' } as SessionUser, from, to);
    let minutes = 0;
    const away = new Set<string>();
    for (const e of evs) {
      const mine = e.attendees.some((a: any) => a.user_id === p.id && a.response !== 'declined') || (e.calendarType === 'personal') || ((e.kind === 'vacation' || e.kind === 'business_trip') && e.createdBy === p.id);
      if (!mine) continue;
      const s = new Date(Math.max(new Date(e.start).getTime(), from.getTime()));
      const en = new Date(Math.min(new Date(e.end).getTime(), to.getTime()));
      if (e.kind === 'vacation' || e.kind === 'business_trip') {
        for (let d = DateTime.fromJSDate(s).setZone(TZ).startOf('day'); d.toJSDate() < en; d = d.plus({ days: 1 })) if (d.weekday <= 5) away.add(d.toISODate()!);
        continue;
      }
      if (!e.allDay && en > s) minutes += (en.getTime() - s.getTime()) / 60000;
    }
    const t = tasks.find((x) => x.assignee_id === p.id) ?? { due_week: 0, overdue: 0, hot: 0 };
    const availableDays = Math.max(0, workdays - away.size);
    const eventHours = r1(minutes / 60) ?? 0;
    // 과부하: 마감 업무가 가용 근무일×2 를 넘거나, 일정이 가용 시간(일 8시간)의 70% 이상, 또는 지연 3건 이상
    const overloaded = t.due_week > Math.max(2, availableDays * 2) || eventHours > availableDays * 8 * 0.7 || t.overdue >= 3;
    out.push({ id: p.id, name: p.name, title: p.title, dueThisWeek: t.due_week, overdue: t.overdue, hot: t.hot, eventHours, awayDays: away.size, availableDays, overloaded });
  }
  return { weekStart: start, weekEnd: end, holidays, people: out };
}

/** B-15 지난주(월~일) 전사 주간 보고 데이터 */
export async function buildWeeklyReport(weekStart: string) {
  const sql = db();
  const end = addDays(weekStart, 6);
  const from = seoulMidnight(weekStart), to = seoulMidnight(addDays(end, 1));
  const sites = await sql<any[]>`
    select o.id, o.name, o.type, o.brand_id,
      count(t.id) filter (where t.status = 'done' and t.completed_at >= ${from} and t.completed_at < ${to})::int as done,
      count(t.id) filter (where t.created_at >= ${from} and t.created_at < ${to})::int as created,
      count(t.id) filter (where t.status <> 'done' and t.due_date <= ${end})::int as overdue,
      count(t.id) filter (where t.status = 'review')::int as review,
      count(t.id) filter (where t.status <> 'done' and '회원 민원' = any(t.tags))::int as open_complaints
    from org_units o left join tasks t on t.org_unit_id = o.id and t.deleted_at is null and t.parent_id is null
    where o.active group by o.id order by done desc, o.name`;
  const issues = await sql<any[]>`
    select t.id, t.title, t.priority, t.due_date, o.name as org_unit_name, u.name as assignee_name
    from tasks t join org_units o on o.id = t.org_unit_id left join users u on u.id = t.assignee_id
    where t.deleted_at is null and t.status <> 'done' and (t.priority in ('urgent','high') or t.due_date <= ${end})
    order by t.priority = 'urgent' desc, t.due_date nulls last limit 10`;
  const photos = await sql<any[]>`
    select a.id, a.file_name, t.id as task_id, t.title as task_title, o.name as org_unit_name, a.captured_at
    from attachments a join tasks t on t.id = a.task_id join org_units o on o.id = t.org_unit_id
    where a.deleted_at is null and a.upload_status = 'ready' and a.kind = 'file' and a.mime_type like 'image/%'
      and a.created_at >= ${from} and a.created_at < ${to} and t.deleted_at is null
    order by a.created_at desc limit 8`;
  const tot = sites.reduce((a, s) => ({ done: a.done + s.done, created: a.created + s.created, overdue: a.overdue + s.overdue, review: a.review + s.review, complaints: a.complaints + s.open_complaints }),
    { done: 0, created: 0, overdue: 0, review: 0, complaints: 0 });
  return { weekStart, weekEnd: end, totals: tot, sites: sites.filter((s) => s.done || s.created || s.overdue || s.review || s.open_complaints), issues, photos };
}

/** 정기 실행: 월요일 08:00(서울) 이후 지난주 보고가 없으면 1번 만들고 대표·본사 관리자에게 알림 */
export async function weeklyReportJob(now = new Date()) {
  const d = DateTime.fromJSDate(now).setZone(TZ);
  if (d.weekday === 1 && d.hour < 8) return { skipped: 'before Monday 08:00' };
  const lastMonday = addDays(weekRangeSeoul(now).start, -7);
  const sql = db();
  const [exists] = await sql`select 1 from weekly_reports where week_start = ${lastMonday}`;
  if (exists) return { skipped: 'exists' };
  const data = await buildWeeklyReport(lastMonday);
  const [r] = await sql<{ id: string }[]>`insert into weekly_reports (week_start, data) values (${lastMonday}, ${sql.json(data as never)})
    on conflict (week_start) do nothing returning id`;
  if (!r) return { skipped: 'race' };
  const admins = (await sql<{ id: string }[]>`select id from users where role in ('owner','admin') and status = 'active'`).map((x) => x.id);
  await notify(sql, { userIds: admins, type: 'weekly_report', title: `주간 보고 (${lastMonday.slice(5).replace('-', '/')} 주)`,
    body: `완료 ${data.totals.done} · 새 업무 ${data.totals.created} · 지연 ${data.totals.overdue} · 미해결 민원 ${data.totals.complaints}`,
    link: `/reports/${r.id}`, entityType: 'weekly_report', entityId: r.id, actorId: null, dedupeKey: `weekly:${lastMonday}` });
  return { created: r.id };
}

export async function listReports(u: SessionUser) {
  if (!isAdmin(u)) throw forbidden('주간 보고는 대표·본사 관리자가 봅니다');
  return db()`select id, week_start, created_at, data->'totals' as totals from weekly_reports order by week_start desc limit 52`;
}
export async function getReport(u: SessionUser, id: string) {
  if (!isAdmin(u)) throw forbidden('주간 보고는 대표·본사 관리자가 봅니다');
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const [r] = await db()`select id, week_start, created_at, data from weekly_reports where id = ${id}`;
  if (!r) throw notFound('보고서가 없습니다');
  return r;
}

export async function listHolidays(from: string, to: string) {
  return db()<{ date: string; name: string }[]>`select to_char(date, 'YYYY-MM-DD') as date, name from holidays where date between ${from} and ${to} order by date`;
}
