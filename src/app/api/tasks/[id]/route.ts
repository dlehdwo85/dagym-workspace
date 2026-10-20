import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { deleteTask, getTaskDetail, markAcked, taskInput, updateTask } from '@/lib/tasks';
import { dispatchPending } from '@/lib/push';
import { syncTaskBlocksSoon } from '@/lib/google/hooks';
import { remindersChanged } from '@/lib/push';
import { affectedByTask } from '@/lib/reminders';
import { db } from '@/lib/db';
import { deleteEvent } from '@/lib/events';
import { syncedEventIds } from '@/lib/eventtasks';

export const GET = handler<{ id: string }>(async ({ user, params }) => {
  const d = await getTaskDetail(user, params.id);
  // V12 6번: 담당자가 업무를 열면 자동으로 "확인 완료" + 요청자 알림
  if ((d.task as any).assignee_id === user.id && !(d.task as any).assignee_ack_at && await markAcked(user, params.id)) {
    (d.task as any).assignee_ack_at = new Date().toISOString();
    after(() => dispatchPending().catch(() => {}));
  }
  return d;
});

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const before = await affectedByTask(params.id).catch(() => []);
  const out = await updateTask(user, params.id, await body(req, taskInput.partial()));
  after(() => dispatchPending().catch(() => {}));
  after(async () => { await remindersChanged([...before, ...(await affectedByTask(params.id))]).catch(() => {}); });
  after(() => syncTaskBlocksSoon(params.id).catch(() => {}));
  return out;
});

export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => {
  // V5 "연결된 일정도 삭제" (?alsoEvent=1)
  const evIds = req.nextUrl.searchParams.get('alsoEvent') === '1' ? await syncedEventIds(db(), params.id) : [];
  const was = await affectedByTask(params.id).catch(() => []);
  after(() => remindersChanged(was).catch(() => {}));
  const out: Record<string, unknown> = await deleteTask(user, params.id);
  let eventsDeleted = 0;
  for (const e of evIds) { try { await deleteEvent(user, e, { scope: 'all' }); eventsDeleted++; } catch { /* 권한 없는 일정은 남김 */ } }
  if (evIds.length) { out.eventsDeleted = eventsDeleted; out.eventsKept = evIds.length - eventsDeleted; }
  return out;
});
