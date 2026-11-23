import { handler } from '@/lib/api';
import { memoPeople } from '@/lib/memos';

/** #1135 볼 사람 고르기용 같은 회사 사람·부서 */
export const GET = handler(async ({ user }) => memoPeople(user));
