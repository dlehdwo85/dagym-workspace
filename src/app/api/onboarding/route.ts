import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { tenantOf } from '@/lib/types';

/** V15 첫 로그인 안내: 1단계 이름·직책 저장, 끝내기(공간 대표만) */
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ name: z.string().trim().min(1).max(50).optional(), title: z.string().trim().max(50).optional(), done: z.boolean().optional() }));
  const sql = db();
  if (i.name || i.title !== undefined) await sql`update users set name = coalesce(${i.name ?? null}, name), title = coalesce(${i.title ?? null}, title), updated_at = now() where id = ${user.id}`;
  if (i.done) await sql`update tenants set onboarded_at = coalesce(onboarded_at, now()) where id = ${tenantOf(user)} and owner_user_id = ${user.id}`;
  return { ok: true };
});
