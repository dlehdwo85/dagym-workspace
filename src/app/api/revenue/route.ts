import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { deleteRevenue, listRevenue, revenueInput, saveRevenue } from '@/lib/revenue';

/** 매출 화면 (본사만, 그 밖에는 404) */
export const GET = handler(async ({ req, user }) => {
  const y = Number(req.nextUrl.searchParams.get('year'));
  const year = Number.isInteger(y) && y >= 2000 && y <= 2100 ? y : Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
  return listRevenue(user, year);
});
export const PUT = handler(async ({ req, user }) => {
  const i = await body(req, revenueInput);
  await saveRevenue(user, i, clientIp(req));
  return { ok: true };
});
export const DELETE = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ orgUnitId: z.string().uuid(), month: z.string() }));
  await deleteRevenue(user, i.orgUnitId, i.month, clientIp(req));
  return { ok: true };
});
