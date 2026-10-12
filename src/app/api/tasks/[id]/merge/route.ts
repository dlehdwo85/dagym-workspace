import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { mergeTask } from '@/lib/tasks';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ intoId: zUuid }));
  return mergeTask(user, params.id, i.intoId);
});
