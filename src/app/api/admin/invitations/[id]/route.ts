import { handler, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMenu } from '@/lib/menuPerms';
import { audit } from '@/lib/log';

export const DELETE = handler<{ id: string }>(async ({ req, user, params }) => {
  await requireMenu(user, 'admin_users', 'edit');
  const sql = db();
  await sql`update invitations set revoked_at = now() where id = ${params.id} and accepted_at is null`;
  await audit(sql, user.id, 'user.invite_revoke', 'invitation', params.id, {}, clientIp(req));
  return { ok: true };
});
