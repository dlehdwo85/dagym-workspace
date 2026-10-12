import { handler, body, clientIp } from '@/lib/api';
import { lineInput, saveLine } from '@/lib/approvals';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveLine(user, params.id, await body(req, lineInput), clientIp(req)));
