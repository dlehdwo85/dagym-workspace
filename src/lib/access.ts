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
/**
 * 로컬 10/19(대표) 팀 격리: 격리 팀(teams.isolated) 구성원(대표·관리자 제외)은 '회사 안의 작은 회사' —
 * 자기 팀(하위 팀 포함)과 자기에게 배정·지시·참여한 것만 보고, 본사(다른 부서)의 업무·일정·사람·자료는 404. mates = 같은 격리 팀 사람들.
 * 업무·일정·사람·자료·메시지·AI 도구가 모두 이 함수와 accessibleUnitIds(격리면 빈 목록)를 거친다.
 */
export type TeamScope = { isolated: boolean; teamIds: string[]; mates: string[] };
export async function teamScope(u: SessionUser, sql: Sql = db()): Promise<TeamScope> {
  if (isAdmin(u) || u.isDemo) return { isolated: false, teamIds: [], mates: [] };
  const teams = await sql<{ id: string }[]>`with recursive d as (
      select t.id from teams t join team_members m on m.team_id = t.id where m.user_id = ${u.id} and t.isolated and not t.archived and t.tenant = ${tenantOf(u)}
      union select c.id from teams c join d on c.parent_id = d.id where not c.archived
    ) select id from d`;
  if (!teams.length) return { isolated: false, teamIds: [], mates: [] };
  const ids = teams.map((r) => r.id);
  const mates = await sql<{ id: string }[]>`select distinct m.user_id as id from team_members m join users us on us.id = m.user_id
    where m.team_id = any(${ids}::uuid[]) and us.status = 'active' and us.id <> ${u.id}`;
  return { isolated: true, teamIds: ids, mates: mates.map((r) => r.id) };
}
/** 내가 속한 팀 + 하위 팀(관리자는 회사 모든 팀) — 팀 캘린더·팀 대화방 조건 */
export function myTeamsSql(sql: Sql, u: SessionUser) {
  if (isAdmin(u)) return sql`select id from teams where tenant = ${tenantOf(u)} and not archived`;
  // union 뒤에 with recursive 를 바로 쓸 수 없어 하위 팀은 괄호 안 서브쿼리로
  return sql`select m.team_id as id from team_members m join teams t0 on t0.id = m.team_id where m.user_id = ${u.id} and not t0.archived and t0.tenant = ${tenantOf(u)} union select s.id from (${subTeamsSql(sql, u)}) s`;
}

