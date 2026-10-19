import { handler, body, clientIp } from '@/lib/api';
import { importApplyInput, importContacts } from '@/lib/contacts';

export const POST = handler(async ({ req, user }) => importContacts(user, await body(req, importApplyInput), true, clientIp(req)), { idempotent: true });
