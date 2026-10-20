import { tenantOf } from '@/lib/types';
import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { db } from '@/lib/db';
import { accessibleUnitIds, atLeast, loadTaskForUser } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { templatePayload } from '@/lib/templates';

export const GET = handler(async ({ user }) => {
  const sql = db();
  const units = await accessibleUnitIds(user, sql);
  const templates = await sql`select t.id, t.name, t.description, t.payload, t.org_unit_id, o.name as org_unit_name, t.updated_at, t.personal
    from templates t left join org_units o on o.id = t.org_unit_id
    where not t.archived and t.tenant = ${tenantOf(user)} and (not t.personal or t.created_by = ${user.id}) and (t.org_unit_id is null or ${units === null ? sql`true` : sql`t.org_unit_id = any(${units}::uuid[])`})
    order by t.org_unit_id nulls first, t.name`;
  return { templates };
});

export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({
    personal: z.boolean().optional(), // V8 3번: 개인 템플릿은 누구나(나만 봄)
    name: z.string().trim().min(1).max(60), description: z.string().max(500).optional(),
    orgUnitId: zUuid.nullable().optional(), payload: templatePayload.optional(), fromTaskId: zUuid.optional(),
  }));
  if (!i.personal && !atLeast(user, 'site_manager')) throw forbidden('공용 템플릿은 현장 관리자 이상이 만들 수 있습니다 — 개인 템플릿으로 저장하세요');
  const sql = db();
  let payload = i.payload;
  if (i.fromTaskId) {
    await loadTaskForUser(user, i.fromTaskId, sql);
    const [t] = await sql`select title, description, priority, approval_required, tags, recurrence_rule, due_date, start_date, assignee_id, requested_by, created_at from tasks where id = ${i.fromTaskId}`;
    const cl = await sql<{ text: string }[]>`select text from task_checklist_items where task_id = ${i.fromTaskId} order by sort`;
    const subs = await sql<{ title: string }[]>`select title from tasks where parent_id = ${i.fromTaskId} and deleted_at is null order by sort_order`;
    payload = { title: t.title, description: t.description, priority: t.priority, approvalRequired: t.approval_required, tags: t.tags,
      checklist: cl.map((c) => c.text), subtasks: subs.map((s) => s.title), recurrence: t.recurrence_rule ?? undefined,
      // 마감 오프셋 = 원래 업무의 (마감 - 만든 날), 기본 담당·요청자 그대로
      dueInDays: t.due_date ? Math.max(0, Math.round((Date.parse(t.due_date) - Date.parse(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(t.created_at)))) / 86400000)) : 7,
      assigneeId: t.assignee_id ?? null, requestedById: t.requested_by ?? null };
  }
  if (!payload) payload = { title: i.name, checklist: [] } as never;
  if (!i.personal && i.orgUnitId === null && !atLeast(user, 'admin')) throw forbidden('전사 템플릿은 관리자만 만들 수 있습니다');
  const orgUnitId = i.personal ? null : i.orgUnitId ?? null;
  if (orgUnitId) { const units = await accessibleUnitIds(user, sql); if (units !== null && !units.includes(orgUnitId)) throw forbidden(); }
  if (orgUnitId && !(await sql`select 1 from org_units where id = ${orgUnitId} and tenant = ${tenantOf(user)}`).length) throw forbidden();
  const [r] = await sql<{ id: string }[]>`insert into templates (name, description, payload, org_unit_id, created_by, personal, tenant)
    values (${i.name}, ${i.description ?? ''}, ${sql.json(payload as never)}, ${orgUnitId}, ${user.id}, ${!!i.personal}, ${tenantOf(user)}) returning id`;
  return { id: r.id };
}, { idempotent: true });
