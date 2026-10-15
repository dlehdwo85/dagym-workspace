import { handler } from '@/lib/api';
import { viewCounts } from '@/lib/tasks';

/** V14 42번: 업무 보기 칩 건수(내 업무·내가 지시·지연·이번 주·검토 대기) */
export const GET = handler(async ({ req, user }) => viewCounts(user, Object.fromEntries(req.nextUrl.searchParams)));
