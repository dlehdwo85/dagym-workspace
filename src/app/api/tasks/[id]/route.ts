import { after } from 'next/server';
import { handler, body } from '@/lib/api';
import { deleteTask, getTaskDetail, markAcked, taskInput, updateTask } from '@/lib/tasks';
import { dispatchPending } from '@/lib/push';
import { syncTaskBlocksSoon } from '@/lib/google/hooks';
import { remindersChanged } from '@/lib/push';
import { affectedByEvent, affectedByTask } from '@/lib/reminders';
import { deletePickedEvents, deletePlan, pickEvents, picksFrom, syncCalendars } from '@/lib/taskEventDelete';

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
  // 361차 #977: 연결 일정은 삭제 창에서 고른 것만(?events=키,…) — 예전 앱 ?alsoEvent=1 은 기본 체크 그대로. 계획은 업무를 지우기 전에(다른 업무 연결 판단)
  const picks = picksFrom(req.nextUrl.searchParams);
  const picked = picks === 'none' ? [] : pickEvents(await deletePlan(user, [params.id]), picks);
  const was = [...(await affectedByTask(params.id).catch(() => [])), ...(await Promise.all(picked.map((p) => affectedByEvent(p.id).catch(() => [])))).flat()];
  after(() => remindersChanged(was).catch(() => {}));
  const out: Record<string, unknown> = await deleteTask(user, params.id);
  if (picked.length) {
    const r = await deletePickedEvents(user, picked);
    out.eventsDeleted = r.deleted; out.eventsKept = picked.length - r.deleted;
    after(() => dispatchPending().catch(() => {})); // 참석자 '일정 취소' 알림
    after(() => syncCalendars(r.calendars));
  }
  return out;
});
