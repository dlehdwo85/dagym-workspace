import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { framesInput, reorganize, undoOrganize } from '@/lib/library';

export const maxDuration = 60;
/** V13 3번: 자동 정리 되돌리기(undo) / 다시 정리(redo) · 210차: 영상이면 화면이 뽑은 장면 사진 2장(frames)을 함께 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const { action, frames } = await body(req, z.object({ action: z.enum(['undo', 'redo']), frames: framesInput }));
  return action === 'undo' ? undoOrganize(user, params.id) : reorganize(user, params.id, frames);
});
