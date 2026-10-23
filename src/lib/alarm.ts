// 로컬 10/20(대표): 업무·일정 알림을 휴대폰 알람처럼(전체 화면·소리·[해제][10분 뒤]) 울릴지 정하는 규칙 — 서버 쪽 공통
// - 항목별 alarm(null = 기본값) → 사람별 기본값: 일정 끔 · 업무 마감 끔 · 내가 '중요'(높음·긴급)로 표시한 업무 켬
// - 결과는 로컬 예약 알림(/api/reminders/upcoming)·FCM/웹 푸시 payload 에 alarm:true·snoozeMinutes·actions 로 실림. 네이티브 전체 화면·소리는 앱(로컬) 담당
// - 해제·미루기 결과는 activities 에 남겨 알림 '활동' 탭에 보임(미루기 재예약은 기기에서)
import { z } from 'zod';
import { db, type Sql } from './db';
import { badRequest, notFound } from './errors';
import { activity } from './log';
import type { SessionUser } from './types';

export const SNOOZE_MINUTES = 10;
export type AlarmDefaults = { events: boolean; tasks: boolean; important: boolean };
export const ALARM_ACTIONS = [{ id: 'dismiss', label: '해제', done: '알람 해제' }, { id: 'snooze', label: `${SNOOZE_MINUTES}분 뒤`, done: `${SNOOZE_MINUTES}분 뒤 다시 알림` }];

export async function alarmDefaults(sql: Sql, userId: string): Promise<AlarmDefaults> {
  const [s] = await sql<{ e: boolean; t: boolean; i: boolean }[]>`select coalesce(alarm_events, false) e, coalesce(alarm_tasks, false) t, coalesce(alarm_important, true) i from user_settings where user_id = ${userId}`;
  return { events: s?.e ?? false, tasks: s?.t ?? false, important: s?.i ?? true };
}
/** 항목별 값이 있으면 그대로, 없으면 기본값(중요 업무는 '중요' 기본값) */
export function alarmOn(kind: 'event' | 'task', item: boolean | null | undefined, d: AlarmDefaults, priority?: string | null) {
  if (item === true || item === false) return item;
  if (kind === 'task' && (priority === 'high' || priority === 'urgent')) return d.important;
  return kind === 'event' ? d.events : d.tasks;
}
/** 푸시·로컬 예약에 싣는 알람 칸 */
export const alarmFields = (on: boolean) => (on ? { alarm: true as const, snoozeMinutes: SNOOZE_MINUTES, actions: ALARM_ACTIONS.map(({ id, label }) => ({ id, label })).concat([{ id: 'open', label: '열기' }]) } : {});

/** 기기(로컬 예약 알림)에서 해제·미루기한 결과 기록 — 미루기 재예약은 기기가 한다 */
export const alarmResultInput = z.object({ kind: z.enum(['event', 'task']), id: z.string().uuid(), action: z.enum(['dismiss', 'snooze']), minutes: z.number().int().min(1).max(120).optional(), key: z.string().max(200).optional() });
export async function recordAlarmResult(u: SessionUser, i: z.infer<typeof alarmResultInput>) {
  const sql = db();
  const [own] = i.kind === 'task'
    ? await sql<{ id: string }[]>`select id from tasks where id = ${i.id} and deleted_at is null and (assignee_id = ${u.id} or requested_by = ${u.id} or created_by = ${u.id}
        or exists (select 1 from task_assignees ta where ta.task_id = tasks.id and ta.user_id = ${u.id}))`
    : await sql<{ id: string }[]>`select e.id from events e join calendars c on c.id = e.calendar_id where e.id = ${i.id} and e.deleted_at is null
        and (c.owner_user_id = ${u.id} or e.created_by = ${u.id} or exists (select 1 from event_attendees a where a.event_id = coalesce(e.recurring_event_id, e.id) and a.user_id = ${u.id}))`;
  if (!own) throw notFound(i.kind === 'task' ? '업무가 없습니다' : '일정이 없습니다');
  if (i.action === 'snooze' && !i.minutes) throw badRequest('미룬 시간(분)을 보내 주세요');
  await activity(sql, i.kind, i.id, u.id, i.action === 'dismiss' ? 'alarm_dismissed' : 'alarm_snoozed', { minutes: i.minutes ?? null, key: i.key ?? null, from: 'device' });
  // 대표 10/22: 휴대폰 알림에서 [해제]/[10분 뒤]를 누르면 같은 업무·일정의 앱 안 알람 띠(서버 알림)도 함께 처리 — 전에는 기록만 해서 띠가 계속 떠 있었다
  const open = sql`user_id = ${u.id} and entity_type = ${i.kind} and entity_id = ${i.id} and (meta->>'alarm')::boolean is true and action_done is null`;
  if (i.action === 'dismiss') await sql`update notifications set action_done = '알람 해제', action_done_at = now(), read_at = coalesce(read_at, now()) where ${open}`;
  else await sql`update notifications set meta = meta || ${sql.json({ snoozed: true, snoozeUntil: new Date(Date.now() + i.minutes! * 60_000).toISOString() })} where ${open} and read_at is null`;
  return { ok: true };
}
