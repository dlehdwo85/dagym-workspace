import { handler } from '@/lib/api';
import { removeSeriesRule } from '@/lib/eventtasks';

export const DELETE = handler<{ id: string; ruleId: string }>(async ({ user, params }) => removeSeriesRule(user, params.id, params.ruleId));
