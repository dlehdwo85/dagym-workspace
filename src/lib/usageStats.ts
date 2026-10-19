// V30 ⑤ 관리자 이용 현황: 사용자·팀별 최근 접속(접속한 날·세션), DAU/WAU/MAU(접속한 날 기준), 업무 만든 수·끝낸 수, 저장공간(올린 파일).
// 사용량·요금제 화면의 "이용 현황" 탭. 보기 권한 = 사용량 메뉴(보기 이상). 다른 회사 데이터는 섞이지 않는다(tenant 조건).
import { db, type Sql } from './db';
import { forbidden } from './errors';
import { isAdmin } from './access';
import { RANK, menuLevel } from './menuPerms';
import { todaySeoul } from './time';
import { tenantOf, type SessionUser } from './types';

export type StatsRange = 7 | 30 | 90;
const RANGES: StatsRange[] = [7, 30, 90];
export const pickRange = (v: string | null | undefined): StatsRange => (RANGES.includes(Number(v) as StatsRange) ? (Number(v) as StatsRange) : 30);

const canView = async (u: SessionUser, sql: Sql) => isAdmin(u) || RANK[await menuLevel(u, 'usage', sql)] >= RANK.view;

/** 기간(days) 안의 이용 현황 — 오늘(Asia/Seoul) 포함 days 일 */
export async function usageStats(u: SessionUser, days: StatsRange = 30, sql: Sql = db()) {
  if (!(await canView(u, sql))) throw forbidden('이용 현황은 사용량·요금제 권한이 있어야 볼 수 있습니다');
  const t = tenantOf(u);
  const today = todaySeoul();
  const since = addDays(today, -(days - 1));
  const sinceTs = sql`(${since}::date::timestamp at time zone 'Asia/Seoul')`;
  const [users, teams, daily, [summary]] = await Promise.all([
    sql<{ id: string; name: string; title: string | null; role: string; status: string; last_active: Date | null; active_days: number; tasks_created: number; tasks_done: number; storage_bytes: number; teams: string[] }[]>`
      select u2.id, u2.name, u2.title, u2.role, u2.status,
        greatest(u2.last_login_at, (select max(s.last_seen_at) from sessions s where s.user_id = u2.id and s.revoked_at is null),
          (select max(d.day)::timestamp at time zone 'Asia/Seoul' from user_active_days d where d.user_id = u2.id)) as last_active,
        (select count(*)::int from user_active_days d where d.user_id = u2.id and d.day >= ${since}::date) as active_days,
        (select count(*)::int from tasks tk where tk.created_by = u2.id and tk.deleted_at is null and tk.created_at >= ${sinceTs}) as tasks_created,
        (select count(*)::int from tasks tk where tk.assignee_id = u2.id and tk.deleted_at is null and tk.status = 'done' and tk.completed_at >= ${sinceTs}) as tasks_done,
        (coalesce((select sum(a.size_bytes) from attachments a where a.created_by = u2.id and a.kind = 'file' and a.storage_key is not null
            and not exists (select 1 from library_files l where l.storage_key = a.storage_key)), 0)
          + coalesce((select sum(l.size_bytes) from library_files l where l.created_by = u2.id and l.tenant = ${t}), 0))::float8 as storage_bytes,
        coalesce((select array_agg(tm2.name order by tm2.name) from team_members m2 join teams tm2 on tm2.id = m2.team_id where m2.user_id = u2.id and not tm2.archived), '{}') as teams
      from users u2 where u2.tenant = ${t} and u2.status in ('active', 'disabled') order by last_active desc nulls last, u2.name`,
    sql<{ id: string; name: string; color: string; members: number; active_users: number; tasks_created: number; tasks_done: number }[]>`
      select tm.id, tm.name, tm.color,
        (select count(*)::int from team_members m join users u2 on u2.id = m.user_id where m.team_id = tm.id and u2.status = 'active') as members,
        (select count(distinct d.user_id)::int from team_members m join user_active_days d on d.user_id = m.user_id where m.team_id = tm.id and d.day >= ${since}::date) as active_users,
        (select count(*)::int from tasks tk where tk.team_id = tm.id and tk.deleted_at is null and tk.created_at >= ${sinceTs}) as tasks_created,
        (select count(*)::int from tasks tk where tk.team_id = tm.id and tk.deleted_at is null and tk.status = 'done' and tk.completed_at >= ${sinceTs}) as tasks_done
      from teams tm where tm.tenant = ${t} and not tm.archived order by tm.name`,
    sql<{ day: string; active: number; created: number; done: number }[]>`
      select to_char(g.day, 'YYYY-MM-DD') as day,
        (select count(*)::int from user_active_days d join users u2 on u2.id = d.user_id where u2.tenant = ${t} and d.day = g.day) as active,
        (select count(*)::int from tasks tk join users u2 on u2.id = tk.created_by where u2.tenant = ${t} and tk.deleted_at is null and (tk.created_at at time zone 'Asia/Seoul')::date = g.day) as created,
        (select count(*)::int from tasks tk join users u2 on u2.id = tk.created_by where u2.tenant = ${t} and tk.deleted_at is null and tk.status = 'done' and (tk.completed_at at time zone 'Asia/Seoul')::date = g.day) as done
      from generate_series(${since}::date, ${today}::date, interval '1 day') g(day) order by g.day`,
    sql<{ dau: number; wau: number; mau: number }[]>`
      select (select count(distinct d.user_id)::int from user_active_days d join users u2 on u2.id = d.user_id where u2.tenant = ${t} and d.day = ${today}::date) as dau,
        (select count(distinct d.user_id)::int from user_active_days d join users u2 on u2.id = d.user_id where u2.tenant = ${t} and d.day > ${today}::date - 7) as wau,
        (select count(distinct d.user_id)::int from user_active_days d join users u2 on u2.id = d.user_id where u2.tenant = ${t} and d.day > ${today}::date - 30) as mau`,
  ]);
  const activeUsers = users.filter((x) => x.status === 'active');
  return {
    days, since, today, summary: { ...summary, users: activeUsers.length, activeInRange: activeUsers.filter((x) => x.active_days > 0).length,
      tasksCreated: daily.reduce((s, d) => s + d.created, 0), tasksDone: daily.reduce((s, d) => s + d.done, 0), storageBytes: users.reduce((s, x) => s + x.storage_bytes, 0) },
    users, teams, daily,
  };
}

