import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { db, type Sql } from './db';
import { isAdmin } from './access';
import { HttpError, badRequest, notFound } from './errors';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';

/** 매출은 본사만: 대표·본사 관리자, 또는 본사(hq) 조직 소속. 그 밖에는 화면·API 모두 없는 것처럼(404) */
/** V13 2번: 매출은 메뉴 권한(보기/입력) — 기본은 대표만. 대표가 "사용자 관리 → 메뉴 권한"에서 등급·사람별로 연다 */
export async function canSeeRevenue(u: SessionUser, sql: Sql = db()) {
  const { menuLevel } = await import('./menuPerms');
  return (await menuLevel(u, 'revenue', sql)) !== 'none';
}
export async function requireRevenue(u: SessionUser, sql: Sql = db(), need: 'view' | 'edit' = 'view') {
  const { requireMenu } = await import('./menuPerms');
  await requireMenu(u, 'revenue', need, sql);
}

const won = z.coerce.number().int('원 단위 정수로 입력하세요').min(0, '0 이상이어야 합니다').max(1e13, '값이 너무 큽니다');
export const revenueInput = z.object({
  orgUnitId: z.string().uuid(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'YYYY-MM 형식이어야 합니다'),
  revenue: won,
  expense: won.default(0),
  members: z.coerce.number().int().min(0).max(1e7).nullable().optional(),
  target: won.nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type RevenueInput = z.infer<typeof revenueInput>;

export async function listRevenue(u: SessionUser, year: number) {
  const sql = db();
  await requireRevenue(u, sql);
  const t = tenantOf(u); // #161: 회사별(상업화 대비 — 다른 회사 숫자가 섞이지 않게)
  const [units, rows] = await Promise.all([
    sql`select o.id, o.name, o.type, o.brand_id from org_units o where o.active and o.tenant = ${t} and o.type in ('branch', 'site') order by o.brand_id nulls last, o.sort, o.name`,
    sql`select r.id, r.org_unit_id, to_char(r.month, 'YYYY-MM') as month, r.revenue::float8 as revenue, r.expense::float8 as expense, r.members,
          r.target::float8 as target, r.note, r.source, r.source_file, r.source_file_ids, r.updated_at, u.name as updated_by_name
        from revenue_entries r join org_units o on o.id = r.org_unit_id and o.tenant = ${t} left join users u on u.id = r.updated_by
        where r.month >= ${`${year - 1}-01-01`} and r.month <= ${`${year}-12-01`} order by r.month`,
  ]);
  const { menuLevel } = await import('./menuPerms');
  return { year, units, rows, aiEnabled: aiConfigured(), canEdit: (await menuLevel(u, 'revenue', sql)) === 'edit' };
}

async function upsert(sql: Sql, u: SessionUser | null, i: RevenueInput, source: 'manual' | 'csv' | 'gpt', file: string | null, tenant: string) {
  const unit = await sql`select id from org_units where id = ${i.orgUnitId} and tenant = ${tenant}`;
  if (!unit.length) throw badRequest('현장을 찾을 수 없습니다');
  await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, members, target, note, source, source_file, created_by, updated_by)
    values (${i.orgUnitId}, ${i.month + '-01'}, ${i.revenue}, ${i.expense ?? 0}, ${i.members ?? null}, ${i.target ?? null}, ${i.note ?? null}, ${source}, ${file}, ${u?.id ?? null}, ${u?.id ?? null})
    on conflict (org_unit_id, month) do update set revenue = excluded.revenue, expense = excluded.expense, members = excluded.members,
      target = excluded.target, note = excluded.note, source = excluded.source, source_file = excluded.source_file, updated_by = excluded.updated_by, updated_at = now()`;
}

/** 항목별 입력(표준 양식·GPT): 들어온 항목만 바꾸고 나머지 값은 유지 */
type Partial1 = { orgUnitId: string; month: string; revenue?: number; expense?: number; members?: number; target?: number; file?: string | null; note?: string | null };
export async function upsertPartial(sql: Sql, u: SessionUser | null, i: Partial1, source: 'csv' | 'gpt' | 'ai', fileIds: string[] | null, tenant: string) {
  const unit = await sql`select id from org_units where id = ${i.orgUnitId} and tenant = ${tenant}`;
  if (!unit.length) throw badRequest('현장을 찾을 수 없습니다');
  const v = (x: number | undefined) => (x === undefined ? null : x);
  await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, members, target, note, source, source_file, source_file_ids, created_by, updated_by)
    values (${i.orgUnitId}, ${i.month + '-01'}, ${i.revenue ?? 0}, ${i.expense ?? 0}, ${v(i.members)}, ${v(i.target)}, ${i.note ?? null}, ${source}, ${i.file ?? null}, ${fileIds}::uuid[], ${u?.id ?? null}, ${u?.id ?? null})
    on conflict (org_unit_id, month) do update set
      revenue = coalesce(${v(i.revenue)}::bigint, revenue_entries.revenue), expense = coalesce(${v(i.expense)}::bigint, revenue_entries.expense),
      members = coalesce(${v(i.members)}::int, revenue_entries.members), target = coalesce(${v(i.target)}::bigint, revenue_entries.target),
      note = coalesce(${i.note ?? null}, revenue_entries.note), source = excluded.source,
      source_file = coalesce(excluded.source_file, revenue_entries.source_file), source_file_ids = excluded.source_file_ids, updated_by = excluded.updated_by, updated_at = now()`;
}

/** 표준 양식(현장·월·항목·금액·근거파일명) 항목 이름 */
const ITEM: Record<string, 'revenue' | 'expense' | 'members' | 'target'> = {
  매출: 'revenue', 매출액: 'revenue', revenue: 'revenue', 지출: 'expense', 비용: 'expense', expense: 'expense',
  회원수: 'members', '회원 수': 'members', members: 'members', 목표: 'target', 목표매출: 'target', '목표 매출': 'target', target: 'target',
};
export type ItemRow = { site: string; month: string; item: string; amount: number | string; sourceFile?: string | null };
export type ItemKey = 'revenue' | 'expense' | 'members' | 'target';
const normMonth = (m: string) => (m ?? '').trim().replace(/[./]/g, '-').replace(/^(\d{4})-(\d)$/, '$1-0$2').replace(/^(\d{4})(\d{2})$/, '$1-$2').slice(0, 7);

/** 항목 행들을 검사해 현장·월별로 묶는다. 오류는 줄 번호와 함께. lines = 줄마다 찾은 현장·월·항목(#161 확인 대기 표의 '지금 값' 비교용) */
export async function collectItems(sql: Sql, rows: { line: number; r: ItemRow }[], tenant: string) {
  const units = await sql<{ id: string; name: string }[]>`select id, name from org_units where tenant = ${tenant}`;
  const byName = new Map(units.map((x) => [x.name.trim(), x.id]));
  const out = new Map<string, Partial1>(); const errors: { line: number; message: string }[] = [];
  const lines: { line: number; unitId: string; month: string; key: ItemKey; amount: number }[] = [];
  for (const { line, r } of rows) {
    const unitId = byName.get(String(r.site ?? '').trim());
    if (!unitId) { errors.push({ line, message: `현장 '${r.site ?? ''}' 을(를) 찾을 수 없습니다` }); continue; }
    const month = normMonth(String(r.month ?? ''));
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) { errors.push({ line, message: `월 '${r.month ?? ''}' 은(는) YYYY-MM 형식이어야 합니다` }); continue; }
    const key = ITEM[String(r.item ?? '').trim().replace(/\s+/g, ' ')] ?? ITEM[String(r.item ?? '').replace(/\s/g, '')];
    if (!key) { errors.push({ line, message: `항목 '${r.item ?? ''}' 은(는) 매출·지출·회원수·목표 중 하나여야 합니다` }); continue; }
    const amount = typeof r.amount === 'number' ? r.amount : num(String(r.amount ?? ''));
    if (amount === null || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(amount) || amount > 1e13) { errors.push({ line, message: `금액 '${r.amount ?? ''}' 은(는) 0 이상 정수여야 합니다` }); continue; }
    const k = `${unitId}|${month}`;
    const cur = out.get(k) ?? { orgUnitId: unitId, month };
    cur[key] = amount;
    lines.push({ line, unitId, month, key, amount });
    const f = (r.sourceFile ?? '').toString().trim().slice(0, 200);
    if (f) cur.file = cur.file && !cur.file.split(', ').includes(f) ? `${cur.file}, ${f}`.slice(0, 400) : cur.file ?? f;
    out.set(k, cur);
  }
  return { entries: [...out.values()], errors, lines };
}

