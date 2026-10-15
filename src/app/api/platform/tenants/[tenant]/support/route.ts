import { NextResponse } from 'next/server';
import { handler, body, clientIp } from '@/lib/api';
import { SUPPORT_COOKIE, startSupport, supportInput } from '@/lib/platformAdmin';

/** V28-3 지원 모드 시작(고객 동의 회사만, 읽기 전용 30분) — 운영자 로그인은 그대로 두고 지원 쿠키만 따로 */
export const POST = handler<{ tenant: string }>(async ({ req, user, params }) => {
  const r = await startSupport(user, params.tenant, await body(req, supportInput), clientIp(req));
  const res = NextResponse.json({ ok: true, tenantName: r.tenantName });
  res.cookies.set({ name: SUPPORT_COOKIE, value: r.token, httpOnly: true, sameSite: 'lax', secure: (process.env.APP_URL ?? '').startsWith('https://'), path: '/', maxAge: r.maxAge });
  return res;
});
