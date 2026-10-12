import { db } from '../db';
import { googleConfigured } from './client';
import { syncLink } from './sync';

/** 회사 캘린더 변경 직후 연결된 Google 캘린더로 즉시 반영 (실패해도 스케줄러가 재시도) */
export async function syncCalendarSoon(calendarId: string | null, eventId?: string) {
  if (!googleConfigured()) return;
  const sql = db();
  let cal = calendarId;
  if (!cal && eventId) {
    const [e] = await sql`select coalesce(m.calendar_id, e.calendar_id) as cal from events e left join events m on m.id = e.recurring_event_id where e.id = ${eventId}`;
    cal = e?.cal ?? null;
  }
  if (!cal) return;
  const links = await sql<{ id: string }[]>`select id from google_calendar_links where local_calendar_id = ${cal} and status <> 'paused'`;
  for (const l of links) await syncLink(l.id, 'local_change');
}

export async function syncTaskBlocksSoon(taskId: string) {
  if (!googleConfigured()) return;
  const cals = await db()<{ calendar_id: string }[]>`select distinct calendar_id from events where task_id = ${taskId}`;
  for (const c of cals) await syncCalendarSoon(c.calendar_id);
}
