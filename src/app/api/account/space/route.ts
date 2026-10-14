import { NextResponse } from 'next/server';
import { handler, body, clientIp } from '@/lib/api';
import { deleteSpace, deleteSpaceInput } from '@/lib/account';
import { sessionCookie } from '@/lib/auth';

/** 공간(회사) 삭제: 대표만, 비밀번호 + 공간 이름 확인 */
export const DELETE = handler(async ({ req, user }) => {
  await deleteSpace(user, await body(req, deleteSpaceInput), clientIp(req));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie('', 0));
  return res;
});
