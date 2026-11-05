import { after } from 'next/server';
import { handler } from '@/lib/api';
import { restoreTask } from '@/lib/tasks';
import { dispatchPending } from '@/lib/push';
import { syncCalendars } from '@/lib/taskEventDelete';

/** 되살리기(휴지통·토스트 되돌리기) — 361차 #977: 함께 지웠던 연결 일정도 되살리면 참석자 알림·외부 캘린더 반영 */
export const POST = handler<{ id: string }>(async ({ user, params }) => {
  const out = await restoreTask(user, params.id);
  if (out.calendars.length) { after(() => dispatchPending().catch(() => {})); after(() => syncCalendars(out.calendars)); }
  return out;
});
