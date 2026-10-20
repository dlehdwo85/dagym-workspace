import { handler, body } from '@/lib/api';
import { isAdmin } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { tenantOf } from '@/lib/types';
import { budgetDraftInput, draftBudget, monthKstOf } from '@/lib/mktOpsHelpers';

/** ② 채널별 월 광고 예산 계획 초안(AI, 관리자) */
export const POST = handler(async ({ req, user }) => { if (!isAdmin(user)) throw forbidden('대표·관리자만'); const i = await body(req, budgetDraftInput); return draftBudget(tenantOf(user), i.month ?? monthKstOf(), user.id, i.total); });
