import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { acceptInvitation } from '@/lib/admin';
import { createSession, sessionCookie } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { AI_REQUIRED_MSG, isIosAppUa } from '@/lib/ai/consentCopy';

export const POST = handler<{ token: string }>(async ({ req, params }) => {
  const { password, ai } = await body(req, z.object({ password: z.string().min(8, '비밀번호는 8자 이상').max(200), ai: z.boolean().optional() }));
  // 대표 11/23 #1087: AI 동의 필수 — 아이폰 앱(1.2.0 심사 통과 전까지 선택)만 예외
  if (ai !== true && !isIosAppUa(req.headers.get('user-agent'))) throw new HttpError(400, 'ai_required', AI_REQUIRED_MSG);
  const { userId } = await acceptInvitation(params.token, password, ai === true);
  const { token, maxAge } = await createSession(userId, 'web', req.headers.get('user-agent'));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie(token, maxAge));
  return res;
}, { public: true });
