// 로컬 10/20 알림에서 바로 처리: 알림 종류·메타로 버튼을 정하고(웹 알림 센터·푸시 payload 공용), 누르면 기존 업무 API 와 같은 함수로 처리한다.
// 권한은 그 함수가 검사(남의 업무 승인 → 403), 알림 주인이 아니면 404. 처리되면 알림이 "승인함 ✓" 로 바뀌고 다시 푸시하지 않는다.
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, notFound } from './errors';
import { activity } from './log';
import { todaySeoul } from './time';
import type { SessionUser } from './types';

/** open: 서버 처리 없이 그 화면을 연다(웹·앱이 link 로 이동). 앱이 모르고 /action 으로 보내면 읽음 + 400 '눌러서 열어 주세요'(누르면 앱이 열림) */
export type NotifAction = { id: string; label: string; input?: 'text'; done?: string; open?: true };
/** task_mine: 받는 사람이 그 업무의 담당자(첫 담당자·함께 맡은 사람)인지 — 마감 알림 [완료]는 담당자에게만(요청자·관리자 '마감 위험' 알림은 [확인]만) */
export type NotifRow = { id: string; type: string; link: string; entity_type: string | null; entity_id: string | null; meta: Record<string, any> | null; action_done: string | null; task_status?: string | null; ext_pending?: boolean | null; task_mine?: boolean | null };

const ACK: NotifAction = { id: 'ack', label: '확인', done: '확인함' };
const ALARM: NotifAction[] = [{ id: 'dismiss', label: '해제', done: '알람 해제' }, { id: 'snooze', label: '10분 뒤', done: '10분 뒤 다시 알림' }];
/** 알림 한 줄에 보일 버튼(#618 대표 10/25: 모든 푸시 알림에 [확인] = 읽음 + 지움, 종류별 1개 더 — 일정 [10분 뒤]·마감 [완료]·승인 대기 [승인함 열기]).
 *  처리됐으면 없음. 알람처럼 울리는 알림은 [해제][10분 뒤] 그대로([해제] = 확인). 웹 알림 목록은 [확인]만 있는 줄이면 기존 [읽음] 버튼을 쓴다(webActions) */
export function actionsFor(n: NotifRow): NotifAction[] {
  if (n.action_done) return [];
  const kind = n.meta?.kind as string | undefined;
  switch (n.type) {
    case 'review_requested':
      if (kind === 'extension') return n.ext_pending === false ? [ACK] : [{ id: 'approve_ext', label: '승인', done: '연장 승인함' }, { id: 'reject_ext', label: '거절', done: '연장 거절함' }];
      if (kind === 'handoff') return [ACK];
      // 마케팅 승인 대기(업무가 아닌 승인 요청: 승인함·운영실·제작실 카드) → [확인][승인함 열기](승인함이 아니면 [열기])
      if (n.entity_type !== 'task' || n.meta?.approval) return [ACK, n.link.startsWith('/s/marketing/approvals') ? { id: 'open', label: '승인함 열기', open: true } : { id: 'view', label: '열기', open: true }];
      if (n.task_status && n.task_status !== 'review') return [ACK];
      return [{ id: 'approve', label: '승인', done: '승인함' }, { id: 'changes', label: '수정 요청', input: 'text', done: '수정 요청함' }];
    case 'comment': case 'mention':
      return [{ id: 'reply', label: '답글', input: 'text', done: '답글 남김' }, ACK];
    case 'chat': // 메신저 3차 C12: 푸시에서 바로 답장(그 방에 메시지)·읽음 — iOS 는 같은 버튼 묶음(wn.reply.ack)
      return n.entity_id ? [{ id: 'reply', label: '답장', input: 'text', done: '답장함' }, { id: 'ack', label: '읽음', done: '읽음' }] : [ACK];
    case 'task_assigned':
      if (n.task_status === 'done') return [ACK];
      return [ACK, { id: 'today', label: '오늘 할 일에 넣기', done: '오늘 할 일에 넣음' }];
    case 'event_reminder':
      // 로컬 10/20(대표): 알람처럼 울리는 알림은 [해제][10분 뒤]
      if (n.meta?.alarm) return ALARM;
      return [ACK, { id: 'snooze', label: '10분 뒤', done: '10분 뒤 다시 알림' }];
    case 'due_soon':
      // 대표 10/25 22:20 결정 15-13: 마감 알림에 [완료] 단추를 넣지 않음(알람형은 [해제]·[10분 뒤]로 충분) — [확인]만
      if (n.meta?.alarm && n.task_status !== 'done') return ALARM;
      return [ACK];
    default: return [ACK];
  }
}
/** 웹 알림 목록용 — 184차 #676(대표 10/26 15:50 '알림에서 확인 버튼이 안 뜸'): 안 읽은 줄은 [확인]만 있어도 보임(#618 모든 알림 [확인]).
 *  읽은 줄은 [확인]만이면 버튼 없음(이미 본 알림) */
export const webActions = (a: NotifAction[], unread = false) => (!unread && a.length === 1 && a[0].id === 'ack' ? [] : a);
/** #676 (b) 묶음 푸시(같은 묶음 하루 2건 이상)의 버튼: [확인] = 그 묶음 오늘 안 읽은 알림 모두 읽음 · [열기] = 공통 화면(iOS 카테고리 wn.ack.view 재사용) */
export const GROUP_ACTIONS: NotifAction[] = [ACK, { id: 'view', label: '열기', open: true }];

