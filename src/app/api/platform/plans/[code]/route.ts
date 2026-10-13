import { handler, body } from '@/lib/api';
import { planInput, upsertPlan } from '@/lib/plans';

export const PUT = handler<{ code: string }>(async ({ req, user, params }) => upsertPlan(user, params.code, await body(req, planInput)));
