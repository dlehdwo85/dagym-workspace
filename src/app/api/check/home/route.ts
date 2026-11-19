import { handler } from '@/lib/api';
import { checkHome } from '@/lib/check/rounds';

/** 점검 홈: 이어서 할 점검 · 최근 점검 · 보완 요청 수(진행·확인 대기) · 외부 연락 대기 · 개선 과제 */
export const GET = handler(async ({ user }) => checkHome(user));
