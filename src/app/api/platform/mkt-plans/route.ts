import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { creditCostInput, mktPlansView, planLimitInput, saveCreditCost, savePlanLimit } from '@/lib/mktPlans';

/** 대표 10/20 15:40 (#103): 플랫폼 운영 › 마케팅 요금제 표 — GET 표·원가율, PUT {plan} 또는 {cost} */
export const GET = handler(async ({ user }) => mktPlansView(user));
const input = z.object({ plan: planLimitInput.optional(), cost: creditCostInput.optional() });
export const PUT = handler(async ({ req, user }) => { const i = await body(req, input); if (i.cost) await saveCreditCost(user, i.cost); if (i.plan) return savePlanLimit(user, i.plan); return mktPlansView(user); });
