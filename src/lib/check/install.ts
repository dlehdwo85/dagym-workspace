import { z } from 'zod';
import { db, type Sql } from '../db';
import { badRequest } from '../errors';
import { requireMenu } from '../menuPerms';
import { tenantOf, type SessionUser } from '../types';
import { CHECK_TEMPLATES, templatesForIndustries, type CheckTemplate } from './templates';

/**
 * 점검 템플릿 설치 — 한 회사에 한 번(chk_installs). 열쇠(tpl_key)로 겹치지 않게 넣고, 이미 설치한 템플릿은 다시 넣지 않는다(관리자가 지운 항목이 되살아나지 않게).
 * - 가입할 때: 공통 기본 + 고른 업종의 템플릿
 * - 예전부터 있던 회사: 점검 가이드를 처음 열 때(ensureCheckTemplates) 같은 규칙으로
 * - 관리자가 가이드 화면에서 업종 템플릿을 더 넣을 수 있음(installTemplate)
 */
async function installOne(sql: Sql, tenant: string, tpl: CheckTemplate, byUser: string | null) {
  const [mark] = await sql`insert into chk_installs (tenant, tpl, by_user) values (${tenant}, ${tpl.key}, ${byUser}) on conflict (tenant, tpl) do nothing returning tpl`;
  if (!mark) return { installed: false, items: 0 };
  let sort = 0;
  for (const c of tpl.categories ?? []) {
    await sql`insert into chk_categories (tenant, name, icon, sort, tpl_key) values (${tenant}, ${c.name}, ${c.icon ?? null}, ${++sort * 10}, ${'c:' + c.key})
      on conflict (tenant, tpl_key) where tpl_key is not null do nothing`;
  }
  const [{ s: base }] = await sql<{ s: number }[]>`select coalesce(max(sort), 0)::int as s from chk_place_types where tenant = ${tenant}`;
  sort = 0;
  for (const p of tpl.placeTypes) {
    await sql`insert into chk_place_types (tenant, name, sort, tpl_key) values (${tenant}, ${p.name}, ${base + ++sort * 10}, ${'p:' + p.key})
      on conflict (tenant, tpl_key) where tpl_key is not null do nothing`;
  }
  const cats = new Map((await sql<{ id: string; tpl_key: string }[]>`select id, tpl_key from chk_categories where tenant = ${tenant} and tpl_key is not null`).map((r) => [r.tpl_key, r.id]));
  const places = new Map((await sql<{ id: string; tpl_key: string }[]>`select id, tpl_key from chk_place_types where tenant = ${tenant} and tpl_key is not null`).map((r) => [r.tpl_key, r.id]));
  let n = 0;
  for (const it of tpl.items) {
    const placeIds = (it.places ?? []).map((k) => places.get('p:' + k)).filter((x): x is string => !!x);
    const fix = { note: it.fix.note, ...(it.fix.dueDays !== undefined ? { dueDays: it.fix.dueDays } : {}), ...(it.fix.external ? { external: true } : {}) };
    const [r] = await sql<{ id: string }[]>`insert into chk_items (tenant, title, category_id, place_type_ids, method, method_note, pass_criteria, blind_spots, fix_action, cycle, share_staff, tpl_key, created_by)
      values (${tenant}, ${it.title}, ${cats.get('c:' + it.category) ?? null}, ${placeIds}::uuid[], ${it.method}, ${it.methodNote ?? null}, ${it.pass}, ${it.blind}, ${sql.json(fix as never)}, ${it.cycle},
        ${!!it.share}, ${`i:${tpl.key}:${it.key}`}, ${byUser})
      on conflict (tenant, tpl_key) where tpl_key is not null do nothing returning id`;
    if (!r) continue;
    n++;
    const snapshot = { title: it.title, categoryId: cats.get('c:' + it.category) ?? null, placeTypeIds: placeIds, unitScope: 'all', orgUnitIds: [], method: it.method, methodNote: it.methodNote ?? null, passCriteria: it.pass,
      blindSpots: it.blind, fixAction: fix, cycle: it.cycle, checkerRole: null, externalRef: null, basisNote: null, shareStaff: !!it.share };
    await sql`insert into chk_item_versions (tenant, item_id, version, snapshot, reason, by_user) values (${tenant}, ${r.id}, 1, ${sql.json(snapshot as never)}, ${`템플릿(${tpl.name})에서 설치`}, ${byUser})`;
  }
  return { installed: true, items: n };
}

/** 여러 템플릿을 한 번에(가입·처음 열 때) — 공통 기본을 먼저(업종 항목이 공통 분야를 씀) */
export async function installCheckTemplates(sql: Sql, tenant: string, keys: string[], byUser: string | null) {
  const out: Record<string, { installed: boolean; items: number }> = {};
  for (const k of ['common', ...keys.filter((x) => x !== 'common')]) { const tpl = CHECK_TEMPLATES[k]; if (tpl) out[k] = await installOne(sql, tenant, tpl, byUser); }
  return out;
}
/** 이 회사에 아직 아무 템플릿도 설치한 적이 없으면: 공통 기본 + 회사 업종의 템플릿(가입 때 못 넣은 예전 회사용). 이미 있으면 아무것도 안 함 */
export async function ensureCheckTemplates(tenant: string, byUser: string | null = null) {
  const sql = db();
  if ((await sql`select 1 from chk_installs where tenant = ${tenant} limit 1`).length) return;
  const [t] = await sql<{ industry: string | null; industries: string[] | null }[]>`select industry, industries from tenants where id = ${tenant}`;
  await sql.begin((tx) => installCheckTemplates(tx as unknown as Sql, tenant, templatesForIndustries([t?.industry, ...(t?.industries ?? [])]), byUser));
}

/** 가이드 화면: 넣을 수 있는 템플릿 목록(설치 여부) */
export async function listTemplates(u: SessionUser) {
  await requireMenu(u, 'check_guide', 'view');
  const done = new Set((await db()<{ tpl: string }[]>`select tpl from chk_installs where tenant = ${tenantOf(u)}`).map((r) => r.tpl));
  return { templates: Object.values(CHECK_TEMPLATES).map((t) => ({ key: t.key, name: t.name, description: t.description, items: t.items.length, placeTypes: t.placeTypes.length, installed: done.has(t.key) })) };
}
export const installInput = z.object({ key: z.string().trim().max(40) });
/** 관리자가 업종 템플릿을 더 넣기 — 편집 권한 */
export async function installTemplate(u: SessionUser, i: z.infer<typeof installInput>) {
  await requireMenu(u, 'check_guide', 'edit');
  if (!CHECK_TEMPLATES[i.key]) throw badRequest('없는 템플릿입니다');
  const sql = db(); const t = tenantOf(u);
  const r = await sql.begin((tx) => installCheckTemplates(tx as unknown as Sql, t, [i.key], u.id));
  return { key: i.key, ...(r[i.key] ?? { installed: false, items: 0 }) };
}
