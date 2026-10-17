import { handler, body } from '@/lib/api';
import { convertCall, convertInput } from '@/lib/marketing';

/** [영업 리드로] */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => convertCall(user, params.id, await body(req, convertInput)));
