import { handler } from '@/lib/api';
import { sheet } from '@/lib/attendance';

/** 관리자: ?day=YYYY-MM-DD 하루 표 · ?month=YYYY-MM 월 요약 */
export const GET = handler(async ({ req, user }) => sheet(user, { day: req.nextUrl.searchParams.get('day') ?? undefined, month: req.nextUrl.searchParams.get('month') ?? undefined }));
