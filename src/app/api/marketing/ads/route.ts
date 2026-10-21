import { handler } from '@/lib/api';
import { adsOverview } from '@/lib/marketingAds';

/** 광고 성과(읽기 전용): 연결된 계정·기간 합계·캠페인별·날짜별. month=YYYY-MM 이면 월별(전월 대비·매체/브랜드별) — 대표 10/21 ① */
export const GET = handler(async ({ req, user }) => adsOverview(user, { days: Number(req.nextUrl.searchParams.get('days')) || undefined, month: req.nextUrl.searchParams.get('month') ?? undefined, brand: req.nextUrl.searchParams.get('brand') ?? undefined, provider: req.nextUrl.searchParams.get('provider') ?? undefined }));
