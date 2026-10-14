import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { reorganize, undoOrganize } from '@/lib/library';

export const maxDuration = 60;
/** V13 3번: 자동 정리 되돌리기(undo) / 다시 정리(redo) */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const { action } = await body(req, z.object({ action: z.enum(['undo', 'redo']) }));
  return action === 'undo' ? undoOrganize(user, params.id) : reorganize(user, params.id);
});
