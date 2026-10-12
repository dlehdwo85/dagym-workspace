import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { db } from '@/lib/db';
import { accessibleUnitIds, atLeast, loadTaskForUser } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { templatePayload } from '@/lib/templates';

export const GET = handler(async ({ user }) => {
  const sql = db();
  const units = await accessibleUnitIds(user, sql);
  const templates = await sql`select t.id, t.name, t.description, t.payload, t.org_unit_id, o.name as org_unit_name, t.updated_at
    from templates t left join org_units o on o.id = t.org_unit_id
    where not t.archived and (t.org_unit_id is null or ${units === null ? sql`true` : sql`t.org_unit_id = any(${units}::uuid[])`})
    order by t.org_unit_id nulls first, t.name`;
  return { templates };
});

export const POST = handler(async ({ req, user }) => {
  if (!atLeast(user, 'site_manager')) throw forbidden('템플릿은 현장 관리자 이상이 만들 수 있습니다');
  const i = await body(req, z.object({
    name: z.string().trim().min(1).max(60), description: z.string().max(500).optional(),
    orgUnitId: zUuid.nullable().optional(), payload: templatePayload.optional(), fromTaskId: zUuid.optional(),
  }));
  const sql = db();
  let payload = i.payload;
  if (i.fromTaskId) {
    await loadTaskForUser(user, i.fromTaskId, sql);
    const [t] = await sql`select title, description, priority, approval_required, tags, recurrence_rule, due_date, start_date from tasks where id = ${i.fromTaskId}`;
    const cl = await sql<{ text: string }[]>`select text from task_checklist_items where task_id = ${i.fromTaskId} order by sort`;
    const subs = await sql<{ title: string }[]>`select title from tasks where parent_id = ${i.fromTaskId} and deleted_at is null order by sort_order`;
    payload = { title: t.title, description: t.description, priority: t.priority, approvalRequired: t.approval_required, tags: t.tags,
      checklist: cl.map((c) => c.text), subtasks: subs.map((s) => s.title), recurrence: t.recurrence_rule ?? undefined, dueInDays: 7 };
  }
  if (!payload) payload = { title: i.name, checklist: [] } as never;
  if (i.orgUnitId === null && !atLeast(user, 'admin')) throw forbidden('전사 템플릿은 관리자만 만들 수 있습니다');
  const [r] = await sql<{ id: string }[]>`insert into templates (name, description, payload, org_unit_id, created_by)
    values (${i.name}, ${i.description ?? ''}, ${sql.json(payload as never)}, ${i.orgUnitId ?? null}, ${user.id}) returning id`;
  return { id: r.id };
}, { idempotent: true });
