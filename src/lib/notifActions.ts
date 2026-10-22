// 로컬 10/20 알림에서 바로 처리: 알림 종류·메타로 버튼을 정하고(웹 알림 센터·푸시 payload 공용), 누르면 기존 업무 API 와 같은 함수로 처리한다.
// 권한은 그 함수가 검사(남의 업무 승인 → 403), 알림 주인이 아니면 404. 처리되면 알림이 "승인함 ✓" 로 바뀌고 다시 푸시하지 않는다.
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, notFound } from './errors';
import { activity } from './log';
import { todaySeoul } from './time';
import type { SessionUser } from './types';

export type NotifAction = { id: string; label: string; input?: 'text'; done?: string };
export type NotifRow = { id: string; type: string; link: string; entity_type: string | null; entity_id: string | null; meta: Record<string, any> | null; action_done: string | null; task_status?: string | null; ext_pending?: boolean | null };

/** 알림 한 줄에 보일 버튼. 처리됐거나 대상이 끝났으면 없음 */
export function actionsFor(n: NotifRow): NotifAction[] {
  if (n.action_done) return [];
  const kind = n.meta?.kind as string | undefined;
  switch (n.type) {
    case 'review_requested':
      if (kind === 'extension') return n.ext_pending === false ? [] : [{ id: 'approve_ext', label: '승인', done: '연장 승인함' }, { id: 'reject_ext', label: '거절', done: '연장 거절함' }];
      if (kind === 'handoff') return [];
      if (n.task_status && n.task_status !== 'review') return [];
      return [{ id: 'approve', label: '승인', done: '승인함' }, { id: 'changes', label: '수정 요청', input: 'text', done: '수정 요청함' }];
    case 'comment': case 'mention':
      return [{ id: 'reply', label: '답글', input: 'text', done: '답글 남김' }, { id: 'ack', label: '확인', done: '확인함' }];
    case 'task_assigned':
      if (n.task_status === 'done') return [];
      return [{ id: 'ack', label: '확인', done: '확인함' }, { id: 'today', label: '오늘 할 일에 넣기', done: '오늘 할 일에 넣음' }];
    case 'event_reminder':
      // 로컬 10/20(대표): 알람처럼 울리는 알림은 [해제][10분 뒤]
      if (n.meta?.alarm) return [{ id: 'dismiss', label: '해제', done: '알람 해제' }, { id: 'snooze', label: '10분 뒤', done: '10분 뒤 다시 알림' }];
      return [{ id: 'snooze', label: '10분 뒤 다시', done: '10분 뒤 다시 알림' }];
    case 'due_soon':
      if (n.meta?.alarm && n.task_status !== 'done') return [{ id: 'dismiss', label: '해제', done: '알람 해제' }, { id: 'snooze', label: '10분 뒤', done: '10분 뒤 다시 알림' }];
      return [];
    default: return [];
  }
}

export const actionInput = z.object({ action: z.string().min(1).max(30), text: z.string().trim().max(2000).optional() });

