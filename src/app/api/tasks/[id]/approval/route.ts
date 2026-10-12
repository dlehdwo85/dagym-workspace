import { after } from 'next/server';
import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { decide } from '@/lib/approvals';
import { dispatchPending } from '@/lib/push';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ decision: z.enum(['approve', 'reject']), comment: z.string().max(2000).optional() }));
  const out = await decide(user, params.id, i.decision, i.comment, clientIp(req));
  after(() => dispatchPending().catch(() => {}));
  return out;
});
