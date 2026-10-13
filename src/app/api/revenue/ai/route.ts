import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { aiAnalyze, latestAi } from '@/lib/revenue';

/** AI 분석 (OPENAI_API_KEY 있을 때만, 본사만). GET = 그 달 최근 결과, POST = 새로 분석 */
export const GET = handler(async ({ req, user }) => {
  const period = req.nextUrl.searchParams.get('period') ?? '';
  return { report: await latestAi(user, period) };
});
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ period: z.string() }));
  return { report: await aiAnalyze(user, i.period, clientIp(req)) };
});
