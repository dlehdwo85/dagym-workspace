import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { aiAnalyze, aiReport, latestAi } from '@/lib/revenue';

export const maxDuration = 120; // 종합 보고(Opus)는 오래 걸릴 수 있음
/** AI 분석(매출 권한자). GET ?period= 그 달 최근 결과 · ?id= 보고서 이력에서 고른 것. POST = 새로 분석(deep = 종합 보고) */
export const GET = handler(async ({ req, user }) => {
  const q = req.nextUrl.searchParams;
  const id = q.get('id');
  return { report: id ? await aiReport(user, id) : await latestAi(user, q.get('period') ?? '') };
});
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ period: z.string(), deep: z.boolean().optional() }));
  return { report: await aiAnalyze(user, i.period, clientIp(req), !!i.deep) };
});
