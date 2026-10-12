import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { googleConfigured } from '@/lib/google/client';

export const GET = handler(async ({ user }) => {
  const sql = db();
  const [acct] = await sql`select google_email, scopes, status, last_error, updated_at from google_accounts where user_id = ${user.id}`;
  const links = await sql`select l.id, l.google_calendar_id, l.google_calendar_name, l.local_calendar_id, c.name as local_calendar_name, l.direction,
      l.status, l.last_error, l.last_synced_at, l.channel_expires_at, l.fail_count
    from google_calendar_links l join calendars c on c.id = l.local_calendar_id where l.user_id = ${user.id} order by l.created_at`;
  const logs = await sql`select id, direction, action, status, detail, created_at from sync_logs where user_id = ${user.id} order by id desc limit 50`;
  const canWrite = !!acct && String(acct.scopes).split(' ').some((s: string) => s.endsWith('/calendar.events') || s.endsWith('/calendar'));
  return { configured: googleConfigured(), account: acct ?? null, canWrite, links, logs };
});
