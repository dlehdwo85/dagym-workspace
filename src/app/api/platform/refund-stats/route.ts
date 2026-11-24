import { handler } from '@/lib/api';
import { refundStats, refundStatsQuery } from '@/lib/customerOps';

/** #1163 ⑥ 환불 사유 통계 — GET ?from&to&hideTest(기본 시험 회사 뺌) */
export const GET = handler(async ({ req, user }) => refundStats(user, refundStatsQuery.parse(Object.fromEntries(req.nextUrl.searchParams))));
