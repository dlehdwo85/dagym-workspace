import { z } from 'zod';
import { db } from '../db';
import { HttpError, badRequest, notFound } from '../errors';
import { audit } from '../log';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';
import { GLOBAL, TENANT } from './migrate';
import { STAGES } from './srcViews';
import { srcConfigured, srcCount } from './supabaseSrc';

/**
 * V41 단계 2 전환 T-1(docs/research/SALES_CUTOVER_PLAN.md).
 * ① 동결 시점 원본 건수 기록(표별 count + 관련 공고) — 대조 기준(V39 E 숫자는 참고만, 원본이 매일 늘어서)
 * ② 옮긴 원본 행(sales_src_rows) → 쓰기용 정식 표 변환(원본 id 기준 멱등)
 * ③ 대조: 기준 건수 = 옮긴 행 수 = 정식 표 행 수. 하나라도 다르면 ok=false(쓰기 열기 불가)
 * 쓰기는 sales_cutover.writes_open = true 일 때만(T-5, 대표 결정 뒤). 그 전에는 409.
 */
const RECORD_KINDS = ['sales_activities', 'proposals', 'contracts', 'lead_opportunity_timing', 'lead_business_interests', 'sales_costs'];
const WORK_TBLS = ['opportunity_work', 'procurement_notices__progress', 'operating_facility_prospects__progress', 'vendor_registrations__progress'];
const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return null; };
const dateOf = (v: unknown) => { const s = v ? String(v).slice(0, 10) : ''; return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };
const numOf = (v: unknown) => { const n = Number(String(v ?? '').replace(/[,\s원]/g, '')); return v !== null && v !== undefined && String(v).trim() !== '' && Number.isFinite(n) ? n : null; };
const tsOf = (v: unknown) => { const d = v ? new Date(String(v)) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };

function platformOnly(u: SessionUser) { if (!u.platformAdmin || u.support) throw notFound(); }

/** ① 동결 시점 원본 건수(원본을 읽기만) */
export async function snapshotSource(u: SessionUser, tenant: string) {
  platformOnly(u);
  if (!srcConfigured()) throw new HttpError(409, 'sales_src_not_configured', 'SALES_SRC_URL·SALES_SRC_SERVICE_KEY 설정이 필요합니다');
  // 원본에 없는 표(404)는 null = '원본에 없음'(옮긴 행도 0이어야 맞음). 그 밖의 읽기 오류는 기준을 남기지 않고 멈춤
  const counts: Record<string, number | null> = {};
  const read = async (tbl: string, filter = '') => { try { return await srcCount(tbl, filter); } catch (e: any) { if (/ 404/.test(String(e?.message))) return null; throw new HttpError(502, 'sales_src_read', String(e?.message ?? e).slice(0, 200)); } };
  for (const tbl of [...Object.keys(GLOBAL), ...TENANT]) counts[tbl] = await read(tbl);
  counts.related = await read('procurement_notices', 'related=is.true');
  const sql = db();
  await sql`insert into sales_cutover (tenant, frozen_at, src_counts, ok, updated_by) values (${tenant}, now(), ${sql.json(counts)}, false, ${u.id})
    on conflict (tenant) do update set frozen_at = now(), src_counts = excluded.src_counts, ok = false, mismatches = null, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'sales_cutover.snapshot', 'tenant', null, { tenant }).catch(() => {});
  return { tenant, srcCounts: counts };
}

/** ② 정식 표로 변환(멱등) */
export async function convertToFormal(tenant: string) {
  const sql = db();
  const users = new Map((await sql<{ src_user_id: string; user_id: string | null }[]>`select src_user_id, user_id from sales_user_map where tenant = ${tenant}`).map((r) => [r.src_user_id, r.user_id]));
  const src = async (scope: string, tbl: string) => (await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = ${scope} and tbl = ${tbl} and not gone`);
  await sql.begin(async (tx) => {
    for (const { src_id, row: r } of await src(tenant, 'leads')) {
      const v = { tenant, src_id, name: String(pick(r, 'name', 'company_name', 'facility_name', 'title', 'organization') ?? '(이름 없음)').slice(0, 300),
        status: pick(r, 'sales_status', 'status', 'stage'), priority: pick(r, 'priority'), facility_type: pick(r, 'facility_type', 'type', 'category'), region: pick(r, 'region', 'sido', 'area'),
        owner_id: users.get(String(pick(r, 'owner_id', 'assigned_to', 'sales_owner_id', 'user_id') ?? '')) ?? null, next_contact_date: dateOf(pick(r, 'next_contact_date', 'next_contact_at', 'next_action_date')),
        contact_name: pick(r, 'contact_name', 'manager_name'), phone: pick(r, 'phone', 'contact_phone'), expected_revenue: numOf(pick(r, 'expected_revenue', 'expected_amount', 'estimated_revenue')),
        memo: pick(r, 'memo', 'notes', 'note'), src: tx.json(r), created_at: tsOf(r.created_at) ?? new Date(), updated_at: tsOf(r.updated_at) ?? new Date() };
      await tx`insert into sales_leads ${tx(v as never)} on conflict (tenant, src_id) do update set name = excluded.name, status = excluded.status, priority = excluded.priority, facility_type = excluded.facility_type,
        region = excluded.region, owner_id = excluded.owner_id, next_contact_date = excluded.next_contact_date, contact_name = excluded.contact_name, phone = excluded.phone,
        expected_revenue = excluded.expected_revenue, memo = excluded.memo, src = excluded.src, updated_at = excluded.updated_at`;
    }
    const leadIds = new Map((await tx<{ src_id: string; id: string }[]>`select src_id, id from sales_leads where tenant = ${tenant}`).map((r) => [r.src_id, r.id]));
    for (const kind of RECORD_KINDS) for (const { src_id, row: r } of await src(tenant, kind)) {
      await tx`insert into sales_lead_records (tenant, kind, src_id, lead_id, occurred_at, data) values (${tenant}, ${kind}, ${src_id}, ${leadIds.get(String(r.lead_id ?? '')) ?? null},
        ${tsOf(pick(r, 'activity_date', 'occurred_at', 'contract_date', 'proposal_date', 'created_at'))}, ${tx.json(r)})
        on conflict (tenant, kind, src_id) do update set lead_id = excluded.lead_id, occurred_at = excluded.occurred_at, data = excluded.data`;
    }
    for (const tbl of WORK_TBLS) for (const { src_id, row: r } of await src(tenant, tbl)) {
      const ref = tbl.endsWith('__progress') ? src_id : String(pick(r, 'notice_id', 'procurement_notice_id', 'source_id') ?? '');
      await tx`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, lead_id, data) values (${tenant}, ${tbl}, ${src_id}, ${ref || null},
        ${pick(r, 'status', 'contact_status', 'classification')}, ${leadIds.get(String(r.lead_id ?? '')) ?? null}, ${tx.json(r)})
        on conflict (tenant, src_tbl, src_id) do update set ref_id = excluded.ref_id, status = excluded.status, lead_id = excluded.lead_id, data = excluded.data, updated_at = now()`;
    }
  });
}

