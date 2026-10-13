import { handler } from '@/lib/api';
import { upcomingReminders } from '@/lib/reminders';

/** 휴대폰 예약 알림: 앞으로 7일(최대 14) 동안 받을 미리 알림 — 앱이 기기에 직접 예약한다 */
export const GET = handler(async ({ req, user }) => {
  const days = Math.min(14, Math.max(1, Number(req.nextUrl.searchParams.get('days') ?? 7) || 7));
  return { reminders: await upcomingReminders(user, days), generatedAt: new Date().toISOString() };
});
