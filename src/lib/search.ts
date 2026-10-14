import { db } from './db';
import { accessibleUnitIds, taskVisibleSql } from './access';
import { tenantOf, type SessionUser } from './types';

/** B-4 빠른 검색: 업무·프로젝트·사람·일정. 모든 결과는 서버 권한 범위 안에서만 */
export async function quickSearch(u: SessionUser, q: string) {
  const term = q.trim();
  if (term.length < 1) return { tasks: [], projects: [], people: [], events: [] };
  const sql = db();
  const units = await accessibleUnitIds(u, sql);
  const like = '%' + term.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
  const [tasks, projects, people, events] = await Promise.all([
    sql`select t.id, t.title, t.status, t.due_date, o.name as org_unit_name from tasks t join org_units o on o.id = t.org_unit_id
        where t.deleted_at is null and ${taskVisibleSql(sql, u, units)}
          and (t.title ilike ${like} or t.description ilike ${like} or exists (select 1 from unnest(t.tags) tg where tg ilike ${like}))
        order by t.status = 'done', t.updated_at desc limit 8`,
    sql`select p.id, p.name, p.color from projects p where not p.archived and p.name ilike ${like}
          and (${units === null ? sql`true` : sql`p.org_unit_id = any(${units}::uuid[])`}
            or exists (select 1 from tasks t where t.project_id = p.id and t.deleted_at is null and ${taskVisibleSql(sql, u, units)}))
        order by p.name limit 5`,
    sql`select u.id, u.name, u.title from users u where u.status = 'active' and (u.name ilike ${like} or u.email ilike ${like})
          and u.tenant = ${tenantOf(u)} and (${units === null ? sql`true` : sql`u.role in ('owner','admin') or exists (select 1 from memberships m where m.user_id = u.id and m.org_unit_id = any(${units}::uuid[]))`})
        order by u.name limit 5`,
    sql`select e.id, e.title, e.start_at, e.all_day from events e join calendars c on c.id = e.calendar_id
        where e.deleted_at is null and e.recurring_event_id is null and e.title ilike ${like}
          and ((c.type = 'company' and c.tenant = ${tenantOf(u)}) or (c.type = 'personal' and c.owner_user_id = ${u.id})
            or (c.type = 'org_unit' and ${units === null ? sql`true` : sql`c.org_unit_id = any(${units}::uuid[])`})
            or exists (select 1 from event_attendees a where a.event_id = e.id and a.user_id = ${u.id}))
        order by abs(extract(epoch from (e.start_at - now()))) limit 5`,
  ]);
  return { tasks, projects, people, events };
}
