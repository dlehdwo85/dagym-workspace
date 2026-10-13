import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { zUuid } from '@/lib/api';
import { reorderTasks } from '@/lib/tasks';

/** 직접 순서 저장: 보이는 순서대로 id 목록 */
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ ids: z.array(zUuid).min(1).max(500) }));
  return reorderTasks(user, i.ids);
});
