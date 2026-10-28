import { after } from 'next/server';
import { handler } from '@/lib/api';
import { restoreEvent } from '@/lib/events';
import { dispatchPending, remindersChanged } from '@/lib/push';
import { affectedByEvent } from '@/lib/reminders';
import { syncCalendarSoon } from '@/lib/google/hooks';

/** 241차: 지운 일정 되살리기 — 지울 때처럼 알림 예약·외부 캘린더 동기화도 다시 */
export const POST = handler<{ id: string }>(async ({ user, params }) => {
  const out = await restoreEvent(user, params.id);
  after(async () => { await remindersChanged(await affectedByEvent(out.id)).catch(() => {}); });
  after(() => dispatchPending().catch(() => {}));
  after(() => syncCalendarSoon(out.calendarId).catch(() => {}));
  return out;
});
