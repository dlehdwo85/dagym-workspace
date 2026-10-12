import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { deleteTask, getTaskDetail, taskInput, updateTask } from '@/lib/tasks';
import { dispatchPending } from '@/lib/push';
import { syncTaskBlocksSoon } from '@/lib/google/hooks';

export const GET = handler<{ id: string }>(async ({ user, params }) => getTaskDetail(user, params.id));

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const out = await updateTask(user, params.id, await body(req, taskInput.partial()));
  after(() => dispatchPending().catch(() => {}));
  after(() => syncTaskBlocksSoon(params.id).catch(() => {}));
  return out;
});

export const DELETE = handler<{ id: string }>(async ({ user, params }) => deleteTask(user, params.id));
