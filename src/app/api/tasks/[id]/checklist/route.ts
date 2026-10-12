import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { loadTaskForUser } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { activity } from '@/lib/log';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const { perms } = await loadTaskForUser(user, params.id);
  if (!perms.edit) throw forbidden();
  const { text } = await body(req, z.object({ text: z.string().trim().min(1).max(300) }));
  const sql = db();
  const [r] = await sql<{ id: string }[]>`insert into task_checklist_items (task_id, text, sort)
    values (${params.id}, ${text}, (select coalesce(max(sort),0)+1 from task_checklist_items where task_id = ${params.id})) returning id`;
  await activity(sql, 'task', params.id, user.id, 'checklist_added', { text });
  return { id: r.id };
}, { idempotent: true });
