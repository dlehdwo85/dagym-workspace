import { handler } from '@/lib/api';
import { pickRange, usageStats } from '@/lib/usageStats';

/** V30 ⑤ 관리자 이용 현황: ?days=7|30|90 */
export const GET = handler(async ({ req, user }) => usageStats(user, pickRange(req.nextUrl.searchParams.get('days'))));
