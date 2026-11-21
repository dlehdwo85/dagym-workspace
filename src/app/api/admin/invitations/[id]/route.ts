import { handler, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMenu } from '@/lib/menuPerms';
import { audit } from '@/lib/log';
import { homeTenants } from '@/lib/admin';
import { isUuid } from '@/lib/access';
import { notFound } from '@/lib/errors';

export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => {
  await requireMenu(user, 'admin_users', 'edit');
  if (!isUuid(params.id)) throw notFound('초대를 찾을 수 없습니다'); // 모양이 틀린 주소 값 → 500 대신 404
  const sql = db();
  await sql`update invitations set revoked_at = now() where id = ${params.id} and accepted_at is null and user_id in (select id from users where tenant = any(${homeTenants(user)}))`;
  await audit(sql, user.id, 'user.invite_revoke', 'invitation', params.id, {}, clientIp(req));
  return { ok: true };
});
