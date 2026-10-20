import { handler, body } from '@/lib/api';
import { z } from 'zod';
import { recommendRevenue } from '@/lib/mktOps';
import { monthKst } from '@/lib/mktGoals';

/** 대표 03:00 ① 월 매출 목표 AI 추천(보수/기본/도전 3안, 근거: 지난 3달 계약·파이프라인·워크인 가입·광고 예산) — 대표가 고른 뒤 [설정]은 PUT /ops/revenue */
export const POST = handler(async ({ req, user }) => { const i = await body(req, z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() })); return recommendRevenue(user, i.month ?? monthKst()); });
