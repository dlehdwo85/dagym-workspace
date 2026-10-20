import { handler, body } from '@/lib/api';
import { assertSpace } from '@/lib/spaces';
import { tenantOf } from '@/lib/types';
import { revenueGoalInput, revenueOf, setRevenueGoal } from '@/lib/mktOps';
import { monthKst } from '@/lib/mktGoals';

/** ③ 월 매출 목표 vs 실적(영업 계약 + 워크인 결제) */
export const GET = handler(async ({ req, user }) => { await assertSpace(user, 'marketing').catch(() => assertSpace(user, 'sales')); return revenueOf(tenantOf(user), req.nextUrl.searchParams.get('month') ?? monthKst(), !!user.platformAdmin); });
export const PUT = handler(async ({ req, user }) => { await assertSpace(user, 'marketing').catch(() => assertSpace(user, 'sales')); return setRevenueGoal(user, await body(req, revenueGoalInput)); });
