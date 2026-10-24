import { handler } from '@/lib/api';
import { adRefWeeklyNow } from '@/lib/mktAdRefs';

export const maxDuration = 120; // 대표 10/24 ①: 만드는 일은 글 모델(최상 모델 30~60초)
/** #499-6 [주간 분석 지금](관리자): 월요일 자동 분석을 바로 — 지난 7일 새 광고 3개 이상, 이번 주에 이미 했으면 건너뜀 */
export const POST = handler(async ({ user }) => adRefWeeklyNow(user));
