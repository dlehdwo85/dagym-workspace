import { handler, body, clientIp } from '@/lib/api';
import { contactInput, deleteContact, getContact, updateContact } from '@/lib/contacts';

export const GET = handler<{ id: string }>(async ({ user, params }) => getContact(user, params.id));
export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateContact(user, params.id, await body(req, contactInput), clientIp(req)));
export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => deleteContact(user, params.id, clientIp(req)));
