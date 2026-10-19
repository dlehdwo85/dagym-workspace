import { z } from 'zod';
import { db, type Sql } from './db';
import { ensurePersonalCalendar, accessibleUnitIds, isAdmin, teamScope } from './access';
import { revokeAllSessions } from './auth';
import { newToken, sha256, hashPassword } from './crypto';
import { badRequest, conflict, forbidden, notFound } from './errors';
import { audit } from './log';
import { tenantOf, ROLE_RANK, type Role, type SessionUser } from './types';
import { zUuid } from './api';

export const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email('이메일 형식이 아닙니다'),
  name: z.string().trim().min(1).max(50),
  role: z.enum(['owner', 'admin', 'dept_lead', 'site_manager', 'staff']),
  orgUnitIds: z.array(zUuid).max(20).default([]),
  title: z.string().max(50).optional(),
  /** 로컬 10/19: 초대하면서 부서·팀에 넣기 + 공간(비우면 그 부서·팀의 기본 공간) */
  teamIds: z.array(zUuid).max(10).default([]),
  spaces: z.array(z.enum(['work', 'sales', 'marketing'])).max(3).optional(),
});

function assertCanGrant(actor: SessionUser, role: Role) {
  if (role === 'owner' && actor.role !== 'owner') throw forbidden('대표 권한은 대표만 부여할 수 있습니다');
  if (ROLE_RANK[role] > ROLE_RANK[actor.role]) throw forbidden('본인보다 높은 권한은 부여할 수 없습니다');
}

