import { handler, body, clientIp } from '@/lib/api';
import { deleteLine, lineInput, saveLine } from '@/lib/approvals';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveLine(user, params.id, await body(req, lineInput), clientIp(req)));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => deleteLine(user, params.id, clientIp(req)));