/** ③ 대조: 동결 기준 건수 vs 옮긴 행 vs 정식 표 */
export async function verifyCutover(tenant: string) {
  const sql = db();
  const [c] = await sql<any[]>`select * from sales_cutover where tenant = ${tenant}`;
  if (!c?.src_counts) throw badRequest('먼저 동결 시점 원본 건수를 기록하세요');
  const copied = Object.fromEntries((await sql<{ scope: string; tbl: string; n: number }[]>`select scope, tbl, count(*)::int n from sales_src_rows where (scope = 'global' or scope = ${tenant}) and not gone group by scope, tbl`).map((r) => [r.tbl, r.n]));
  const [rel] = await sql<{ n: number }[]>`select count(*)::int n from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and (row->>'related')::boolean is true`;
  const formal: Record<string, number> = { leads: (await sql<{ n: number }[]>`select count(*)::int n from sales_leads where tenant = ${tenant} and src_id is not null`)[0].n };
  for (const r of await sql<{ kind: string; n: number }[]>`select kind, count(*)::int n from sales_lead_records where tenant = ${tenant} and src_id is not null group by kind`) formal[r.kind] = r.n;
  for (const r of await sql<{ src_tbl: string; n: number }[]>`select src_tbl, count(*)::int n from sales_work_records where tenant = ${tenant} group by src_tbl`) formal[r.src_tbl] = r.n;
  const mismatches: { item: string; source: number | null; copied: number; formal?: number }[] = [];
  for (const [tbl, n] of Object.entries(c.src_counts as Record<string, number | null>)) {
    // 공용 수집 표(공고 등)는 원본 동결 뒤에도 수집이 계속돼 늘 수 있음 → 기준보다 적을 때만 불일치. 회사별 표는 정확히 같아야 함
    if (tbl === 'related') { if (rel.n < (n ?? 0)) mismatches.push({ item: '관련 공고', source: n, copied: rel.n }); continue; }
    const got = copied[tbl] ?? 0;
    const f = tbl === 'leads' || RECORD_KINDS.includes(tbl) || WORK_TBLS.includes(tbl) ? formal[tbl] ?? 0 : undefined;
    const short = tbl in GLOBAL ? got < (n ?? 0) : (n ?? 0) !== got;
    if (short || (f !== undefined && f !== got)) mismatches.push({ item: tbl, source: n, copied: got, ...(f !== undefined ? { formal: f } : {}) });
  }
  // 원본 건수로 셀 수 없는 '<표>__progress'(옮길 때 떼어 낸 것)는 옮긴 행 = 정식 표만 대조
  for (const tbl of WORK_TBLS.filter((t) => t.endsWith('__progress'))) if ((copied[tbl] ?? 0) !== (formal[tbl] ?? 0)) mismatches.push({ item: tbl, source: null, copied: copied[tbl] ?? 0, formal: formal[tbl] ?? 0 });
  const ok = mismatches.length === 0;
  const dst = { ...copied, related: rel.n, formal };
  await sql`update sales_cutover set converted_at = now(), dst_counts = ${sql.json(dst)}, ok = ${ok}, mismatches = ${sql.json(mismatches)}, updated_at = now() where tenant = ${tenant}`;
  return { tenant, ok, mismatches, srcCounts: c.src_counts, dstCounts: dst };
}

