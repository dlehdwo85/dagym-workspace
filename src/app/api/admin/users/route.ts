import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { requireMenu } from '@/lib/menuPerms';
import { homeTenants, inviteInput, inviteUser } from '@/lib/admin';

export const GET = handler(async ({ user }) => {
  await requireMenu(user, 'admin_users', 'view');
  const sql = db();
  const users = await sql`
    select u.id, u.email, u.name, u.title, u.title_short, u.role, u.status, u.last_login_at, u.created_at, u.is_demo, u.left_at::text as left_at, u.rejoin_until::text as rejoin_until, u.handover_to,
      coalesce(array_agg(m.org_unit_id) filter (where m.org_unit_id is not null), '{}') as org_unit_ids,
      (select count(*)::int from sessions s where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()) as active_sessions,
      (select max(i.expires_at) from invitations i where i.user_id = u.id and i.accepted_at is null and i.revoked_at is null) as invite_expires_at,
      (select coalesce(json_agg(json_build_object('id', t.id, 'name', t.name, 'path', tp.path, 'primary', tm.is_primary, 'lead', tm.is_lead) order by tm.is_primary desc, tp.path), '[]')
        from team_members tm join teams t on t.id = tm.team_id and not t.archived
        join lateral (with recursive up as (select t.id, t.parent_id, t.name::text as path union all select p.id, p.parent_id, p.name || ' › ' || up.path from teams p join up on p.id = up.parent_id)
          select path from up where parent_id is null limit 1) tp on true
        where tm.user_id = u.id) as teams
    from users u left join memberships m on m.user_id = u.id
    where u.tenant = any(${homeTenants(user)})
    group by u.id order by u.status = 'active' desc, u.name`;
  return { users };
});

export const POST = handler(async ({ req, user }) => {
  const i = await body(req, inviteInput);
  return inviteUser(user, i, clientIp(req));
});
