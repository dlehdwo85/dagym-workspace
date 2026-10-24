import { handler, body } from '@/lib/api';
import { adRefReport, adRefReportInput } from '@/lib/mktAdRefs';

export const maxDuration = 120; // 대표 10/24 ①: 만드는 일은 글 모델(최상 모델 30~60초)
/** #499-6 [공통 구조 분석]: 고른 2~12개 → 공통점·공통 구조·우리 브랜드 광고 대본 3안(광고형 점수) */
export const POST = handler(async ({ req, user }) => adRefReport(user, await body(req, adRefReportInput)));
