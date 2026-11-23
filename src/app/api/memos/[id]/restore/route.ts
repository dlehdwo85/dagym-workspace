import { handler, clientIp } from '@/lib/api';
import { restoreMemo } from '@/lib/memos';

/** #1135 휴지통의 메모 되살리기 */
export const POST = handler<{ id: string }>(async ({ req, user, params }) => restoreMemo(user, params.id, clientIp(req)));
