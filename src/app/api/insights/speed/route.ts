import { handler } from '@/lib/api';
import { speedStats } from '@/lib/insights';

/** R-15 4번 직원별 업무 처리 속도 (볼 수 있는 업무 기준) */
export const GET = handler(async ({ req, user }) => {
  const id = req.nextUrl.searchParams.get('userId');
  return { people: await speedStats(user, id && /^[0-9a-f-]{36}$/.test(id) ? [id] : undefined) };
});
