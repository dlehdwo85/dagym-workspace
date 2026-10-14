import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { loadTaskForUser } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { activity } from '@/lib/log';

export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const { perms } = await loadTaskForUser(user, params.id);
  if (!perms.edit) throw forbidden();
  const { text, assigneeId } = await body(req, z.object({ text: z.string().trim().min(1).max(300), assigneeId: z.string().uuid().nullable().optional() }));
  if (assigneeId) { const [x] = await db()`select 1 from users where id = ${assigneeId} and status = 'active' and tenant = ${user.tenant ?? (user.isDemo ? 'demo' : 'default')}`; if (!x) throw forbidden('배정할 수 없는 사람입니다'); }
  const sql = db();
  const [r] = await sql<{ id: string }[]>`insert into task_checklist_items (task_id, text, sort, assignee_id)
    values (${params.id}, ${text}, (select coalesce(max(sort),0)+1 from task_checklist_items where task_id = ${params.id}), ${assigneeId ?? null}) returning id`;
  await activity(sql, 'task', params.id, user.id, 'checklist_added', { text });
  return { id: r.id };
}, { idempotent: true });
