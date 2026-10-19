import { handler, body, clientIp } from '@/lib/api';
import { formInput, saveForm } from '@/lib/approvalForms';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => saveForm(user, params.id, await body(req, formInput), clientIp(req)));
