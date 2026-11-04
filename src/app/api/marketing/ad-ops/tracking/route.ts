import { handler, body } from '@/lib/api';
import { naverTrackingAll, trackingAllInput } from '@/lib/adOps';

/** 360차 #971 네이버 자동 추적 URL: 계정의 모든 캠페인 켜기(dryRun 기본 = 바꿀 목록만) */
export const POST = handler(async ({ req, user }) => naverTrackingAll(user, await body(req, trackingAllInput)));
