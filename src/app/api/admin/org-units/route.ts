import { handler, body, clientIp } from '@/lib/api';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/access';
import { createOrgUnit, orgUnitInput } from '@/lib/admin';

export const GET = handler(async ({ user }) => {
  requireAdmin(user);
  const units = await db()`select o.*, (select count(*)::int from memberships m join users u on u.id = m.user_id
    where m.org_unit_id = o.id and u.status = 'active') as member_count from org_units o order by o.sort, o.name`;
  return { units };
});

export const POST = handler(async ({ req, user }) => createOrgUnit(user, await body(req, orgUnitInput), clientIp(req)));
