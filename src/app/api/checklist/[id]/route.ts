import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { loadTaskForUser } from '@/lib/access';
import { forbidden, notFound } from '@/lib/errors';
import { activity } from '@/lib/log';

async function load(user: any, id: string) {
  const [c] = await db()`select * from task_checklist_items where id = ${id}`;
  if (!c) throw notFound('항목이 없습니다');
  const { perms } = await loadTaskForUser(user, c.task_id);
  if (!perms.edit) throw forbidden();
  return c;
}

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const c = await load(user, params.id);
  const i = await body(req, z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(300).optional() }));
  const sql = db();
  await sql`update task_checklist_items set
    done = ${i.done ?? c.done}, text = ${i.text ?? c.text},
    done_by = ${i.done === undefined ? c.done_by : i.done ? user.id : null},
    done_at = ${i.done === undefined ? c.done_at : i.done ? new Date() : null}
    where id = ${params.id}`;
  await activity(sql, 'task', c.task_id, user.id, i.done !== undefined ? (i.done ? 'checklist_done' : 'checklist_undone') : 'checklist_edited', { text: i.text ?? c.text });
  return { ok: true };
});

export const DELETE = handler<{ id: string }>(async ({ user, params }) => {
  const c = await load(user, params.id);
  await db()`delete from task_checklist_items where id = ${params.id}`;
  await activity(db(), 'task', c.task_id, user.id, 'checklist_removed', { text: c.text });
  return { ok: true };
});
