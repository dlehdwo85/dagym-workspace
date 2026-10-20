import { handler, body } from '@/lib/api';
import { adsMonthAnalysis, adsMonthInput } from '@/lib/mktAdsMonth';

/** 대표 10/21 ①: 월별 광고 성과 AI 마케터 분석(좋았던 점·나빴던 점·다음 달 제안 3개). force 는 관리자만 */
export const POST = handler(async ({ req, user }) => { const b = await body(req, adsMonthInput); return adsMonthAnalysis(user, b.month, { force: !!b.force }); });
