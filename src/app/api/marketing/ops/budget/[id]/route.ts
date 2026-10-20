import { handler, body } from '@/lib/api';
import { actBudget, budgetAction } from '@/lib/mktOps';

/** 예산 계획: 고치기 · 승인(→ 네이버 캠페인 하루 예산 집행, 다른 매체 안내) · 반려 */
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => actBudget(user, params.id, await body(req, budgetAction)));
