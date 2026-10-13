import { handler, body } from '@/lib/api';
import { createTasksForAssignees, listQuery, listTasks, taskInput } from '@/lib/tasks';
import { after } from 'next/server';
import { dispatchPending, remindersChanged } from '@/lib/push';

export const GET = handler(async ({ req, user }) => {
  const q = listQuery.parse(Object.fromEntries(req.nextUrl.searchParams));
  return { tasks: await listTasks(user, q) };
});

export const POST = handler(async ({ req, user }) => {
  const out = await createTasksForAssignees(user, await body(req, taskInput)); // 담당자 여러 명이면 각자 1건씩
  after(() => dispatchPending().catch(() => {}));
  after(async () => { const ids = 'ids' in out ? out.ids : [out.id]; const sql = (await import('@/lib/db')).db(); await remindersChanged((await sql`select assignee_id from tasks where id = any(${ids}::uuid[])`).map((r: any) => r.assignee_id)).catch(() => {}); });
  return out;
}, { idempotent: true });
