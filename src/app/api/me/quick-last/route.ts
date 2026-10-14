import { z } from 'zod';
import { body, handler } from '@/lib/api';
import { db } from '@/lib/db';

/** 검수 20: 업무 등록 창의 마지막 설정(사용자 단위, 어느 기기에서나 같게) */
const input = z.object({
  assigneeId: z.string().uuid().nullable().optional(), requestedById: z.string().uuid().nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), projectId: z.string().uuid().nullable().or(z.literal('')).optional(),
  remind: z.array(z.number().int().min(0).max(40320)).max(5).nullable().optional(),
});
export const GET = handler(async ({ user }) => {
  const [r] = await db()<{ quick_last: unknown }[]>`select quick_last from user_settings where user_id = ${user.id}`;
  return { last: r?.quick_last ?? null };
});
export const PUT = handler(async ({ req, user }) => {
  const v = await body(req, input);
  const sql = db();
  await sql`insert into user_settings (user_id, quick_last) values (${user.id}, ${sql.json(v as never)})
    on conflict (user_id) do update set quick_last = excluded.quick_last, updated_at = now()`;
  return { ok: true };
});