/** 알림 액션 실행 → { label, unread } */
export async function performAction(u: SessionUser, notificationId: string, i: z.infer<typeof actionInput>, ip: string | null) {
  const sql = db();
  const [n] = await sql<NotifRow[]>`select n.id, n.type, n.link, n.entity_type, n.entity_id, n.meta, n.action_done,
      case when n.entity_type = 'task' then t.status end as task_status,
      case when n.meta->>'extensionId' is not null then exists (select 1 from task_due_extensions x where x.id = (n.meta->>'extensionId')::uuid and x.status = 'pending') end as ext_pending
    from notifications n left join tasks t on n.entity_type = 'task' and t.id = n.entity_id where n.id = ${notificationId} and n.user_id = ${u.id}`;
  if (!n) throw notFound('알림을 찾을 수 없습니다');
  if (n.action_done) return { ok: true, label: n.action_done, already: true, unread: await unread(sql, u.id) };
  const act = actionsFor(n).find((a) => a.id === i.action);
  if (!act) throw badRequest('이 알림에서는 할 수 없는 처리입니다 — 열어서 확인해 주세요');
  if (act.input === 'text' && !i.text) throw badRequest(`${act.label} 내용을 적어 주세요`);
  const taskId = n.entity_type === 'task' ? n.entity_id! : null;
  const T = await import('./tasks');
  let label = act.done ?? act.label;
  switch (i.action) {
    case 'approve': case 'changes': {
      if (!taskId) throw badRequest('업무 알림이 아닙니다');
      // 결재선(task_approvals) 업무면 결재 API, 아니면 검토 승인(완료)/보완 요청
      const [pend] = await sql<{ id: number }[]>`select id from task_approvals where task_id = ${taskId} and status = 'pending' limit 1`;
      if (pend) {
        const { decide } = await import('./approvals');
        await decide(u, taskId, i.action === 'approve' ? 'approve' : 'reject', i.text, ip);
      } else {
        const [t] = await sql<{ version: number; status: string }[]>`select version, status from tasks where id = ${taskId} and deleted_at is null`;
        if (!t) throw notFound('업무가 없습니다');
        if (t.status !== 'review') throw badRequest('이미 처리된 검토 요청입니다');
        await T.updateTask(u, taskId, i.action === 'approve' ? { status: 'done', version: t.version } : { status: 'in_progress', version: t.version, reviewNote: i.text });
      }
      break;
    }
    case 'approve_ext': case 'reject_ext': {
      const extId = n.meta?.extensionId as string | undefined;
      if (!taskId || !extId) throw badRequest('연장 요청 알림이 아닙니다');
      await T.decideExtension(u, taskId, extId, i.action === 'approve_ext');
      break;
    }
    case 'reply': {
      if (!taskId) throw badRequest('업무 알림이 아닙니다');
      const parentId = (n.meta?.commentId as string | undefined) ?? n.link.match(/#c-([0-9a-f-]{36})/)?.[1] ?? null;
      await T.addComment(u, taskId, i.text!, parentId); // 답글의 답글은 addComment 가 같은 스레드로 붙임
      break;
    }
    case 'ack': {
      if (n.type === 'task_assigned' && taskId) await T.ackTask(u, taskId);
      break;
    }
    case 'today': {
      if (!taskId) throw badRequest('업무 알림이 아닙니다');
      const [t] = await sql<{ version: number }[]>`select version from tasks where id = ${taskId} and deleted_at is null`;
      if (!t) throw notFound('업무가 없습니다');
      await T.updateTask(u, taskId, { startDate: todaySeoul(), version: t.version });
      break;
    }
    case 'snooze': {
      const { queuePush } = await import('./notifications');
      await queuePush(sql, u.id, n.id, { delayMinutes: 10 });
      label = act.done!;
      // 다시 울리게 두되 읽음으로는 두지 않음. 대표 10/22: 띠(alarms)에서 10분 동안 빠지도록 snoozeUntil — 전에는 그대로 남아 [10분 뒤]를 눌러도 띠가 다시 떴다
      const until = new Date(Date.now() + 10 * 60_000).toISOString();
      await sql`update notifications set action_done = null, meta = meta || ${sql.json({ snoozed: true, snoozeUntil: until })} where id = ${n.id}`;
      if (n.meta?.alarm && n.entity_id && (n.entity_type === 'task' || n.entity_type === 'event')) await activity(sql, n.entity_type, n.entity_id, u.id, 'alarm_snoozed', { minutes: 10, from: 'notification' }); // 알림 '활동' 탭
      return { ok: true, label, unread: await unread(sql, u.id) };
    }
    case 'dismiss': { // 로컬 10/20(대표): 알람 해제 — 기록만 남기고 처리 완료(재푸시 없음)
      if (n.entity_id && (n.entity_type === 'task' || n.entity_type === 'event')) await activity(sql, n.entity_type, n.entity_id, u.id, 'alarm_dismissed', { from: 'notification' });
      break;
    }
    default: throw badRequest('알 수 없는 처리');
  }
  await sql`update notifications set action_done = ${label}, action_done_at = now(), read_at = coalesce(read_at, now()) where id = ${n.id}`;
  return { ok: true, label, unread: await unread(sql, u.id) };
}
async function unread(sql: Sql, userId: string) {
  const [c] = await sql<{ c: number }[]>`select count(*)::int c from notifications where user_id = ${userId} and read_at is null and type <> 'chat'`;
  return c.c;
}
