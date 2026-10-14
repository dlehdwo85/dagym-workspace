import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMenu } from '@/lib/menuPerms';

export const GET = handler(async ({ req, user }) => {
  await requireMenu(user, 'ops', 'view');
  const before = req.nextUrl.searchParams.get('before');
  const logs = await db()`select a.id, a.action, a.target_type, a.target_id, a.detail, a.ip, a.created_at, u.name as actor_name
    from audit_logs a left join users u on u.id = a.actor_id
    where ${before ? db()`a.id < ${Number(before)}` : db()`true`} order by a.id desc limit 100`;
  return { logs };
});
