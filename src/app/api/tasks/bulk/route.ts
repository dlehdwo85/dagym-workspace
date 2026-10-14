import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { deleteTask, restoreTask, updateTask } from '@/lib/tasks';
import { zDate } from '@/lib/api';

/**
 * V14 12번 다중 선택 작업: 업무마다 기존 권한 검사를 그대로(삭제·수정·상태). 권한이 없거나 실패한 것은 건너뛰고 이유를 돌려준다.
 * 되돌리기: 화면이 이전 값으로 patch(또는 restore) 를 다시 보낸다.
 */
const input = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(['delete', 'restore', 'patch', 'done']),
  patch: z.object({ assigneeId: z.string().uuid().nullable().optional(), dueDate: zDate.nullable().optional(), projectId: z.string().uuid().nullable().optional(),
    status: z.enum(['todo', 'in_progress', 'review', 'on_hold', 'done']).optional() }).optional(),
  /** 되돌리기: 업무별 이전 값 */
  each: z.record(z.string().uuid(), z.record(z.string(), z.unknown())).optional(),
});
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, input);
  const done: string[] = []; const skipped: { id: string; title: string; reason: string }[] = [];
  const titles = new Map((await db()<{ id: string; title: string }[]>`select id, title from tasks where id = any(${i.ids}::uuid[])`).map((r) => [r.id, r.title]));
  for (const id of new Set(i.ids)) {
    try {
      if (i.action === 'delete') await deleteTask(user, id);
      else if (i.action === 'restore') await restoreTask(user, id);
      else if (i.action === 'done') {
        // 완료는 본인 업무만 (V12-11 상태 규칙을 그대로 updateTask 가 검사)
        await updateTask(user, id, { status: 'done' });
      } else await updateTask(user, id, (i.each?.[id] ?? i.patch ?? {}) as never);
      done.push(id);
    } catch (e: any) {
      skipped.push({ id, title: titles.get(id) ?? '(알 수 없음)', reason: e?.status === 404 ? '볼 수 없는 업무' : String(e?.message ?? '실패').slice(0, 120) });
    }
  }
  return { done, skipped };
});
