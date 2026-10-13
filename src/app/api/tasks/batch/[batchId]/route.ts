import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { deleteBatch, taskInput, updateBatch } from '@/lib/tasks';
import { dispatchPending } from '@/lib/push';

/** V6 13번: 같은 묶음(담당자별 1건씩) 전체에 적용 — 지시자만 */
export const PATCH = handler<{ batchId: string }>(async ({ req, user, params }) => {
  const i = await body(req, taskInput.pick({ title: true, dueDate: true, dueTime: true, priority: true, description: true }).partial());
  const out = await updateBatch(user, params.batchId, i);
  after(() => dispatchPending().catch(() => {}));
  return out;
});
export const DELETE = handler<{ batchId: string }>(async ({ user, params }) => deleteBatch(user, params.batchId));
