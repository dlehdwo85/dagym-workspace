import { handler, body } from '@/lib/api';
import { deleteField, fieldInput, updateField } from '@/lib/fields';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateField(user, params.id, await body(req, fieldInput.partial())));
export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteField(user, params.id));
