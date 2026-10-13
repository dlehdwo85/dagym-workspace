import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { answerTicket } from '@/lib/support';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ answer: z.string().max(5000), close: z.boolean().default(false) }));
  return answerTicket(user, params.id, i.answer, i.close);
});
