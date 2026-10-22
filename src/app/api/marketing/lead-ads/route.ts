import { handler } from '@/lib/api';
import { leadAdsReport } from '@/lib/metaLeads';

/** 광고 2차 ① 광고 운영 '리드 광고' 상자 — 페이지별 받기 상태·최근 신청(이름 가림)·첫 연락 시간·광고별 리드당 비용 */
export const GET = handler(async ({ req, user }) => leadAdsReport(user, { days: Number(req.nextUrl.searchParams.get('days')) || undefined }));
