import { handler } from '@/lib/api';
import { logList, topicBlocked } from '@/lib/ai/threads';

/** V14 6번: 회사 AI 사용 내역 (메뉴 권한 "AI 사용 내역" 조회) */
export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  // 381차 #1002: 업무 밖 거름에 걸린 질문(최근 30일, 이름 없이) — 허용 낱말로 기준을 고칠 수 있게
  const [list, topic] = await Promise.all([logList(user, { userId: p.get('userId') || undefined, q: p.get('q')?.trim() || undefined }), topicBlocked(user)]);
  return { ...list, topicBlocked: topic };
});
