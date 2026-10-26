import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { unreadCount } from '@/lib/notifications';
import { captureFor } from '@/lib/capturePolicy';

export const GET = handler(async ({ user }) => {
  const sql = db();
  const units = await sql`select o.id, o.name, o.type, o.brand_id from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = ${user.id}`;
  const capture = await captureFor(user, sql); // #626 캡처 차단 정책 — 앱이 네이티브 차단(FLAG_SECURE)·안내에 쓴다
  return { user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant: user.tenant, personal: !!user.personal }, orgUnits: units, unread: await unreadCount(user.id), capture };
});
