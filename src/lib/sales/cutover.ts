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
  // 191차: 워크인 규칙이 판정을 바꾼 줄(judged_at — 예 대표 10/27 정정으로 '관련 아님'으로 내린 원본 복사 줄)도 복사된 줄로 셈 — 이 대조는 복사가 빠짐없는지를 봄
  const [rel] = await sql<{ n: number }[]>`select count(*)::int n from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and ((row->>'related')::boolean is true or row ? 'judged_at')`;
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
const leadFields = { facilityType: z.string().trim().max(100).nullable().optional(), region: z.string().trim().max(50).nullable().optional(), scale: z.string().trim().max(60).nullable().optional(), expectedRevenue: z.number().min(0).max(1e13).nullable().optional(),
  contactName: z.string().trim().max(100).nullable().optional(), phone: z.string().trim().max(40).nullable().optional(), email: z.string().trim().max(200).nullable().optional(), homepage: z.string().trim().max(300).nullable().optional(),
  bizNo: z.string().trim().max(20).nullable().optional() }; // S2 2차 리드 폼 13칸 · 205차 사업자번호(선택, 중복 대조)
export const leadPatch = z.object({ ...leadFields, name: z.string().trim().min(1).max(300).optional(), priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().optional(), status: z.enum(STAGES as [string, ...string[]]).optional(), reason: z.string().trim().max(500).optional(),
  nextContactDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), memo: z.string().max(5000).nullable().optional(), ownerId: z.string().uuid().nullable().optional(),
  /** 197차(#461): 다음 할 일(다음 연락일과 한 쌍 — 연락일을 지우면 같이 지움) · 다시 볼 날(보류·실패로 닫을 때, 그날 담당자 업무) */
  nextAction: z.string().trim().max(200).nullable().optional(), revisitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() });
/**
 * 204차(#461 ⑦ 일괄 작업, SALES_LEADS_REVAMP 5절): 여러 거래처를 한 번에 — 담당·단계(보류·실패 사유·다시 볼 날)·다음 연락일(+ 할 일).
 * 한 건씩 updateLead 로 바꿔 권한(담당만·담당 변경은 관리자)·단계 기록·영업 업무 맞춤이 한 건 고칠 때와 똑같다. 못 바꾼 건은 이름·이유와 함께 돌려준다(나머지는 그대로 진행)
 */
export const bulkLeadsInput = z.object({ ids: z.array(z.string().uuid()).min(1).max(100),
  patch: leadPatch.pick({ ownerId: true, status: true, reason: true, revisitDate: true, nextContactDate: true, nextAction: true }) })
  .refine((i) => Object.values(i.patch).some((v) => v !== undefined), { message: '바꿀 칸이 없습니다' });
export async function bulkLeads(u: SessionUser, i: z.infer<typeof bulkLeadsInput>) {
  await assertSpace(u, 'sales');
  const ids = [...new Set(i.ids)];
  const names = new Map((await db()<{ id: string; name: string }[]>`select id, name from sales_leads where id = any(${ids}) and tenant = ${tenantOf(u)} and deleted_at is null`).map((r) => [r.id, r.name]));
  let ok = 0; const failed: { id: string; name: string | null; message: string }[] = [];
  for (const id of ids) {
    try { await updateLead(u, id, i.patch); ok++; } catch (e) { failed.push({ id, name: names.get(id) ?? null, message: e instanceof HttpError ? e.message : '바꾸지 못했습니다' }); }
  }
  return { ok, failed };
}
export async function updateLead(u: SessionUser, id: string, i: z.infer<typeof leadPatch>) {
  await assertSpace(u, 'sales');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const t = tenantOf(u); const sql = db();
  const [l] = await sql<any[]>`select id, status, owner_id from sales_leads where id = ${id} and tenant = ${t} and deleted_at is null`;
  if (!l) throw notFound();
  await assertWritesOpen(t);
  if (i.status && ['보류', '실패'].includes(i.status) && !i.reason) throw badRequest(`'${i.status}'(으)로 바꿀 때는 사유가 필요합니다`);
  const closing = ['보류', '실패'].includes(i.status ?? l.status ?? '');
  if (i.revisitDate && !closing) throw badRequest("다시 볼 날은 '보류'·'실패'로 닫을 때만 정합니다");
  if (i.revisitDate && i.revisitDate <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())) throw badRequest('다시 볼 날은 내일 이후로 골라 주세요');
  const admin = ['owner', 'admin'].includes(u.role);
  if (i.ownerId !== undefined && !admin) throw new HttpError(403, 'forbidden', '담당자 변경은 관리자가 합니다');
  if (!admin && l.owner_id && l.owner_id !== u.id) throw new HttpError(403, 'forbidden', '담당 리드만 고칠 수 있습니다');
  if (i.ownerId && !(await sql`select 1 from users where id = ${i.ownerId} and tenant = ${t} and status = 'active'`).length) throw badRequest('그 사람을 찾을 수 없습니다');
  await sql.begin(async (tx) => {
    await tx`update sales_leads set status = coalesce(${i.status ?? null}, status), name = coalesce(${i.name ?? null}, name), priority = ${i.priority === undefined ? tx`priority` : i.priority},
      next_contact_date = ${i.nextContactDate === undefined ? tx`next_contact_date` : i.nextContactDate}, memo = ${i.memo === undefined ? tx`memo` : i.memo},
      next_action = ${i.nextAction !== undefined ? i.nextAction || null : i.nextContactDate === null ? null : tx`next_action`},
      revisit_date = ${i.revisitDate !== undefined ? i.revisitDate : i.status && !['보류', '실패'].includes(i.status) ? null : tx`revisit_date`},
      owner_id = ${i.ownerId === undefined ? tx`owner_id` : i.ownerId},
      facility_type = ${i.facilityType === undefined ? tx`facility_type` : i.facilityType}, region = ${i.region === undefined ? tx`region` : i.region}, scale = ${i.scale === undefined ? tx`scale` : i.scale},
      expected_revenue = ${i.expectedRevenue === undefined ? tx`expected_revenue` : i.expectedRevenue}, contact_name = ${i.contactName === undefined ? tx`contact_name` : i.contactName},
      phone = ${i.phone === undefined ? tx`phone` : i.phone}, email = ${i.email === undefined ? tx`email` : i.email}, homepage = ${i.homepage === undefined ? tx`homepage` : i.homepage},
      biz_no = ${i.bizNo === undefined ? tx`biz_no` : i.bizNo}, updated_at = now() where id = ${id}`;
    if (i.status && i.status !== l.status) await tx`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${t}, ${id}, ${l.status}, ${i.status}, ${i.reason ?? null}, ${u.id})`;
    if (i.ownerId !== undefined && i.ownerId !== l.owner_id) await audit(tx, u.id, 'sales.lead_owner', 'sales_lead', id, { from: l.owner_id, to: i.ownerId }, null); // 담당자 변경 로그
  });
  // 대표 10/20 14:15: 보류·실패·계약완료 → 열린 영업 업무 보류·완료, 다음 연락일 바꾸면 업무 마감도
  if (i.status || i.nextContactDate !== undefined) {
    const [cur] = await sql<{ name: string; status: string; next: string | null; next_action: string | null; owner_id: string | null }[]>`select name, status, next_contact_date::text as next, next_action, owner_id from sales_leads where id = ${id}`;
    await (await import('./autoTasks')).syncSalesTask(sql, u, { kind: 'lead', id, name: cur.name, status: cur.status, nextDate: cur.next, nextAction: cur.next_action, assigneeId: cur.owner_id, leadId: id });
  }
  return { ok: true };
}

