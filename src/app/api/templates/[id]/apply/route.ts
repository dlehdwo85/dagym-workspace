import { z } from 'zod';
import { handler, body, zDate, zUuid } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { createTask } from '@/lib/tasks';
import { addDays, todaySeoul } from '@/lib/time';
import type { TemplatePayload } from '@/lib/templates';
import { tenantOf } from '@/lib/types';

/** 템플릿을 복사해 새 업무(체크리스트·하위 업무 포함)를 만든다 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const i = await body(req, z.object({
    title: z.string().trim().min(1).max(200).optional(), orgUnitId: zUuid.optional(), projectId: zUuid.nullable().optional(),
    assigneeId: zUuid.nullable().optional(), requestedById: zUuid.nullable().optional(), dueDate: zDate.optional(), brandId: z.enum(['dagym', 'hilink', 'bodylab']).nullable().optional(),
  }));
  const [t] = await db()`select * from templates where id = ${params.id} and tenant = ${tenantOf(user)} and not archived and (not personal or created_by = ${user.id})`;
  if (!t) throw notFound('템플릿이 없습니다');
  const p = t.payload as TemplatePayload;
  const due = i.dueDate ?? (p.dueInDays !== undefined ? addDays(todaySeoul(), p.dueInDays) : null);
  const created = await createTask(user, {
    title: i.title ?? p.title, description: p.description, priority: p.priority, approvalRequired: p.approvalRequired ?? true,
    tags: p.tags, checklist: p.checklist, orgUnitId: i.orgUnitId, projectId: i.projectId ?? null, assigneeId: i.assigneeId !== undefined ? i.assigneeId : p.assigneeId ?? null,
    requestedById: i.requestedById ?? p.requestedById ?? undefined,
    dueDate: due, recurrenceRule: p.recurrence ?? null, brandId: i.brandId,
  });
  for (const s of p.subtasks ?? []) {
    await createTask(user, { title: s, parentId: created.id, assigneeId: i.assigneeId ?? null, dueDate: due, approvalRequired: false });
  }
  return created;
}, { idempotent: true });
