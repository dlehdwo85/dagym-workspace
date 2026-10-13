import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { db, type Sql } from './db';
import { isAdmin } from './access';
import { HttpError, badRequest, notFound } from './errors';
import { audit } from './log';
import type { SessionUser } from './types';

/** 매출은 본사만: 대표·본사 관리자, 또는 본사(hq) 조직 소속. 그 밖에는 화면·API 모두 없는 것처럼(404) */
export async function canSeeRevenue(u: SessionUser, sql: Sql = db()) {
  if (isAdmin(u)) return true;
  const r = await sql`select 1 from memberships m join org_units o on o.id = m.org_unit_id where m.user_id = ${u.id} and o.type = 'hq' limit 1`;
  return r.length > 0;
}
export async function requireRevenue(u: SessionUser, sql: Sql = db()) {
  if (!(await canSeeRevenue(u, sql))) throw notFound();
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
  const [units, rows] = await Promise.all([
    sql`select o.id, o.name, o.type, o.brand_id from org_units o where o.active and not o.is_demo and o.type in ('branch', 'site') order by o.brand_id nulls last, o.sort, o.name`,
    sql`select r.id, r.org_unit_id, to_char(r.month, 'YYYY-MM') as month, r.revenue::float8 as revenue, r.expense::float8 as expense, r.members,
          r.target::float8 as target, r.note, r.source, r.source_file, r.updated_at, u.name as updated_by_name
        from revenue_entries r left join users u on u.id = r.updated_by
        where r.month >= ${`${year - 1}-01-01`} and r.month <= ${`${year}-12-01`} order by r.month`,
  ]);
  return { year, units, rows, aiEnabled: aiConfigured() };
}

