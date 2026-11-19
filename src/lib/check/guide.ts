// 점검 1단계 — 점검 가이드: 분야 · 공간 유형 · 공간 · 점검 항목 · 개정 이력
// (대표 11/19 "점검 개발 시작" · docs/check-feature-design.md · docs/reference/prompt-b-check-feature.md)
// 원칙: 모든 줄에 회사(tenant) — 다른 회사 것은 없는 것처럼 404. 권한은 메뉴 권한 check_guide(보기/편집).
// 직원은 가이드 전체가 아니라 '직원 공유' 표시된 양호 기준만 본다(sharedItems).
import { z } from 'zod';
import { db, type Sql } from '../db';
import { accessibleUnitIds } from '../access';
import { badRequest, notFound } from '../errors';
import { requireMenu } from '../menuPerms';
import { tenantOf, type SessionUser } from '../types';

/** 확인 방법 — 프롬프트 B 의 선택지 그대로 */
export const METHODS = { look: '직접 보기', operate: '작동해 보기', record: '기록 확인', photo: '사진 비교', observe: '참관' } as const;
export type Method = keyof typeof METHODS;
/** 권장 주기 */
export const CYCLES = { daily: '매일', weekly: '매주', monthly: '매월', quarterly: '분기마다', yearly: '해마다', as_needed: '필요할 때' } as const;
export type Cycle = keyof typeof CYCLES;

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(60);

