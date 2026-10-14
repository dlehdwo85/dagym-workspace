import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { unreadCount } from '@/lib/notifications';

export const GET = handler(async ({ user }) => {
  const sql = db();
  const units = await sql`select o.id, o.name, o.type, o.brand_id from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = ${user.id}`;
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant: user.tenant, personal: !!user.personal }, orgUnits: units, unread: await unreadCount(user.id) };
});
