import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/access';

export const GET = handler(async ({ user }) => {
  requireAdmin(user);
  const sql = db();
  const [jobs, errors, deliveries, syncErrors, counts] = await Promise.all([
    sql`select id, job, trigger, started_at, finished_at, status, detail from job_runs order by id desc limit 30`,
    sql`select id, source, message, context, created_at from error_logs order by id desc limit 50`,
    sql`select status, count(*)::int c from notification_deliveries where created_at > now() - interval '7 days' group by status`,
    sql`select l.id, l.action, l.status, l.detail, l.created_at, u.name from sync_logs l left join users u on u.id = l.user_id
        where l.status in ('error','conflict') order by l.id desc limit 30`,
    sql`select (select count(*)::int from users where status='active') users, (select count(*)::int from tasks where deleted_at is null) tasks,
        (select count(*)::int from events where deleted_at is null) events, (select count(*)::int from attachments where deleted_at is null) files,
        (select coalesce(sum(size_bytes),0)::bigint from attachments where deleted_at is null and kind='file') file_bytes`,
  ]);
  return { jobs, errors, deliveries, syncErrors, counts: counts[0] };
});
