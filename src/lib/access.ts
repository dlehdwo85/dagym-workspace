import { db, type Sql } from './db';
import { forbidden, notFound } from './errors';
import { ROLE_RANK, tenantOf, type SessionUser } from './types';

export const isAdmin = (u: SessionUser) => u.role === 'owner' || u.role === 'admin';
export const atLeast = (u: SessionUser, role: keyof typeof ROLE_RANK) => ROLE_RANK[u.role] >= ROLE_RANK[role];

export function requireAdmin(u: SessionUser) {
  if (!isAdmin(u)) throw forbidden('관리자만 사용할 수 있는 기능입니다');
}

/**
 * 사용자가 접근 가능한 조직 단위 id 목록. 소속 단위와 그 하위 단위 전체가 포함된다.
 * V15: 대표·본사 관리자도 "전체"(null)가 아니라 **자기 회사(tenant)의 조직 전체** 목록 — 공개 가입한 다른 회사 데이터가 절대 섞이지 않게.
 * (반환 타입의 null 은 예전 호출부 호환용으로만 남겨 둠 — 이제 돌려주지 않는다)
 */
export async function accessibleUnitIds(u: SessionUser, sql: Sql = db()): Promise<string[] | null> {
  if (isAdmin(u)) return (await sql<{ id: string }[]>`select id from org_units where tenant = ${tenantOf(u)}`).map((r) => r.id);
  const rows = await sql<{ id: string }[]>`
    with recursive t as (
      select o.id from org_units o join memberships m on m.org_unit_id = o.id where m.user_id = ${u.id} and o.tenant = ${tenantOf(u)}
      union
      select c.id from org_units c join t on c.parent_id = t.id where c.tenant = ${tenantOf(u)}
    ) select id from t`;
  return rows.map((r) => r.id);
}

/** 메뉴 권한 단계를 SQL 안에서 (사람별 예외 → 등급 설정 → 기본값). 동기 함수(taskVisibleSql)에서 쓰려고 */
function menuLevelSql(sql: Sql, u: SessionUser, menu: string, def: string) {
  return sql`coalesce((select level from menu_user_perms where menu = ${menu} and user_id = ${u.id}), (select level from menu_role_perms where menu = ${menu} and role = ${u.role}), ${def})`;
}
const TEAM_DEF: Record<string, [string, string]> = { owner: ['edit', 'edit'], admin: ['edit', 'edit'], dept_lead: ['view', 'none'], site_manager: ['view', 'none'], staff: ['view', 'none'] };

/** 업무 조회 가능 조건 (tasks 별칭 t 기준)
 * V14 8번: 팀 업무(team_id)는 소속(현장)이 아니라 팀으로 — 팀원("팀 업무" 조회 이상) · "다른 팀 업무 보기" 권한자만. 본인이 담당·지시·만든·참여한 업무는 항상 */
export function taskVisibleSql(sql: Sql, u: SessionUser, units: string[] | null) {
  // 대표·본사 관리자(전체)에게도 앱 심사용 데모 조직 업무는 섞지 않는다
  if (units === null) return sql`not exists (select 1 from org_units dz where dz.id = t.org_unit_id and dz.is_demo)`;
  const [dTeam, dAll] = TEAM_DEF[u.role] ?? ['view', 'none'];
  return sql`(
    (t.team_id is null and t.org_unit_id = any(${units}::uuid[]))
    or (t.team_id is not null and (
      (${menuLevelSql(sql, u, 'team_tasks', dTeam)} <> 'none' and exists (select 1 from team_members tm where tm.team_id = t.team_id and tm.user_id = ${u.id}))
      or ${menuLevelSql(sql, u, 'team_tasks_all', dAll)} <> 'none'))
    or t.assignee_id = ${u.id}
    or t.created_by = ${u.id}
    or t.requested_by = ${u.id}
    or exists (select 1 from task_collaborators tc where tc.task_id = t.id and tc.user_id = ${u.id})
  )`;
}

/** V14 8번: 이 사용자가 팀 업무에 갖는 단계 (none/view/edit) */
export async function teamTaskLevel(u: SessionUser, teamId: string, sql: Sql = db()) {
  if (isAdmin(u)) return 'edit';
  const { menuLevel } = await import('./menuPerms');
  const [m] = await sql<{ is_lead: boolean }[]>`select is_lead from team_members where team_id = ${teamId} and user_id = ${u.id}`;
  const rank: Record<string, number> = { none: 0, view: 1, edit: 2 };
  const own = m ? await menuLevel(u, 'team_tasks', sql) : 'none';
  const mine = m?.is_lead && rank[own] >= 1 ? 'edit' : own; // 팀장은 조회 이상이면 자기 팀 편집
  const all = await menuLevel(u, 'team_tasks_all', sql);
  return rank[all] > rank[mine] ? all : mine;
}

export interface TaskAccessRow {
  id: string;
  org_unit_id: string;
  assignee_id: string | null;
  created_by: string;
  project_id: string | null;
  requested_by?: string | null;
  team_id?: string | null;
}

export interface TaskPerms {
  view: boolean;
  edit: boolean; // 내용·일정·담당자 변경
  approve: boolean; // 최종 완료 확인
  delete: boolean;
}

