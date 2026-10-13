import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { deleteEvent, eventInput, loadEvent, scopeSchema, updateEvent } from '@/lib/events';
import { createSyncTask, syncedTaskIds } from '@/lib/eventtasks';
import { deleteTask } from '@/lib/tasks';
import { dispatchPending, remindersChanged } from '@/lib/push';
import { affectedByEvent } from '@/lib/reminders';
import { syncCalendarSoon } from '@/lib/google/hooks';

export const GET = handler<{ id: string }>(async ({ user, params }) => {
  const { event, perms } = await loadEvent(user, params.id, db(), { allowMasked: true });
  const sql = db();
  const masterId = event.recurring_event_id ?? event.id;
  const attendees = await sql`select a.user_id, u.name, a.response from event_attendees a join users u on u.id = a.user_id where a.event_id = ${masterId}`;
  const attachments = await sql`select a.*, u.name as created_by_name from attachments a join users u on u.id = a.created_by
    where a.event_id = ${params.id} and a.deleted_at is null and a.upload_status = 'ready'`;
  const master = event.recurring_event_id ? (await sql`select rrule, reminder_minutes from events where id = ${masterId}`)[0] : event;
  if (perms.masked) {
    // 비공개 일정: 시간만 ("바쁨")
    return { event: { ...event, title: '바쁨', description: '', location: '', task_id: null, rrule: master.rrule, reminder_minutes: null, masked: true }, perms: { edit: false, attendee: false }, calendar: { ...perms.calendar, name: '' }, attendees: [], attachments: [], task: null };
  }
  const task = event.task_id ? (await sql`select id, title, status from tasks where id = ${event.task_id}`)[0] : null;
  // V5 "업무에도 추가"로 연결된 업무
  const [syncTask] = await sql`select t.id, t.title, t.status from event_tasks et join tasks t on t.id = et.task_id where et.event_id = ${masterId} and et.sync and t.deleted_at is null`;
  return { event: { ...event, rrule: master.rrule, reminder_minutes: (master as any).reminder_minutes ?? null }, perms: { edit: perms.edit, attendee: perms.attendee }, calendar: perms.calendar, attendees, attachments, task, syncTask: syncTask ?? null };
});

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const raw = await req.json();
  const scope = scopeSchema.parse(raw);
  const i = eventInput.partial().parse(raw);
  const before = await affectedByEvent(params.id).catch(() => []);
  const out: Record<string, unknown> = await updateEvent(user, params.id, i, scope);
  after(async () => { await remindersChanged([...before, ...(await affectedByEvent(String(out.id ?? params.id)))]).catch(() => {}); });
  if (i.alsoTask) out.taskId = (await createSyncTask(user, out.id as string, i.taskAssigneeId, { requestedById: i.taskRequestedById, priority: i.taskPriority })).id; // 기존 일정에 "업무에도 추가"
  after(() => dispatchPending().catch(() => {}));
  after(() => syncCalendarSoon(null, params.id).catch(() => {}));
  return out;
});

export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => {
  const p = req.nextUrl.searchParams;
  const scope = scopeSchema.parse({ scope: p.get('scope') ?? 'all', occurrenceStart: p.get('occurrenceStart') ?? undefined });
  const { event } = await loadEvent(user, params.id);
  // V5 "연결된 업무도 삭제" (반복 일정은 전체 삭제일 때만)
  const alsoTask = p.get('alsoTask') === '1' && (scope.scope === 'all' || (!event.rrule && !event.recurring_event_id));
  const taskIds = alsoTask ? await syncedTaskIds(db(), event.recurring_event_id ?? event.id) : [];
  const was = await affectedByEvent(params.id).catch(() => []);
  const out: Record<string, unknown> = await deleteEvent(user, params.id, scope);
  after(() => remindersChanged(was).catch(() => {}));
  let tasksDeleted = 0;
  for (const t of taskIds) { try { await deleteTask(user, t); tasksDeleted++; } catch { /* 삭제 권한 없는 업무는 남김 */ } }
  if (alsoTask) { out.tasksDeleted = tasksDeleted; out.tasksKept = taskIds.length - tasksDeleted; }
  after(() => dispatchPending().catch(() => {}));
  after(() => syncCalendarSoon(event.calendar_id).catch(() => {}));
  return out;
});
