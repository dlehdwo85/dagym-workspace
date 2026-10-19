import { handler, body, clientIp } from '@/lib/api';
import { deleteSite, saveSite, siteInput } from '@/lib/attendance';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveSite(user, params.id, await body(req, siteInput), clientIp(req)));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => deleteSite(user, params.id, clientIp(req)));
