import { handler, body, clientIp } from '@/lib/api';
import { lineInput, listLines, saveLine } from '@/lib/approvals';

export const GET = handler(async ({ user }) => ({ lines: await listLines(user) }));
export const POST = handler(async ({ req, user }) => saveLine(user, null, await body(req, lineInput), clientIp(req)), { idempotent: true });
