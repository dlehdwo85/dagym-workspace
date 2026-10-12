import { handler, body } from '@/lib/api';
import { addSeriesRule, listSeriesRules, seriesInput } from '@/lib/eventtasks';

export const GET = handler<{ id: string }>(async ({ user, params }) => ({ rules: await listSeriesRules(user, params.id) }));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => addSeriesRule(user, params.id, await body(req, seriesInput)), { idempotent: true });
