import { handler, clientIp } from '@/lib/api';
import { badRequest } from '@/lib/errors';
import { isProvider, myIdentities, unlinkIdentity } from '@/lib/oauth';

/** 설정 > 계정: 연결된 소셜 계정 목록 · 연결 해제(로그인 방법이 하나는 남아야 함) */
export const GET = handler(async ({ user }) => myIdentities(user));
export const DELETE = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams.get('provider') ?? '';
  if (!isProvider(p)) throw badRequest('알 수 없는 연결입니다');
  return unlinkIdentity(user, p, clientIp(req));
});
