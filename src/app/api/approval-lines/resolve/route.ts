import { handler } from '@/lib/api';
import { resolveForMember } from '@/lib/approvals';

/** #429 '누구에게 어떻게 적용되나' 확인: ?userId= → 양식 종류마다 고른 결재선·정해진 곳·1차·2차·3차 결재자 (운영 상태 권한) */
export const GET = handler(async ({ req, user }) => resolveForMember(user, req.nextUrl.searchParams.get('userId') ?? ''));
