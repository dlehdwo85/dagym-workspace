import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { analyzeNow } from '@/lib/revenueAuto';

export const maxDuration = 120;
/** #161 분석 대기 중인 달을 10분 기다리지 않고 지금 분석 */
export const POST = handler(async ({ req, user }) => ({ report: await analyzeNow(user, (await body(req, z.object({ period: z.string() }))).period, clientIp(req)) }));
