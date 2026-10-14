import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { requireAnyMenu } from '@/lib/menuPerms';
import { createOrgUnit, homeTenants, orgUnitInput } from '@/lib/admin';

export const GET = handler(async ({ user }) => {
  await requireAnyMenu(user, ['ops', 'admin_users'], 'view');
  const units = await db()`select o.*, (select count(*)::int from memberships m join users u on u.id = m.user_id
    where m.org_unit_id = o.id and u.status = 'active') as member_count from org_units o where o.tenant = any(${homeTenants(user)}) order by o.sort, o.name`;
  return { units };
});

export const POST = handler(async ({ req, user }) => createOrgUnit(user, await body(req, orgUnitInput), clientIp(req)));
