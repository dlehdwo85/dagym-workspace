import { tenantOf } from '@/lib/types';
import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMenu } from '@/lib/menuPerms';
import { weekRangeSeoul, seoulMidnight } from '@/lib/time';

/** V8 2번: 대표·본사 관리자는 그 주 모두의 보고(초안·제출)를 한 화면에서 */
export const GET = handler(async ({ req, user }) => {
  await requireMenu(user, 'team_reports', 'view'); // V13 2번 메뉴 권한
  const w = req.nextUrl.searchParams.get('week');
  const week = w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? weekRangeSeoul(seoulMidnight(w)).start : weekRangeSeoul().start;
  const teamId = req.nextUrl.searchParams.get('teamId'); // V14 8번 팀별 모아 보기
  const sql = db();
  const reports = await sql`select r.id, r.user_id, u.name, r.status, r.submitted_at, r.body, r.data, r.updated_at from personal_reports r join users u on u.id = r.user_id
    where r.week_start = ${week} and u.tenant = ${tenantOf(user)} ${teamId && /^[0-9a-f-]{36}$/.test(teamId) ? sql`and r.user_id in (select user_id from team_members where team_id = ${teamId})` : sql``} order by u.name`;
  const teams = await sql`select id, name, color from teams where tenant = ${tenantOf(user)} and not archived order by name`; // 범용화 S-01: 예전엔 'default' 고정이라 다른 회사 관리자에게 다짐 팀 이름이 보였다
  // #1118(대표 11/22): 지점 작성 담당은 사내 보고 대신 그 주(금요일) 지점 보고 제출 여부를 한 줄로
  const { branchReportOn } = await import('@/lib/branchReport');
  const branch = branchReportOn(tenantOf(user)) ? await sql<{ userId: string; name: string; sites: { site: string; status: string | null; reportId: string | null }[] }[]>`
    select u.id as "userId", u.name, json_agg(json_build_object('site', s.name, 'status', r.status, 'reportId', r.id) order by s.sort, s.name) as sites
    from branch_sites s join users u on u.id = s.writer_user_id
    left join branch_reports r on r.site_id = s.id and r.kind = 'weekly' and r.report_day = ${week}::date + 4
    where s.tenant = ${tenantOf(user)} and not s.hidden and u.status = 'active'
    group by u.id, u.name order by u.name` : [];
  return { weekStart: week, reports, teams, branch };
});
