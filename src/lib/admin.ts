import { z } from 'zod';
import { db, type Sql } from './db';
import { requireAdmin, ensurePersonalCalendar, accessibleUnitIds, isAdmin } from './access';
import { revokeAllSessions } from './auth';
import { newToken, sha256, hashPassword } from './crypto';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { audit } from './log';
import { ROLE_RANK, type Role, type SessionUser } from './types';
import { zUuid } from './api';

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email('이메일 형식이 아닙니다'),
  name: z.string().trim().min(1).max(50),
  role: z.enum(['owner', 'admin', 'dept_lead', 'site_manager', 'staff']),
  orgUnitIds: z.array(zUuid).max(20).default([]),
  title: z.string().max(50).optional(),
});

function assertCanGrant(actor: SessionUser, role: Role) {
  if (role === 'owner' && actor.role !== 'owner') throw forbidden('대표 권한은 대표만 부여할 수 있습니다');
  if (ROLE_RANK[role] > ROLE_RANK[actor.role]) throw forbidden('본인보다 높은 권한은 부여할 수 없습니다');
}

export async function inviteUser(actor: SessionUser, i: z.infer<typeof inviteInput>, ip: string | null) {
  requireAdmin(actor);
  assertCanGrant(actor, i.role);
  const sql = db();
  if (i.role !== 'owner' && i.role !== 'admin' && i.orgUnitIds.length === 0) throw badRequest('소속 조직을 1개 이상 선택하세요');
  const existing = await sql<{ id: string; status: string }[]>`select id, status from users where lower(email) = ${i.email}`;
  if (existing[0] && existing[0].status === 'active') throw conflict('이미 활성 사용자입니다');
  const units = i.orgUnitIds.length ? await sql`select id from org_units where id = any(${i.orgUnitIds}::uuid[])` : [];
  if (units.length !== i.orgUnitIds.length) throw badRequest('없는 조직이 포함되어 있습니다');
  const token = newToken();
  return sql.begin(async (tx) => {
    let userId = existing[0]?.id;
    if (!userId) {
      const [u] = await tx<{ id: string }[]>`
        insert into users (email, name, role, status, title) values (${i.email}, ${i.name}, ${i.role}, 'invited', ${i.title ?? null}) returning id`;
      userId = u.id;
    } else {
      await tx`update users set name = ${i.name}, role = ${i.role}, title = ${i.title ?? null}, updated_at = now() where id = ${userId}`;
    }
    await tx`update invitations set revoked_at = now() where user_id = ${userId} and accepted_at is null and revoked_at is null`;
    const [inv] = await tx<{ id: string }[]>`
      insert into invitations (email, name, role, org_unit_ids, token_hash, invited_by, user_id, expires_at)
      values (${i.email}, ${i.name}, ${i.role}, ${i.orgUnitIds}, ${sha256(token)}, ${actor.id}, ${userId}, now() + interval '7 days')
      returning id`;
    await tx`delete from memberships where user_id = ${userId}`;
    for (const o of i.orgUnitIds) await tx`insert into memberships (user_id, org_unit_id) values (${userId}, ${o})`;
    await audit(tx, actor.id, 'user.invite', 'user', userId, { email: i.email, role: i.role, orgUnitIds: i.orgUnitIds }, ip);
    return { invitationId: inv.id, userId, token, path: `/invite/${token}` };
  });
}

export async function invitationInfo(token: string) {
  const [inv] = await db()`
    select i.email, i.name, i.role, i.expires_at, i.accepted_at, i.revoked_at, u.name as invited_by_name
    from invitations i join users u on u.id = i.invited_by where i.token_hash = ${sha256(token)}`;
  if (!inv) throw notFound('초대 링크가 올바르지 않습니다');
  if (inv.revoked_at) throw badRequest('취소된 초대입니다. 관리자에게 다시 요청하세요.');
  if (inv.accepted_at) throw badRequest('이미 사용된 초대입니다. 로그인해 주세요.');
  if (new Date(inv.expires_at) < new Date()) throw badRequest('만료된 초대입니다. 관리자에게 다시 요청하세요.');
  return inv;
}

export async function acceptInvitation(token: string, password: string) {
  if (password.length < 8) throw badRequest('비밀번호는 8자 이상이어야 합니다');
  const sql = db();
  return sql.begin(async (tx) => {
    const [inv] = await tx`select * from invitations where token_hash = ${sha256(token)} for update`;
    if (!inv || inv.revoked_at || inv.accepted_at || new Date(inv.expires_at) < new Date()) throw badRequest('사용할 수 없는 초대 링크입니다');
    const [u] = await tx<{ id: string; status: string; name: string }[]>`select id, status, name from users where id = ${inv.user_id}`;
    if (!u || (u.status !== 'invited' && u.status !== 'active')) throw forbidden('비활성화된 계정입니다. 관리자에게 문의하세요.');
    await tx`update users set password_hash = ${await hashPassword(password)}, status = 'active', updated_at = now() where id = ${u.id}`;
    await tx`update invitations set accepted_at = now() where id = ${inv.id}`;
    await ensurePersonalCalendar(u.id, u.name, tx);
    await audit(tx, u.id, 'user.accept_invite', 'user', u.id, {});
    return { userId: u.id };
  });
}

