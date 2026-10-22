import { handler } from '@/lib/api';
import { autoOverview } from '@/lib/revenueAuto';

/** #161 매출 화면 위: 확인 대기 자료(읽은 값 vs 지금 값)·분석 대기열·보고서 이력. 매출 권한 없으면 404 */
export const GET = handler(async ({ user }) => autoOverview(user));
