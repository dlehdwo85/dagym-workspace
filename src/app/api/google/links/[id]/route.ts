import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { stopWatch } from '@/lib/google/sync';

/** 연결 해제: Google·회사 양쪽 일정은 그대로 두고 연결만 끊는다 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => {
  const sql = db();
  const [l] = await sql`select * from google_calendar_links where id = ${params.id} and user_id = ${user.id}`;
  if (!l) throw notFound();
  await stopWatch(sql, l as never).catch(() => {});
  await sql`delete from google_calendar_links where id = ${params.id}`;
  await sql`insert into sync_logs (user_id, direction, action, status, detail) values (${user.id}, 'auth', 'unlink', 'ok', ${sql.json({ calendar: l.google_calendar_name })})`;
  return { ok: true };
});
