import { z } from 'zod';
import { handler, body, zUuid } from '@/lib/api';
import { db } from '@/lib/db';

export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ ids: z.array(zUuid).optional(), all: z.boolean().optional() }));
  const sql = db();
  if (i.all) await sql`update notifications set read_at = now() where user_id = ${user.id} and read_at is null`;
  else if (i.ids?.length) await sql`update notifications set read_at = now() where user_id = ${user.id} and id = any(${i.ids}::uuid[]) and read_at is null`;
  return { ok: true };
});
