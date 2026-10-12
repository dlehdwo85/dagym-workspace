import { handler, body } from '@/lib/api';
import { deleteRule, ruleInput, saveRule } from '@/lib/automation';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveRule(user, params.id, await body(req, ruleInput)));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteRule(user, params.id));
