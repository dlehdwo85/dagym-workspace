import { handler } from '@/lib/api';
import { adOpsOverview } from '@/lib/adOps';

/** V44 광고 운영: 월 상한·이번 달 광고비·세팅안·변경 기록 */
export const GET = handler(async ({ user }) => adOpsOverview(user));
