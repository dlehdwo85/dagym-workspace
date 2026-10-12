import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { duplicateTask } from '@/lib/tasks';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ withSubtasks: z.boolean().optional() }));
  return duplicateTask(user, params.id, i.withSubtasks ?? true);
}, { idempotent: true });
