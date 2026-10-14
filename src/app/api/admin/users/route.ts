import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMenu } from '@/lib/menuPerms';
import { homeTenants, inviteInput, inviteUser } from '@/lib/admin';

export const GET = handler(async ({ user }) => {
  await requireMenu(user, 'admin_users', 'view');
  const sql = db();
  const users = await sql`
    select u.id, u.email, u.name, u.title, u.title_short, u.role, u.status, u.last_login_at, u.created_at, u.is_demo,
      coalesce(array_agg(m.org_unit_id) filter (where m.org_unit_id is not null), '{}') as org_unit_ids,
      (select count(*)::int from sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as active_sessions,
      (select max(i.expires_at) from invitations i where i.user_id = u.id and i.accepted_at is null and i.revoked_at is null) as invite_expires_at
    from users u left join memberships m on m.user_id = u.id
    where u.tenant = any(${homeTenants(user)})
    group by u.id order by u.status = 'active' desc, u.name`;
  return { users };
});

export const POST = handler(async ({ req, user }) => {
  const i = await body(req, inviteInput);
  return inviteUser(user, i, clientIp(req));
});
