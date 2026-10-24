import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { roomEventInput, scheduleInRoom } from '@/lib/chat';
import { dispatchPending, remindersChanged } from '@/lib/push';
import { affectedByEvent } from '@/lib/reminders';
import { syncCalendarSoon } from '@/lib/google/hooks';

/** 메신저 2차 B9 일정 잡기: 캘린더 일정(참석자 = 방 참여자) + 방에 일정 카드 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  const out = await scheduleInRoom(user, params.id, await body(req, roomEventInput));
  after(() => dispatchPending().catch(() => {}));
  after(() => syncCalendarSoon(out.calendarId).catch(() => {}));
  after(async () => { await remindersChanged(await affectedByEvent(out.eventId)).catch(() => {}); });
  return out;
}, { idempotent: true });