// ---------- 분야(2단계) ----------
export const categoryInput = z.object({ name, parentId: uuid.nullable().optional(), icon: z.string().trim().max(40).nullable().optional(), sort: z.number().int().min(0).max(9999).optional(), active: z.boolean().optional() });
export async function listCategories(u: SessionUser) {
  await requireMenu(u, 'check_guide', 'view');
  const rows = await db()<{ id: string; parent_id: string | null; name: string; icon: string | null; sort: number; active: boolean; items: number }[]>`
    select c.id, c.parent_id, c.name, c.icon, c.sort, c.active,
      (select count(*)::int from chk_items i where i.tenant = c.tenant and i.category_id = c.id and i.active) as items
    from chk_categories c where c.tenant = ${tenantOf(u)} order by c.parent_id nulls first, c.sort, c.name`;
  return { categories: rows };
}
export async function saveCategory(u: SessionUser, id: string | null, i: z.infer<typeof categoryInput>) {
  await requireMenu(u, 'check_guide', 'edit');
  const sql = db(); const t = tenantOf(u);
  if (i.parentId) {
    // 2단계까지만: 위 분야는 맨 위 분야여야 하고, 자기 자신·아래 분야를 위로 둘 수 없다
    const [p] = await sql<{ parent_id: string | null }[]>`select parent_id from chk_categories where id = ${i.parentId} and tenant = ${t}`;
    if (!p) throw notFound();
    if (p.parent_id || i.parentId === id) throw badRequest('분야는 2단계까지만 만들 수 있습니다');
    if (id && (await sql`select 1 from chk_categories where tenant = ${t} and parent_id = ${id} limit 1`).length) throw badRequest('아래 분야가 있는 분야는 다른 분야 아래로 옮길 수 없습니다');
  }
  if (!id) {
    const [r] = await sql<{ id: string }[]>`insert into chk_categories (tenant, parent_id, name, icon, sort, active)
      values (${t}, ${i.parentId ?? null}, ${i.name}, ${i.icon ?? null}, ${i.sort ?? 0}, ${i.active ?? true}) returning id`;
    return { id: r.id };
  }
  const [r] = await sql<{ id: string }[]>`update chk_categories set name = ${i.name}, parent_id = ${i.parentId === undefined ? sql`parent_id` : i.parentId}, icon = ${i.icon === undefined ? sql`icon` : i.icon},
      sort = ${i.sort === undefined ? sql`sort` : i.sort}, active = ${i.active === undefined ? sql`active` : i.active}, updated_at = now()
    where id = ${id} and tenant = ${t} returning id`;
  if (!r) throw notFound();
  return { id: r.id };
}
/** 지우기: 이 분야(와 아래 분야)를 쓰는 항목이 있으면 지우지 않고 '안 씀'으로만 */
export async function removeCategory(u: SessionUser, id: string) {
  await requireMenu(u, 'check_guide', 'edit');
  const sql = db(); const t = tenantOf(u);
  const [c] = await sql<{ id: string }[]>`select id from chk_categories where id = ${id} and tenant = ${t}`;
  if (!c) throw notFound();
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from chk_items i where i.tenant = ${t}
    and i.category_id in (select id from chk_categories where tenant = ${t} and (id = ${id} or parent_id = ${id}))`;
  if (n > 0) { await sql`update chk_categories set active = false, updated_at = now() where tenant = ${t} and (id = ${id} or parent_id = ${id})`; return { removed: false, deactivated: true, items: n }; }
  await sql`delete from chk_categories where tenant = ${t} and id = ${id}`;
  return { removed: true, deactivated: false, items: 0 };
}

// ---------- 공간 유형 ----------
export const placeTypeInput = z.object({ name, sort: z.number().int().min(0).max(9999).optional(), active: z.boolean().optional() });
export async function listPlaceTypes(u: SessionUser) {
  await requireMenu(u, 'check_guide', 'view');
  return { placeTypes: await db()`select id, name, sort, active from chk_place_types where tenant = ${tenantOf(u)} order by sort, name` };
}
export async function savePlaceType(u: SessionUser, id: string | null, i: z.infer<typeof placeTypeInput>) {
  await requireMenu(u, 'check_guide', 'edit');
  const sql = db(); const t = tenantOf(u);
  if (!id) { const [r] = await sql<{ id: string }[]>`insert into chk_place_types (tenant, name, sort, active) values (${t}, ${i.name}, ${i.sort ?? 0}, ${i.active ?? true}) returning id`; return { id: r.id }; }
  const [r] = await sql<{ id: string }[]>`update chk_place_types set name = ${i.name}, sort = ${i.sort === undefined ? sql`sort` : i.sort}, active = ${i.active === undefined ? sql`active` : i.active}
    where id = ${id} and tenant = ${t} returning id`;
  if (!r) throw notFound();
  return { id: r.id };
}

// ---------- 공간(지점별) ----------
export const placeInput = z.object({ name, orgUnitId: uuid, placeTypeId: uuid.nullable().optional(), sort: z.number().int().min(0).max(9999).optional(), active: z.boolean().optional() });
/** 이 회사의 조직이고 내가 볼 수 있는 조직인지(아니면 없는 것처럼) */
async function assertUnit(u: SessionUser, unitId: string, sql: Sql) {
  const [o] = await sql`select 1 from org_units where id = ${unitId} and tenant = ${tenantOf(u)}`;
  const mine = await accessibleUnitIds(u, sql);
  if (!o || (mine !== null && !mine.includes(unitId))) throw notFound();
}
async function assertPlaceTypes(t: string, ids: string[], sql: Sql) {
  if (!ids.length) return;
  const rows = await sql<{ id: string }[]>`select id from chk_place_types where tenant = ${t} and id = any(${ids}::uuid[])`;
  if (rows.length !== new Set(ids).size) throw notFound();
}
export async function listPlaces(u: SessionUser, unitId?: string | null) {
  await requireMenu(u, 'check_guide', 'view');
  const sql = db(); const mine = await accessibleUnitIds(u, sql);
  const rows = await sql`select p.id, p.name, p.org_unit_id, o.name as org_unit_name, p.place_type_id, pt.name as place_type_name, p.sort, p.active
    from chk_places p join org_units o on o.id = p.org_unit_id left join chk_place_types pt on pt.id = p.place_type_id
    where p.tenant = ${tenantOf(u)} ${unitId ? sql`and p.org_unit_id = ${unitId}` : sql``} ${mine === null ? sql`` : sql`and p.org_unit_id = any(${mine}::uuid[])`}
    order by o.name, p.sort, p.name`;
  return { places: rows };
}
export async function savePlace(u: SessionUser, id: string | null, i: z.infer<typeof placeInput>) {
  await requireMenu(u, 'check_guide', 'edit');
  const sql = db(); const t = tenantOf(u);
  await assertUnit(u, i.orgUnitId, sql);
  if (i.placeTypeId) await assertPlaceTypes(t, [i.placeTypeId], sql);
  if (!id) {
    const [r] = await sql<{ id: string }[]>`insert into chk_places (tenant, org_unit_id, place_type_id, name, sort, active)
      values (${t}, ${i.orgUnitId}, ${i.placeTypeId ?? null}, ${i.name}, ${i.sort ?? 0}, ${i.active ?? true}) returning id`;
    return { id: r.id };
  }
  const [cur] = await sql<{ org_unit_id: string }[]>`select org_unit_id from chk_places where id = ${id} and tenant = ${t}`;
  if (!cur) throw notFound();
  await assertUnit(u, cur.org_unit_id, sql);
  await sql`update chk_places set name = ${i.name}, org_unit_id = ${i.orgUnitId}, place_type_id = ${i.placeTypeId === undefined ? sql`place_type_id` : i.placeTypeId},
    sort = ${i.sort === undefined ? sql`sort` : i.sort}, active = ${i.active === undefined ? sql`active` : i.active} where id = ${id} and tenant = ${t}`;
  return { id };
}

// ---------- 점검 항목 ----------
const line = z.string().trim().min(1).max(200);
export const itemInput = z.object({
  title: z.string().trim().min(1).max(120),
  categoryId: uuid.nullable().optional(),
  placeTypeIds: z.array(uuid).max(30).optional(),
  unitScope: z.enum(['all', 'some']).optional(),
  orgUnitIds: z.array(uuid).max(200).optional(),
  method: z.enum(['look', 'operate', 'record', 'photo', 'observe']).optional(),
  methodNote: z.string().trim().max(500).nullable().optional(),
  passCriteria: z.string().trim().max(1000).optional(),
  blindSpots: z.array(line).max(20).optional(),
  fixAction: z.object({ note: z.string().trim().max(300).optional(), role: z.string().trim().max(40).optional(), dueDays: z.number().int().min(0).max(365).optional(), external: z.boolean().optional() }).optional(),
  cycle: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'as_needed']).nullable().optional(),
  checkerRole: z.string().trim().max(40).nullable().optional(),
  externalRef: z.string().trim().max(120).nullable().optional(),
  basisNote: z.string().trim().max(1000).nullable().optional(),
  shareStaff: z.boolean().optional(),
  active: z.boolean().optional(),
  /** 고친 까닭(개정 이력에 남음) */
  reason: z.string().trim().max(300).optional(),
});
export type ItemInput = z.infer<typeof itemInput>;
type ItemRow = { id: string; title: string; category_id: string | null; place_type_ids: string[]; unit_scope: 'all' | 'some'; org_unit_ids: string[]; method: Method; method_note: string | null;
  pass_criteria: string; blind_spots: string[]; fix_action: Record<string, unknown>; cycle: Cycle | null; checker_role: string | null; external_ref: string | null; basis_note: string | null;
  share_staff: boolean; version: number; active: boolean; updated_at: Date };
/** 개정 이력에 남기는 내용(판정에 쓰이는 칸 전부) — 사용 여부(active)만 바꾼 것은 개정이 아님 */
const snap = (r: ItemRow) => ({ title: r.title, categoryId: r.category_id, placeTypeIds: r.place_type_ids, unitScope: r.unit_scope, orgUnitIds: r.org_unit_ids, method: r.method, methodNote: r.method_note,
  passCriteria: r.pass_criteria, blindSpots: r.blind_spots, fixAction: r.fix_action, cycle: r.cycle, checkerRole: r.checker_role, externalRef: r.external_ref, basisNote: r.basis_note, shareStaff: r.share_staff });
const COLS = (sql: Sql) => sql`i.id, i.title, i.category_id, i.place_type_ids, i.unit_scope, i.org_unit_ids, i.method, i.method_note, i.pass_criteria, i.blind_spots, i.fix_action, i.cycle, i.checker_role,
  i.external_ref, i.basis_note, i.share_staff, i.version, i.active, i.updated_at`;

async function assertItemRefs(u: SessionUser, i: ItemInput, sql: Sql) {
  const t = tenantOf(u);
  if (i.categoryId && !(await sql`select 1 from chk_categories where id = ${i.categoryId} and tenant = ${t}`).length) throw notFound();
  await assertPlaceTypes(t, i.placeTypeIds ?? [], sql);
  for (const id of i.orgUnitIds ?? []) await assertUnit(u, id, sql);
  if (i.unitScope === 'some' && !(i.orgUnitIds ?? []).length) throw badRequest('적용할 곳을 한 곳 이상 골라 주세요');
}
export async function listItems(u: SessionUser, f: { categoryId?: string | null; placeTypeId?: string | null; unitId?: string | null; q?: string | null; all?: boolean } = {}) {
  await requireMenu(u, 'check_guide', 'view');
  const sql = db(); const t = tenantOf(u);
  const q = (f.q ?? '').trim().slice(0, 60);
  const rows = await sql`select ${COLS(sql)}, c.name as category_name,
      (select count(*)::int from chk_photos p where p.tenant = i.tenant and p.owner_kind = 'item' and p.owner_id = i.id and p.upload_status = 'ready') as photos
    from chk_items i left join chk_categories c on c.id = i.category_id
    where i.tenant = ${t} ${f.all ? sql`` : sql`and i.active`}
      ${f.categoryId ? sql`and (i.category_id = ${f.categoryId} or c.parent_id = ${f.categoryId})` : sql``}
      ${f.placeTypeId ? sql`and ${f.placeTypeId}::uuid = any(i.place_type_ids)` : sql``}
      ${f.unitId ? sql`and (i.unit_scope = 'all' or ${f.unitId}::uuid = any(i.org_unit_ids))` : sql``}
      ${q ? sql`and (i.title ilike ${'%' + q + '%'} or i.pass_criteria ilike ${'%' + q + '%'})` : sql``}
    order by c.sort nulls last, c.name nulls last, i.title limit 500`;
  return { items: rows, methods: METHODS, cycles: CYCLES };
}
export async function getItem(u: SessionUser, id: string) {
  await requireMenu(u, 'check_guide', 'view');
  const sql = db(); const t = tenantOf(u);
  const [item] = await sql`select ${COLS(sql)}, c.name as category_name from chk_items i left join chk_categories c on c.id = i.category_id where i.id = ${id} and i.tenant = ${t}`;
  if (!item) throw notFound();
  const versions = await sql`select v.version, v.reason, v.at, v.snapshot, us.name as by_name from chk_item_versions v left join users us on us.id = v.by_user
    where v.item_id = ${id} and v.tenant = ${t} order by v.version desc limit 50`;
  return { item, versions };
}
export async function createItem(u: SessionUser, i: ItemInput) {
  await requireMenu(u, 'check_guide', 'edit');
  const sql = db(); const t = tenantOf(u);
  await assertItemRefs(u, i, sql);
  return sql.begin(async (tx) => {
    const [r] = await tx<ItemRow[]>`insert into chk_items (tenant, title, category_id, place_type_ids, unit_scope, org_unit_ids, method, method_note, pass_criteria, blind_spots, fix_action, cycle, checker_role,
        external_ref, basis_note, share_staff, active, created_by)
      values (${t}, ${i.title}, ${i.categoryId ?? null}, ${i.placeTypeIds ?? []}::uuid[], ${i.unitScope ?? 'all'}, ${i.unitScope === 'some' ? i.orgUnitIds ?? [] : []}::uuid[], ${i.method ?? 'look'}, ${i.methodNote ?? null},
        ${i.passCriteria ?? ''}, ${i.blindSpots ?? []}, ${tx.json((i.fixAction ?? {}) as never)}, ${i.cycle ?? null}, ${i.checkerRole ?? null}, ${i.externalRef ?? null}, ${i.basisNote ?? null},
        ${i.shareStaff ?? false}, ${i.active ?? true}, ${u.id})
      returning id, title, category_id, place_type_ids, unit_scope, org_unit_ids, method, method_note, pass_criteria, blind_spots, fix_action, cycle, checker_role, external_ref, basis_note, share_staff, version, active, updated_at`;
    await tx`insert into chk_item_versions (tenant, item_id, version, snapshot, reason, by_user) values (${t}, ${r.id}, 1, ${tx.json(snap(r) as never)}, ${i.reason ?? '처음 등록'}, ${u.id})`;
    return { id: r.id, version: 1 };
  });
}
export async function updateItem(u: SessionUser, id: string, i: Partial<ItemInput>) {
  await requireMenu(u, 'check_guide', 'edit');
  const sql = db(); const t = tenantOf(u);
  await assertItemRefs(u, i as ItemInput, sql);
  return sql.begin(async (tx) => {
    const [cur] = await tx<ItemRow[]>`select id, title, category_id, place_type_ids, unit_scope, org_unit_ids, method, method_note, pass_criteria, blind_spots, fix_action, cycle, checker_role, external_ref, basis_note,
      share_staff, version, active, updated_at from chk_items where id = ${id} and tenant = ${t} for update`;
    if (!cur) throw notFound();
    const scope = i.unitScope ?? cur.unit_scope;
    const next: ItemRow = { ...cur,
      title: i.title ?? cur.title, category_id: i.categoryId === undefined ? cur.category_id : i.categoryId, place_type_ids: i.placeTypeIds ?? cur.place_type_ids, unit_scope: scope,
      org_unit_ids: scope === 'all' ? [] : i.orgUnitIds ?? cur.org_unit_ids, method: i.method ?? cur.method, method_note: i.methodNote === undefined ? cur.method_note : i.methodNote,
      pass_criteria: i.passCriteria ?? cur.pass_criteria, blind_spots: i.blindSpots ?? cur.blind_spots, fix_action: (i.fixAction as Record<string, unknown> | undefined) ?? cur.fix_action,
      cycle: i.cycle === undefined ? cur.cycle : i.cycle, checker_role: i.checkerRole === undefined ? cur.checker_role : i.checkerRole, external_ref: i.externalRef === undefined ? cur.external_ref : i.externalRef,
      basis_note: i.basisNote === undefined ? cur.basis_note : i.basisNote, share_staff: i.shareStaff ?? cur.share_staff, active: i.active ?? cur.active };
    if (next.unit_scope === 'some' && !next.org_unit_ids.length) throw badRequest('적용할 곳을 한 곳 이상 골라 주세요');
    const revised = JSON.stringify(snap(next)) !== JSON.stringify(snap(cur)); // 내용이 바뀌었을 때만 개정(사용 여부만 바꾼 것은 아님)
    const version = revised ? cur.version + 1 : cur.version;
    await tx`update chk_items set title = ${next.title}, category_id = ${next.category_id}, place_type_ids = ${next.place_type_ids}::uuid[], unit_scope = ${next.unit_scope}, org_unit_ids = ${next.org_unit_ids}::uuid[],
      method = ${next.method}, method_note = ${next.method_note}, pass_criteria = ${next.pass_criteria}, blind_spots = ${next.blind_spots}, fix_action = ${tx.json(next.fix_action as never)}, cycle = ${next.cycle},
      checker_role = ${next.checker_role}, external_ref = ${next.external_ref}, basis_note = ${next.basis_note}, share_staff = ${next.share_staff}, active = ${next.active}, version = ${version}, updated_at = now()
      where id = ${id} and tenant = ${t}`;
    if (revised) await tx`insert into chk_item_versions (tenant, item_id, version, snapshot, reason, by_user) values (${t}, ${id}, ${version}, ${tx.json(snap(next) as never)}, ${i.reason ?? null}, ${u.id})`;
    return { id, version, revised };
  });
}

// ---------- 직원 공유: 양호 기준만 ----------
/** 메뉴 권한이 없어도 같은 회사 사람이면 봄 — '직원 공유' 표시된 사용 중 항목의 제목·분야·확인 방법·양호 기준·놓치기 쉬운 곳만(근거 메모·조치·연결값은 안 줌) */
export async function sharedItems(u: SessionUser) {
  const sql = db(); const mine = await accessibleUnitIds(u, sql);
  const rows = await sql`select i.id, i.title, c.name as category_name, i.method, i.pass_criteria, i.blind_spots
    from chk_items i left join chk_categories c on c.id = i.category_id
    where i.tenant = ${tenantOf(u)} and i.active and i.share_staff
      ${mine === null ? sql`` : sql`and (i.unit_scope = 'all' or i.org_unit_ids && ${mine}::uuid[])`}
    order by c.sort nulls last, c.name nulls last, i.title limit 500`;
  return { items: rows, methods: METHODS };
}
