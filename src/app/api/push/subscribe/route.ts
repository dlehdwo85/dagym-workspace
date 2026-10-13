import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';

const schema = z.object({
  kind: z.enum(['webpush', 'fcm']),
  endpoint: z.string().min(10).max(4000),
  keys: z.object({ p256dh: z.string(), auth: z.string() }).optional(),
  platform: z.string().max(30).optional(),
  /** 이 기기가 미리 알림(일정·업무·브리핑)을 직접 예약함 → 서버 푸시 생략 */
  localReminders: z.boolean().optional(),
});

/** 같은 기기 토큰이 다른 계정에 남아 있으면 현재 사용자로 옮긴다 (공용 기기 로그인 전환 대응) */
export const POST = handler(async ({ req, user }) => {
  const i = await body(req, schema);
  const sql = db();
  const [r] = await sql<{ id: string }[]>`insert into push_subscriptions (user_id, kind, endpoint, keys, platform, local_reminders)
    values (${user.id}, ${i.kind}, ${i.endpoint}, ${i.keys ? sql.json(i.keys) : null}, ${i.platform ?? null}, ${i.localReminders ?? false})
    on conflict (endpoint) do update set user_id = excluded.user_id, kind = excluded.kind, keys = excluded.keys,
      platform = excluded.platform, disabled_at = null, fail_count = 0, local_reminders = excluded.local_reminders
    returning id`;
  return { id: r.id };
});

export const DELETE = handler(async ({ req, user }) => {
  const i = await body(req, z.object({ endpoint: z.string() }));
  await db()`update push_subscriptions set disabled_at = now() where user_id = ${user.id} and endpoint = ${i.endpoint}`;
  return { ok: true };
});
