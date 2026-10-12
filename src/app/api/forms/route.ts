import { handler, body } from '@/lib/api';
import { formInput, listForms, saveForm } from '@/lib/forms';

export const GET = handler(async ({ user }) => ({ forms: await listForms(user) }));
export const POST = handler(async ({ req, user }) => saveForm(user, null, await body(req, formInput)), { idempotent: true });
