import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, body, clientIp } from '@/lib/api';
import { createSession, sessionCookie } from '@/lib/auth';
import { verifyEmail } from '@/lib/signup';

/** 확인 링크 → 가입 완료 + 바로 로그인 */
export const POST = handler(async ({ req }) => {
  const i = await body(req, z.object({ token: z.string().min(10).max(200) }));
  const userId = await verifyEmail(i.token);
  const { token, maxAge } = await createSession(userId, 'web', req.headers.get('user-agent'), { ip: clientIp(req) });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(token, maxAge));
  return res;
}, { public: true });