/** only = 이 알림만(웹 목록의 [확인]). 없으면(푸시 버튼) 묶음 알림은 그 묶음 전체를 읽음으로 */
export const actionInput = z.object({ action: z.string().min(1).max(30), text: z.string().trim().max(2000).optional(), only: z.boolean().optional() });

/** 알림 액션 실행 → { label, unread } */
export async function performAction(u: SessionUser, notificationId: string, i: z.infer<typeof actionInput>, ip: string | null) {
  const sql = db();
  const [n] = await sql<NotifRow[]>`select n.id, n.type, n.link, n.entity_type, n.entity_id, n.meta, n.action_done,
      case when n.entity_type = 'task' then t.status end as task_status,
      case when n.meta->>'extensionId' is not null then exists (select 1 from task_due_extensions x where x.id = (n.meta->>'extensionId')::uuid and x.status = 'pending') end as ext_pending,
      case when t.id is not null then (t.assignee_id = n.user_id or exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = n.user_id)) end as task_mine
    from notifications n left join tasks t on n.entity_type = 'task' and t.id = n.entity_id where n.id = ${notificationId} and n.user_id = ${u.id}`;
  if (!n) throw notFound('알림을 찾을 수 없습니다');
  if (n.action_done) return { ok: true, label: n.action_done, already: true, unread: await unread(sql, u.id) };
  const act = actionsFor(n).find((a) => a.id === i.action) ?? (n.meta?.group ? GROUP_ACTIONS.find((a) => a.id === i.action) : undefined);
  if (!act) throw badRequest('이 알림에서는 할 수 없는 처리입니다 — 열어서 확인해 주세요');
  if (act.input === 'text' && !i.text) throw badRequest(`${act.label} 내용을 적어 주세요`);
  if (act.open) { // #618 [승인함 열기]·[열기]: 웹·iOS 앱은 서버를 부르지 않고 그 화면으로 간다. 옛 안드로이드 앱이 보내면 읽음만 표시하고 "눌러서 열어 주세요"(그 알림을 누르면 앱이 link 로 열림)
    await sql`update notifications set read_at = coalesce(read_at, now()) where id = ${n.id}`;
    throw badRequest(act.id === 'open' ? '눌러서 승인함을 열어 주세요' : '눌러서 열어 주세요');
  }
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
      if (n.type === 'chat') { // 메신저 3차 C12: 그 방에 메시지로 보내고(방을 떠났으면 404) 방은 읽음으로
        const C = await import('./chat');
        await C.sendMessage(u, n.entity_id!, C.messageInput.parse({ body: i.text }));
        await C.markRead(u, n.entity_id!);
        break;
      }
      if (!taskId) throw badRequest('업무 알림이 아닙니다');
      const parentId = (n.meta?.commentId as string | undefined) ?? n.link.match(/#c-([0-9a-f-]{36})/)?.[1] ?? null;
      await T.addComment(u, taskId, i.text!, parentId); // 답글의 답글은 addComment 가 같은 스레드로 붙임
      break;
    }
    case 'ack': {
      // #676 (b) 묶음 푸시의 [확인]: 같은 묶음·같은 날(서울) 안 읽은 알림을 이 알림까지 모두 읽음 + '확인함'
      if (n.meta?.group && !i.only) await sql`update notifications set read_at = coalesce(read_at, now()), action_done = coalesce(action_done, ${act.done ?? '확인함'}), action_done_at = coalesce(action_done_at, now())
        where user_id = ${u.id} and id <> ${n.id} and read_at is null and meta->>'group' = ${String(n.meta.group)}
          and (created_at at time zone 'Asia/Seoul')::date = (select (created_at at time zone 'Asia/Seoul')::date from notifications where id = ${n.id})
          and created_at <= (select created_at from notifications where id = ${n.id})`;
      if (n.type === 'task_assigned' && taskId) await T.ackTask(u, taskId);
      // 메신저 3차 C12: 알림 온 메시지까지 읽음(그 뒤 새 메시지는 그대로 안 읽음)
      if (n.type === 'chat' && n.entity_id) await (await import('./chat')).markRead(u, n.entity_id, /^\d{1,20}$/.test(String(n.meta?.messageId ?? '')) ? String(n.meta!.messageId) : undefined);
      break;
    }
    case 'today': {
      if (!taskId) throw badRequest('업무 알림이 아닙니다');
      const [t] = await sql<{ version: number }[]>`select version from tasks where id = ${taskId} and deleted_at is null`;
      if (!t) throw notFound('업무가 없습니다');
      await T.updateTask(u, taskId, { startDate: todaySeoul(), version: t.version });
      break;
    }
    case 'done': { // #618 마감 알림 [완료]: 위젯 체크와 같은 길(검토 필수면 검토 요청, 함께 맡은 업무면 내 몫 완료) — 권한은 updateTask(담당자만)
      if (!taskId) throw badRequest('업무 알림이 아닙니다');
      const [t] = await sql<{ version: number; status: string; approval_required: boolean }[]>`select version, status, approval_required from tasks where id = ${taskId} and deleted_at is null`;
      if (!t) throw notFound('업무가 없습니다');
      if (t.status === 'done') { label = '이미 완료됨'; break; }
      await T.updateTask(u, taskId, { status: t.approval_required ? 'review' : 'done', version: t.version });
      const [after] = await sql<{ status: string }[]>`select status from tasks where id = ${taskId}`;
      if (after?.status === 'review') label = '검토 요청함';
      else if (after?.status !== 'done') label = '내 몫 완료함';
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
