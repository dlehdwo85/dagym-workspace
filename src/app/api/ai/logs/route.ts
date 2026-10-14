import { handler } from '@/lib/api';
import { logList } from '@/lib/ai/threads';

/** V14 6번: 회사 AI 사용 내역 (메뉴 권한 "AI 사용 내역" 조회) */
export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  return logList(user, { userId: p.get('userId') || undefined, q: p.get('q')?.trim() || undefined });
});
