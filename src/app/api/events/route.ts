import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { createEvent, eventInput, listEvents } from '@/lib/events';
import { dispatchPending, remindersChanged } from '@/lib/push';
import { affectedByEvent } from '@/lib/reminders';
import { syncCalendarSoon } from '@/lib/google/hooks';

export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  const from = new Date(p.get('from') ?? ''), to = new Date(p.get('to') ?? '');
  if (isNaN(+from) || isNaN(+to) || to <= from) throw badRequest('from/to 범위가 필요합니다');
  if (to.getTime() - from.getTime() > 400 * 86400000) throw badRequest('조회 범위가 너무 깁니다');
  const cal = p.get('calendarIds')?.split(',').filter(Boolean);
  return { events: await listEvents(user, from, to, cal) };
});

export const POST = handler(async ({ req, user }) => {
  const i = await body(req, eventInput);
  const out = await createEvent(user, i);
  after(() => dispatchPending().catch(() => {}));
  after(() => syncCalendarSoon(i.calendarId).catch(() => {}));
  after(async () => { const id = (out as { id?: string }).id; if (id) await remindersChanged(await affectedByEvent(id)).catch(() => {}); });
  return out;
}, { idempotent: true });
