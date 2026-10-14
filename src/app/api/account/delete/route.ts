import { NextResponse } from 'next/server';
import { handler, body, clientIp } from '@/lib/api';
import { deleteAccount, deleteInput } from '@/lib/account';
import { sessionCookie } from '@/lib/auth';

export const POST = handler(async ({ req, user }) => {
  await deleteAccount(user, await body(req, deleteInput), clientIp(req));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(sessionCookie('', 0));
  return res;
});
