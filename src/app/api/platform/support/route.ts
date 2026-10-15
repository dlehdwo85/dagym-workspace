import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { SUPPORT_COOKIE, endSupport } from '@/lib/platformAdmin';

/** V28-3 지원 모드 끝내기(지원 모드 중에도 허용되는 유일한 쓰기) */
export const DELETE = handler(async ({ req }) => {
  await endSupport(req.cookies.get(SUPPORT_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SUPPORT_COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
});
