import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { loadTaskForUser } from '@/lib/access';
import { forbidden, notFound } from '@/lib/errors';
import { activity } from '@/lib/log';
import { tenantOf } from '@/lib/types';

/** R-15 6번 항목 담당자: 같은 회사 활성 사용자만 */
async function assertSameTenant(user: any, id: string) {
  const [x] = await db()`select 1 from users where id = ${id} and status = 'active' and tenant = ${tenantOf(user)}`;
  if (!x) throw forbidden('배정할 수 없는 사람입니다');
}

/** V14 50: 항목 편집·삭제는 지시자·담당자만, 완료 체크는 그 항목 담당자도 */
async function load(user: any, id: string, onlyDone = false) {
  const [c] = await db()`select * from task_checklist_items where id = ${id}`;
  if (!c) throw notFound('항목이 없습니다');
  const { perms } = await loadTaskForUser(user, c.task_id);
  if (!perms.edit && !(onlyDone && c.assignee_id === user.id)) throw forbidden('업무 내용은 지시자·담당자만 바꿀 수 있습니다');
  return c;
}

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({ done: z.boolean().optional(), text: z.string().trim().min(1).max(300).optional(), assigneeId: z.string().uuid().nullable().optional() }));
  const c = await load(user, params.id, i.text === undefined && i.assigneeId === undefined);
  if (i.assigneeId) await assertSameTenant(user, i.assigneeId);
  const sql = db();
  await sql`update task_checklist_items set
    done = ${i.done ?? c.done}, text = ${i.text ?? c.text}, assignee_id = ${i.assigneeId !== undefined ? i.assigneeId : c.assignee_id},
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
