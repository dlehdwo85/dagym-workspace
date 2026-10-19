import { handler, body } from '@/lib/api';
import { listShares, setShares, sharesInput } from '@/lib/libDocs';

export const GET = handler<{ id: string }>(async ({ user, params }) => listShares(user, params.id));
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => setShares(user, params.id, await body(req, sharesInput)));
