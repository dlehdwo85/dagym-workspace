import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { deleteBatch, taskInput, updateBatch } from '@/lib/tasks';
import { dispatchPending } from '@/lib/push';
import { db } from '@/lib/db';
import { deletePickedEvents, deletePlan, pickEvents, picksFrom, syncCalendars } from '@/lib/taskEventDelete';

/** V6 13번: 같은 묶음(담당자별 1건씩) 전체에 적용 — 요청자만 */
export const PATCH = handler<{ batchId: string }>(async ({ req, user, params }) => {
  const i = await body(req, taskInput.pick({ title: true, dueDate: true, dueTime: true, priority: true, description: true }).partial());
  const out = await updateBatch(user, params.batchId, i);
  after(() => dispatchPending().catch(() => {}));
  return out;
});
/** 361차 #977: 묶음 삭제도 업무 하나 지울 때와 같은 일정 규칙(?events=키,… · default · none) */
export const DELETE = handler<{ batchId: string }>(async ({ req, user, params }) => {
  const picks = picksFrom(req.nextUrl.searchParams);
  const roots = (await db()<{ id: string }[]>`select id from tasks where batch_id = ${params.batchId} and deleted_at is null`).map((r) => r.id);
  const picked = picks === 'none' || !roots.length ? [] : pickEvents(await deletePlan(user, roots), picks);
  const out: Record<string, unknown> = await deleteBatch(user, params.batchId);
  if (picked.length) {
    const r = await deletePickedEvents(user, picked);
    out.eventsDeleted = r.deleted; out.eventsKept = picked.length - r.deleted;
    after(() => dispatchPending().catch(() => {}));
    after(() => syncCalendars(r.calendars));
  }
  return out;
});
