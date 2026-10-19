import { handler, body, clientIp } from '@/lib/api';
import { listSites, saveSite, siteInput } from '@/lib/attendance';

export const GET = handler(async ({ user }) => listSites(user));
export const POST = handler(async ({ req, user }) => saveSite(user, null, await body(req, siteInput), clientIp(req)));
