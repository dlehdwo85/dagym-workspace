import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { assertUnitAccess, atLeast } from '@/lib/access';
import { forbidden } from '@/lib/errors';
import { getProjectOrThrow } from '@/lib/tasks';
import { activity } from '@/lib/log';
import { projectInput } from '@/lib/projects';

export const GET = handler<{ id: string }>(async ({ user, params }) => ({ project: await getProjectOrThrow(user, params.id) }));

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const p = await getProjectOrThrow(user, params.id);
  if (p.limited || !(atLeast(user, 'site_manager') || p.owner_id === user.id)) throw forbidden('프로젝트를 수정할 권한이 없습니다');
  const i = await body(req, projectInput.partial());
  if (i.orgUnitId) await assertUnitAccess(user, i.orgUnitId);
  const map: Record<string, string> = { name: 'name', description: 'description', orgUnitId: 'org_unit_id', brandId: 'brand_id', ownerId: 'owner_id', color: 'color', archived: 'archived' };
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(i)) if (v !== undefined && map[k]) set[map[k]] = v;
  if (!Object.keys(set).length) return { ok: true };
  set.updated_at = new Date();
  const sql = db();
  await sql`update projects set ${sql(set as never, ...(Object.keys(set) as never[]))} where id = ${params.id}`;
  await activity(sql, 'project', params.id, user.id, 'updated', i);
  return { ok: true };
});
