import { handler, clientIp } from '@/lib/api';
import { restoreContact } from '@/lib/contacts';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => restoreContact(user, params.id, clientIp(req)));
