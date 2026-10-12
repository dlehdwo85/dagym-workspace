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
}

/**
 * 알림 생성 + 푸시 발송 대기열 등록. 실제 발송은 dispatchPending() (요청 직후 + 서버 스케줄러 재시도).
 * 반환: 새로 만들어진 알림 id 목록
 */
export async function notify(sql: Sql, n: NotifyInput): Promise<string[]> {
  const targets = [...new Set(n.userIds.filter((x): x is string => !!x && x !== n.actorId))];
  if (targets.length === 0) return [];
  const created: string[] = [];
  for (const userId of targets) {
    const pref = await sql<{ in_app: boolean; push: boolean }[]>`
      select in_app, push from notification_prefs where user_id = ${userId} and type = ${n.type}`;
    const inApp = pref[0]?.in_app ?? true;
    const push = pref[0]?.push ?? true;
    if (!inApp && !push) continue;
    const active = await sql`select 1 from users where id = ${userId} and status = 'active'`;
    if (active.length === 0) continue;
    const rows = await sql<{ id: string }[]>`
      insert into notifications (user_id, type, title, body, link, entity_type, entity_id, actor_id, dedupe_key, read_at)
      values (${userId}, ${n.type}, ${n.title}, ${n.body ?? ''}, ${n.link}, ${n.entityType ?? null}, ${n.entityId ?? null},
              ${n.actorId ?? null}, ${n.dedupeKey}, ${inApp ? null : sql`now()`})
      on conflict (user_id, dedupe_key) do nothing
      returning id`;
    if (!rows[0]) continue;
    created.push(rows[0].id);
    if (push) {
      const quiet = await sql<{ resume_at: Date | null }[]>`
        select case
          when s.quiet_start is null or s.quiet_end is null then null
          when s.quiet_start < s.quiet_end and (now() at time zone 'Asia/Seoul')::time between s.quiet_start and s.quiet_end
            then ((now() at time zone 'Asia/Seoul')::date + s.quiet_end) at time zone 'Asia/Seoul'
          when s.quiet_start > s.quiet_end and (now() at time zone 'Asia/Seoul')::time >= s.quiet_start
            then ((now() at time zone 'Asia/Seoul')::date + 1 + s.quiet_end) at time zone 'Asia/Seoul'
          when s.quiet_start > s.quiet_end and (now() at time zone 'Asia/Seoul')::time < s.quiet_end
            then ((now() at time zone 'Asia/Seoul')::date + s.quiet_end) at time zone 'Asia/Seoul'
          else null end as resume_at
        from user_settings s where s.user_id = ${userId}`;
      const at = quiet[0]?.resume_at ?? null;
      await sql`
        insert into notification_deliveries (notification_id, subscription_id, channel, status, next_attempt_at)
        select ${rows[0].id}, p.id, p.kind, 'pending', coalesce(${at}::timestamptz, now())
        from push_subscriptions p where p.user_id = ${userId} and p.disabled_at is null
        on conflict do nothing`;
    }
  }
  return created;
}

export async function unreadCount(userId: string) {
  const r = await db()<{ c: number }[]>`select count(*)::int c from notifications where user_id = ${userId} and read_at is null`;
  return r[0].c;
}
