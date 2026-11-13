import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMenu } from '@/lib/menuPerms';
import { badRequest } from '@/lib/errors';
import { audit } from '@/lib/log';
import { removeHoliday, saveHoliday } from '@/lib/holidays';

const ok = (d: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d))) throw badRequest('날짜 형식이 아닙니다'); return d; };
/** 공휴일 추가·이름 변경 (관리자) */
export const PUT = handler<{ date: string }>(async ({ req, user, params }) => {
  await requireMenu(user, 'ops', 'edit');
  const date = ok(params.date);
  const i = await body(req, z.object({ name: z.string().trim().min(1).max(40) }));
  const sql = db();
  await saveHoliday(user, date, i.name, sql); // 범용화 S-05: 기본 회사는 예전 표 그대로, 다른 회사는 자기 회사 것만
  await audit(sql, user.id, 'holiday.save', 'holiday', null, { date, name: i.name }, clientIp(req));
  return { ok: true };
});
export const DELETE = handler<{ date: string }>(async ({ req, user, params }) => {
  await requireMenu(user, 'ops', 'edit');
  const date = ok(params.date);
  const sql = db();
  await removeHoliday(user, date, sql);
  await audit(sql, user.id, 'holiday.delete', 'holiday', null, { date }, clientIp(req));
  return { ok: true };
});
