import { handler, body, clientIp } from '@/lib/api';
import { lockMemos, unlockInput, unlockMemos } from '@/lib/memos';

/** #1135 주요 메모 본인 확인(10분) · DELETE = 지금 잠그기 */
export const POST = handler(async ({ req, user }) => unlockMemos(user, await body(req, unlockInput), clientIp(req)));
export const DELETE = handler(async ({ user }) => lockMemos(user));
