import { z } from 'zod';
import { handler, body } from '@/lib/api';
import { db } from '@/lib/db';
import { notFound } from '@/lib/errors';
import { collectSource } from '@/lib/sales/collect';

/** V41 단계 3: 플랫폼 운영자 — 원천 수집 주소·칸 이름 맞추기, 수집 켜기, 수동 실행(실제 응답 확인용) */
export const GET = handler(async ({ user }) => {
  if (!user.platformAdmin) throw notFound();
  return { sources: await db()`select code, name, provider, category, endpoint, params, field_map, collect, last_run_at, last_count, last_error, (select count(*)::int from prospects p where p.source_code = s.code) as total from data_sources s order by category, name` };
});
const input = z.object({ code: z.string().max(20), endpoint: z.string().url().startsWith('https://').nullable().optional(), params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  fieldMap: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(), collect: z.boolean().optional(), run: z.boolean().optional(), maxPages: z.number().int().min(1).max(20).optional() });
export const POST = handler(async ({ req, user }) => {
  if (!user.platformAdmin) throw notFound();
  const i = await body(req, input);
  const sql = db();
  const [s] = await sql`update data_sources set endpoint = coalesce(${i.endpoint === undefined ? null : i.endpoint}, endpoint), params = coalesce(${i.params ? sql.json(i.params) : null}, params),
      field_map = coalesce(${i.fieldMap ? sql.json(i.fieldMap as never) : null}, field_map), collect = coalesce(${i.collect ?? null}, collect), updated_at = now() where code = ${i.code} returning code`;
  if (!s) throw notFound();
  return i.run ? await collectSource(i.code, { maxPages: i.maxPages }) : { ok: true };
});