export async function inviteUser(actor: SessionUser, i: z.infer<typeof inviteInput>, ip: string | null) {
  await (await import('./menuPerms')).requireMenu(actor, 'admin_users', 'edit');
  assertCanGrant(actor, i.role);
  const sql = db();
  if (i.role !== 'owner' && i.role !== 'admin' && i.orgUnitIds.length === 0) throw badRequest('소속 조직을 1개 이상 선택하세요');
  const existing = await sql<{ id: string; status: string }[]>`select id, status from users where lower(email) = ${i.email}`;
  if (existing[0] && existing[0].status === 'active') throw conflict('이미 활성 사용자입니다');
  const tn = tenantOf(actor);
  if (existing[0]) { const [et] = await sql<{ tenant: string }[]>`select tenant from users where id = ${existing[0].id}`; if (!homeTenants(actor).includes(et.tenant)) throw conflict('이미 다른 곳에서 쓰는 이메일입니다'); }
  const units = i.orgUnitIds.length ? await sql`select id from org_units where id = any(${i.orgUnitIds}::uuid[]) and tenant = any(${homeTenants(actor)})` : [];
  if (units.length !== i.orgUnitIds.length) throw badRequest('없는 조직이 포함되어 있습니다');
  // V10 요금제 사용자 수 (이미 초대 중인 사람을 다시 초대하는 건 셈하지 않음)
  if (existing[0]?.status !== 'invited') {
    const demoOnly = i.role !== 'owner' && i.role !== 'admin' && i.orgUnitIds.length > 0
      && (await sql`select 1 from org_units where id = any(${i.orgUnitIds}::uuid[]) and not is_demo`).length === 0;
    await (await import('./plans')).assertSeat(demoOnly ? 'demo' : tn, sql);
  }
  const token = newToken();
  return sql.begin(async (tx) => {
    let userId = existing[0]?.id;
    if (!userId) {
      const [u] = await tx<{ id: string }[]>`
        insert into users (email, name, role, status, title, tenant) values (${i.email}, ${i.name}, ${i.role}, 'invited', ${i.title ?? null}, ${tn}) returning id`;
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
    // 부서·팀 소속(팀원으로) + 팀 대화방 + 공간(초대 때 고른 것, 없으면 부서·팀 기본 공간의 합)
    const teamIds = i.teamIds ?? []; // 심사용 계정처럼 코드에서 바로 부르는 경우(zod 기본값 없음)
    if (teamIds.length) {
      const teams = await tx<{ id: string; default_spaces: string[] }[]>`select id, default_spaces from teams where id = any(${teamIds}::uuid[]) and tenant = ${tn} and not archived`;
      if (teams.length !== new Set(teamIds).size) throw badRequest('없는 부서·팀이 포함되어 있습니다');
      for (const t of teams) {
        await tx`insert into team_members (team_id, user_id, is_lead) values (${t.id}, ${userId}, false) on conflict (team_id, user_id) do nothing`;
        await tx`insert into chat_members (room_id, user_id) select id, ${userId} from chat_rooms where team_id = ${t.id} on conflict do nothing`;
      }
      const spaces = i.spaces ?? [...new Set(teams.flatMap((t) => t.default_spaces))];
      if (spaces.length) await tx`insert into space_members (user_id, tenant, spaces, role) values (${userId}, ${tn}, ${spaces}, ${i.role}) on conflict (user_id, tenant) do update set spaces = excluded.spaces, updated_at = now()`;
    } else if (i.spaces?.length) {
      await tx`insert into space_members (user_id, tenant, spaces, role) values (${userId}, ${tn}, ${i.spaces}, ${i.role}) on conflict (user_id, tenant) do update set spaces = excluded.spaces, updated_at = now()`;
    }
    await syncDemoFlag(tx, [userId]);
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
  titleShort: z.string().trim().max(12).nullable().optional(),
  role: z.enum(['owner', 'admin', 'dept_lead', 'site_manager', 'staff']).optional(),
  status: z.enum(['active', 'disabled', 'left']).optional(),
  orgUnitIds: z.array(zUuid).max(20).optional(),
});

export async function updateUser(actor: SessionUser, id: string, p: z.infer<typeof userPatch>, ip: string | null) {
  await (await import('./menuPerms')).requireMenu(actor, 'admin_users', 'edit');
  const sql = db();
  await assertHomeUser(actor, id, sql);
  if (p.orgUnitIds?.length && (await sql`select id from org_units where id = any(${p.orgUnitIds}::uuid[]) and tenant = any(${homeTenants(actor)})`).length !== new Set(p.orgUnitIds).size) throw badRequest('없는 조직이 포함되어 있습니다');
  return sql.begin(async (tx) => {
    const [cur] = await tx<{ id: string; role: Role; status: string; email: string }[]>`select id, role, status, email from users where id = ${id} for update`;
    if (!cur) throw notFound('사용자가 없습니다');
    if (cur.role === 'owner' && actor.role !== 'owner') throw forbidden('대표 계정은 대표만 변경할 수 있습니다');
    if (p.role) assertCanGrant(actor, p.role);
    if (id === actor.id && (p.status && p.status !== 'active')) throw badRequest('본인 계정은 비활성화할 수 없습니다');
    if (id === actor.id && p.role && p.role !== actor.role) throw badRequest('본인 권한은 바꿀 수 없습니다');
    if (cur.role === 'owner' && (p.role && p.role !== 'owner' || p.status && p.status !== 'active')) {
      const owners = await tx`select 1 from users where role = 'owner' and status = 'active' and id <> ${id} and tenant = ${tenantOf(actor)}`;
      if (!owners.length) throw badRequest('마지막 대표 계정은 변경할 수 없습니다');
    }
    const set: Record<string, unknown> = {};
    if (p.name !== undefined) set.name = p.name;
    if (p.title !== undefined) set.title = p.title;
    if (p.titleShort !== undefined) set.title_short = p.titleShort || null;
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
    if (p.orgUnitIds || p.role) await syncDemoFlag(tx, [id]);
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
  await (await import('./menuPerms')).requireMenu(actor, 'admin_users', 'edit');
  const sql = db();
  await assertHomeUser(actor, userId, sql);
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
  /** 앱 심사용 격리 조직: 최상위만. 소속 직원은 이 조직 밖을 전혀 볼 수 없고, 대표·본사 화면에도 섞이지 않는다 */
  isDemo: z.boolean().optional(),
});

export async function createOrgUnit(actor: SessionUser, i: z.infer<typeof orgUnitInput>, ip: string | null) {
  await (await import('./menuPerms')).requireMenu(actor, 'ops', 'edit');
  const sql = db();
  if (i.isDemo && i.parentId) throw badRequest('앱 심사용 격리 조직은 최상위(상위 조직 없음)로만 만들 수 있습니다');
  if (i.isDemo && tenantOf(actor) !== 'default') throw badRequest('격리 조직은 만들 수 없습니다');
  if (i.parentId) await assertHomeUnit(actor, i.parentId, sql);
  const tn = i.isDemo ? 'demo' : tenantOf(actor);
  return sql.begin(async (tx) => {
    const [o] = await tx<{ id: string }[]>`
      insert into org_units (parent_id, brand_id, type, name, sort, is_demo, tenant) values (${i.parentId ?? null}, ${i.brandId ?? null}, ${i.type}, ${i.name}, ${i.sort ?? 0}, ${!!i.isDemo}, ${tn})
      returning id`;
    await tx`insert into calendars (type, org_unit_id, name, color) values ('org_unit', ${o.id}, ${i.name + ' 일정'},
      ${i.brandId === 'dagym' ? '#ea580c' : i.brandId === 'hilink' ? '#2563eb' : i.brandId === 'bodylab' ? '#16a34a' : '#475569'})`;
    await audit(tx, actor.id, 'org.create', 'org_unit', o.id, i, ip);
    return { id: o.id };
  });
}

export async function updateOrgUnit(actor: SessionUser, id: string, i: Partial<z.infer<typeof orgUnitInput>>, ip: string | null) {
  await (await import('./menuPerms')).requireMenu(actor, 'ops', 'edit');
  const sql = db();
  if (i.parentId === id) throw badRequest('자기 자신을 상위 조직으로 지정할 수 없습니다');
  await assertHomeUnit(actor, id, sql);
  if (i.parentId) await assertHomeUnit(actor, i.parentId, sql);
  if (i.isDemo !== undefined && tenantOf(actor) !== 'default') throw badRequest('격리 조직은 만들 수 없습니다');
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
  if (i.isDemo !== undefined) {
    const [cur] = await sql<{ parent_id: string | null }[]>`select parent_id from org_units where id = ${id}`;
    const parent = i.parentId !== undefined ? i.parentId : cur?.parent_id;
    if (i.isDemo && parent) throw badRequest('앱 심사용 격리 조직은 최상위(상위 조직 없음)로만 지정할 수 있습니다');
    if (i.isDemo) { const kids = await sql`select 1 from org_units where parent_id = ${id} limit 1`; if (kids.length) throw badRequest('하위 조직이 있는 조직은 격리 조직으로 바꿀 수 없습니다'); }
    set.is_demo = i.isDemo;
  }
  if (!Object.keys(set).length) return { ok: true };
  await sql.begin(async (tx) => {
    if (set.is_demo !== undefined) { await tx`update org_units set is_demo = ${set.is_demo as boolean}, tenant = ${set.is_demo ? 'demo' : 'default'} where id = ${id}`; delete set.is_demo; await syncDemoFlag(tx, (await tx<{ user_id: string }[]>`select user_id from memberships where org_unit_id = ${id}`).map((r) => r.user_id)); if (!Object.keys(set).length) { await audit(tx, actor.id, 'org.update', 'org_unit', id, i, ip); return; } }
    await tx`update org_units set ${tx(set as never, ...(Object.keys(set) as never[]))} where id = ${id}`;
    if (i.name) await tx`update calendars set name = ${i.name + ' 일정'} where org_unit_id = ${id}`;
    await audit(tx, actor.id, 'org.update', 'org_unit', id, i, ip);
  });
  return { ok: true };
}

/** 조직·사용자 디렉터리 (배정 후보). 관리자는 전체, 그 외는 접근 가능한 조직의 구성원 + 관리자 */
export async function directory(u: SessionUser, sql: Sql = db()) {
  const units = await accessibleUnitIds(u, sql);
  const sc = await teamScope(u, sql); // 로컬 10/19: 격리 팀 구성원에게 사람 = 같은 팀 + 대표·관리자 + 본인
  const orgUnits = await sql`select id, parent_id, brand_id, type, name, active, sort from org_units
    where id = any(${units ?? []}::uuid[]) order by sort, name`;
  const users = await sql`
    select u.id, u.name, u.title, u.title_short, u.role, u.email,
      coalesce(array_agg(m.org_unit_id) filter (where m.org_unit_id is not null), '{}') as org_unit_ids
    from users u left join memberships m on m.user_id = u.id
    where u.status = 'active' and u.tenant = ${tenantOf(u)} and (u.role in ('owner','admin') or u.id = ${u.id} or u.id = any(${sc.mates}::uuid[])
      or exists (select 1 from memberships mm where mm.user_id = u.id and mm.org_unit_id = any(${units ?? []}::uuid[])))
    group by u.id order by u.name`;
  // 브랜드(다짐·하이링크·바디랩)는 기존 회사 전용 — 다른 회사에는 보이지 않게(AI·음성 단어에도 섞이지 않음)
  const brands = tenantOf(u) === 'default' ? await sql`select id, name, color from brands order by sort` : [];
  return { brands, orgUnits, users, accessibleUnitIds: units, isAdmin: isAdmin(u) };
}

/** 체험(격리) 계정 표시: 대표·본사 관리자가 아니고, 소속이 모두 격리 조직이면 is_demo — 화면·API 에서 그 조직 밖이 전혀 안 보인다 */
export async function syncDemoFlag(tx: Sql, userIds: string[]) {
  if (!userIds.length) return;
  await tx`update users u set is_demo = (u.role not in ('owner','admin')
      and exists (select 1 from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = u.id and o.is_demo)
      and not exists (select 1 from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = u.id and not o.is_demo))
    where u.id = any(${userIds}::uuid[])`;
  // V15: 체험 격리는 기본 회사 안에서만 — 표시가 바뀌면 회사(tenant)도 따라간다
  await tx`update users set tenant = case when is_demo then 'demo' else 'default' end where id = any(${userIds}::uuid[]) and tenant in ('default','demo')`;
}

/** 관리 화면에서 다룰 수 있는 회사: 기본 회사 관리자는 체험(격리) 조직까지 */
export const homeTenants = (u: SessionUser) => (tenantOf(u) === 'default' ? ['default', 'demo'] : [tenantOf(u)]);
export async function assertHomeUnit(u: SessionUser, unitId: string, sql: Sql = db()) {
  const [o] = await sql<{ tenant: string }[]>`select tenant from org_units where id = ${unitId}`;
  if (!o || !homeTenants(u).includes(o.tenant)) throw notFound('조직이 없습니다');
}
export async function assertHomeUser(u: SessionUser, userId: string, sql: Sql = db()) {
  const [o] = await sql<{ tenant: string }[]>`select tenant from users where id = ${userId}`;
  if (!o || !homeTenants(u).includes(o.tenant)) throw notFound('사용자가 없습니다');
}
