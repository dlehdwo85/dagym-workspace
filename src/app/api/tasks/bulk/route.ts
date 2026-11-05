import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { loadTaskForUser } from '@/lib/access';
import { deleteTask, restoreTask, updateTask } from '@/lib/tasks';
import { after } from 'next/server';
import { dispatchPending } from '@/lib/push';
import { deletePickedEvents, deletePlan, pickEvents, syncCalendars } from '@/lib/taskEventDelete';
import { zDate } from '@/lib/api';

/**
 * V14 12번 다중 선택 작업: 업무마다 기존 권한 검사를 그대로(삭제·수정·상태). 권한이 없거나 실패한 것은 건너뛰고 이유를 돌려준다.
 * 되돌리기: 화면이 이전 값으로 patch(또는 restore) 를 다시 보낸다.
 */
const input = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(['delete', 'restore', 'patch', 'done', 'plan']),
  patch: z.object({ assigneeId: z.string().uuid().nullable().optional(), dueDate: zDate.nullable().optional(), projectId: z.string().uuid().nullable().optional(),
    status: z.enum(['todo', 'in_progress', 'review', 'on_hold', 'done']).optional() }).optional(),
  /** 되돌리기: 업무별 이전 값 */
  each: z.record(z.string().uuid(), z.record(z.string(), z.unknown())).optional(),
  /** 361차 #977 지울 때 연결 일정: default = 업무마다 삭제 창의 기본 체크 그대로(이 업무가 주인인 일정만), 없으면 일정은 남김 */
  events: z.enum(['default', 'none']).optional(),
});
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, input);
  // 361차 #977: 여러 건 지우기 전 확인 — 업무마다 기본 체크(이 업무가 주인인 일정)로 함께 지워질 일정 목록(읽기만)
  if (i.action === 'plan') {
    const seen = new Map<string, { title: string; start: string; end: string; allDay: boolean; attendees: number }>();
    for (const id of new Set(i.ids)) {
      try { await loadTaskForUser(user, id); for (const e of pickEvents(await deletePlan(user, [id]), 'default')) seen.set(e.key, { title: e.title, start: e.start, end: e.end, allDay: e.allDay, attendees: e.attendees }); } catch { /* 볼 수 없는 업무는 건너뜀 */ }
    }
    return { events: [...seen.values()] };
  }
  const done: string[] = []; const skipped: { id: string; title: string; reason: string }[] = [];
  let eventsDeleted = 0, eventsRestored = 0; const cals = new Set<string>();
  const titles = new Map((await db()<{ id: string; title: string }[]>`select id, title from tasks where id = any(${i.ids}::uuid[])`).map((r) => [r.id, r.title]));
  for (const id of new Set(i.ids)) {
    try {
      if (i.action === 'delete') {
        const picked = i.events === 'default' ? pickEvents(await deletePlan(user, [id]), 'default') : [];
        await deleteTask(user, id);
        if (picked.length) { const r = await deletePickedEvents(user, picked); eventsDeleted += r.deleted; r.calendars.forEach((c) => cals.add(c)); }
      } else if (i.action === 'restore') { const r = await restoreTask(user, id); eventsRestored += r.eventsRestored; r.calendars.forEach((c) => cals.add(c)); }
      else if (i.action === 'done') {
        // 완료는 본인 업무만 (V12-11 상태 규칙을 그대로 updateTask 가 검사)
        await updateTask(user, id, { status: 'done' });
      } else await updateTask(user, id, (i.each?.[id] ?? i.patch ?? {}) as never);
      done.push(id);
    } catch (e: any) {
      skipped.push({ id, title: titles.get(id) ?? '(알 수 없음)', reason: e?.status === 404 ? '볼 수 없는 업무' : String(e?.message ?? '실패').slice(0, 120) });
    }
  }
  if (cals.size) { after(() => dispatchPending().catch(() => {})); after(() => syncCalendars([...cals])); }
  return { done, skipped, ...(i.action === 'delete' ? { eventsDeleted } : {}), ...(i.action === 'restore' ? { eventsRestored } : {}) };
});
