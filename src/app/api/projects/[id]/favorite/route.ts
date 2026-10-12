import { handler } from '@/lib/api';
import { db } from '@/lib/db';
import { accessibleUnitIds, isUuid, taskVisibleSql } from '@/lib/access';
import { notFound } from '@/lib/errors';

/** 즐겨찾기 표시/해제 — 볼 수 있는 프로젝트만 */
async function check(user: Parameters<typeof accessibleUnitIds>[0], id: string) {
  if (!isUuid(id)) throw notFound();
  const sql = db();
  const units = await accessibleUnitIds(user, sql);
  const r = await sql`select 1 from projects p where p.id = ${id} and (${units === null ? sql`true` : sql`p.org_unit_id = any(${units}::uuid[])`}
    or exists (select 1 from tasks t where t.project_id = p.id and t.deleted_at is null and ${taskVisibleSql(sql, user, units)}))`;
  if (!r.length) throw notFound('프로젝트를 찾을 수 없습니다');
  return sql;
}
export const PUT = handler<{ id: string }>(async ({ user, params }) => {
  const sql = await check(user, params.id);
  await sql`insert into project_favorites (user_id, project_id) values (${user.id}, ${params.id}) on conflict do nothing`;
  return { ok: true };
});
export const DELETE = handler<{ id: string }>(async ({ user, params }) => {
  const sql = await check(user, params.id);
  await sql`delete from project_favorites where user_id = ${user.id} and project_id = ${params.id}`;
  return { ok: true };
});