export const leadCreate = z.object({ ...leadFields, name: z.string().trim().min(1).max(300), status: z.enum(STAGES as [string, ...string[]]).default('신규리드'), priority: z.enum(['urgent', 'high', 'medium', 'low']).optional(),
  nextContactDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), memo: z.string().max(5000).optional(), ownerId: z.string().uuid().optional(), reason: z.string().max(500).optional(),
  force: z.boolean().optional() /* 비슷한 거래처가 있어도 새로 */ });
const normName = (s: string) => s.replace(/[\s()（）·\-_,.]/g, '').toLowerCase();
/** 비슷한 이름 열쇠(앞 4자) — 205차: 회사 형태((주)·㈜·주식회사·유한회사·재단·사단법인)는 빼고 본다(이것만 같아도 '비슷함'이던 것) */
const simKey = (s: string) => normName(s.replace(/[(（]\s*주\s*[)）]|㈜|주식회사|유한회사|재단법인|사단법인/g, '')).slice(0, 4);
/** S2 2차: 비슷한 이름의 거래처(앞 4자, 최대 5곳) — 새 리드 중복 경고·[진행영업으로 넘기기]와 같은 규칙 */
export async function similarLeads(sql: ReturnType<typeof db>, tenant: string, name: string, excludeId?: string) {
  const key = simKey(name);
  if (key.length < 2) return [];
  return sql<{ id: string; name: string; status: string | null; region: string | null }[]>`select id, name, status, region from sales_leads where tenant = ${tenant} and deleted_at is null and id is distinct from ${excludeId ?? null}
    and replace(replace(replace(lower(name), ' ', ''), '(', ''), ')', '') like ${'%' + key + '%'} order by updated_at desc limit 5`;
}
/** 205차(#461 ⑦ 중복 방지, SALES_LEADS_REVAMP 4절): 전화는 숫자만(+82 → 0, 9자리 이상 — 대표번호 8자리는 빼고) · 사업자번호는 숫자 10자리 · 메일은 소문자 */
const digitsOf = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const phoneKey = (s: unknown) => { let d = digitsOf(s); if (d.startsWith('82') && d.length >= 11) d = `0${d.slice(2)}`; return d.length >= 9 ? d : ''; };
const bizKey = (s: unknown) => { const d = digitsOf(s); return d.length === 10 ? d : ''; };
const mailKey = (s: unknown) => { const m = String(s ?? '').trim().toLowerCase(); return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m) ? m : ''; };
/** 같은 사업자번호·전화·메일인 거래처(최대 5곳, 이름은 달라도) — by = 무엇이 같은지 */
async function sameContactLeads(sql: ReturnType<typeof db>, tenant: string, c: { phone?: string | null; bizNo?: string | null; email?: string | null }, excludeId?: string) {
  const p = phoneKey(c.phone), b = bizKey(c.bizNo), m = mailKey(c.email);
  if (!p && !b && !m) return [];
  const rows = await sql<{ id: string; name: string; status: string | null; region: string | null; phone: string | null; biz_no: string | null; email: string | null }[]>`select id, name, status, region, phone, biz_no, email from sales_leads
    where tenant = ${tenant} and deleted_at is null and id is distinct from ${excludeId ?? null}
      and (${p ? sql`right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 8) = ${p.slice(-8)}` : sql`false`} or ${b ? sql`regexp_replace(coalesce(biz_no, ''), '\\D', '', 'g') = ${b}` : sql`false`}
        or ${m ? sql`lower(trim(email)) = ${m}` : sql`false`})
    order by updated_at desc limit 20`;
  return rows.map((l) => ({ id: l.id, name: l.name, status: l.status, region: l.region, by: b && bizKey(l.biz_no) === b ? 'bizNo' : p && phoneKey(l.phone) === p ? 'phone' : m && mailKey(l.email) === m ? 'email' : '' }))
    .filter((l) => l.by).slice(0, 5);
}
/** 새 리드 중복 경고(205차): 같은 사업자번호·전화·메일(이름이 달라도) 먼저 + 비슷한 이름 — 최대 5곳. 전화·메일은 요청 본문으로만 받는다(주소에 고객 연락처를 싣지 않음) */
async function dupCandidates(sql: ReturnType<typeof db>, tenant: string, c: { name: string; phone?: string | null; bizNo?: string | null; email?: string | null }, excludeId?: string) {
  const contact = await sameContactLeads(sql, tenant, c, excludeId); const seen = new Set(contact.map((x) => x.id));
  return [...contact, ...(await similarLeads(sql, tenant, c.name, excludeId)).filter((x) => !seen.has(x.id)).map((x) => ({ ...x, by: 'name' }))].slice(0, 5);
}
/** 새 리드(전환 뒤) — 담당 = 만든 사람(관리자는 지정 가능). 비슷한 거래처가 있으면 먼저 알려 주고(force 로 그래도 새로) */
export async function createLead(u: SessionUser, i: z.infer<typeof leadCreate>) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); await assertWritesOpen(t);
  if (!i.force) { const similar = await dupCandidates(db(), t, i); if (similar.length) return { similar }; }
  const owner = i.ownerId && ['owner', 'admin'].includes(u.role) ? i.ownerId : u.id;
  const [r] = await db()<{ id: string }[]>`insert into sales_leads (tenant, name, status, priority, facility_type, region, scale, expected_revenue, owner_id, next_contact_date, contact_name, phone, email, homepage, biz_no, memo)
    values (${t}, ${i.name}, ${i.status}, ${i.priority ?? null}, ${i.facilityType ?? null}, ${i.region ?? null}, ${i.scale ?? null}, ${i.expectedRevenue ?? null}, ${owner}, ${i.nextContactDate ?? null}, ${i.contactName ?? null}, ${i.phone ?? null}, ${i.email ?? null}, ${i.homepage ?? null}, ${i.bizNo ?? null}, ${i.memo ?? null}) returning id`;
  if (i.reason || i.status !== '신규리드') await db()`insert into sales_status_log (tenant, lead_id, from_status, to_status, reason, changed_by) values (${t}, ${r.id}, null, ${i.status}, ${i.reason ?? null}, ${u.id})`;
  // 대표 10/20 14:15(원본 규칙 '[첫 연락]' 업무 자동): 새 리드 → 담당자 업무
  await (await import('./autoTasks')).syncSalesTask(db(), u, { kind: 'lead', id: r.id, name: i.name, status: i.status, nextDate: i.nextContactDate ?? null, nextAction: '첫 연락', leadId: r.id, assigneeId: owner });
  return { id: r.id };
}
/** S2 2차: 리드 삭제(사유·감사, 소프트) — 관리자 또는 담당자. 열린 영업 업무는 완료 처리 */
export async function deleteLead(u: SessionUser, id: string, reason: string, ip: string | null) {
  await assertSpace(u, 'sales');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const t = tenantOf(u); const sql = db();
  const [l] = await sql<{ owner_id: string | null; name: string }[]>`select owner_id, name from sales_leads where id = ${id} and tenant = ${t} and deleted_at is null`;
  if (!l) throw notFound();
  await assertWritesOpen(t);
  if (!['owner', 'admin'].includes(u.role) && l.owner_id !== u.id) throw new HttpError(403, 'forbidden', '담당 리드만 지울 수 있습니다');
  await sql`update sales_leads set deleted_at = now(), deleted_reason = ${reason}, updated_at = now() where id = ${id}`;
  await (await import('./autoTasks')).syncSalesTask(sql, u, { kind: 'lead', id, name: l.name, status: '대상아님' });
  await audit(sql, u.id, 'sales.lead_delete', 'sales_lead', id, { name: l.name, reason }, ip);
  return { ok: true };
}
/** S2 2차: 리드 상세 '업무' 탭 — 사람이 맡는 업무 추가(space sales, lead_id·sales_ref 연결) */
export const leadTaskInput = z.object({ title: z.string().trim().min(1).max(200), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), assigneeId: z.string().uuid().optional() });
export async function addLeadTask(u: SessionUser, leadId: string, i: z.infer<typeof leadTaskInput>) {
  await assertSpace(u, 'sales');
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw notFound();
  const t = tenantOf(u); const sql = db();
  const [l] = await sql<{ owner_id: string | null; name: string }[]>`select owner_id, name from sales_leads where id = ${leadId} and tenant = ${t} and deleted_at is null`;
  if (!l) throw notFound();
  await assertWritesOpen(t);
  const { createTask } = await import('../tasks');
  const r = await createTask(u, { title: i.title, description: `거래처 ${l.name} — /s/sales/leads?id=${leadId}`, space: 'sales', assigneeId: i.assigneeId ?? l.owner_id ?? u.id, requestedById: u.id, dueDate: i.dueDate ?? null, approvalRequired: false, tags: ['영업', '리드'] }, { quiet: false, skipQuota: true });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'lead', id: leadId, name: l.name, manual: true })}, lead_id = ${leadId} where id = ${r.id}`;
  await sql`update sales_leads set updated_at = now() where id = ${leadId}`;
  return { id: r.id };
}
/**
 * CSV 가져오기(관리자). S2 2차: 같은 이름(공백·괄호 무시)이 있으면 건너뜀.
 * 205차(#461 ⑦, SALES_LEADS_REVAMP 4·5절 '미리보기 → 중복 표시 → 반영'): 줄마다 action — merge(mergeId 거래처의 빈 칸 채우기) · new(그래도 새로) · skip.
 * action 이 없는 줄은 예전 그대로(같은 이름이면 건너뜀).
 */
const importRow = leadCreate.omit({ force: true, ownerId: true, reason: true }).extend({ action: z.enum(['new', 'merge', 'skip']).optional(), mergeId: z.string().uuid().optional() });
export const importInput = z.object({ rows: z.array(importRow).min(1).max(2000) });
type ImportRow = z.infer<typeof importRow>;
/** 합칠 때 채우는 칸 — 거래처에 비어 있으면 채우고, 이미 다른 값이면 바꾸지 않고 메모에 한 줄로 남김(단계는 손대지 않음) */
const MERGE_FIELDS = [['bizNo', 'biz_no', '사업자번호'], ['phone', 'phone', '연락처'], ['email', 'email', '이메일'], ['contactName', 'contact_name', '고객 담당자'], ['region', 'region', '지역'],
  ['facilityType', 'facility_type', '시설'], ['scale', 'scale', '규모'], ['homepage', 'homepage', '홈페이지'], ['expectedRevenue', 'expected_revenue', '예상매출'], ['priority', 'priority', '우선순위'],
  ['nextContactDate', 'next_contact_date', '다음 연락일']] as const;
const PRI_KO: Record<string, string> = { urgent: '긴급', high: '높음', medium: '보통', low: '낮음' };
const sameVal = (k: string, a: unknown, b: unknown) => k === 'phone' ? digitsOf(a) === digitsOf(b) || (!!phoneKey(a) && phoneKey(a) === phoneKey(b)) : k === 'bizNo' ? digitsOf(a) === digitsOf(b)
  : k === 'expectedRevenue' ? Number(a) === Number(b) : String(a).replace(/\s+/g, '').toLowerCase() === String(b).replace(/\s+/g, '').toLowerCase();
const importNote = (day: string) => (diff: string[]) => (diff.length ? `[가져오기 ${day}] 다른 값 — ${diff.join(' · ')}` : '');
const mergeLeads = (sql: ReturnType<typeof db>, tenant: string, ids: string[]) => sql<any[]>`select l.id, l.name, l.status, l.region, l.facility_type, l.scale, l.contact_name, l.phone, l.email, l.homepage, l.biz_no,
  l.expected_revenue::float8 as expected_revenue, l.priority, l.next_contact_date::text as next_contact_date, l.memo, u.name as owner,
  l.owner_id, l.next_action, l.created_at, l.src_id
  from sales_leads l left join users u on u.id = l.owner_id where l.tenant = ${tenant} and l.deleted_at is null and l.id = any(${ids}::uuid[])`;
/** 거래처 l 에 r 을 합칠 때: 빈 칸만 채우고(fill), 이미 다른 값(diff)은 바꾸지 않고 note(diff) 한 줄로 메모에 — 가져오기·거래처 합치기 공용 */
function fillPlan(l: any, r: Record<string, any>, note: (diff: string[]) => string) {
  const patch: Record<string, unknown> = {}; const fill: string[] = []; const diff: string[] = [];
  const closed = ['계약완료', '보류', '실패', '되돌림'].includes(String(l.status ?? ''));
  for (const [k, col, label] of MERGE_FIELDS) {
    const v = r[k]; if (v == null || v === '' || (k === 'nextContactDate' && closed)) continue; // 종결 거래처엔 다음 연락일을 넣지 않음
    const cur = l[col];
    if (cur == null || cur === '') { patch[k] = v; fill.push(label); } else if (!sameVal(k, cur, v)) diff.push(`${label} ${k === 'priority' ? PRI_KO[String(v)] ?? v : k === 'expectedRevenue' ? Number(v).toLocaleString('ko-KR') : v}`);
  }
  const memo = String(l.memo ?? ''); const line = note(diff); const rm = typeof r.memo === 'string' ? r.memo.trim() : '';
  const add = [line && !memo.includes(line) ? line : '', rm && !memo.includes(rm) ? rm : ''].filter(Boolean);
  if (add.length) patch.memo = [memo, ...add].filter(Boolean).join('\n').slice(0, 5000);
  return { patch, fill, diff, memo: add.length > 0 };
}
const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
async function assertAdminWrite(u: SessionUser, msg: string) {
  await assertSpace(u, 'sales');
  if (!['owner', 'admin'].includes(u.role)) throw new HttpError(403, 'forbidden', msg);
  const t = tenantOf(u); await assertWritesOpen(t); return t;
}
/**
 * 205차 미리보기: 줄마다 무엇과 겹치는지 — same(같은 이름 거래처) · file(파일 안 앞 줄과 같은 이름) · contact(이름은 달라도 같은 사업자번호·전화·메일) · similar(비슷한 이름, 앞 4자) · new.
 * 후보마다 합치면 채울 칸(fill)·바꾸지 않고 메모에 남길 다른 값(diff). 쓰기는 하지 않음
 */
export async function previewImport(u: SessionUser, i: z.infer<typeof importInput>) {
  const t = await assertAdminWrite(u, 'CSV 가져오기는 관리자만'); const sql = db();
  const all = await sql<{ id: string; name: string; phone: string | null; email: string | null; biz_no: string | null }[]>`select id, name, phone, email, biz_no from sales_leads where tenant = ${t} and deleted_at is null order by updated_at desc`;
  const idx = { name: new Map<string, string[]>(), phone: new Map<string, string[]>(), bizNo: new Map<string, string[]>(), email: new Map<string, string[]>() };
  const put = (m: Map<string, string[]>, k: string, id: string) => { if (k) m.set(k, [...(m.get(k) ?? []), id]); };
  for (const l of all) { put(idx.name, normName(l.name), l.id); put(idx.phone, phoneKey(l.phone), l.id); put(idx.bizNo, bizKey(l.biz_no), l.id); put(idx.email, mailKey(l.email), l.id); }
  const names = all.map((l) => [l.id, normName(l.name)] as const);
  const firstRow = new Map<string, number>();
  const found = i.rows.map((r, n) => {
    const k = normName(r.name); const dupOf = k ? firstRow.get(k) : undefined; if (k && dupOf === undefined) firstRow.set(k, n);
    const by = new Map<string, string[]>();
    for (const [what, key] of [['name', k], ['bizNo', bizKey(r.bizNo)], ['phone', phoneKey(r.phone)], ['email', mailKey(r.email)]] as const) for (const id of key ? idx[what].get(key) ?? [] : []) by.set(id, [...(by.get(id) ?? []), what]);
    const hits = [...by].sort((a, b) => Number(b[1].includes('name')) - Number(a[1].includes('name')) || b[1].length - a[1].length).slice(0, 3);
    if (hits.some(([, w]) => w.includes('name'))) return { kind: 'same' as const, hits };
    if (dupOf !== undefined) return { kind: 'file' as const, hits: [], dupOf };
    if (hits.length) return { kind: 'contact' as const, hits };
    const key = simKey(r.name); const sim: [string, string[]][] = [];
    if (key.length >= 2) for (const [id, nm] of names) if (nm.includes(key) && sim.push([id, []]) === 3) break;
    return sim.length ? { kind: 'similar' as const, hits: sim } : { kind: 'new' as const, hits: [] };
  });
  const hitIds = [...new Set(found.flatMap((f) => f.hits.map(([id]) => id)))];
  const full = new Map((hitIds.length ? await mergeLeads(sql, t, hitIds) : []).map((l) => [l.id, l]));
  const day = todayKst(); const counts = { new: 0, same: 0, file: 0, contact: 0, similar: 0 };
  const rows = found.map((f, n) => {
    counts[f.kind]++;
    if (f.kind === 'new') return { kind: f.kind };
    const matches = f.hits.map(([id, by]) => { const l = full.get(id); if (!l) return null; const p = fillPlan(l, i.rows[n], importNote(day));
      return { id, name: l.name as string, status: l.status as string | null, region: l.region as string | null, owner: l.owner as string | null, by, fill: p.fill, diff: p.diff, memo: p.memo }; }).filter(Boolean);
    return { kind: f.kind, matches, ...('dupOf' in f ? { dupOf: f.dupOf } : {}) };
  });
  return { rows, counts };
}
/** 고른 거래처에 합치기 — 빈 칸만 채우고(다음 연락일이면 영업 업무 마감도), 다른 값은 메모 한 줄. 권한·기록은 updateLead 그대로 */
async function mergeIntoLead(u: SessionUser, id: string, r: ImportRow) {
  const t = tenantOf(u); const sql = db();
  const [l] = await mergeLeads(sql, t, [id]); if (!l) throw notFound('합칠 거래처를 찾을 수 없습니다');
  const p = fillPlan(l, r, importNote(todayKst()));
  if (Object.keys(p.patch).length) {
    await updateLead(u, id, p.patch as z.infer<typeof leadPatch>);
    await audit(sql, u.id, 'sales.lead_merge', 'sales_lead', id, { from: 'csv', fill: p.fill, diff: p.diff.length }, null); // 값(전화·메일)은 기록에 싣지 않음 — 칸 이름·개수만
  }
  return p;
}
export async function importLeads(u: SessionUser, i: z.infer<typeof importInput>) {
  const t = await assertAdminWrite(u, 'CSV 가져오기는 관리자만'); const sql = db();
  const have = new Set((await sql<{ name: string }[]>`select name from sales_leads where tenant = ${t} and deleted_at is null`).map((x) => normName(x.name)));
  let created = 0, merged = 0; const skipped: string[] = []; const failed: { name: string; message: string }[] = [];
  for (const { action, mergeId, ...r } of i.rows) {
    try {
      if (action === 'skip') { skipped.push(r.name); continue; }
      if (action === 'merge') { if (!mergeId) throw badRequest('합칠 거래처를 고르지 않았습니다'); await mergeIntoLead(u, mergeId, r); merged++; continue; }
      const k = normName(r.name);
      if (action !== 'new' && (!k || have.has(k))) { skipped.push(r.name); continue; } // 고르지 않은 줄 = 예전 그대로
      have.add(k);
      await createLead(u, { ...r, force: true });
      created++;
    } catch (e) { failed.push({ name: r.name, message: e instanceof HttpError ? e.message : '가져오지 못했습니다' }); }
  }
  await audit(sql, u.id, 'sales.lead_import', 'sales_lead', null, { created, merged, skipped: skipped.length, failed: failed.length }, null);
  return { ok: true, created, merged, skipped, failed };
}

/**
 * 206차(#461 ⑦ 기존 거래처끼리 합치기, SALES_LEADS_REVAMP 4절·7절 7번) — 관리자. 같은 곳이 두 번 들어간 거래처를 하나로:
 * 합칠 거래처의 상담·제안·계약 등 기록 · 단계 기록 · 업무(설명 속 링크도) · 일정 · 입찰 연결 · 광고 문의 · 견적을 남길 거래처로 옮기고,
 * 남길 거래처의 빈 칸만 채운다(다른 값은 메모 한 줄, 담당·다음 연락일이 비었으면 가져옴). 합친 거래처는 목록에서 빠지고 merged_into 로 남길 쪽을 가리킨다(예전 링크는 남긴 쪽으로).
 * 자동 영업 업무는 하나만 — 남길 쪽에 열린 것이 있으면 합칠 쪽 것은 완료, 없으면 합칠 쪽 것을 이어받는다. 되돌리기는 없다(미리보기에서 확인)
 */
const leadIdOk = (id: string) => /^[0-9a-f-]{36}$/i.test(id);
const MERGE_MSG = '거래처 합치기는 관리자만';
/** 합칠 후보: q(2자 이상)면 이름 찾기, 없으면 겹쳐 보이는 거래처(같은 사업자번호·전화·메일 / 비슷한 이름) */
export async function mergeCandidates(u: SessionUser, id: string, q: string) {
  const t = await assertAdminWrite(u, MERGE_MSG); const sql = db();
  if (!leadIdOk(id)) throw notFound();
  const [l] = await sql<{ name: string; phone: string | null; biz_no: string | null; email: string | null }[]>`select name, phone, biz_no, email from sales_leads where id = ${id} and tenant = ${t} and deleted_at is null`;
  if (!l) throw notFound();
  const key = q.replace(/[\s()]/g, '').toLowerCase();
  if (key.length >= 2) return { candidates: (await sql<{ id: string; name: string; status: string | null; region: string | null }[]>`select id, name, status, region from sales_leads where tenant = ${t} and deleted_at is null and id <> ${id}
    and position(${key} in replace(replace(replace(lower(name), ' ', ''), '(', ''), ')', '')) > 0 order by updated_at desc limit 10`).map((x) => ({ ...x, by: 'search' })) };
  return { candidates: await dupCandidates(sql, t, { name: l.name, phone: l.phone, bizNo: l.biz_no, email: l.email }, id) };
}
/** 거래처에 딸린 것 수(합치면 옮겨지는 것) */
async function leadFootprint(sql: ReturnType<typeof db>, t: string, id: string) {
  const [c] = await sql<Record<string, number>[]>`select
    (select count(*)::int from sales_lead_records where tenant = ${t} and lead_id = ${id} and kind = 'sales_activities') as acts,
    (select count(*)::int from sales_lead_records where tenant = ${t} and lead_id = ${id} and kind in ('proposals', 'contracts')) as deals,
    (select count(*)::int from sales_lead_records where tenant = ${t} and lead_id = ${id} and kind not in ('sales_activities', 'proposals', 'contracts')) as records,
    (select count(*)::int from tasks where lead_id = ${id} and deleted_at is null) as tasks,
    (select count(*)::int from events where lead_id = ${id} and deleted_at is null) as events,
    (select count(*)::int from sales_work_records where tenant = ${t} and lead_id = ${id}) as work,
    (select count(*)::int from mkt_meta_leads where lead_id = ${id}) as "adLeads",
    (select count(*)::int from quotes where lead_id = ${id}) as quotes,
    (select count(*)::int from sales_status_log where tenant = ${t} and lead_id = ${id}) as "statusLog"`;
  return c;
}
const asLeadRow = (l: any) => ({ bizNo: l.biz_no, phone: l.phone, email: l.email, contactName: l.contact_name, region: l.region, facilityType: l.facility_type, scale: l.scale, homepage: l.homepage,
  expectedRevenue: l.expected_revenue, priority: l.priority, nextContactDate: l.next_contact_date, memo: l.memo });
const mergeNote = (from: { name: string }, day: string) => (diff: string[]) => `[합침 ${day}] ${from.name}${diff.length ? ` — 다른 값: ${diff.join(' · ')}` : ''}`;
const ymdKst = (v: unknown) => (v instanceof Date ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(v) : String(v ?? '').slice(0, 10));
/** 미리보기(쓰기 없음): 두 거래처 요약·딸린 것 수 · 어느 쪽으로 합치든 채울 칸·다른 값 · 남길 쪽 제안(딸린 것이 많은 쪽, 같으면 먼저 등록한 쪽) */
export async function mergePreview(u: SessionUser, id: string, withId: string) {
  const t = await assertAdminWrite(u, MERGE_MSG); const sql = db();
  if (!leadIdOk(id) || !leadIdOk(withId)) throw notFound();
  if (id === withId) throw badRequest('같은 거래처끼리는 합칠 수 없습니다');
  const rows = await mergeLeads(sql, t, [id, withId]);
  const a = rows.find((x) => x.id === id), b = rows.find((x) => x.id === withId);
  if (!a || !b) throw notFound();
  const fa = await leadFootprint(sql, t, id), fb = await leadFootprint(sql, t, withId);
  const total = (f: Record<string, number>) => Object.entries(f).reduce((n, [k, v]) => (k === 'statusLog' ? n : n + v), 0);
  const day = todayKst();
  const side = (l: any, f: Record<string, number>) => ({ id: l.id as string, name: l.name as string, status: l.status as string | null, region: l.region as string | null, owner: l.owner as string | null, next: l.next_contact_date as string | null, created: ymdKst(l.created_at), counts: f });
  const plan = (into: any, from: any) => { const p = fillPlan(into, asLeadRow(from), mergeNote(from, day)); return { fill: p.fill, diff: p.diff, owner: !into.owner_id && !!from.owner_id }; };
  const keep = total(fa) !== total(fb) ? (total(fa) > total(fb) ? 'a' : 'b') : new Date(a.created_at) <= new Date(b.created_at) ? 'a' : 'b';
  return { a: side(a, fa), b: side(b, fb), keep, aIntoB: plan(b, a), bIntoA: plan(a, b) };
}
export const mergeInput = z.object({ into: z.string().uuid() });
/** id 거래처를 into 거래처로 합친다 */
export async function mergeLead(u: SessionUser, id: string, into: string) {
  const t = await assertAdminWrite(u, MERGE_MSG); const sql = db();
  if (!leadIdOk(id)) throw notFound();
  if (id === into) throw badRequest('같은 거래처끼리는 합칠 수 없습니다');
  const rows = await mergeLeads(sql, t, [id, into]);
  const src = rows.find((x) => x.id === id), tgt = rows.find((x) => x.id === into);
  if (!src || !tgt) throw notFound();
  const p = fillPlan(tgt, asLeadRow(src), mergeNote(src, todayKst()));
  const cols: Record<string, unknown> = {};
  for (const [k, col] of MERGE_FIELDS) if (p.patch[k] !== undefined) cols[col] = p.patch[k];
  if (p.patch.memo !== undefined) cols.memo = p.patch.memo;
  const ownerFill = !tgt.owner_id && src.owner_id ? (src.owner_id as string) : null;
  if (ownerFill) cols.owner_id = ownerFill;
  if (cols.next_contact_date && src.next_action && !tgt.next_action) cols.next_action = src.next_action; // 다음 연락일을 가져오면 그 할 일도
  const openAuto = async (lid: string) => (await sql<{ id: string }[]>`select id from tasks where deleted_at is null and status <> 'done' and sales_ref->>'kind' = 'lead' and sales_ref->>'id' = ${lid}
    and coalesce(sales_ref->>'manual', '') <> 'true' order by created_at desc`).map((x) => x.id);
  const srcOpen = await openAuto(id), tgtOpen = await openAuto(into);
  const inherit = tgtOpen.length ? null : srcOpen[0] ?? null; // 남길 쪽에 열린 자동 업무가 없으면 합칠 쪽 것을 이어받음
  const close = srcOpen.filter((x) => x !== inherit);
  const moved = await sql.begin(async (tx) => {
    if (close.length) await tx`update tasks set status = 'done', completed_at = now(), updated_at = now(), version = version + 1 where id = any(${close}::uuid[])`;
    const m = {
      records: (await tx`update sales_lead_records set lead_id = ${into} where tenant = ${t} and lead_id = ${id}`).count,
      statusLog: (await tx`update sales_status_log set lead_id = ${into} where tenant = ${t} and lead_id = ${id}`).count,
      tasks: (await tx`update tasks set lead_id = ${into},
          sales_ref = case when sales_ref->>'kind' = 'lead' and sales_ref->>'id' = ${id} then sales_ref || ${tx.json({ id: into, name: tgt.name })} else sales_ref end,
          title = case when id = ${inherit}::uuid then replace(title, ${src.name}, ${tgt.name}) else title end,
          description = replace(description, ${id}, ${into}), updated_at = now(), version = version + 1
        where deleted_at is null and (lead_id = ${id} or (sales_ref->>'kind' = 'lead' and sales_ref->>'id' = ${id}))`).count,
      events: (await tx`update events set lead_id = ${into} where lead_id = ${id}`).count,
      work: (await tx`update sales_work_records set lead_id = ${into}, data = case when data ? 'lead_id' then jsonb_set(data, '{lead_id}', to_jsonb(${into}::text)) else data end, updated_at = now()
        where tenant = ${t} and lead_id = ${id}`).count,
      adLeads: (await tx`update mkt_meta_leads set lead_id = ${into} where lead_id = ${id}`).count,
      quotes: (await tx`update quotes set lead_id = ${into} where lead_id = ${id}`).count,
    };
    await tx`update mkt_capi_events set lead_id = ${into} where lead_id = ${id}`;
    await tx`update sales_leads set merged_into = ${into} where tenant = ${t} and merged_into = ${id}`; // 앞서 이 거래처로 합친 것도 남길 쪽을 가리키게
    if (Object.keys(cols).length) await tx`update sales_leads set ${tx(cols as never)}, updated_at = now() where id = ${into}`;
    await tx`update sales_leads set deleted_at = now(), deleted_reason = ${`합침 → ${tgt.name}`.slice(0, 500)}, merged_into = ${into}, updated_at = now() where id = ${id}`;
    return m;
  });
  await audit(sql, u.id, 'sales.lead_merge', 'sales_lead', into, { from: id, fromName: src.name, moved, fill: p.fill, diff: p.diff.length, closedTasks: close.length }, null);
  if (ownerFill) await audit(sql, u.id, 'sales.lead_owner', 'sales_lead', into, { from: null, to: ownerFill, merge: id }, null);
  // 남긴 거래처 기준으로 자동 영업 업무 맞춤(다음 연락일·종결 단계) — 합치기로 알림이 가지 않게 조용히
  const [cur] = await sql<{ name: string; status: string; next: string | null; next_action: string | null; owner_id: string | null }[]>`select name, status, next_contact_date::text as next, next_action, owner_id from sales_leads where id = ${into}`;
  await (await import('./autoTasks')).syncSalesTask(sql, u, { kind: 'lead', id: into, name: cur.name, status: cur.status, nextDate: cur.next, nextAction: cur.next_action, assigneeId: cur.owner_id, leadId: into, quiet: true });
  return { ok: true, into, moved };
}
export const activityInput = z.object({ type: z.enum(['전화', '방문', '미팅', '메일', '문자', '기타']).default('전화'), content: z.string().trim().min(1).max(5000), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  nextDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), nextAction: z.string().trim().max(200).optional(), request: z.string().trim().max(2000).optional() /* S2 2차: 다음 연락 예정일·다음 액션·고객 요청 */ });
/** 영업 재편 5): 리드 일정 — 날짜(+시각·길이) → 회사 공용 캘린더에 lead_id 로 연결, 참석 = 리드 담당(없으면 나). 캘린더가 없으면 409 */
export const leadEventInput = z.object({ title: z.string().trim().min(1, '제목을 적어 주세요').max(200), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  durationMin: z.number().int().min(15).max(24 * 60).default(60), memo: z.string().max(2000).optional(), attendeeIds: z.array(z.string().uuid()).max(20).optional() });
export async function addLeadEvent(u: SessionUser, leadId: string, i: z.infer<typeof leadEventInput>) {
  await assertSpace(u, 'sales');
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw notFound();
  const t = tenantOf(u); const sql = db();
  const [l] = await sql<{ owner_id: string | null; name: string }[]>`select owner_id, name from sales_leads where id = ${leadId} and tenant = ${t} and deleted_at is null`;
  if (!l) throw notFound();
  await assertWritesOpen(t);
  if (!['owner', 'admin'].includes(u.role) && l.owner_id && l.owner_id !== u.id) throw new HttpError(403, 'forbidden', '담당 리드에만 일정을 만들 수 있습니다');
  const [cal] = await sql<{ id: string }[]>`select id from calendars where type = 'company' and tenant = ${t} order by created_at limit 1`;
  if (!cal) throw new HttpError(409, 'no_calendar', '회사 공용 캘린더가 없어 일정을 만들 수 없습니다');
  const start = i.time ? new Date(`${i.date}T${i.time}:00+09:00`) : new Date(`${i.date}T00:00:00+09:00`);
  if (Number.isNaN(start.getTime()) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(start) !== i.date) throw badRequest('날짜가 올바르지 않습니다');
  const end = i.time ? new Date(start.getTime() + i.durationMin * 60000) : new Date(start.getTime() + 86400000);
  const attendees = [...new Set([...(i.attendeeIds ?? []), l.owner_id ?? u.id])];
  const { createEvent } = await import('../events');
  const ev = await createEvent(u, { calendarId: cal.id, title: `[영업] ${i.title} · ${l.name}`.slice(0, 200), description: `${i.memo ?? ''}\n리드: /s/sales/leads?id=${leadId}`.trim(), start: start.toISOString(), end: end.toISOString(), allDay: !i.time,
    attendeeIds: attendees, reminderMinutes: i.time ? [60] : [1440], leadId });
  await sql`update sales_leads set updated_at = now() where id = ${leadId}`;
  return { id: ev.id };
}
/** 상담(활동) 기록 추가 — 담당자·관리자 */
export async function addActivity(u: SessionUser, leadId: string, i: z.infer<typeof activityInput>) {
  await assertSpace(u, 'sales');
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) throw notFound();
  const t = tenantOf(u); const sql = db();
  const [l] = await sql<{ owner_id: string | null; name: string; status: string }[]>`select owner_id, name, status from sales_leads where id = ${leadId} and tenant = ${t} and deleted_at is null`;
  if (!l) throw notFound();
  await assertWritesOpen(t);
  if (!['owner', 'admin'].includes(u.role) && l.owner_id && l.owner_id !== u.id) throw new HttpError(403, 'forbidden', '담당 리드만 기록할 수 있습니다');
  const day = i.date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const [r] = await sql<{ id: string }[]>`insert into sales_lead_records (tenant, kind, lead_id, occurred_at, data) values (${t}, 'sales_activities', ${leadId}, ${new Date(`${day}T12:00:00+09:00`)},
    ${sql.json({ activity_type: i.type, content: i.content, activity_date: day, next_contact_date: i.nextDate ?? null, next_action: i.nextAction ?? null, customer_request: i.request ?? null, created_by: u.id, created_by_name: u.name })}) returning id`;
  // 상담에서 다음 연락 예정일을 적으면 리드의 다음 연락일·영업 업무 마감도 같이
  if (i.nextDate) { await sql`update sales_leads set next_contact_date = ${i.nextDate}, next_action = ${i.nextAction || null}, updated_at = now() where id = ${leadId}`; await (await import('./autoTasks')).syncSalesTask(sql, u, { kind: 'lead', id: leadId, name: l.name, status: l.status, nextDate: i.nextDate, nextAction: i.nextAction ?? null, assigneeId: l.owner_id, leadId }); }
  else await sql`update sales_leads set updated_at = now() where id = ${leadId}`;
  return { id: r.id };
}
