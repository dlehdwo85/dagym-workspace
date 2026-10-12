import { NextResponse } from 'next/server';
import { handler } from '@/lib/api';
import { revokeSession, SESSION_COOKIE } from '@/lib/auth';
import { db } from '@/lib/db';
import { z } from 'zod';

export const POST = handler(async ({ req, user }) => {
  if (user) {
    // 앱 로그아웃 시 이 기기의 푸시 토큰도 해제
    const b = z.object({ pushEndpoint: z.string().optional() }).safeParse(await req.json().catch(() => ({})));
    if (b.success && b.data.pushEndpoint) {
      await db()`update push_subscriptions set disabled_at = now() where user_id = ${user.id} and endpoint = ${b.data.pushEndpoint}`;
    }
    await revokeSession(user.sessionId);
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: SESSION_COOKIE, value: '', path: '/', maxAge: 0 });
  return res;
}, { public: true });
