import { after } from 'next/server';
import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { addComment } from '@/lib/tasks';
import { dispatchPending } from '@/lib/push';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const { body: text, parentId } = await body(req, z.object({ body: z.string().min(1).max(10000), parentId: z.string().uuid().nullable().optional() }));
  const out = await addComment(user, params.id, text, parentId ?? null);
  after(() => dispatchPending().catch(() => {}));
  return out;
}, { idempotent: true });
