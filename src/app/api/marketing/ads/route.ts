import { handler } from '@/lib/api';
import { adsOverview } from '@/lib/marketingAds';

/** 광고 성과(읽기 전용): 연결된 계정·기간 합계·캠페인별·날짜별 */
export const GET = handler(async ({ req, user }) => adsOverview(user, { days: Number(req.nextUrl.searchParams.get('days')) || undefined }));
