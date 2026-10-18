import { handler, body } from '@/lib/api';
import { actRequest, requestAction } from '@/lib/mktAuto';

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => actRequest(user, params.id, await body(req, requestAction)));
