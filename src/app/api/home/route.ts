import { handler } from '@/lib/api';
import { homeSummary } from '@/lib/homeSummary';

/** #1110 홈 요약 한 번에 — 오늘 처리할 것 숫자 칸 · 회사 현황(대표·관리자) · 공지 2개 */
export const GET = handler(async ({ user }) => homeSummary(user));
