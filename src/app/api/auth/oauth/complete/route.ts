import { NextResponse } from 'next/server';
import { handler, body, clientIp } from '@/lib/api';
import { createSession, sessionCookie } from '@/lib/auth';
import { completeInput, completeSocialSignup } from '@/lib/oauth';

/** 소셜 가입 마무리: 회사(또는 개인 공간) 만들기 → 바로 로그인(확인 메일 없음) */
export const POST = handler(async ({ req }) => {
  const { userId, pendingApproval } = await completeSocialSignup(await body(req, completeInput), clientIp(req));
  const { token, maxAge } = await createSession(userId, 'web', req.headers.get('user-agent'), { ip: clientIp(req) });
  const res = NextResponse.json({ ok: true, pendingApproval }); // 359차: 승인제면 '가입 신청 접수' 화면으로
  res.cookies.set(sessionCookie(token, maxAge));
  return res;
}, { public: true });
