import { handler, body } from '@/lib/api';
import { accountPatch, removeAccount, updateAccount } from '@/lib/marketingAds';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateAccount(user, params.id, await body(req, accountPatch)));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => removeAccount(user, params.id));
