import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { setLimit } from '@/lib/ai/assistant';
import { usdKrw } from '@/lib/ai/provider';
import { baseBudgetKrw, companyAiBudget } from '@/lib/ai/companyBudget';
import { HttpError } from '@/lib/errors';
import { tenantOf } from '@/lib/types';

/**
 * 대표가 정하는 회사 AI 월 한도 — 달러 또는 원(대표 10/24 ②: 요금제 예산보다 낮게 정하면 그 값에서 멈춤), clear = 지우고 요금제 예산 그대로.
 * 351차 #939 ③: 대표 화면은 원 없이 — pct(요금제 예산 대비 %)로 받아 서버가 원으로 바꿈(100 = 지움)
 */
export const PUT = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ monthlyUsd: z.number().min(0).max(100000).optional(), monthlyKrw: z.number().int().min(0).max(140_000_000).optional(), pct: z.number().int().min(1).max(100).optional(), clear: z.boolean().optional() })
    .refine((x) => x.clear || x.monthlyUsd !== undefined || x.monthlyKrw !== undefined || x.pct !== undefined, '한도를 적어 주세요'));
  if (i.clear) return setLimit(user, null);
  if (i.pct !== undefined && i.monthlyUsd === undefined && i.monthlyKrw === undefined) {
    if (i.pct >= 100) return setLimit(user, null);
    const base = baseBudgetKrw(await companyAiBudget(tenantOf(user)));
    if (!base) throw new HttpError(400, 'no_budget', '회사 AI 예산이 정해져 있지 않아 비율로 정할 수 없습니다');
    return setLimit(user, Math.round((Math.round((base * i.pct) / 100) / usdKrw()) * 100) / 100);
  }
  return setLimit(user, i.monthlyUsd ?? Math.round((i.monthlyKrw! / usdKrw()) * 100) / 100);
});
