import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/access';

export const GET = handler(async ({ user }) => {
  requireAdmin(user);
  const sql = db();
  const [jobs, errors, deliveries, syncErrors, counts, recent, noDevice] = await Promise.all([
    sql`select id, job, trigger, started_at, finished_at, status, detail from job_runs order by id desc limit 30`,
    sql`select id, source, message, context, created_at from error_logs order by id desc limit 50`,
    sql`select status, count(*)::int c from notification_deliveries where created_at > now() - interval '7 days' group by status`,
    sql`select l.id, l.action, l.status, l.detail, l.created_at, u.name from sync_logs l left join users u on u.id = l.user_id
        where l.status in ('error','conflict') order by l.id desc limit 30`,
    sql`select (select count(*)::int from users where status='active') users, (select count(*)::int from tasks where deleted_at is null) tasks,
        (select count(*)::int from events where deleted_at is null) events, (select count(*)::int from attachments where deleted_at is null) files,
        (select coalesce(sum(size_bytes),0)::bigint from attachments where deleted_at is null and kind='file') file_bytes`,
    // V6 9번: 최근 알림 50건 — 받는 사람·기기 수·발송 상태(기기 없음 포함)·오류. 데모 계정 제외
    sql`select n.id, n.title, n.type, n.created_at, u.name as user_name,
          (select count(*)::int from push_subscriptions p where p.user_id = n.user_id and p.disabled_at is null) as devices,
          coalesce((select json_agg(json_build_object('channel', d.channel, 'status', d.status, 'error', d.error, 'sent_at', d.sent_at) order by d.id)
            from notification_deliveries d where d.notification_id = n.id), '[]') as deliveries
        from notifications n join users u on u.id = n.user_id
        where not u.is_demo order by n.created_at desc limit 50`,
    // 알림을 받을 기기가 하나도 없는 사람 (앱 알림 켜기 안내 대상)
    sql`select u.id, u.name from users u where u.status = 'active' and not u.is_demo
        and not exists (select 1 from push_subscriptions p where p.user_id = u.id and p.disabled_at is null) order by u.name`,
  ]);
  return { jobs, errors, deliveries, syncErrors, counts: counts[0], recent, noDevice };
});
