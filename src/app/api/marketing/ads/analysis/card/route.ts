import { handler, body } from '@/lib/api';
import { adsAnalysisCard, adsMonthInput } from '@/lib/mktAdsMonth';

/** 분석 → 운영실 승인 요청 카드(승인함 '운영 제안' 탭) */
export const POST = handler(async ({ req, user }) => adsAnalysisCard(user, (await body(req, adsMonthInput)).month));
