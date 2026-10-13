import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { ensureDrafts } from '@/lib/briefing';
import { weekRangeSeoul, seoulMidnight } from '@/lib/time';
import { badRequest } from '@/lib/errors';

const weekOf = (w?: string | null) => (w && /^\d{4}-\d{2}-\d{2}$/.test(w) ? weekRangeSeoul(seoulMidnight(w)).start : weekRangeSeoul().start);
const load = async (userId: string, week: string) =>
  (await db()`select id, week_start, data, body, status, submitted_at, updated_at from personal_reports where user_id = ${userId} and week_start = ${week}`)[0] ?? null;

/** V8 2번 내 주간 보고 (금요일 16시 자동 초안, 지금 만들기도 가능) */
export const GET = handler(async ({ req, user }) => {
  const week = weekOf(req.nextUrl.searchParams.get('week'));
  return { weekStart: week, report: await load(user.id, week) };
});
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ week: z.string().optional() }));
  const week = weekOf(i.week);
  await ensureDrafts(week, user.id);
  return { weekStart: week, report: await load(user.id, week) };
});
export const PUT = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ week: z.string().optional(), body: z.string().max(20000), submit: z.boolean().optional() }));
  const week = weekOf(i.week);
  const r = await load(user.id, week);
  if (!r) throw badRequest('먼저 초안을 만드세요');
  await db()`update personal_reports set body = ${i.body}, updated_at = now(),
    status = ${i.submit ? 'submitted' : r.status}, submitted_at = ${i.submit ? new Date() : r.submitted_at} where id = ${r.id}`;
  return { weekStart: week, report: await load(user.id, week) };
});
