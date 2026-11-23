import { handler } from '@/lib/api';
import { memoStatus } from '@/lib/memos';

/** #1135 주요 메모 사용 가능 여부(키) · 본인 확인 상태·방법 */
export const GET = handler(async ({ user }) => memoStatus(user));
