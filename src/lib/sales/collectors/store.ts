// 수집 결과 저장 — 공용 복사 표 sales_src_rows(scope='global') 에 원본과 같은 모양(JSON)으로. origin='workin' (매일 복사가 '사라짐' 표시하지 않음).
// 원본 Edge collector-write 의 역할: 공고(upsert_procurement_notices_bulk)·운영시설(upsert_operating_prospects_bulk)·K-apt 사업자선정(upsert_kapt_vendor)·파생(derive_operating_from_kapt)·실행 이력.
import { randomUUID } from 'node:crypto';
import { db } from '../../db';
import { sourceFiles } from '../files';
import { PROCUREMENT_ETL_FIELDS, planNoticeBatch } from './procurement';
import { planBatch, prospectFromKaptSelection } from './prospects';
import type { CollectorResult } from './types';

const SCOPE = 'global';
const nowIso = () => new Date().toISOString();
const todayKst = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

async function prevNotices(sourceType: string, extIds: string[]) {
  if (!extIds.length) return new Map<string, Record<string, unknown>>();
  const rows = await db()<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where tbl = 'procurement_notices' and scope = ${SCOPE} and row->>'source_type' = ${sourceType} and row->>'source_external_id' = any(${extIds}) and not gone`;
  return new Map(rows.map((r) => [String(r.row.source_external_id), { ...r.row, id: r.row.id ?? r.src_id }]));
}
async function writeRows(tbl: string, rows: { id: string; row: Record<string, unknown> }[]) {
  const sql = db(); const now = new Date();
  for (let n = 0; n < rows.length; n += 500) {
    const chunk = rows.slice(n, n + 500).map((r) => ({ scope: SCOPE, tbl, src_id: r.id, row: sql.json(r.row as never), gone: false, synced_at: now, origin: 'workin' }));
    await sql`insert into sales_src_rows ${sql(chunk as never)} on conflict (scope, tbl, src_id) do update set row = excluded.row, gone = false, synced_at = excluded.synced_at, origin = case when sales_src_rows.origin = 'src' then 'src' else 'workin' end`;
  }
}
async function patchRows(tbl: string, patches: { id: string; patch: Record<string, unknown> }[]) {
  const sql = db(); const now = new Date();
  for (const p of patches) await sql`update sales_src_rows set row = row || ${sql.json(p.patch as never)}::jsonb, gone = false, synced_at = ${now} where scope = ${SCOPE} and tbl = ${tbl} and src_id = ${p.id}`;
}
async function touchRows(tbl: string, ids: string[]) {
  if (!ids.length) return; const sql = db(); const t = nowIso(), d = todayKst();
  for (let n = 0; n < ids.length; n += 500) await sql`update sales_src_rows set row = row || ${sql.json({ last_seen_at: t, last_seen_date: d } as never)}::jsonb, gone = false, synced_at = now() where scope = ${SCOPE} and tbl = ${tbl} and src_id = any(${ids.slice(n, n + 500)})`;
}

export type WriteSummary = { inserted: number; updated: number; unchanged: number; errors: number; invalid: number; duplicatesMerged: number; errorLog?: string };
/** 입찰공고 N건(같은 source_type 여러 개 섞여도 됨). mergeScope='award' 면 낙찰 칸만 병합 */
export async function upsertNotices(items: Record<string, unknown>[], opt: { mergeScope?: 'all' | 'award' } = {}): Promise<WriteSummary> {
  const now = new Date(); const out: WriteSummary = { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, duplicatesMerged: 0 }; const logs: string[] = [];
  const byType = new Map<string, Record<string, unknown>[]>();
  for (const it of items) { const st = String(it.source_type ?? ''); if (!byType.has(st)) byType.set(st, []); byType.get(st)!.push(it); }
  for (const [st, list] of byType) {
    const prev = await prevNotices(st, [...new Set(list.map((x) => String(x.source_external_id ?? '')).filter(Boolean))]);
    const plan = planNoticeBatch(list, prev, now, opt.mergeScope ?? 'all');
    out.invalid += plan.invalid; logs.push(...plan.errLog);
    const t = nowIso(), d = todayKst();
    try {
      await writeRows('procurement_notices', plan.inserts.map((i) => { const id = randomUUID(); return { id, row: { id, lead_id: null, ...i.row, first_seen_at: t, last_seen_at: t, last_seen_date: d, created_at: t, updated_at: t } }; }));
      await patchRows('procurement_notices', plan.updates.map((u) => ({ id: u.id, patch: { ...u.patch, last_seen_at: t, last_seen_date: d, updated_at: t } })));
      await touchRows('procurement_notices', plan.unchangedIds);
      out.inserted += plan.inserts.length; out.updated += plan.updates.length; out.unchanged += plan.unchangedIds.length;
    } catch (e) { out.errors += list.length; logs.push(`쓰기 실패(${st}): ${e instanceof Error ? e.message : String(e)}`); }
  }
  if (logs.length) out.errorLog = logs.slice(0, 20).join('\n');
  return out;
}
/** 공고 줄마다 진행 기록·업무 연결 수(회사 무관): 정식 진행 기록·원본 진행 칸(__progress)·opportunity_work·업무(sales_ref) */
export async function noticeLinks(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await db()<{ id: string; n: number }[]>`select id, count(*)::int as n from (
      select ref_id as id from sales_work_records where ref_id = any(${ids}::text[])
      union all select case when w.src_id = any(${ids}::text[]) then w.src_id else coalesce(w.row->>'notice_id', w.row->>'procurement_notice_id') end from sales_src_rows w
        where w.scope <> ${SCOPE} and w.tbl in ('opportunity_work', 'procurement_notices__progress') and (w.src_id = any(${ids}::text[]) or w.row->>'notice_id' = any(${ids}::text[]) or w.row->>'procurement_notice_id' = any(${ids}::text[]))
      union all select sales_ref->>'id' from tasks where sales_ref is not null and sales_ref->>'kind' = 'bid' and sales_ref->>'id' = any(${ids}::text[])
    ) x where id is not null group by id`;
  return new Map(rows.map((r) => [r.id, r.n]));
}
const filled = (v: unknown) => v != null && v !== '' && !(Array.isArray(v) && !v.length);
const at = (r: any) => Date.parse(String(r?.updated_at ?? r?.last_seen_at ?? r?.created_at ?? '')) || 0;
/** 판정 칸 — 시스템마다 규칙이 달라 남길 줄 값을 그대로 둠(비었을 때만 채움) */
const JUDGED = new Set<string>(['fit_business', 'matched_keywords', 'related', 'current_status', 'notice_kind', 'files_checked_at']);
/**
 * #507 후속(로컬 10/23): 같은 공고(원천 종류 + 원천 번호)가 여러 줄 — 원본 영업관리 복사(origin 'src', 원본 수집기가 아직 돎)와 워크인 수집기가 따로 넣은 줄.
 * 진행 기록·업무가 걸린 줄의 id 를 살리고(없으면 워크인 수집 줄 → 첨부 있는 줄 → 먼저 본 줄), 다른 줄의 첨부는 합치고 빈 칸·원천 값은 더 최근 줄 값으로 채운 뒤 숨김(gone, merged_into).
 * 진행 기록이 걸린 줄이 둘 이상이면 그 줄들은 숨기지 않음(목록은 화면에서 한 줄). 원본 복사가 숨긴 줄을 되살려도 복사 뒤·수집 뒤에 다시 돌아 같은 결과
 */
export async function mergeNoticeDuplicates(): Promise<{ groups: number; hidden: number; kept: number; byType: Record<string, number> }> {
  const sql = db();
  const dup = await sql<{ src_id: string; origin: string; row: any }[]>`with d as (
      select row->>'source_type' as st, row->>'source_external_id' as ext from sales_src_rows
      where scope = ${SCOPE} and tbl = 'procurement_notices' and not gone and coalesce(row->>'source_external_id', '') <> '' group by 1, 2 having count(*) > 1)
    select s.src_id, s.origin, s.row from sales_src_rows s join d on s.row->>'source_type' = d.st and s.row->>'source_external_id' = d.ext
    where s.scope = ${SCOPE} and s.tbl = 'procurement_notices' and not s.gone`;
  const out = { groups: 0, hidden: 0, kept: 0, byType: {} as Record<string, number> };
  if (!dup.length) return out;
  const links = await noticeLinks(dup.map((r) => r.src_id));
  type Dup = { src_id: string; origin: string; row: any };
  const groups = new Map<string, Dup[]>();
  for (const r of dup) { const k = `${r.row?.source_type}|${r.row?.source_external_id}`; const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]); }
  const patches: { id: string; p: string }[] = []; const hides: { id: string; keep: string }[] = [];
  for (const g of groups.values()) {
    out.groups++;
    const rank = (r: Dup) => [links.has(r.src_id) ? 1 : 0, r.origin === 'workin' ? 1 : 0, sourceFiles(r.row?.attachment_urls ?? r.row?.attachments, r.row?.notice_file_url).length ? 1 : 0, -(Date.parse(String(r.row?.first_seen_at ?? r.row?.created_at ?? '')) || 0)];
    const sorted = [...g].sort((a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i] - x[i]; return 0; });
    const keep = sorted[0]; const drop = sorted.slice(1).filter((r) => !links.has(r.src_id));
    if (!drop.length) { out.kept++; continue; }
    // 칸: 비었으면 채우고, 원천 값은 더 최근 줄 값으로. 판정 칸(관련·적합 사업·상태 등)은 남길 줄 것을 그대로(비었을 때만 채움) — 다른 시스템 판정으로 목록에서 빠지지 않게
    const patch: Record<string, unknown> = {}; const newest = [...drop].sort((a, b) => at(b.row) - at(a.row));
    for (const f of PROCUREMENT_ETL_FIELDS) {
      if (f === 'attachment_urls') continue;
      const d = newest.find((r) => filled(r.row?.[f]) && (!filled(keep.row?.[f]) || (!JUDGED.has(f) && at(r.row) > at(keep.row))));
      if (d && JSON.stringify(d.row[f]) !== JSON.stringify(keep.row?.[f])) patch[f] = d.row[f];
    }
    const mine = sourceFiles(keep.row?.attachment_urls ?? keep.row?.attachments, keep.row?.notice_file_url);
    const all = sourceFiles(keep.row?.attachment_urls ?? keep.row?.attachments, keep.row?.notice_file_url, ...drop.flatMap((r) => [r.row?.attachment_urls ?? r.row?.attachments, r.row?.notice_file_url]));
    if (all.length > mine.length) patch.attachment_urls = all.map((x) => (x.name ? { name: x.name, url: x.url } : x.url));
    if (Object.keys(patch).length) patches.push({ id: keep.src_id, p: JSON.stringify(patch) });
    for (const r of drop) hides.push({ id: r.src_id, keep: keep.src_id });
    out.hidden += drop.length; const st = String(keep.row?.source_type ?? ''); out.byType[st] = (out.byType[st] ?? 0) + drop.length;
  }
  // 묶음이 많아도(첫 실행 수백 건) 쿼리 몇 번으로 — 수집기 60초 안
  for (let n = 0; n < patches.length; n += 500) {
    const c = patches.slice(n, n + 500);
    await sql`update sales_src_rows s set row = s.row || v.p::jsonb, synced_at = now() from (select unnest(${c.map((x) => x.id)}::text[]) as id, unnest(${c.map((x) => x.p)}::text[]) as p) v
      where s.scope = ${SCOPE} and s.tbl = 'procurement_notices' and s.src_id = v.id`;
  }
  for (let n = 0; n < hides.length; n += 500) {
    const c = hides.slice(n, n + 500);
    await sql`update sales_src_rows s set gone = true, row = s.row || jsonb_build_object('merged_into', v.keep), synced_at = now() from (select unnest(${c.map((x) => x.id)}::text[]) as id, unnest(${c.map((x) => x.keep)}::text[]) as keep) v
      where s.scope = ${SCOPE} and s.tbl = 'procurement_notices' and s.src_id = v.id`;
  }
  return out;
}
/** 운영시설 N건 — dedupe_key 로 병합(수동 필드 보존·null 은 기존 값 유지) */
export async function upsertProspects(items: Record<string, unknown>[]): Promise<WriteSummary> {
  const sql = db(); const today = todayKst();
  const keys = [...new Set(items.map((p) => { const v = p.dedupe_key; return v ? String(v) : null; }).filter(Boolean))] as string[];
  // dedupe_key 는 validate 가 계산 → 먼저 후보 키를 뽑기 위해 planBatch 를 빈 prev 로 한 번 돌려 키를 얻는다
  const pre = planBatch(items, new Map(), today);
  const wantKeys = [...new Set([...keys, ...pre.inserts.map((i) => i.key)])];
  const prevRows = wantKeys.length ? await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where tbl = 'operating_facility_prospects' and scope = ${SCOPE} and row->>'dedupe_key' = any(${wantKeys}) and not gone` : [];
  const prev = new Map(prevRows.map((r) => [String(r.row.dedupe_key), { ...r.row, id: r.row.id ?? r.src_id }]));
  const plan = planBatch(items, prev, today);
  const out: WriteSummary = { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: plan.invalid, duplicatesMerged: plan.duplicatesMerged };
  const t = nowIso(), d = todayKst();
  try {
    await writeRows('operating_facility_prospects', plan.inserts.map((i) => { const id = randomUUID(); return { id, row: { id, ...i.patch, next_action: null, next_action_date: null, notes: null, assigned_to: null, lead_id: null, verification_status: 'raw', verified_at: null, first_seen_at: t, last_seen_at: t, last_seen_date: d, created_at: t, updated_at: t } }; }));
    await patchRows('operating_facility_prospects', plan.updates.map((u) => ({ id: u.id, patch: { ...u.patch, last_seen_at: t, last_seen_date: d, updated_at: t } })));
    await touchRows('operating_facility_prospects', plan.unchangedIds);
    out.inserted = plan.inserts.length; out.updated = plan.updates.length; out.unchanged = plan.unchangedIds.length;
  } catch (e) { out.errors += items.length; out.errorLog = `쓰기 실패: ${e instanceof Error ? e.message : String(e)}`; }
  if (plan.errLog.length) out.errorLog = [out.errorLog, ...plan.errLog].filter(Boolean).join('\n');
  return out;
}
/** K-apt 사업자선정 결과 1건 — (source_type, source_external_id) 키, 수동 필드(evaluation_notes·verification_status·lead_id) 보존 */
export async function upsertKaptVendor(r: Record<string, unknown>): Promise<{ result: 'insert' | 'update' | 'skip'; id: string; changeSummary?: string }> {
  const sql = db(); const ext = String(r.source_external_id ?? '');
  const [prev] = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where tbl = 'kapt_vendor_selection' and scope = ${SCOPE} and row->>'source_type' = ${String(r.source_type ?? 'kapt_sa_sun')} and row->>'source_external_id' = ${ext} and not gone limit 1`;
  const t = nowIso(), d = todayKst();
  const FIELDS = ['source_url', 'complex_code', 'complex_name', 'address', 'region', 'household_count', 'task_category', 'task_detail', 'announcement_date', 'bid_open_date', 'selected_vendor', 'selected_vendor_biz_no', 'selected_amount', 'contract_start_date', 'contract_end_date'];
  if (!prev) { const id = randomUUID(); await writeRows('kapt_vendor_selection', [{ id, row: { id, source_type: r.source_type ?? 'kapt_sa_sun', source_external_id: ext, ...Object.fromEntries(FIELDS.map((f) => [f, r[f] ?? null])), evaluation_notes: null, verification_status: 'raw', verified_at: null, lead_id: null, first_seen_at: t, last_seen_at: t, last_seen_date: d, created_at: t, updated_at: t } }]); return { result: 'insert', id }; }
  const patch: Record<string, unknown> = {}; const changed: string[] = [];
  for (const f of FIELDS) { const v = r[f]; if (v == null) continue; if (String(prev.row[f] ?? '') !== String(v)) { patch[f] = v; changed.push(f); } }
  if (!changed.length) { await touchRows('kapt_vendor_selection', [prev.src_id]); return { result: 'skip', id: prev.src_id }; }
  await patchRows('kapt_vendor_selection', [{ id: prev.src_id, patch: { ...patch, last_seen_at: t, last_seen_date: d, updated_at: t } }]);
  return { result: 'update', id: prev.src_id, changeSummary: `변경: ${changed.join(', ')}` };
}
/** 낙찰 업체 이름을 이미 아는 사업자선정 결과(다시 묻지 않게) */
export async function knownKaptVendors(exts: string[]): Promise<Set<string>> {
  if (!exts.length) return new Set();
  const rows = await db()<{ ext: string }[]>`select row->>'source_external_id' as ext from sales_src_rows where tbl = 'kapt_vendor_selection' and scope = ${SCOPE} and coalesce(row->>'selected_vendor', '') <> '' and row->>'source_external_id' = any(${exts})`;
  return new Set(rows.map((r) => r.ext));
}
/** kapt_vendor_selection → operating_facility_prospects 파생(커뮤니티·운동시설 위탁 업무만) */
export async function deriveOperatingFromKapt(limit = 500): Promise<WriteSummary & { filtered: number }> {
  const rows = await db()<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where tbl = 'kapt_vendor_selection' and scope = ${SCOPE} and not gone order by row->>'last_seen_at' desc nulls last limit ${limit}`;
  const payloads: Record<string, unknown>[] = []; let filtered = 0;
  for (const r of rows) { const p = prospectFromKaptSelection({ ...r.row, id: r.row.id ?? r.src_id }); if (p) payloads.push({ ...p, source_observed_at: nowIso() }); else filtered++; }
  const out = payloads.length ? await upsertProspects(payloads) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, duplicatesMerged: 0 };
  return { ...out, filtered };
}
// ---- 실행 이력 ----
export async function startRun(slug: string, trigger: string) {
  const [r] = await db()<{ id: number }[]>`insert into sales_collector_runs (slug, trigger) values (${slug}, ${trigger}) returning id`;
  return r.id;
}
export async function completeRun(id: number, slug: string, r: CollectorResult, status?: 'success' | 'partial' | 'failed' | 'skipped') {
  const st = status ?? (r.errors > 0 && r.inserted + r.updated + r.unchanged === 0 ? 'failed' : r.errors > 0 ? 'partial' : 'success');
  const sql = db();
  await sql`update sales_collector_runs set finished_at = now(), status = ${st}, inserted = ${r.inserted}, updated = ${r.updated}, unchanged = ${r.unchanged}, errors = ${r.errors}, error_log = ${r.errorLog?.slice(0, 4000) ?? null}, summary = ${r.summary?.slice(0, 1000) ?? null}, provider_mode = ${r.providerMode},
    detail = ${r.sources ? sql.json({ sources: r.sources } as never) : null} where id = ${id}`;
  await sql`insert into sales_collector_state (slug, last_run_at, last_status) values (${slug}, now(), ${st}) on conflict (slug) do update set last_run_at = now(), last_status = excluded.last_status, updated_at = now()`;
  return st;
}
