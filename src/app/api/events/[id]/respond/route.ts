import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { respondEvent } from '@/lib/events';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const { response } = await body(req, z.object({ response: z.enum(['accepted', 'declined', 'tentative']) }));
  return respondEvent(user, params.id, response);
});
