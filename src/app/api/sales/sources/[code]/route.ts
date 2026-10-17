import { handler, body } from '@/lib/api';
import { setSource, sourceInput } from '@/lib/sales/sources';

export const PUT = handler<{ code: string }>(async ({ req, user, params }) => setSource(user, params.code, await body(req, sourceInput)));
