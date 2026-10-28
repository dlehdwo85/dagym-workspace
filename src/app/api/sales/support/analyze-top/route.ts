import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { analyzeTop } from '@/lib/sales/support';

export const maxDuration = 120; // 20건 = 5건씩 네 번
/** #782 '규칙상 맞음 · AI 판단 전' 공고를 맞춤 순 위에서 5·10·20건 AI 판단(관리자가 눌렀을 때만) */
export const POST = handler(async ({ req, user }) => analyzeTop(user, (await body(req, z.object({ n: z.number().int().min(1).max(20).optional() }))).n ?? 5));
