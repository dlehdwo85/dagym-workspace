import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { requirePlatformOps } from '@/lib/menuPerms';

export const GET = handler(async ({ req, user }) => {
  await requirePlatformOps(user, 'view'); // 범용화 S-02: 감사 기록은 모든 회사 기록이 한 표 — 기본 회사 전용(다른 회사 404)
  const before = req.nextUrl.searchParams.get('before');
  const logs = await db()`select a.id, a.action, a.target_type, a.target_id, a.detail, a.ip, a.created_at, u.name as actor_name
    from audit_logs a left join users u on u.id = a.actor_id
    where ${before ? db()`a.id < ${Number(before)}` : db()`true`} order by a.id desc limit 100`;
  return { logs };
});
