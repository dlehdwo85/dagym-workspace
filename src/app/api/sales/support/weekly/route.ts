import { handler } from '@/lib/api';
import { sendWeeklyManual } from '@/lib/sales/support';

/** #568 [이번 주 묶음 지금 만들기](관리자) — 1차 ✅ 공고 자동 AI 판단 + 맞는 공고 묶음(알림은 주마다 한 번) */
export const POST = handler(async ({ user }) => sendWeeklyManual(user));
