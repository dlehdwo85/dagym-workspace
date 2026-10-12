import { handler, body } from '@/lib/api';
import { createTask, listQuery, listTasks, taskInput } from '@/lib/tasks';
import { after } from 'next/server';
import { dispatchPending } from '@/lib/push';

export const GET = handler(async ({ req, user }) => {
  const q = listQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return { tasks: await listTasks(user, q) };
});

export const POST = handler(async ({ req, user }) => {
  const out = await createTask(user, await body(req, taskInput));
  after(() => dispatchPending().catch(() => {}));
  return out;
}, { idempotent: true });
