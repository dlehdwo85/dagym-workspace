import { handler } from '@/lib/api';
import { listThreads } from '@/lib/ai/threads';

/** V14 2번: 내 AI 대화 목록(검색·업무별) */
export const GET = handler(async ({ req, user }) => {
  const p = req.nextUrl.searchParams;
  return listThreads(user, { q: p.get('q')?.trim() || undefined, taskId: p.get('taskId') || undefined });
});