/** 소속 조직(하위 포함) — 쓰기(업무 만들 조직) 판단용. 격리와 무관 */
export async function membershipUnitIds(u: SessionUser, sql: Sql = db()): Promise<string[] | null> {
  if (isAdmin(u)) return (await sql<{ id: string }[]>`select id from org_units where tenant = ${tenantOf(u)}`).map((r) => r.id);
  const rows = await sql<{ id: string }[]>`
    with recursive t as (
      select o.id from org_units o join memberships m on m.org_unit_id = o.id where m.user_id = ${u.id} and o.tenant = ${tenantOf(u)}
      union
      select c.id from org_units c join t on c.parent_id = t.id where c.tenant = ${tenantOf(u)}
    ) select id from t`;
  return rows.map((r) => r.id);
}
/** 보이는 조직 — 격리 팀 구성원은 빈 목록(조직 단위로는 아무것도 안 보임, 팀·본인 것만) */
export async function accessibleUnitIds(u: SessionUser, sql: Sql = db()): Promise<string[] | null> {
  if (isAdmin(u)) return (await sql<{ id: string }[]>`select id from org_units where tenant = ${tenantOf(u)}`).map((r) => r.id);
  if ((await teamScope(u, sql)).isolated) return [];
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
  return sql`coalesce((select level from menu_user_perms where menu = ${menu} and user_id = ${u.id}), (select level from menu_role_perms_t where tenant = ${tenantOf(u)} and menu = ${menu} and role = ${u.role}), ${def})`;
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
    or (t.team_id is not null and exists (select 1 from teams tt where tt.id = t.team_id and tt.tenant = ${tenantOf(u)}) and (
      (${menuLevelSql(sql, u, 'team_tasks', dTeam)} <> 'none' and exists (select 1 from team_members tm where tm.team_id = t.team_id and tm.user_id = ${u.id}))
      or t.team_id in (${subTeamsSql(sql, u)})
      -- 대표 10/20 4): '팀 업무 보기' 전체(team_tasks_all) 또는 지정 팀(team_view_grants) — 격리 팀원은 자기 팀만(넓어지지 않음)
      or (not ${isolatedSql(sql, u)} and (${menuLevelSql(sql, u, 'team_tasks_all', dAll)} <> 'none' or t.team_id in (select g.team_id from team_view_grants g where g.user_id = ${u.id})))))
    or t.assignee_id = ${u.id}
    or t.created_by = ${u.id}
    or ${leadOfInvolvedSql(sql, u)}
    or t.requested_by = ${u.id}
    or exists (select 1 from task_collaborators tc where tc.task_id = t.id and tc.user_id = ${u.id})
    or exists (select 1 from task_checklist_items ci where ci.task_id = t.id and ci.assignee_id = ${u.id})
  )`;
}

/** 격리 팀('회사 안의 작은 회사') 구성원인지 — 동기 SQL 조건용 */
export function isolatedSql(sql: Sql, u: SessionUser) {
  return sql`exists (select 1 from teams ti join team_members mi on mi.team_id = ti.id where mi.user_id = ${u.id} and ti.isolated and not ti.archived and ti.tenant = ${tenantOf(u)})`;
}
/** 부서(팀) 업무 환경(대표 10/16): 부서장(팀장)은 자기 부서원(하위 부서 포함)이 담당·지시한 업무를 본다 — 부서 간 협업 업무는 참여자와 양쪽 부서장에게만 */
export function leadOfInvolvedSql(sql: Sql, u: SessionUser) {
  return sql`exists (
    with recursive lt as (
      select lm.team_id as id from team_members lm join teams lt0 on lt0.id = lm.team_id where lm.user_id = ${u.id} and lm.is_lead and not lt0.archived and lt0.tenant = ${tenantOf(u)}
      union select c.id from teams c join lt on c.parent_id = lt.id where not c.archived
    ) select 1 from team_members pm where pm.team_id in (select id from lt) and pm.user_id in (t.assignee_id, t.requested_by))`;
}
/** R-16: 내가 속한 팀의 하위 팀들(자식·손자…) — 상위 팀 구성원은 하위 팀 업무 전체 권한 */
export function subTeamsSql(sql: Sql, u: SessionUser) {
  return sql`with recursive d as (
      select c.id from teams c join team_members m on m.team_id = c.parent_id and m.user_id = ${u.id} where c.tenant = ${tenantOf(u)} and not c.archived
      union select c.id from teams c join d on c.parent_id = d.id where not c.archived
    ) select id from d`;
}
/** V14 8번: 이 사용자가 팀 업무에 갖는 단계 (none/view/edit) */
export async function teamTaskLevel(u: SessionUser, teamId: string, sql: Sql = db()) {
  const [tm] = await sql<{ tenant: string }[]>`select tenant from teams where id = ${teamId}`;
  if (!tm || tm.tenant !== tenantOf(u)) return 'none'; // 다른 회사 팀
  if (isAdmin(u)) return 'edit';
  if ((await sql`select 1 from (${subTeamsSql(sql, u)}) s where s.id = ${teamId}`).length) return 'edit'; // R-16 상위 팀
  const { menuLevel } = await import('./menuPerms');
  const [m] = await sql<{ is_lead: boolean }[]>`select is_lead from team_members where team_id = ${teamId} and user_id = ${u.id}`;
  const rank: Record<string, number> = { none: 0, view: 1, edit: 2 };
  const own = m ? await menuLevel(u, 'team_tasks', sql) : 'none';
  const mine = m?.is_lead && rank[own] >= 1 ? 'edit' : own; // 팀장은 조회 이상이면 자기 팀 편집
  if ((await teamScope(u, sql)).isolated) return mine; // 격리 팀원은 자기 팀만
  const all = await menuLevel(u, 'team_tasks_all', sql);
  const granted = (await sql`select 1 from team_view_grants where user_id = ${u.id} and team_id = ${teamId}`).length ? 'view' : 'none'; // 지정 팀은 조회
  const wide = rank[all] > rank[granted] ? all : granted;
  return rank[wide] > rank[mine] ? wide : mine;
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
    (await sql`select 1 from task_collaborators where task_id = ${t.id} and user_id = ${u.id}`).length > 0
    || (await sql`select 1 from task_checklist_items where task_id = ${t.id} and assignee_id = ${u.id} limit 1`).length > 0; // R-15 6번 항목 담당자도 참여자
  const involved = t.assignee_id === u.id || t.created_by === u.id || isCollab || (!!t.requested_by && t.requested_by === u.id);
  // V14 50(대표 결정): 내용·일정 수정 = 지시자(없으면 만든 사람)·담당자 2명만(대표·관리자·협업자·같은 팀은 보기·댓글·첨부 올리기만),
  // 담당자 변경·삭제 = 지시자만, 상태·검토 승인은 tasks.updateTask 에서 담당자(검토는 검토 담당자)만
  const requester = t.requested_by ?? t.created_by;
  const edit = t.assignee_id === u.id || requester === u.id;
  const del = requester === u.id;
  // 부서장: 자기 부서원이 담당·지시한 업무(부서 간 협업 포함)
  const deptLead = (await sql`select 1 from tasks t where t.id = ${t.id} and ${leadOfInvolvedSql(sql, u)}`).length > 0;
  if (t.team_id) { // V14 8번 팀 업무: 보기는 팀 권한, 수정은 위 규칙
    const lv = await teamTaskLevel(u, t.team_id, sql);
    const [lead] = await sql`select 1 from team_members where team_id = ${t.team_id} and user_id = ${u.id} and is_lead`;
    const teamManager = isAdmin(u) || (!!lead && lv === 'edit');
    return { view: lv !== 'none' || involved || deptLead, edit, approve: teamManager || (inUnit && atLeast(u, 'site_manager')), delete: del };
  }
  const manager = inUnit && atLeast(u, 'site_manager');
  return { view: inUnit || involved || deptLead, edit, approve: manager, delete: del };
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
  const units = await membershipUnitIds(u, sql); // 격리 팀 구성원도 자기 소속 조직에 업무는 만든다
  if (units !== null && !units.includes(unitId)) throw forbidden('해당 조직에 대한 권한이 없습니다');
}

/** 캘린더 접근: 회사(전원 조회, 관리자 편집) / 조직(소속 조회, 소속 관리자 이상 또는 소속원 편집) / 개인(본인) */
export interface CalendarRow {
  id: string;
  type: 'company' | 'org_unit' | 'personal' | 'team';
  org_unit_id: string | null;
  owner_user_id: string | null;
  team_id?: string | null;
}

export async function calendarPerms(u: SessionUser, c: CalendarRow, units?: string[] | null) {
  units = units === undefined ? await accessibleUnitIds(u) : units;
  if (c.type === 'company') { const mine = ((c as any).tenant ?? 'default') === tenantOf(u); return { view: mine, edit: mine && atLeast(u, 'dept_lead') }; }
  if (c.type === 'personal') return { view: c.owner_user_id === u.id, edit: c.owner_user_id === u.id };
  // 팀 일정(로컬 10/19): 팀장·부서(상위) 구성원·본사 = 편집, 팀원 = 조회
  if (c.type === 'team') { const lvl = c.team_id ? await teamTaskLevel(u, c.team_id) : 'none'; return { view: lvl !== 'none', edit: lvl === 'edit' }; }
  const inUnit = units === null || (c.org_unit_id !== null && units.includes(c.org_unit_id));
  return { view: inUnit, edit: inUnit };
}

export async function visibleCalendars(u: SessionUser, sql: Sql = db()) {
  const units = await accessibleUnitIds(u, sql);
  const sc = await teamScope(u, sql);
  const rows = await sql<(CalendarRow & { name: string; color: string; unit_name: string | null; brand_id: string | null })[]>`
    select c.id, c.type, c.org_unit_id, c.owner_user_id, c.team_id, c.name, c.color, coalesce(o.name, tm.name) as unit_name, o.brand_id, c.tenant
    from calendars c left join org_units o on o.id = c.org_unit_id left join teams tm on tm.id = c.team_id
    where (c.type = 'company' and c.tenant = ${tenantOf(u)} and ${sc.isolated ? sql`false` : sql`true`})
       or (c.type = 'personal' and c.owner_user_id = ${u.id})
       or (c.type = 'org_unit' and ${units === null ? sql`not exists (select 1 from org_units dz where dz.id = c.org_unit_id and dz.is_demo)` : sql`c.org_unit_id = any(${units}::uuid[])`})
       or (c.type = 'team' and c.team_id in (${myTeamsSql(sql, u)}))
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
