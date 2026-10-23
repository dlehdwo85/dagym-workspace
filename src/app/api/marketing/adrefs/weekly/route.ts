import { handler } from '@/lib/api';
import { adRefWeeklyNow } from '@/lib/mktAdRefs';

export const maxDuration = 60;
/** #499-6 [주간 분석 지금](관리자): 월요일 자동 분석을 바로 — 지난 7일 새 광고 3개 이상, 이번 주에 이미 했으면 건너뜀 */
export const POST = handler(async ({ user }) => adRefWeeklyNow(user));
