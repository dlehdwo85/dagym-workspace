import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/access';
import { badRequest } from '@/lib/errors';
import { audit } from '@/lib/log';

const ok = (d: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d))) throw badRequest('날짜 형식이 아닙니다'); return d; };
/** 공휴일 추가·이름 변경 (관리자) */
export const PUT = handler<{ date: string }>(async ({ req, user, params }) => {
  requireAdmin(user);
  const date = ok(params.date);
  const i = await body(req, z.object({ name: z.string().trim().min(1).max(40) }));
  const sql = db();
  await sql`insert into holidays (date, name, updated_by) values (${date}, ${i.name}, ${user.id})
    on conflict (date) do update set name = excluded.name, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, user.id, 'holiday.save', 'holiday', null, { date, name: i.name }, clientIp(req));
  return { ok: true };
});
export const DELETE = handler<{ date: string }>(async ({ req, user, params }) => {
  requireAdmin(user);
  const date = ok(params.date);
  const sql = db();
  await sql`delete from holidays where date = ${date}`;
  await audit(sql, user.id, 'holiday.delete', 'holiday', null, { date }, clientIp(req));
  return { ok: true };
});
