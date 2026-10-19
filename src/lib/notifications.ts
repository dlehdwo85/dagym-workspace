import { db, type Sql } from './db';
import type { NotificationType } from './types';

export interface NotifyInput {
  userIds: (string | null | undefined)[];
  type: NotificationType;
  title: string;
  body?: string;
  link: string;
  entityType?: string;
  entityId?: string;
  actorId?: string | null;
  /** 같은 사용자에게 같은 키로는 한 번만 생성 (중복 발송 방지) */
  dedupeKey: string;
  /** false = 이번 알림은 목록에만(푸시 안 함) — 받는 사람 설정과 무관. 로컬 10/20 알림 다이어트 */
  push?: boolean;
  /** 알림에서 바로 처리용(kind: review|approval|extension|comment|assigned|event, extensionId·commentId 등) */
  meta?: Record<string, unknown>;
}

/**
 * 로컬 10/20 알림 다이어트 — 종류별 푸시 기본값. 끔(목록에만): 내가 한 일의 결과·시스템 결과. 사용자가 알림 설정에서 켤 수 있다.
 * 푸시 유지: 나에게 온 요청(배정·검토·결재·연장·멘션·메시지)·내 일정·지시한 업무 완료·중요 공지·한도.
 */
export const PUSH_OFF_DEFAULT = new Set<string>(['mail_sent', 'library_organized', 'recurring_created', 'month_close', 'weekly_report']);
export const defaultPush = (type: string) => !PUSH_OFF_DEFAULT.has(type);
/** 조용한 시간 기본값 22:00~07:00 (시험에서는 QUIET_DEFAULT=off 로 끔). 사용자가 끄면(quiet_off) 적용 안 함 */
export const QUIET_DEFAULT = process.env.QUIET_DEFAULT === 'off' ? null : { start: '22:00', end: '07:00' };

/**
 * 알림 생성 + 푸시 발송 대기열 등록. 실제 발송은 dispatchPending() (요청 직후 + 서버 스케줄러 재시도).
 * 반환: 새로 만들어진 알림 id 목록
 */
/** 기기 로컬 알림이 대신하는 종류 (일정 시작 전·마감 미리 알림·아침 브리핑) */
export const LOCAL_TYPES: string[] = ['event_reminder', 'due_soon', 'briefing'];

export async function notify(sql: Sql, n: NotifyInput): Promise<string[]> {
  const targets = [...new Set(n.userIds.filter((x): x is string => !!x && x !== n.actorId))];
  if (targets.length === 0) return [];
  const created: string[] = [];
  for (const userId of targets) {
    const pref = await sql<{ in_app: boolean; push: boolean }[]>`
      select in_app, push from notification_prefs where user_id = ${userId} and type = ${n.type}`;
    const inApp = pref[0]?.in_app ?? true;
    const push = n.push === false ? false : (pref[0]?.push ?? defaultPush(n.type));
    if (!inApp && !push) continue;
    const active = await sql`select 1 from users where id = ${userId} and status = 'active'`;
    if (active.length === 0) continue;
    const rows = await sql<{ id: string }[]>`
      insert into notifications (user_id, type, title, body, link, entity_type, entity_id, actor_id, dedupe_key, read_at, meta)
      values (${userId}, ${n.type}, ${n.title}, ${n.body ?? ''}, ${n.link}, ${n.entityType ?? null}, ${n.entityId ?? null},
              ${n.actorId ?? null}, ${n.dedupeKey}, ${inApp ? null : sql`now()`}, ${sql.json((n.meta ?? {}) as never)})
      on conflict (user_id, dedupe_key) do nothing
      returning id`;
    if (!rows[0]) continue;
    created.push(rows[0].id);
    if (push) await queuePush(sql, userId, rows[0].id);
  }
  return created;
}

/** 푸시 대기열에 넣기(조용한 시간이면 끝나는 시각에). 기본 22:00~07:00, 사용자가 바꾸거나 끌 수 있음 */
export async function queuePush(sql: Sql, userId: string, notificationId: string, opts: { delayMinutes?: number } = {}) {
  const qs = QUIET_DEFAULT?.start ?? null, qe = QUIET_DEFAULT?.end ?? null;
  const quiet = await sql<{ resume_at: Date | null }[]>`
    with q as (select coalesce(s.quiet_start, ${qs}::time) as qs, coalesce(s.quiet_end, ${qe}::time) as qe, coalesce(s.quiet_off, false) as off
      from users u left join user_settings s on s.user_id = u.id where u.id = ${userId})
    select case
      when q.off or q.qs is null or q.qe is null then null
      when q.qs < q.qe and (now() at time zone 'Asia/Seoul')::time between q.qs and q.qe then ((now() at time zone 'Asia/Seoul')::date + q.qe) at time zone 'Asia/Seoul'
      when q.qs > q.qe and (now() at time zone 'Asia/Seoul')::time >= q.qs then ((now() at time zone 'Asia/Seoul')::date + 1 + q.qe) at time zone 'Asia/Seoul'
      when q.qs > q.qe and (now() at time zone 'Asia/Seoul')::time < q.qe then ((now() at time zone 'Asia/Seoul')::date + q.qe) at time zone 'Asia/Seoul'
      else null end as resume_at from q`;
  const at = quiet[0]?.resume_at ?? null;
  const delay = opts.delayMinutes ? `${opts.delayMinutes} minutes` : null;
  const [n] = await sql<{ type: string }[]>`select type from notifications where id = ${notificationId}`;
  await sql`
    insert into notification_deliveries (notification_id, subscription_id, channel, status, next_attempt_at)
    select ${notificationId}, p.id, p.kind, 'pending', greatest(coalesce(${at}::timestamptz, now()), now() + coalesce(${delay}::interval, interval '0'))
    from push_subscriptions p where p.user_id = ${userId} and p.disabled_at is null
      -- 미리 알림을 기기에서 직접 예약하는 앱에는 같은 알림을 다시 보내지 않음(중복 방지)
      and not (p.local_reminders and ${LOCAL_TYPES.includes(n?.type ?? '')})
    on conflict do nothing`;
}

export async function unreadCount(userId: string) {
  const r = await db()<{ c: number }[]>`select count(*)::int c from notifications where user_id = ${userId} and read_at is null and type <> 'chat'`;
  return r[0].c;
}