export async function taskPerms(u: SessionUser, t: TaskAccessRow, sql: Sql = db()): Promise<TaskPerms> {
  const units = await accessibleUnitIds(u, sql);
  const inUnit = units === null || units.includes(t.org_unit_id);
  const isCollab =
    (await sql`select 1 from task_collaborators where task_id = ${t.id} and user_id = ${u.id}`).length > 0;
  const involved = t.assignee_id === u.id || t.created_by === u.id || isCollab || (!!t.requested_by && t.requested_by === u.id);
  if (t.team_id) { // V14 8번 팀 업무
    const lv = await teamTaskLevel(u, t.team_id, sql);
    const [lead] = await sql`select 1 from team_members where team_id = ${t.team_id} and user_id = ${u.id} and is_lead`;
    const teamManager = isAdmin(u) || (!!lead && lv === 'edit');
    return { view: lv !== 'none' || involved, edit: lv === 'edit' || involved, approve: teamManager || (inUnit && atLeast(u, 'site_manager')),
      delete: teamManager || t.created_by === u.id || (!!t.requested_by && t.requested_by === u.id) };
  }
  const manager = inUnit && atLeast(u, 'site_manager');
  return {
    view: inUnit || involved,
    edit: manager || involved || inUnit,
    approve: manager,
    delete: manager || t.created_by === u.id || (!!t.requested_by && t.requested_by === u.id), // 지시자도 삭제 가능(V6 11번)
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

export async function loadTaskForUser(u: SessionUser, taskId: string, sql: Sql = db()) {
  if (!isUuid(taskId)) throw notFound('업무를 찾을 수 없습니다');
  const rows = await sql<TaskAccessRow[]>`
    select id, org_unit_id, assignee_id, created_by, project_id, requested_by, team_id from tasks where id = ${taskId} and deleted_at is null`;
  const t = rows[0];
  if (!t) throw notFound('업무를 찾을 수 없습니다');
  const perms = await taskPerms(u, t, sql);
  // 존재 여부를 노출하지 않기 위해 권한 없음도 404
  if (!perms.view) throw notFound('업무를 찾을 수 없습니다');
  return { task: t, perms };
}

export async function assertUnitAccess(u: SessionUser, unitId: string, sql: Sql = db()) {
  const units = await accessibleUnitIds(u, sql);
  if (units !== null && !units.includes(unitId)) throw forbidden('해당 조직에 대한 권한이 없습니다');
}

/** 캘린더 접근: 회사(전원 조회, 관리자 편집) / 조직(소속 조회, 소속 관리자 이상 또는 소속원 편집) / 개인(본인) */
export interface CalendarRow {
  id: string;
  type: 'company' | 'org_unit' | 'personal';
  org_unit_id: string | null;
  owner_user_id: string | null;
}

export async function calendarPerms(u: SessionUser, c: CalendarRow, units?: string[] | null) {
  units = units === undefined ? await accessibleUnitIds(u) : units;
  if (c.type === 'company') { const mine = ((c as any).tenant ?? 'default') === tenantOf(u); return { view: mine, edit: mine && atLeast(u, 'dept_lead') }; }
  if (c.type === 'personal') return { view: c.owner_user_id === u.id, edit: c.owner_user_id === u.id };
  const inUnit = units === null || (c.org_unit_id !== null && units.includes(c.org_unit_id));
  return { view: inUnit, edit: inUnit };
}

export async function visibleCalendars(u: SessionUser, sql: Sql = db()) {
  const units = await accessibleUnitIds(u, sql);
  const rows = await sql<(CalendarRow & { name: string; color: string; unit_name: string | null; brand_id: string | null })[]>`
    select c.id, c.type, c.org_unit_id, c.owner_user_id, c.name, c.color, o.name as unit_name, o.brand_id, c.tenant
    from calendars c left join org_units o on o.id = c.org_unit_id
    where (c.type = 'company' and c.tenant = ${tenantOf(u)})
       or (c.type = 'personal' and c.owner_user_id = ${u.id})
       or (c.type = 'org_unit' and ${units === null ? sql`not exists (select 1 from org_units dz where dz.id = c.org_unit_id and dz.is_demo)` : sql`c.org_unit_id = any(${units}::uuid[])`})
    order by case c.type when 'personal' then 0 when 'company' then 1 else 2 end, c.name`;
  return Promise.all(rows.map(async (c) => ({ ...c, perms: await calendarPerms(u, c, units) })));
}

export async function ensurePersonalCalendar(userId: string, name: string, sql: Sql = db()) {
  const r = await sql<{ id: string }[]>`
    insert into calendars (type, owner_user_id, name, color) values ('personal', ${userId}, ${name + ' 개인 일정'}, '#7c3aed')
    on conflict (owner_user_id) where type = 'personal' do update set name = calendars.name
    returning id`;
  return r[0].id;
}

/** 체험 계정이면 막는다 (설정 변경·초대·첨부·외부 연동 등) */
export function denyDemo(u: SessionUser) {
  if (u.isDemo) throw forbidden('체험 계정에서는 사용할 수 없는 기능입니다');
}
