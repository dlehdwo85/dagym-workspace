import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { deleteEvent, eventInput, loadEvent, scopeSchema, updateEvent } from '@/lib/events';
import { dispatchPending } from '@/lib/push';
import { syncCalendarSoon } from '@/lib/google/hooks';

export const GET = handler<{ id: string }>(async ({ user, params }) => {
  const { event, perms } = await loadEvent(user, params.id);
  const sql = db();
  const masterId = event.recurring_event_id ?? event.id;
  const attendees = await sql`select a.user_id, u.name, a.response from event_attendees a join users u on u.id = a.user_id where a.event_id = ${masterId}`;
  const attachments = await sql`select a.*, u.name as created_by_name from attachments a join users u on u.id = a.created_by
    where a.event_id = ${params.id} and a.deleted_at is null and a.upload_status = 'ready'`;
  const master = event.recurring_event_id ? (await sql`select rrule from events where id = ${masterId}`)[0] : event;
  const task = event.task_id ? (await sql`select id, title, status from tasks where id = ${event.task_id}`)[0] : null;
  return { event: { ...event, rrule: master.rrule }, perms: { edit: perms.edit, attendee: perms.attendee }, calendar: perms.calendar, attendees, attachments, task };
});

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const raw = await req.json();
  const scope = scopeSchema.parse(raw);
  const i = eventInput.partial().parse(raw);
  const out = await updateEvent(user, params.id, i, scope);
  after(() => dispatchPending().catch(() => {}));
  after(() => syncCalendarSoon(null, params.id).catch(() => {}));
  return out;
});

export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => {
  const p = req.nextUrl.searchParams;
  const scope = scopeSchema.parse({ scope: p.get('scope') ?? 'all', occurrenceStart: p.get('occurrenceStart') ?? undefined });
  const { event } = await loadEvent(user, params.id);
  const out = await deleteEvent(user, params.id, scope);
  after(() => dispatchPending().catch(() => {}));
  after(() => syncCalendarSoon(event.calendar_id).catch(() => {}));
  return out;
});
