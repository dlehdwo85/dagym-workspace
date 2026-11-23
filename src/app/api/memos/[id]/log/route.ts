import { handler } from '@/lib/api';
import { memoLog } from '@/lib/memos';

/** #1135 그 메모의 기록(누가·언제·무엇을) — 고치기 권한자만, 값은 없음 */
export const GET = handler<{ id: string }>(async ({ user, params }) => memoLog(user, params.id));
