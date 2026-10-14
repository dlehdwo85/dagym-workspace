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
    where r.week_start = ${week} and not u.is_demo ${teamId && /^[0-9a-f-]{36}$/.test(teamId) ? sql`and r.user_id in (select user_id from team_members where team_id = ${teamId})` : sql``} order by u.name`;
  const teams = await sql`select id, name, color from teams where tenant = 'default' and not archived order by name`;
  return { weekStart: week, reports, teams };
});
