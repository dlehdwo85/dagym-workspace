import { handler, body, clientIp } from '@/lib/api';
import { createMemo, listMemos, memoInput } from '@/lib/memos';

/** #1135 메모 목록(내가 볼 수 있는 것만) · 새 메모. ?kind=note|secret · ?q= · ?deleted=1(휴지통, 고치기 권한만) — 아이디·비밀번호는 넣지 않음 */
export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  return listMemos(user, { kind: p.get('kind'), q: p.get('q'), deleted: p.get('deleted') === '1' });
});
export const POST = handler(async ({ req, user }) => createMemo(user, await body(req, memoInput), clientIp(req)));