export const userPatch = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  title: z.string().max(50).nullable().optional(),
  role: z.enum(['owner', 'admin', 'dept_lead', 'site_manager', 'staff']).optional(),
  status: z.enum(['active', 'disabled', 'left']).optional(),
  orgUnitIds: z.array(zUuid).max(20).optional(),
});

export async function updateUser(actor: SessionUser, id: string, p: z.infer<typeof userPatch>, ip: string | null) {
  requireAdmin(actor);
  const sql = db();
  return sql.begin(async (tx) => {
    const [cur] = await tx<{ id: string; role: Role; status: string; email: string }[]>`select id, role, status, email from users where id = ${id} for update`;
    if (!cur) throw notFound('사용자가 없습니다');
    if (cur.role === 'owner' && actor.role !== 'owner') throw forbidden('대표 계정은 대표만 변경할 수 있습니다');
    if (p.role) assertCanGrant(actor, p.role);
    if (id === actor.id && (p.status && p.status !== 'active')) throw badRequest('본인 계정은 비활성화할 수 없습니다');
    if (id === actor.id && p.role && p.role !== actor.role) throw badRequest('본인 권한은 바꿀 수 없습니다');
    if (cur.role === 'owner' && (p.role && p.role !== 'owner' || p.status && p.status !== 'active')) {
      const owners = await tx`select 1 from users where role = 'owner' and status = 'active' and id <> ${id}`;
      if (!owners.length) throw badRequest('마지막 대표 계정은 변경할 수 없습니다');
    }
    const set: Record<string, unknown> = {};
    if (p.name !== undefined) set.name = p.name;
    if (p.title !== undefined) set.title = p.title;
    if (p.role !== undefined) set.role = p.role;
    if (p.status !== undefined) {
      if (p.status === 'active' && cur.status === 'invited') throw badRequest('초대 수락 전 사용자는 활성화할 수 없습니다');
      set.status = p.status;
    }
    if (Object.keys(set).length) {
      set.updated_at = new Date();
      await tx`update users set ${tx(set as never, ...(Object.keys(set) as never[]))} where id = ${id}`;
    }
    if (p.orgUnitIds) {
      await tx`delete from memberships where user_id = ${id}`;
      for (const o of new Set(p.orgUnitIds)) await tx`insert into memberships (user_id, org_unit_id) values (${id}, ${o})`;
    }
    // 비활성·퇴사·권한 변경 시 기존 세션 즉시 차단
    if ((p.status && p.status !== 'active') || p.role || p.orgUnitIds) {
      if (p.status && p.status !== 'active') {
        await tx`update sessions set revoked_at = now() where user_id = ${id} and revoked_at is null`;
        await tx`update push_subscriptions set disabled_at = now() where user_id = ${id} and disabled_at is null`;
        await tx`update invitations set revoked_at = now() where user_id = ${id} and accepted_at is null and revoked_at is null`;
        await tx`update google_calendar_links set status = 'paused' where user_id = ${id}`;
      }
    }
    await audit(tx, actor.id, 'user.update', 'user', id, { before: { role: cur.role, status: cur.status }, change: p }, ip);
    return { ok: true };
  });
}

export async function createPasswordReset(actor: SessionUser, userId: string, ip: string | null) {
  requireAdmin(actor);
  const sql = db();
  const [u] = await sql<{ status: string; role: Role }[]>`select status, role from users where id = ${userId}`;
  if (!u || u.status !== 'active') throw badRequest('활성 사용자만 비밀번호를 재설정할 수 있습니다');
  if (u.role === 'owner' && actor.role !== 'owner') throw forbidden('대표 계정은 대표만 재설정할 수 있습니다');
  const token = newToken();
  await sql`insert into password_resets (token_hash, user_id, created_by, expires_at) values (${sha256(token)}, ${userId}, ${actor.id}, now() + interval '24 hours')`;
  await audit(sql, actor.id, 'user.password_reset_link', 'user', userId, {}, ip);
  return { path: `/reset/${token}` };
}

