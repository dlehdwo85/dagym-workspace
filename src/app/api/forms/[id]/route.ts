import { handler, body } from '@/lib/api';
import { formInput, saveForm } from '@/lib/forms';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveForm(user, params.id, await body(req, formInput)));
