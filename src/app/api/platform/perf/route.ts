import { handler } from '@/lib/api';
import { perfOverview } from '@/lib/perf';

/** #948 플랫폼 운영 › 속도: 핵심 API 검침(최근 7일)·실제 화면 표시 시간(웹·앱 p75)·느린 곳 상위 5·최근 알림 — 슈퍼관리자만 */
export const GET = handler(async ({ user, req }) => perfOverview(user, Number(req.nextUrl.searchParams.get('days') ?? 7)));