export async function usePasswordReset(token: string, password: string) {
  if (password.length < 8) throw badRequest('비밀번호는 8자 이상이어야 합니다');
  const sql = db();
  return sql.begin(async (tx) => {
    const [r] = await tx`select * from password_resets where token_hash = ${sha256(token)} for update`;
    if (!r || r.used_at || new Date(r.expires_at) < new Date()) throw badRequest('사용할 수 없는 링크입니다');
    await tx`update users set password_hash = ${await hashPassword(password)}, updated_at = now() where id = ${r.user_id} and status = 'active'`;
    await tx`update password_resets set used_at = now() where token_hash = ${r.token_hash}`;
    await tx`update sessions set revoked_at = now() where user_id = ${r.user_id} and revoked_at is null`;
    await audit(tx, r.user_id, 'user.password_reset', 'user', r.user_id, {});
    return { ok: true };
  });
}

export const orgUnitInput = z.object({
  name: z.string().trim().min(1).max(60),
  type: z.enum(['hq', 'department', 'branch', 'site']),
  parentId: zUuid.nullable().optional(),
  brandId: z.enum(['dagym', 'hilink', 'bodylab']).nullable().optional(),
  active: z.boolean().optional(),
  sort: z.number().int().optional(),
});

export async function createOrgUnit(actor: SessionUser, i: z.infer<typeof orgUnitInput>, ip: string | null) {
  requireAdmin(actor);
  const sql = db();
  return sql.begin(async (tx) => {
    const [o] = await tx<{ id: string }[]>`
      insert into org_units (parent_id, brand_id, type, name, sort) values (${i.parentId ?? null}, ${i.brandId ?? null}, ${i.type}, ${i.name}, ${i.sort ?? 0})
      returning id`;
    await tx`insert into calendars (type, org_unit_id, name, color) values ('org_unit', ${o.id}, ${i.name + ' 일정'},
      ${i.brandId === 'dagym' ? '#ea580c' : i.brandId === 'hilink' ? '#2563eb' : i.brandId === 'bodylab' ? '#059669' : '#475569'})`;
    await audit(tx, actor.id, 'org.create', 'org_unit', o.id, i, ip);
    return { id: o.id };
  });
}

export async function updateOrgUnit(actor: SessionUser, id: string, i: Partial<z.infer<typeof orgUnitInput>>, ip: string | null) {
  requireAdmin(actor);
  const sql = db();
  if (i.parentId === id) throw badRequest('자기 자신을 상위 조직으로 지정할 수 없습니다');
  if (i.parentId) {
    const cyc = await sql`with recursive d as (select id from org_units where id = ${id} union select c.id from org_units c join d on c.parent_id = d.id)
      select 1 from d where id = ${i.parentId}`;
    if (cyc.length) throw badRequest('하위 조직 아래로 옮길 수 없습니다');
  }
  const set: Record<string, unknown> = {};
  if (i.name !== undefined) set.name = i.name;
  if (i.type !== undefined) set.type = i.type;
  if (i.parentId !== undefined) set.parent_id = i.parentId;
  if (i.brandId !== undefined) set.brand_id = i.brandId;
  if (i.active !== undefined) set.active = i.active;
  if (i.sort !== undefined) set.sort = i.sort;
  if (!Object.keys(set).length) return { ok: true };
  await sql.begin(async (tx) => {
    await tx`update org_units set ${tx(set as never, ...(Object.keys(set) as never[]))} where id = ${id}`;
    if (i.name) await tx`update calendars set name = ${i.name + ' 일정'} where org_unit_id = ${id}`;
    await audit(tx, actor.id, 'org.update', 'org_unit', id, i, ip);
  });
  return { ok: true };
}

/** 조직·사용자 디렉터리 (배정 후보). 관리자는 전체, 그 외는 접근 가능한 조직의 구성원 + 관리자 */
export async function directory(u: SessionUser, sql: Sql = db()) {
  const units = await accessibleUnitIds(u, sql);
  const orgUnits = await sql`select id, parent_id, brand_id, type, name, active, sort from org_units
    where ${units === null ? sql`not is_demo` : sql`id = any(${units}::uuid[])`} order by sort, name`;
  const users = await sql`
    select u.id, u.name, u.title, u.role, u.email,
      coalesce(array_agg(m.org_unit_id) filter (where m.org_unit_id is not null), '{}') as org_unit_ids
    from users u left join memberships m on m.user_id = u.id
    where u.status = 'active' and u.is_demo = ${!!u.isDemo} and (${units === null ? sql`true` : sql`
      (u.role in ('owner','admin') and ${!u.isDemo}) or exists (select 1 from memberships mm where mm.user_id = u.id and mm.org_unit_id = any(${units}::uuid[]))`})
    group by u.id order by u.name`;
  const brands = await sql`select id, name, color from brands order by sort`;
  return { brands, orgUnits, users, accessibleUnitIds: units, isAdmin: isAdmin(u) };
}
