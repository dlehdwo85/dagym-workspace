import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { notify } from '@/lib/notifications';
import { dispatchPending } from '@/lib/push';

/** 내 기기로 시험 알림 발송 (설정 화면) */
export const POST = handler(async ({ user }) => {
  const sql = db();
  const ids = await notify(sql, { userIds: [user.id], type: 'comment', title: '시험 알림', body: '알림이 정상적으로 도착했습니다.',
    link: '/notifications', dedupeKey: `test:${Date.now()}`, actorId: null });
  const result = await dispatchPending();
  const deliveries = ids.length ? await sql`select channel, status, error from notification_deliveries where notification_id = ${ids[0]}` : [];
  return { result, deliveries };
});
