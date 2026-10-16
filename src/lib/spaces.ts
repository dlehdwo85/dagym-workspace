import { z } from 'zod';
import { db, type Sql } from './db';
import { isAdmin, requireAdmin } from './access';
import { badRequest, notFound } from './errors';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';

/** V41 단계 1 공간: 업무(지금 화면)·영업(/s/sales)·마케팅(/s/marketing) */
export const SPACES = ['work', 'sales', 'marketing'] as const;
export type Space = (typeof SPACES)[number];
export const isSpace = (s: string): s is Space => (SPACES as readonly string[]).includes(s);

/** 회사가 켠 공간(업무는 늘 켜짐) */
export async function tenantSpaces(tenant: string, sql: Sql = db()): Promise<Space[]> {
  const [t] = await sql<{ spaces: string[] | null }[]>`select spaces from tenants where id = ${tenant}`;
  return SPACES.filter((s) => s === 'work' || (t?.spaces ?? []).includes(s));
}

/** 이 사람이 들어갈 수 있는 공간: 관리자 = 회사가 켠 공간 전부, 직원 = 그중 배정된 공간(업무는 늘) */
export async function userSpaces(u: SessionUser, sql: Sql = db()): Promise<Space[]> {
  const on = await tenantSpaces(tenantOf(u), sql);
  if (isAdmin(u)) return on;
  const [m] = await sql<{ spaces: string[] }[]>`select spaces from space_members where user_id = ${u.id} and tenant = ${tenantOf(u)}`;
  const mine = new Set(m?.spaces ?? ['work']);
  return on.filter((s) => s === 'work' || mine.has(s));
}

/** 공간 밖 사람에게는 없는 화면처럼 404 */
export async function assertSpace(u: SessionUser, space: string, sql: Sql = db()) {
  if (!isSpace(space) || !(await userSpaces(u, sql)).includes(space)) throw notFound('찾을 수 없습니다');
}

/** 관리자 화면: 회사 공간 켜기/끄기 + 사람별 배정 */
export async function spaceSettings(u: SessionUser) {
  requireAdmin(u);
  const sql = db(); const t = tenantOf(u);
  const users = await sql<{ id: string; name: string; role: string; spaces: string[] | null }[]>`
    select u.id, u.name, u.role, m.spaces from users u left join space_members m on m.user_id = u.id and m.tenant = u.tenant
    where u.tenant = ${t} and u.status in ('active', 'invited') and not coalesce(u.is_demo, false) order by u.name`;
  return { enabled: await tenantSpaces(t, sql), users: users.map((x) => ({ id: x.id, name: x.name, role: x.role, admin: ['owner', 'admin'].includes(x.role), spaces: x.spaces ?? ['work'] })) };
}
export const spaceToggleInput = z.object({ space: z.enum(['sales', 'marketing']), on: z.boolean() });
export async function setTenantSpace(u: SessionUser, i: z.infer<typeof spaceToggleInput>, ip: string | null) {
  requireAdmin(u);
  const sql = db(); const t = tenantOf(u);
  if (i.on) await sql`update tenants set spaces = (select array_agg(distinct x) from unnest(spaces || ${[i.space]}::text[]) x) where id = ${t}`;
  else await sql`update tenants set spaces = array_remove(spaces, ${i.space}) where id = ${t}`;
  await audit(sql, u.id, 'space.toggle', 'tenant', null, { space: i.space, on: i.on }, ip);
  return { enabled: await tenantSpaces(t, sql) };
}
export const memberSpacesInput = z.object({ userId: z.string().uuid(), spaces: z.array(z.enum(['sales', 'marketing'])).max(2) });
export async function setMemberSpaces(u: SessionUser, i: z.infer<typeof memberSpacesInput>, ip: string | null) {
  requireAdmin(u);
  const sql = db(); const t = tenantOf(u);
  const [target] = await sql<{ role: string }[]>`select role from users where id = ${i.userId} and tenant = ${t}`;
  if (!target) throw notFound('사용자를 찾을 수 없습니다');
  if (['owner', 'admin'].includes(target.role)) throw badRequest('관리자는 켠 공간을 모두 씁니다');
  const spaces = ['work', ...new Set(i.spaces)];
  await sql`insert into space_members (user_id, tenant, spaces, role) values (${i.userId}, ${t}, ${spaces}, ${target.role})
    on conflict (user_id, tenant) do update set spaces = excluded.spaces, updated_at = now()`;
  await audit(sql, u.id, 'space.member', 'user', i.userId, { spaces }, ip);
  return { spaces };
}
