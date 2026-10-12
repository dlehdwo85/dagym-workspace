import { handler, body } from '@/lib/api';
import { createField, fieldInput, listFields } from '@/lib/fields';

export const GET = handler<{ id: string }>(async ({ user, params }) => ({ fields: await listFields(user, params.id) }));
export const POST = handler<{ id: string }>(async ({ req, user, params }) => createField(user, params.id, await body(req, fieldInput)), { idempotent: true });
