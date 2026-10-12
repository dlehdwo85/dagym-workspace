import { featureGate } from '@/lib/google/gate';
import { z } from 'zod';
import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { syncLink } from '@/lib/google/sync';

/** 지금 동기화. full=1 이면 동기화 토큰을 지우고 전체 재동기화 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => {
  featureGate();
  const sql = db();
  const [l] = await sql`select id from google_calendar_links where id = ${params.id} and user_id = ${user.id}`;
  if (!l) throw notFound();
  const full = z.object({ full: z.boolean().optional() }).parse(await req.json().catch(() => ({}))).full;
  if (full) await sql`update google_calendar_links set sync_token = null where id = ${params.id}`;
  await sql`update google_calendar_links set status = 'active', fail_count = 0 where id = ${params.id}`;
  return syncLink(params.id, 'manual');
});
