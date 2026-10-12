import { handler, body } from '@/lib/api';
import { listRules, ruleInput, saveRule } from '@/lib/automation';

export const GET = handler(async ({ user }) => listRules(user));
export const POST = handler(async ({ req, user }) => saveRule(user, null, await body(req, ruleInput)), { idempotent: true });
