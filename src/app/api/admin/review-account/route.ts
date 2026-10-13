import { handler, body, clientIp } from '@/lib/api';
import { reviewInput, setupReviewAccount } from '@/lib/review';

/** 대표 전용: 앱 심사용 체험 계정(격리 조직·예시 데이터·초대 링크). 다시 부르면 예시 데이터 초기화 */
export const POST = handler(async ({ req, user }) => setupReviewAccount(user, await body(req, reviewInput), clientIp(req)));
