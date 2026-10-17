import { handler, body } from '@/lib/api';
import { callUpdateInput, updateCall } from '@/lib/marketing';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => updateCall(user, params.id, await body(req, callUpdateInput)));
