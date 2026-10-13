import { handler, body } from '@/lib/api';
import { planRequestInput, requestPlanChange } from '@/lib/plans';

export const POST = handler(async ({ req, user }) => requestPlanChange(user, await body(req, planRequestInput)), { idempotent: true });
