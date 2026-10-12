import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { acceptInvitation } from '@/lib/admin';
import { createSession, sessionCookie } from '@/lib/auth';

export const POST = handler<{ token: string }>(async ({ req, params }) => {
  const { password } = await body(req, z.object({ password: z.string().min(8, '비밀번호는 8자 이상').max(200) }));
  const { userId } = await acceptInvitation(params.token, password);
  const { token, maxAge } = await createSession(userId, 'web', req.headers.get('user-agent'));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(token, maxAge));
  return res;
}, { public: true });