export async function writesOpen(tenant: string) {
  const [c] = await db()<{ writes_open: boolean }[]>`select writes_open from sales_cutover where tenant = ${tenant}`;
  return !!c?.writes_open;
}
export async function convertAndVerify(u: SessionUser, tenant: string) {
  platformOnly(u);
  // 쓰기를 연 뒤 다시 변환하면 워크인에서 고친 내용을 원본 값으로 덮어씀 → 막음(닫고 나서만)
  if (await writesOpen(tenant)) throw new HttpError(409, 'cutover_open', '쓰기가 열린 뒤에는 다시 변환하지 않습니다(워크인 수정분 보호) — 필요하면 먼저 쓰기를 닫으세요');
  await convertToFormal(tenant);
  const r = await verifyCutover(tenant);
  await audit(db(), u.id, 'sales_cutover.convert', 'tenant', null, { tenant, ok: r.ok, mismatches: r.mismatches.length }).catch(() => {});
  return r;
}

/** T-5: 대조가 맞은 회사만 쓰기 열기(대표 결정 뒤 플랫폼 운영자가) · 다시 닫기 */
export async function setWritesOpen(u: SessionUser, tenant: string, open: boolean) {
  platformOnly(u);
  const sql = db();
  const [c] = await sql<{ ok: boolean }[]>`select ok from sales_cutover where tenant = ${tenant}`;
  if (open && !c?.ok) throw new HttpError(409, 'cutover_not_verified', '건수 대조가 맞아야 쓰기를 열 수 있습니다');
  await sql`update sales_cutover set writes_open = ${open}, updated_by = ${u.id}, updated_at = now() where tenant = ${tenant}`;
  await audit(sql, u.id, open ? 'sales_cutover.open' : 'sales_cutover.close', 'tenant', null, { tenant }).catch(() => {});
  return { tenant, writesOpen: open };
}
export async function cutoverStatus(u: SessionUser) {
  platformOnly(u);
  return { cutovers: await db()`select tenant, frozen_at, src_counts, converted_at, dst_counts, ok, mismatches, writes_open, updated_at from sales_cutover order by tenant` };
}

async function assertWritesOpen(tenant: string) {
  if (!(await writesOpen(tenant))) throw new HttpError(409, 'sales_read_only', '영업관리 전환 전이라 워크인에서는 고칠 수 없습니다 — 전환일까지는 영업관리에서 수정해 주세요');
}

// ---------------- 쓰기(전환 뒤) — V39 D: 보류·실패는 사유 필수, 담당 변경 권한은 서버 검사 ----------------
export const leadPatch = z.object({ name: z.string().trim().min(1).max(300).optional(), priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().optional(), status: z.enum(STAGES as [string, ...string[]]).optional(), reason: z.string().trim().max(500).optional(),
  nextContactDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), memo: z.string().max(5000).nullable().optional(), ownerId: z.string().uuid().nullable().optional() });
