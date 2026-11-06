import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { decideExtension } from '@/lib/tasks';

/** V32 4 요청자가 마감 연장 요청 승인·반려 · 379차 #1012 요청을 낸 사람이 [바로 적용]·[요청 취소] */
const input = z.union([z.object({ approve: z.boolean() }), z.object({ action: z.enum(['apply', 'cancel']) })]);
export const POST = handler<{ id: string; xid: string }>(async ({ req, user, params }) => {
  const i = await body(req, input);
  return decideExtension(user, params.id, params.xid, 'action' in i ? i.action : i.approve);
});
