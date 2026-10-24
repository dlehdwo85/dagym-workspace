import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { setLimit } from '@/lib/ai/assistant';
import { usdKrw } from '@/lib/ai/provider';

/** 대표가 정하는 회사 AI 월 한도 — 달러 또는 원(대표 10/24 ②: 요금제 예산보다 낮게 정하면 그 값에서 멈춤), clear = 지우고 요금제 예산 그대로 */
export const PUT = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ monthlyUsd: z.number().min(0).max(100000).optional(), monthlyKrw: z.number().int().min(0).max(140_000_000).optional(), clear: z.boolean().optional() })
    .refine((x) => x.clear || x.monthlyUsd !== undefined || x.monthlyKrw !== undefined, '한도를 적어 주세요'));
  return setLimit(user, i.clear ? null : i.monthlyUsd ?? Math.round((i.monthlyKrw! / usdKrw()) * 100) / 100);
});
