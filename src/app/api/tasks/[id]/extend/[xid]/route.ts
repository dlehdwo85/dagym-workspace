import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { decideExtension } from '@/lib/tasks';

/** V32 4 지시자가 마감 연장 요청 승인·반려 */
export const POST = handler<{ id: string; xid: string }>(async ({ req, user, params }) =>
  decideExtension(user, params.id, params.xid, (await body(req, z.object({ approve: z.boolean() }))).approve));
