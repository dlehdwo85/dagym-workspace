import { handler, body, clientIp } from '@/lib/api';
import { clock, clockInput, myToday } from '@/lib/attendance';

/** V30 ③ 출퇴근: 오늘 내 기록 · [출근]/[퇴근] (위치는 동의한 사람만, 그 순간만) */
export const GET = handler(async ({ user }) => myToday(user));
export const POST = handler(async ({ req, user }) => clock(user, await body(req, clockInput), clientIp(req)), { idempotent: true });
