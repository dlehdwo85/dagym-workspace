import { handler } from '@/lib/api';
import { revokeSessionByPrefix } from '@/lib/auth';
import { badRequest, notFound } from '@/lib/errors';

/** 로컬 10/19: 기기 목록에서 그 기기만 원격 로그아웃(앞 8자 id). 지금 기기는 로그아웃 메뉴로 */
export const DELETE = handler<{ id: string }>(async ({ user, params }) => {
  const n = await revokeSessionByPrefix(user.id, params.id, user.sessionId);
  if (n === -1) throw badRequest('지금 쓰는 기기는 여기서 끊을 수 없습니다 — 로그아웃을 쓰세요');
  if (!n) throw notFound('그 기기 로그인이 없습니다');
  return { revoked: n };
});