export async function saveRevenue(u: SessionUser, i: RevenueInput, ip: string | null) {
  const sql = db();
  await requireRevenue(u, sql, 'edit');
  await upsert(sql, u, i, 'manual', null, tenantOf(u));
  await audit(sql, u.id, 'revenue.save', 'org_unit', i.orgUnitId, { month: i.month, revenue: i.revenue, expense: i.expense }, ip);
}

export async function deleteRevenue(u: SessionUser, orgUnitId: string, month: string, ip: string | null) {
  const sql = db();
  await requireRevenue(u, sql, 'edit');
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('YYYY-MM 형식이어야 합니다');
  await sql`delete from revenue_entries r using org_units o where o.id = r.org_unit_id and o.tenant = ${tenantOf(u)} and r.org_unit_id = ${orgUnitId} and r.month = ${month + '-01'}`;
  await audit(sql, u.id, 'revenue.delete', 'org_unit', orgUnitId, { month }, ip);
}

/** CSV 한 줄을 칸으로 (따옴표·쉼표 포함 칸 지원) */
function splitCsvLine(line: string) {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
const HEAD: Record<string, string> = {
  현장: 'unit', 지점: 'unit', org: 'unit', site: 'unit', 월: 'month', month: 'month', 기준월: 'month',
  매출: 'revenue', revenue: 'revenue', 지출: 'expense', expense: 'expense', 회원수: 'members', '회원 수': 'members', members: 'members',
  목표: 'target', target: 'target', 메모: 'note', note: 'note', 근거: 'note',
};
const num = (s: string) => (s === '' ? null : Number(s.replace(/[,원\s]/g, '')));

/**
 * CSV 가져오기: 머리글 현장,월,매출,지출[,회원수,목표,메모]. 현장은 조직 이름과 정확히 일치해야 한다.
 * 오류가 하나라도 있으면 아무것도 저장하지 않고 줄 번호와 이유를 돌려준다. dryRun 이면 검사만.
 */
export async function importRevenueCsv(u: SessionUser, csv: string, fileName: string | null, dryRun: boolean, ip: string | null, evidenceIds: string[] | null = null) {
  const sql = db();
  await requireRevenue(u, sql, 'edit');
  if (evidenceIds?.length) { const { loadLibraryFile } = await import('./library'); for (const id of evidenceIds) await loadLibraryFile(u, id); } // 근거 파일도 볼 수 있어야
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw badRequest('머리글과 한 줄 이상의 자료가 필요합니다');
  const rawHead = splitCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').replace(/\s*\(.*\)$/, '').trim());
  // 표준 양식(현장·월·항목·금액·근거파일명): 한 줄 = 한 항목
  if (rawHead.includes('항목') && rawHead.includes('금액')) {
    const idx = (names: string[]) => rawHead.findIndex((h) => names.includes(h));
    const [iS, iM, iI, iA, iF] = [idx(['현장', '지점', 'site']), idx(['월', '기준월', 'month']), idx(['항목', 'item']), idx(['금액', 'amount']), idx(['근거파일명', '근거 파일명', '근거', 'source_file'])];
    if (iS < 0 || iM < 0) throw badRequest('머리글에 현장·월 칸이 없습니다');
    const items = lines.slice(1).map((l, i) => { const c = splitCsvLine(l); return { line: i + 2, r: { site: c[iS], month: c[iM], item: c[iI], amount: c[iA], sourceFile: iF >= 0 ? c[iF] || fileName : fileName } }; });
    const { entries, errors } = await collectItems(sql, items, tenantOf(u));
    if (errors.length || dryRun) return { ok: !errors.length, count: entries.length, errors, preview: entries.slice(0, 50) };
    await sql.begin(async (tx) => { for (const e of entries) await upsertPartial(tx as unknown as Sql, u, e, evidenceIds?.length ? 'ai' : 'csv', evidenceIds?.length ? evidenceIds : null, tenantOf(u)); });
    await audit(sql, u.id, evidenceIds?.length ? 'revenue.ai_import' : 'revenue.import', null, null, { count: entries.length, file: fileName, format: 'items', evidence: evidenceIds }, ip);
    return { ok: true, count: entries.length, errors: [] };
  }
  const cols = rawHead.map((h) => HEAD[h] ?? '');
  for (const need of ['unit', 'month', 'revenue']) if (!cols.includes(need)) throw badRequest(`머리글에 ${({ unit: '현장', month: '월', revenue: '매출' } as Record<string, string>)[need]} 칸이 없습니다`);
  const units = await sql<{ id: string; name: string }[]>`select id, name from org_units where tenant = ${tenantOf(u)}`;
  const byName = new Map(units.map((x) => [x.name.trim(), x.id]));
  const rows: RevenueInput[] = []; const errors: { line: number; message: string }[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    const rec: Record<string, string> = {};
    cols.forEach((c, i) => { if (c) rec[c] = cells[i] ?? ''; });
    const unitId = byName.get(rec.unit ?? '');
    if (!unitId) { errors.push({ line: li + 1, message: `현장 '${rec.unit ?? ''}' 을(를) 찾을 수 없습니다` }); continue; }
    const m = (rec.month ?? '').replace(/[./]/g, '-').replace(/^(\d{4})-(\d)$/, '$1-0$2').slice(0, 7);
    const p = revenueInput.safeParse({ orgUnitId: unitId, month: m, revenue: num(rec.revenue ?? '') ?? undefined, expense: num(rec.expense ?? '') ?? 0,
      members: rec.members !== undefined ? num(rec.members) : null, target: rec.target !== undefined ? num(rec.target) : null, note: rec.note || null });
    if (!p.success) { errors.push({ line: li + 1, message: p.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join(', ') }); continue; }
    rows.push(p.data);
  }
  if (errors.length || dryRun) return { ok: !errors.length, count: rows.length, errors, preview: rows.slice(0, 50) };
  await sql.begin(async (tx) => { for (const r of rows) await upsert(tx as unknown as Sql, u, r, 'csv', fileName, tenantOf(u)); });
  await audit(sql, u.id, 'revenue.import', null, null, { count: rows.length, file: fileName }, ip);
  return { ok: true, count: rows.length, errors: [] };
}

// ---------------- GPT Custom Action: 쓰기 전용 토큰 (V13: 기본 꺼짐, FEATURE_GPT_ACTION=1 일 때만) ----------------
export const gptActionEnabled = () => process.env.FEATURE_GPT_ACTION === '1';
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
export async function listTokens(u: SessionUser) {
  const sql = db(); await requireRevenue(u, sql);
  return sql`select t.id, t.name, t.prefix, t.scope, t.created_at, t.last_used_at, t.revoked_at, cu.name as created_by_name
    from api_tokens t left join users cu on cu.id = t.created_by order by t.created_at desc`;
}
export async function createToken(u: SessionUser, name: string, ip: string | null) {
  if (!gptActionEnabled()) throw notFound();
  const sql = db(); await requireRevenue(u, sql, 'edit');
  const token = 'wk_' + randomBytes(24).toString('base64url');
  const [r] = await sql`insert into api_tokens (name, token_hash, prefix, scope, created_by) values (${name}, ${sha(token)}, ${token.slice(0, 11)}, 'revenue:write', ${u.id}) returning id`;
  await audit(sql, u.id, 'api_token.create', 'api_token', r.id, { name, scope: 'revenue:write' }, ip);
  return { id: r.id, token };
}
export async function revokeToken(u: SessionUser, id: string, ip: string | null) {
  const sql = db(); await requireRevenue(u, sql);
  await sql`update api_tokens set revoked_at = now() where id = ${id} and revoked_at is null`;
  await audit(sql, u.id, 'api_token.revoke', 'api_token', id, {}, ip);
}
/** 토큰 확인: 매출 입력 범위만. 틀리거나 폐기된 토큰은 null */
export async function tokenFromHeader(auth: string | null) {
  const t = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!t.startsWith('wk_')) return null;
  const sql = db();
  const [r] = await sql<{ id: string; name: string }[]>`update api_tokens set last_used_at = now() where token_hash = ${sha(t)} and revoked_at is null and scope = 'revenue:write' returning id, name`;
  return r ?? null;
}
export const actionInput = z.object({
  entries: z.array(z.object({
    site: z.string().min(1).max(100), month: z.string().min(6).max(10), item: z.string().min(1).max(20),
    amount: z.union([z.number(), z.string().max(30)]), sourceFile: z.string().max(200).nullable().optional(),
  })).min(1).max(500),
  dryRun: z.boolean().optional(),
});
/** GPT Action 이 보낸 월 실적 입력 (항목 단위, 오류 있으면 전부 미저장) */
export async function actionImport(token: { id: string; name: string }, i: z.infer<typeof actionInput>, ip: string | null) {
  const sql = db();
  const { entries, errors } = await collectItems(sql, i.entries.map((r, k) => ({ line: k + 1, r })), 'default'); // 예전 GPT 연동(꺼짐)은 기본 회사 전용
  if (errors.length || i.dryRun) return { ok: !errors.length, count: entries.length, errors };
  await sql.begin(async (tx) => { for (const e of entries) await upsertPartial(tx as unknown as Sql, null, e, 'gpt', null, 'default'); });
  await audit(sql, null, 'revenue.gpt_import', 'api_token', token.id, { token: token.name, count: entries.length }, ip);
  return { ok: true, count: entries.length, errors: [] };
}