async function upsert(sql: Sql, u: SessionUser | null, i: RevenueInput, source: 'manual' | 'csv' | 'gpt', file: string | null) {
  const unit = await sql`select id from org_units where id = ${i.orgUnitId} and not is_demo`;
  if (!unit.length) throw badRequest('현장을 찾을 수 없습니다');
  await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, members, target, note, source, source_file, created_by, updated_by)
    values (${i.orgUnitId}, ${i.month + '-01'}, ${i.revenue}, ${i.expense ?? 0}, ${i.members ?? null}, ${i.target ?? null}, ${i.note ?? null}, ${source}, ${file}, ${u?.id ?? null}, ${u?.id ?? null})
    on conflict (org_unit_id, month) do update set revenue = excluded.revenue, expense = excluded.expense, members = excluded.members,
      target = excluded.target, note = excluded.note, source = excluded.source, source_file = excluded.source_file, updated_by = excluded.updated_by, updated_at = now()`;
}

/** 항목별 입력(표준 양식·GPT): 들어온 항목만 바꾸고 나머지 값은 유지 */
type Partial1 = { orgUnitId: string; month: string; revenue?: number; expense?: number; members?: number; target?: number; file?: string | null; note?: string | null };
async function upsertPartial(sql: Sql, u: SessionUser | null, i: Partial1, source: 'csv' | 'gpt') {
  const unit = await sql`select id from org_units where id = ${i.orgUnitId} and not is_demo`;
  if (!unit.length) throw badRequest('현장을 찾을 수 없습니다');
  const v = (x: number | undefined) => (x === undefined ? null : x);
  await sql`insert into revenue_entries (org_unit_id, month, revenue, expense, members, target, note, source, source_file, created_by, updated_by)
    values (${i.orgUnitId}, ${i.month + '-01'}, ${i.revenue ?? 0}, ${i.expense ?? 0}, ${v(i.members)}, ${v(i.target)}, ${i.note ?? null}, ${source}, ${i.file ?? null}, ${u?.id ?? null}, ${u?.id ?? null})
    on conflict (org_unit_id, month) do update set
      revenue = coalesce(${v(i.revenue)}::bigint, revenue_entries.revenue), expense = coalesce(${v(i.expense)}::bigint, revenue_entries.expense),
      members = coalesce(${v(i.members)}::int, revenue_entries.members), target = coalesce(${v(i.target)}::bigint, revenue_entries.target),
      note = coalesce(${i.note ?? null}, revenue_entries.note), source = excluded.source,
      source_file = coalesce(excluded.source_file, revenue_entries.source_file), updated_by = excluded.updated_by, updated_at = now()`;
}

/** 표준 양식(현장·월·항목·금액·근거파일명) 항목 이름 */
const ITEM: Record<string, 'revenue' | 'expense' | 'members' | 'target'> = {
  매출: 'revenue', 매출액: 'revenue', revenue: 'revenue', 지출: 'expense', 비용: 'expense', expense: 'expense',
  회원수: 'members', '회원 수': 'members', members: 'members', 목표: 'target', 목표매출: 'target', '목표 매출': 'target', target: 'target',
};
export type ItemRow = { site: string; month: string; item: string; amount: number | string; sourceFile?: string | null };
const normMonth = (m: string) => (m ?? '').trim().replace(/[./]/g, '-').replace(/^(\d{4})-(\d)$/, '$1-0$2').replace(/^(\d{4})(\d{2})$/, '$1-$2').slice(0, 7);

/** 항목 행들을 검사해 현장·월별로 묶는다. 오류는 줄 번호와 함께 */
async function collectItems(sql: Sql, rows: { line: number; r: ItemRow }[]) {
  const units = await sql<{ id: string; name: string }[]>`select id, name from org_units where not is_demo`;
  const byName = new Map(units.map((x) => [x.name.trim(), x.id]));
  const out = new Map<string, Partial1>(); const errors: { line: number; message: string }[] = [];
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
    const f = (r.sourceFile ?? '').toString().trim().slice(0, 200);
    if (f) cur.file = cur.file && !cur.file.split(', ').includes(f) ? `${cur.file}, ${f}`.slice(0, 400) : cur.file ?? f;
    out.set(k, cur);
  }
  return { entries: [...out.values()], errors };
}

export async function saveRevenue(u: SessionUser, i: RevenueInput, ip: string | null) {
  const sql = db();
  await requireRevenue(u, sql);
  await upsert(sql, u, i, 'manual', null);
  await audit(sql, u.id, 'revenue.save', 'org_unit', i.orgUnitId, { month: i.month, revenue: i.revenue, expense: i.expense }, ip);
}

export async function deleteRevenue(u: SessionUser, orgUnitId: string, month: string, ip: string | null) {
  const sql = db();
  await requireRevenue(u, sql);
  if (!/^\d{4}-\d{2}$/.test(month)) throw badRequest('YYYY-MM 형식이어야 합니다');
  await sql`delete from revenue_entries where org_unit_id = ${orgUnitId} and month = ${month + '-01'}`;
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
export async function importRevenueCsv(u: SessionUser, csv: string, fileName: string | null, dryRun: boolean, ip: string | null) {
  const sql = db();
  await requireRevenue(u, sql);
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw badRequest('머리글과 한 줄 이상의 자료가 필요합니다');
  const rawHead = splitCsvLine(lines[0]).map((h) => h.replace(/^\uFEFF/, '').replace(/\s*\(.*\)$/, '').trim());
  // 표준 양식(현장·월·항목·금액·근거파일명): 한 줄 = 한 항목
  if (rawHead.includes('항목') && rawHead.includes('금액')) {
    const idx = (names: string[]) => rawHead.findIndex((h) => names.includes(h));
    const [iS, iM, iI, iA, iF] = [idx(['현장', '지점', 'site']), idx(['월', '기준월', 'month']), idx(['항목', 'item']), idx(['금액', 'amount']), idx(['근거파일명', '근거 파일명', '근거', 'source_file'])];
    if (iS < 0 || iM < 0) throw badRequest('머리글에 현장·월 칸이 없습니다');
    const items = lines.slice(1).map((l, i) => { const c = splitCsvLine(l); return { line: i + 2, r: { site: c[iS], month: c[iM], item: c[iI], amount: c[iA], sourceFile: iF >= 0 ? c[iF] || fileName : fileName } }; });
    const { entries, errors } = await collectItems(sql, items);
    if (errors.length || dryRun) return { ok: !errors.length, count: entries.length, errors, preview: entries.slice(0, 50) };
    await sql.begin(async (tx) => { for (const e of entries) await upsertPartial(tx as unknown as Sql, u, e, 'csv'); });
    await audit(sql, u.id, 'revenue.import', null, null, { count: entries.length, file: fileName, format: 'items' }, ip);
    return { ok: true, count: entries.length, errors: [] };
  }
  const cols = rawHead.map((h) => HEAD[h] ?? '');
  for (const need of ['unit', 'month', 'revenue']) if (!cols.includes(need)) throw badRequest(`머리글에 ${({ unit: '현장', month: '월', revenue: '매출' } as Record<string, string>)[need]} 칸이 없습니다`);
  const units = await sql<{ id: string; name: string }[]>`select id, name from org_units where not is_demo`;
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
  await sql.begin(async (tx) => { for (const r of rows) await upsert(tx as unknown as Sql, u, r, 'csv', fileName); });
  await audit(sql, u.id, 'revenue.import', null, null, { count: rows.length, file: fileName }, ip);
  return { ok: true, count: rows.length, errors: [] };
}

// ---------------- GPT Custom Action: 쓰기 전용 토큰 ----------------
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
export async function listTokens(u: SessionUser) {
  const sql = db(); await requireRevenue(u, sql);
  return sql`select t.id, t.name, t.prefix, t.scope, t.created_at, t.last_used_at, t.revoked_at, cu.name as created_by_name
    from api_tokens t left join users cu on cu.id = t.created_by order by t.created_at desc`;
}
export async function createToken(u: SessionUser, name: string, ip: string | null) {
  const sql = db(); await requireRevenue(u, sql);
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
  const { entries, errors } = await collectItems(sql, i.entries.map((r, k) => ({ line: k + 1, r })));
  if (errors.length || i.dryRun) return { ok: !errors.length, count: entries.length, errors };
  await sql.begin(async (tx) => { for (const e of entries) await upsertPartial(tx as unknown as Sql, null, e, 'gpt'); });
  await audit(sql, null, 'revenue.gpt_import', 'api_token', token.id, { token: token.name, count: entries.length }, ip);
  return { ok: true, count: entries.length, errors: [] };
}

// ---------------- AI 분석 (OpenAI, OPENAI_API_KEY 있을 때만) ----------------
export const aiConfigured = () => !!process.env.OPENAI_API_KEY;
const AI_SYSTEM = `당신은 한국 피트니스 회사(다짐·하이링크) 본사의 매출 분석 보조입니다. 입력은 현장별 월 집계 숫자(원·명)뿐입니다.
반드시 입력 숫자만 근거로 쓰고, 없는 사실을 지어내지 마세요. 숫자를 말할 때는 그 현장·월을 함께 적으세요.
JSON 으로만 답하세요: {"summary": "3~5문장 요약", "anomalies": [{"site": "현장 이름", "month": "YYYY-MM", "metric": "revenue|expense|members", "comment": "한두 문장"}], "comparisons": [{"site": "현장 이름", "comment": "한두 문장"}]}.
이상치는 전월·전년 동월 대비 크게 오르거나 내린 경우(대략 ±30% 이상)만 고르세요. 투자 조언·사람 평가는 하지 마세요.`;

/** 분석에 보낼 집계값: 기준 월 포함 최근 13개월, 현장 이름·월·매출·지출·회원 수·목표만 (개인정보·메모·파일 이름 없음) */
async function aiInput(sql: Sql, period: string) {
  const [y, m] = period.split('-').map(Number);
  const from = `${m === 12 ? y : y - 1}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const rows = await sql<{ site: string; month: string; revenue: number; expense: number; members: number | null; target: number | null }[]>`
    select o.name as site, to_char(r.month, 'YYYY-MM') as month, r.revenue::float8 as revenue, r.expense::float8 as expense, r.members, r.target::float8 as target
    from revenue_entries r join org_units o on o.id = r.org_unit_id
    where not o.is_demo and r.month >= ${from} and r.month <= ${period + '-01'} order by o.name, r.month`;
  const prevYear = `${y - 1}-${String(m).padStart(2, '0')}`;
  const prevRows = await sql<{ site: string; revenue: number }[]>`select o.name as site, r.revenue::float8 as revenue from revenue_entries r join org_units o on o.id = r.org_unit_id
    where not o.is_demo and r.month = ${prevYear + '-01'}`;
  return { period, unit: '원(회원 수는 명)', rows, sameMonthLastYear: prevRows.map((r) => ({ site: r.site, month: prevYear, revenue: r.revenue })) };
}

