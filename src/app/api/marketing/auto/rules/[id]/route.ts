import { handler, body } from '@/lib/api';
import { deleteRule, rulePatch, updateRule } from '@/lib/mktAuto';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateRule(user, params.id, await body(req, rulePatch)));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteRule(user, params.id));