// ---------------- AI 분석 ----------------
// V13 1번: AI 분석도 내장 AI(공급자 어댑터 — 기본 Anthropic) 사용, 키가 없으면 숨김
// #161 V25: 분석 본체는 revenueAuto.analyzePeriod (서버가 증감률·이동평균·추세·전망 범위를 먼저 계산, AI 는 해석·문장만)
export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** [AI 분석] = Sonnet(보통), [종합 보고] = Opus(월 마감 종합 — 대표 10/15: Opus 는 이것만) */
export async function aiAnalyze(u: SessionUser, period: string, ip: string | null, deep = false) {
  const sql = db(); await requireRevenue(u, sql);
  if (!aiConfigured()) throw notFound();
  if (!PERIOD.test(period)) throw badRequest('YYYY-MM 형식이어야 합니다');
  await (await import('./plans')).assertAiRequest(u);
  const { analyzePeriod } = await import('./revenueAuto');
  const r = await analyzePeriod(tenantOf(u), period, { actor: u, kind: deep ? 'deep' : 'manual' });
  await audit(sql, u.id, 'revenue.ai_analyze', null, null, { period, model: r.model, kind: r.kind, tokens: r.tokens }, ip);
  return r;
}
const REPORT_COLS = 'id, period, kind, model, input, stats, output, file_ids, created_at';
async function withFiles(sql: Sql, tenant: string, r: any) {
  if (!r) return null;
  const files = r.file_ids?.length ? await sql`select id, title, file_name from library_files where id = any(${r.file_ids}::uuid[]) and tenant = ${tenant} and deleted_at is null` : [];
  return { ...r, files };
}
export async function latestAi(u: SessionUser, period: string) {
  const sql = db(); await requireRevenue(u, sql);
  const [r] = await sql`select ${sql.unsafe(REPORT_COLS)} from revenue_ai_reports where period = ${period} and tenant = ${tenantOf(u)} order by created_at desc limit 1`;
  return withFiles(sql, tenantOf(u), r);
}
/** 보고서 이력에서 고른 것 / 알림 링크(?report=) */
export async function aiReport(u: SessionUser, id: string) {
  const sql = db(); await requireRevenue(u, sql);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [r] = await sql`select ${sql.unsafe(REPORT_COLS)} from revenue_ai_reports where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!r) throw notFound();
  return withFiles(sql, tenantOf(u), r);
}

// ---------------- V13 1번 "자료로 입력(AI)": 정산서 엑셀·PDF·사진 → 표준 양식 CSV → 미리보기(검사) → 사람이 확인 후 반영 ----------------
export type ExtractRow = { site: string; month: string; item: string; amount: number };
/**
 * 자료에서 현장별 월 실적 뽑기(가벼운 모델). 권한 검사는 부르는 쪽에서 — 파일은 u 가 볼 수 있는 것만 읽는다.
 * #161: 자동 감지 때는 올린 사람 권한으로 읽고 사용량은 '회사 시스템 작업'(usageUserId null)으로 기록
 */
export async function extractRows(u: SessionUser, fileIds: string[], opt: { purpose: string; usageUserId: string | null }) {
  const sql = db();
  const t = tenantOf(u);
  const { anthropicProvider, costUsd } = await import('./ai/provider');
  const { fileBlocksFor } = await import('./ai/assistant');
  const { loadLibraryFile } = await import('./library');
  const files = await Promise.all(fileIds.map((id) => loadLibraryFile(u, id)));
  const fb = await fileBlocksFor(u, fileIds);
  const units = await sql<{ name: string }[]>`select name from org_units where active and tenant = ${t} and type in ('branch', 'site') order by name`;
  const provider = anthropicProvider({ tier: 'fast' }); // 표 읽기는 가벼운 모델
  const schema = { type: 'object', additionalProperties: false, required: ['rows', 'notes'], properties: {
    rows: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['site', 'month', 'item', 'amount'], properties: {
      site: { type: 'string' }, month: { type: 'string' }, item: { type: 'string', enum: ['매출', '지출', '회원수', '목표'] }, amount: { type: 'number' } } } },
    notes: { type: 'string' } } };
  const system = `정산서·매출 자료에서 현장별 월 실적만 뽑아 JSON 으로 답하세요. 현장 이름은 반드시 이 목록 중 하나로: ${units.map((x) => x.name).join(', ')}. 월은 YYYY-MM. 항목은 매출·지출·회원수·목표. 금액은 원 단위 정수(천원·만원 단위면 원으로 환산). 자료에 없는 숫자는 만들지 말고, 애매한 것은 notes 에 적으세요.`;
  const r = await provider.chat({ system, tools: [], format: schema, messages: [{ role: 'user', content: [...fb.blocks, { type: 'text', text: '이 자료의 현장별 월 실적을 뽑아 주세요.' }] as never }] })
    .catch((e: any) => { throw new HttpError(502, 'ai_unavailable', `AI 서버 응답 오류${e?.status ? ` (${e.status})` : ''}`); });
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${t}, ${opt.usageUserId}, ${crypto.randomUUID()}, ${provider.name}, ${r.model ?? provider.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, ${r.usage.cache_read_input_tokens ?? 0},
      ${r.usage.cache_creation_input_tokens ?? 0}, ${costUsd(r.model ?? provider.model, r.usage)}, ${opt.purpose})`;
  let out: any;
  try { out = JSON.parse(r.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')); } catch { throw new HttpError(502, 'ai_bad_output', 'AI 응답을 해석하지 못했습니다'); }
  const fileName = files.map((f: any) => f.file_name).join(' · ').slice(0, 190);
  const rows: ExtractRow[] = (Array.isArray(out.rows) ? out.rows : []).slice(0, 500)
    .map((x: any) => ({ site: String(x.site ?? '').slice(0, 100), month: String(x.month ?? '').slice(0, 10), item: String(x.item ?? '').slice(0, 20), amount: Math.round(Number(x.amount) || 0) }));
  return { rows, notes: String(out.notes ?? '').slice(0, 1000), fileName };
}
const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const itemsCsv = (rows: ExtractRow[], fileName: string) =>
  ['현장,월,항목,금액,근거파일명', ...rows.map((x) => [x.site, x.month, x.item, x.amount, fileName].map((v) => esc(String(v ?? ''))).join(','))].join('\n');

export async function aiExtract(u: SessionUser, fileIds: string[]) {
  const sql = db(); await requireRevenue(u, sql, 'edit');
  if (!aiConfigured()) throw notFound();
  await (await import('./plans')).assertAiRequest(u);
  const x = await extractRows(u, fileIds, { purpose: 'revenue_extract', usageUserId: u.id });
  const csv = itemsCsv(x.rows, x.fileName);
  if (!x.rows.length) return { ok: false, count: 0, errors: [{ line: 0, message: '자료에서 실적을 찾지 못했습니다' }], preview: [], csv, fileName: x.fileName, notes: x.notes, rows: [] };
  const check = await importRevenueCsv(u, csv, x.fileName, true, null); // 검사·미리보기만 — 반영은 사람이 확인 후 /api/revenue/import
  return { ...check, csv, fileName: x.fileName, notes: x.notes, rows: x.rows };
}