export async function aiAnalyze(u: SessionUser, period: string, ip: string | null) {
  const sql = db(); await requireRevenue(u, sql);
  if (!aiConfigured()) throw notFound();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw badRequest('YYYY-MM 형식이어야 합니다');
  const input = await aiInput(sql, period);
  if (!input.rows.some((r) => r.month === period)) throw badRequest(`${period} 실적이 없습니다. 먼저 입력하세요`);
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const res = await fetch(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/chat/completions`, {
    method: 'POST', signal: AbortSignal.timeout(60_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model, temperature: 0.2, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: AI_SYSTEM }, { role: 'user', content: JSON.stringify(input) }] }),
  }).catch((e) => { throw new HttpError(502, 'ai_unavailable', `AI 분석 서버에 연결하지 못했습니다 (${(e as Error).message})`); });
  if (!res.ok) throw new HttpError(502, 'ai_failed', `AI 분석이 실패했습니다 (${res.status})`);
  const j = await res.json();
  let out: any;
  try { out = JSON.parse(j.choices?.[0]?.message?.content ?? ''); } catch { throw new HttpError(502, 'ai_bad_output', 'AI 응답을 해석하지 못했습니다'); }
  // 입력에 없는 현장·월을 가리키는 제안은 버린다 (근거 없는 숫자 방지)
  const known = new Set(input.rows.map((r) => `${r.site}|${r.month}`));
  const sites = new Set(input.rows.map((r) => r.site));
  const output = {
    summary: String(out.summary ?? '').slice(0, 2000),
    anomalies: (Array.isArray(out.anomalies) ? out.anomalies : []).filter((a: any) => known.has(`${a.site}|${a.month}`)).slice(0, 20)
      .map((a: any) => ({ site: String(a.site), month: String(a.month), metric: ['revenue', 'expense', 'members'].includes(a.metric) ? a.metric : 'revenue', comment: String(a.comment ?? '').slice(0, 400) })),
    comparisons: (Array.isArray(out.comparisons) ? out.comparisons : []).filter((c: any) => sites.has(c.site)).slice(0, 20)
      .map((c: any) => ({ site: String(c.site), comment: String(c.comment ?? '').slice(0, 400) })),
  };
  const [r] = await sql`insert into revenue_ai_reports (period, model, input, output, usage, created_by)
    values (${period}, ${model}, ${sql.json(input as never)}, ${sql.json(output as never)}, ${sql.json((j.usage ?? null) as never)}, ${u.id}) returning id, created_at`;
  await audit(sql, u.id, 'revenue.ai_analyze', null, null, { period, model, tokens: j.usage?.total_tokens ?? null }, ip);
  return { id: r.id, created_at: r.created_at, period, model, input, output };
}
export async function latestAi(u: SessionUser, period: string) {
  const sql = db(); await requireRevenue(u, sql);
  const [r] = await sql`select id, period, model, input, output, created_at from revenue_ai_reports where period = ${period} order by created_at desc limit 1`;
  return r ?? null;
}
