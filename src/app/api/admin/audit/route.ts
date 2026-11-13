import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { requireCompanyAudit } from '@/lib/menuPerms';
import { tenantOf } from '@/lib/types';

export const GET = handler(async ({ req, user }) => {
  await requireCompanyAudit(user); // 407차(대표 11/14 '가안'): 회사마다 자기 회사 기록만 — 다른 회사 기록·플랫폼 운영 행위는 플랫폼 운영 화면(/api/platform/audit)에서만
  const t = tenantOf(user);
  const before = req.nextUrl.searchParams.get('before');
  const logs = await db()`select a.id, a.action, a.target_type, a.target_id, a.detail, a.ip, a.created_at, u.name as actor_name
    from audit_logs a left join users u on u.id = a.actor_id
    where a.tenant = ${t} and ${before ? db()`a.id < ${Number(before)}` : db()`true`} order by a.id desc limit 100`;
  return { logs };
});
