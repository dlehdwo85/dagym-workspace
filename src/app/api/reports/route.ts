import { tenantOf } from '@/lib/types';
import { notFound } from '@/lib/errors';
import { z } from 'zod';
import { handler, body, zDate } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMenu } from '@/lib/menuPerms';
import { buildWeeklyReport, listReports } from '@/lib/insights';
import { weekRangeSeoul, seoulMidnight, addDays } from '@/lib/time';

export const GET = handler(async ({ user }) => ({ reports: await listReports(user) }));
/** 관리자가 지난주(또는 지정한 주) 보고를 바로 만들기. 이미 있으면 그 보고를 돌려준다 */
export const POST = handler(async ({ req, user }) => {
  await requireMenu(user, 'team_reports', 'edit');
  if (tenantOf(user) !== 'default') throw notFound(); // 회사 전체 주간 보고는 기본 회사 전용(현장 집계)
  const i = await body(req, z.object({ weekStart: zDate.optional() }));
  const week = i.weekStart ? weekRangeSeoul(seoulMidnight(i.weekStart)).start : addDays(weekRangeSeoul().start, -7);
  const sql = db();
  const [old] = await sql`select id from weekly_reports where week_start = ${week}`;
  if (old) return { id: old.id, existed: true };
  const data = await buildWeeklyReport(week);
  const [r] = await sql`insert into weekly_reports (week_start, data) values (${week}, ${sql.json(data as never)}) on conflict (week_start) do update set week_start = excluded.week_start returning id`;
  return { id: r.id, existed: false };
}, { idempotent: true });
