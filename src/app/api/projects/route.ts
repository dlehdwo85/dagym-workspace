import { handler, body } from '@/lib/api';
import { projectInput } from '@/lib/projects';
import { db } from '@/lib/db';
import { accessibleUnitIds, assertUnitAccess, atLeast, taskVisibleSql } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { activity } from '@/lib/log';


export const GET = handler(async ({ user, req }) => {
  const sql = db();
  const units = await accessibleUnitIds(user, sql);
  const archived = req.nextUrl.searchParams.get('archived') === '1';
  const projects = await sql`
    select p.id, p.name, p.description, p.org_unit_id, p.brand_id, p.owner_id, p.color, p.archived, p.updated_at,
      o.name as org_unit_name, u.name as owner_name,
      exists (select 1 from project_favorites f where f.project_id = p.id and f.user_id = ${user.id}) as favorite,
      (select count(*)::int from tasks t where t.project_id = p.id and t.deleted_at is null and t.parent_id is null) as task_count,
      (select count(*)::int from tasks t where t.project_id = p.id and t.deleted_at is null and t.parent_id is null and t.status = 'done') as done_count
    from projects p join org_units o on o.id = p.org_unit_id left join users u on u.id = p.owner_id
    where p.archived = ${archived} and (${units === null ? sql`true` : sql`p.org_unit_id = any(${units}::uuid[])`}
      or exists (select 1 from tasks t where t.project_id = p.id and t.deleted_at is null and ${taskVisibleSql(sql, user, units)}))
    order by p.name`;
  return { projects };
});

export const POST = handler(async ({ req, user }) => {
  const i = await body(req, projectInput);
  if (!atLeast(user, 'site_manager')) throw forbidden('프로젝트는 현장 관리자 이상이 만들 수 있습니다');
  const sql = db();
  await assertUnitAccess(user, i.orgUnitId, sql);
  const brand = i.brandId !== undefined ? i.brandId : ((await sql`select brand_id from org_units where id = ${i.orgUnitId}`)[0]?.brand_id ?? null);
  const [p] = await sql<{ id: string }[]>`insert into projects (name, description, org_unit_id, brand_id, owner_id, color, created_by)
    values (${i.name}, ${i.description ?? ''}, ${i.orgUnitId}, ${brand}, ${i.ownerId ?? user.id}, ${i.color ?? '#2563eb'}, ${user.id}) returning id`;
  await activity(sql, 'project', p.id, user.id, 'created', { name: i.name });
  return { id: p.id };
}, { idempotent: true });
