import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { revoke } from '@/lib/google/client';
import { stopWatch } from '@/lib/google/sync';

export const POST = handler(async ({ user }) => {
  const sql = db();
  const links = await sql`select * from google_calendar_links where user_id = ${user.id}`;
  for (const l of links) await stopWatch(sql, l as never).catch(() => {});
  await revoke(user.id);
  await sql`delete from google_calendar_links where user_id = ${user.id}`;
  await sql`delete from google_accounts where user_id = ${user.id}`;
  await sql`insert into sync_logs (user_id, direction, action, status) values (${user.id}, 'auth', 'disconnect', 'ok')`;
  return { ok: true };
});