/** 엑셀: 사용자 표 + 팀 표 + 날짜별 */
export async function exportStats(u: SessionUser, days: StatsRange = 30) {
  const s = await usageStats(u, days);
  const { writeXlsx } = await import('./xlsx');
  const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(d) : '');
  const mb = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;
  const data = writeXlsx([
    { name: '사용자', rows: [['이름', '직책', '팀', '상태', '최근 접속', `접속일(${days}일)`, '만든 업무', '끝낸 업무', '저장 MB'],
      ...s.users.map((x) => [x.name, x.title ?? '', x.teams.join(', '), x.status === 'active' ? '사용 중' : '비활성', fmt(x.last_active), x.active_days, x.tasks_created, x.tasks_done, mb(x.storage_bytes)])], widths: [10, 10, 16, 8, 16, 10, 10, 10, 10] },
    { name: '팀', rows: [['팀', '인원', `접속한 사람(${days}일)`, '만든 업무', '끝낸 업무'], ...s.teams.map((x) => [x.name, x.members, x.active_users, x.tasks_created, x.tasks_done])] },
    { name: '날짜별', rows: [['날짜', '접속한 사람', '만든 업무', '끝낸 업무'], ...s.daily.map((d) => [d.day, d.active, d.created, d.done])] },
  ]);
  return { fileName: `이용현황_${s.since}_${s.today}.xlsx`, data };
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
