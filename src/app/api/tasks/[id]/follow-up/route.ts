import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { followUpTask } from '@/lib/tasks';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ title: z.string().max(200).optional() }));
  return followUpTask(user, params.id, i.title);
}, { idempotent: true });
