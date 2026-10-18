import { handler, body } from '@/lib/api';
import { createRule, ruleInput } from '@/lib/mktAuto';

export const POST = handler(async ({ req, user }) => createRule(user, await body(req, ruleInput)));
