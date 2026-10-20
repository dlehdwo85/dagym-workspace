import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { backfillRationale } from '@/lib/mktGoals';

/** ④ 이달 자동 제작분 근거 소급(AI 비용 0) */
export const POST = handler(async ({ req, user }) => backfillRationale(user, (await body(req, z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }))).month));
