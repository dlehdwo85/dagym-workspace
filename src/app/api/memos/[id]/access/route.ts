import { handler, body, clientIp } from '@/lib/api';
import { memoAccessInput, setMemoAccess } from '@/lib/memos';

/** #1135 볼 사람 바꾸기(사람·부서, 보기/고치기) — 고치기 권한자만 */
export const PUT = handler<{ id: string }>(async ({ req, user, params }) => setMemoAccess(user, params.id, await body(req, memoAccessInput), clientIp(req)));
