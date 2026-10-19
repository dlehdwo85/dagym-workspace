import { handler, body } from '@/lib/api';
import { importApplyInput, importContacts } from '@/lib/contacts';

export const POST = handler(async ({ req, user }) => importContacts(user, await body(req, importApplyInput), false, null));