export async function updateLead(u: SessionUser, id: string, i: z.infer<typeof leadPatch>) {
  await assertSpace(u, 'sales');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const t = tenantOf(u); const sql = db();
  const [l] = await sql<any[]>`select id, status, owner_id from sales_leads where id = ${id} and tenant = ${t}`;
  if (!l) throw notFound();
  await assertWritesOpen(t);
  if (i.status && ['보류', '실패'].includes(i.status) && !i.reason) throw badRequest(`'${i.status}'(으)로 바꿀 때는 사유가 필요합니다`);
  const admin = ['owner', 'admin'].includes(u.role);
  if (i.ownerId !== undefined && !admin) throw new HttpError(403, 'forbidden', '담당자 변경은 관리자가 합니다');
  if (!admin && l.owner_id && l.owner_id !== u.id) throw new HttpError(403, 'forbidden', '담당 리드만 고칠 수 있습니다');
  if (i.ownerId && !(await sql`select 1 from users where id = ${i.ownerId} and tenant = ${t} and status = 'active'`).length) throw badRequest('그 사람을 찾을 수 없습니다');
  await sql.begin(async (tx) => {
    await tx`update sales_leads set status = coalesce(${i.status ?? null}, status), name = coalesce(${i.name ?? null}, name), priority = ${i.priority === undefined ? tx`priority` : i.priority},
      next_contact_date = ${i.nextContactDate === undefined ? tx`next_contact_date` : i.nextContactDate}, memo = ${i.memo === undefined ? tx`memo` : i.memo},
      owner_id = ${i.ownerId === undefined ? tx`owner_id` : i.ownerId}, updated_at = now() where id = ${id}`;
    if (i.status && i.status !== l.status) await tx`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${t}, ${id}, ${l.status}, ${i.status}, ${i.reason ?? null}, ${u.id})`;
  });
  // 대표 10/20 14:15: 보류·실패·계약완료 → 열린 영업 업무 보류·완료, 다음 연락일 바꾸면 업무 마감도
  if (i.status || i.nextContactDate !== undefined) {
    const [cur] = await sql<{ name: string; status: string; next: string | null; owner_id: string | null }[]>`select name, status, next_contact_date::text as next, owner_id from sales_leads where id = ${id}`;
    await (await import('./autoTasks')).syncSalesTask(sql, u, { kind: 'lead', id, name: cur.name, status: cur.status, nextDate: cur.next, assigneeId: cur.owner_id, leadId: id });
  }
  return { ok: true };
}

export const leadCreate = z.object({ name: z.string().trim().min(1).max(300), status: z.enum(STAGES as [string, ...string[]]).default('신규리드'), priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  facilityType: z.string().max(100).optional(), region: z.string().max(50).optional(), contactName: z.string().max(100).optional(), phone: z.string().max(40).optional(),
  nextContactDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), memo: z.string().max(5000).optional() });
/** 새 리드(전환 뒤) — 담당 = 만든 사람 */
export async function createLead(u: SessionUser, i: z.infer<typeof leadCreate>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); await assertWritesOpen(t);
  const [r] = await db()<{ id: string }[]>`insert into sales_leads (tenant, name, status, priority, facility_type, region, owner_id, next_contact_date, contact_name, phone, memo)
    values (${t}, ${i.name}, ${i.status}, ${i.priority ?? null}, ${i.facilityType ?? null}, ${i.region ?? null}, ${u.id}, ${i.nextContactDate ?? null}, ${i.contactName ?? null}, ${i.phone ?? null}, ${i.memo ?? null}) returning id`;
  // 대표 10/20 14:15(원본 규칙 '[첫 연락]' 업무 자동): 새 리드 → 담당자 업무
  await (await import('./autoTasks')).syncSalesTask(db(), u, { kind: 'lead', id: r.id, name: i.name, status: i.status, nextDate: i.nextContactDate ?? null, nextAction: '첫 연락', leadId: r.id });
  return { id: r.id };
}
export const activityInput = z.object({ type: z.enum(['전화', '방문', '미팅', '메일', '문자', '기타']).default('전화'), content: z.string().trim().min(1).max(5000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
/** 상담(활동) 기록 추가 — 담당자·관리자 */
export async function addActivity(u: SessionUser, leadId: string, i: z.infer<typeof activityInput>) {
  await assertSpace(u, 'sales');
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw notFound();
  const t = tenantOf(u); const sql = db();
  const [l] = await sql<{ owner_id: string | null }[]>`select owner_id from sales_leads where id = ${leadId} and tenant = ${t}`;
  if (!l) throw notFound();
  await assertWritesOpen(t);
  if (!['owner', 'admin'].includes(u.role) && l.owner_id && l.owner_id !== u.id) throw new HttpError(403, 'forbidden', '담당 리드만 기록할 수 있습니다');
  const day = i.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const [r] = await sql<{ id: string }[]>`insert into sales_lead_records (tenant, kind, lead_id, occurred_at, data) values (${t}, 'sales_activities', ${leadId}, ${new Date(`${day}T12:00:00+09:00`)},
    ${sql.json({ activity_type: i.type, content: i.content, activity_date: day, created_by: u.id, created_by_name: u.name })}) returning id`;
  await sql`update sales_leads set updated_at = now() where id = ${leadId}`;
  return { id: r.id };
}
