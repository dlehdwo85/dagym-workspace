import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { atLeast } from '@/lib/access';
import { forbidden, notFound } from '@/lib/errors';
import { tenantOf, type SessionUser } from '@/lib/types';
import { templatePayload } from '@/lib/templates';

async function load(id: string, user: SessionUser) {
  // 다른 회사 템플릿·남의 개인 템플릿은 없는 것으로(404)
  const [t] = await db()`select * from templates where id = ${id} and tenant = ${tenantOf(user)} and (not personal or created_by = ${user.id})`;
  if (!t) throw notFound('템플릿이 없습니다');
  return t;
}

export const PATCH = handler<{ id: string }>(async ({ req, user, params }) => {
  const t = await load(params.id, user);
  if (!(atLeast(user, 'admin') || (atLeast(user, 'site_manager') && t.created_by === user.id))) throw forbidden();
  const i = await body(req, z.object({ name: z.string().min(1).max(60).optional(), description: z.string().max(500).optional(), payload: templatePayload.optional(), archived: z.boolean().optional() }));
  const sql = db();
  await sql`update templates set name = ${i.name ?? t.name}, description = ${i.description ?? t.description},
    payload = ${sql.json((i.payload ?? t.payload) as never)}, archived = ${i.archived ?? t.archived}, updated_at = now() where id = ${params.id}`;
  return { ok: true };
});
