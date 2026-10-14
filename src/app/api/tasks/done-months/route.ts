import { handler } from '@/lib/api';
import { doneMonths } from '@/lib/tasks';

/** V20 완료 보관: 볼 수 있는 완료 업무의 달별 개수(펼칠 때 그 달만 불러온다) */
export const GET = handler(async ({ req, user }) => doneMonths(user, Object.fromEntries(req.nextUrl.searchParams)));
