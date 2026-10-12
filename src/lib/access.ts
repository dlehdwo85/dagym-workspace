import { db, type Sql } from './db';
import { forbidden, notFound } from './errors';
import { ROLE_RANK, type SessionUser } from './types';

export const isAdmin = (u: SessionUser) => u.role === 'owner' || u.role === 'admin';
export const atLeast = (u: SessionUser, role: keyof typeof ROLE_RANK) => ROLE_RANK[u.role] >= ROLE_RANK[role];

export function requireAdmin(u: SessionUser) {
  if (!isAdmin(u)) throw forbidden('관리자만 사용할 수 있는 기능입니다');
}

/**
 * 사용자가 접근 가능한 조직 단위 id 목록. 대표·본사 관리자는 null(전체).
 * 소속 단위와 그 하위 단위 전체가 포함된다.
 */
export async function accessibleUnitIds(u: SessionUser, sql: Sql = db()): Promise<string[] | null> {
  if (isAdmin(u)) return null;
  const rows = await sql<{ id: string }[]>`
    with recursive t as (
      select o.id from org_units o join memberships m on m.org_unit_id = o.id where m.user_id = ${u.id}
      union
      select c.id from org_units c join t on c.parent_id = t.id
    ) select id from t`;
  return rows.map((r) => r.id);
}

/** 업무 조회 가능 조건 (tasks 별칭 t 기준) */
export function taskVisibleSql(sql: Sql, u: SessionUser, units: string[] | null) {
  if (units === null) return sql`true`;
  return sql`(
    t.org_unit_id = any(${units}::uuid[])
    or t.assignee_id = ${u.id}
    or t.created_by = ${u.id}
    or exists (select 1 from task_collaborators tc where tc.task_id = t.id and tc.user_id = ${u.id})
  )`;
}

export interface TaskAccessRow {
  id: string;
  org_unit_id: string;
  assignee_id: string | null;
  created_by: string;
  project_id: string | null;
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
  const involved = t.assignee_id === u.id || t.created_by === u.id || isCollab;
  const manager = inUnit && atLeast(u, 'site_manager');
  return {
    view: inUnit || involved,
    edit: manager || involved || inUnit,
    approve: manager,
    delete: manager || t.created_by === u.id,
  };
}

export async function loadTaskForUser(u: SessionUser, taskId: string, sql: Sql = db()) {
  const rows = await sql<TaskAccessRow[]>`
    select id, org_unit_id, assignee_id, created_by, project_id from tasks where id = ${taskId} and deleted_at is null`;
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
  if (c.type === 'company') return { view: true, edit: atLeast(u, 'dept_lead') };
  if (c.type === 'personal') return { view: c.owner_user_id === u.id, edit: c.owner_user_id === u.id };
  const inUnit = units === null || (c.org_unit_id !== null && units.includes(c.org_unit_id));
  return { view: inUnit, edit: inUnit };
}

export async function visibleCalendars(u: SessionUser, sql: Sql = db()) {
  const units = await accessibleUnitIds(u, sql);
  const rows = await sql<(CalendarRow & { name: string; color: string; unit_name: string | null; brand_id: string | null })[]>`
    select c.id, c.type, c.org_unit_id, c.owner_user_id, c.name, c.color, o.name as unit_name, o.brand_id
    from calendars c left join org_units o on o.id = c.org_unit_id
    where c.type = 'company'
       or (c.type = 'personal' and c.owner_user_id = ${u.id})
       or (c.type = 'org_unit' and ${units === null ? sql`true` : sql`c.org_unit_id = any(${units}::uuid[])`})
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
