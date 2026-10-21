// K-apt(공동주택) 수집기 3종 — 전국 입찰공고 HTML(키 불필요) · 입찰결과 HTML(낙찰 병합) · 사업자선정 결과 OpenAPI(KAPT_SERVICE_KEY). 원본 lib/collectors/kapt_* 이식(10/21).
import { matchFit } from './procurement';
import { upsertKaptVendor, upsertNotices, deriveOperatingFromKapt } from './store';
import type { Collector, CollectorCtx, CollectorResult } from './types';

const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
const BASE = () => (T() ? `${T()}/kapt` : 'https://www.k-apt.go.kr');
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; WorkIn-collector/1.0)', 'Accept-Language': 'ko-KR' };
const PAGE_SIZE = 100, MAX_PAGES = 40, DETAIL_LIMIT = 150, CHUNK = 500;
export const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
export type KaptBidRow = { bidNum: string; system: string; awardMethod: string; title: string; deadline: string; state: string; complex: string; registeredAt: string };
/** 목록 HTML → 행. goView('번호') 가 있는 줄만. 칸 수가 다르면 형식 변경으로 보고 버림 */
export function parseKaptBidList(html: string): { rows: KaptBidRow[]; malformed: number } {
  const rows: KaptBidRow[] = []; let malformed = 0;
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const tr = m[1]; const id = tr.match(/goView\('([^']+)'\)/)?.[1]; if (!id) continue;
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1]));
    if (cells.length < 8 || !/^\d{4}-\d{2}-\d{2}/.test(cells[4] ?? '')) { malformed++; continue; }
    const [, system, awardMethod, title, deadline, state, complex, registeredAt] = cells;
    rows.push({ bidNum: id, system, awardMethod, title, deadline, state, complex, registeredAt });
  }
  return { rows, malformed };
}
export type KaptBidDetail = { manager?: string; officeAddress?: string; phone?: string; fax?: string; households?: number; category?: string; bidKind?: string; content?: string; attachments?: string[] };
export function parseKaptBidDetail(html: string): KaptBidDetail {
  const d: KaptBidDetail = {};
  const t = html.match(/<tr>\s*(?:<th[^>]*>[\s\S]*?<\/th>\s*)+<\/tr>\s*<tr>([\s\S]*?)<\/tr>/); const head = html.match(/<tr>\s*((?:<th[^>]*>[\s\S]*?<\/th>\s*)+)<\/tr>\s*<tr>/);
  if (t && head) {
    const heads = [...head[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((c) => text(c[1]));
    const vals = t[1].split(/<td[^>]*>/).slice(1).map((c) => text(c.replace(/<\/td>[\s\S]*$/, '')));
    const get = (name: string) => { const i = heads.indexOf(name); return i >= 0 ? vals[i] || undefined : undefined; };
    if (heads.includes('전화번호')) { d.manager = get('주택관리업자'); d.officeAddress = get('관리사무소 주소'); d.phone = get('전화번호'); d.fax = get('팩스번호'); const hh = Number((get('세대수') ?? '').replace(/,/g, '')); if (Number.isFinite(hh) && hh > 0) d.households = hh; }
  }
  const pair = (name: string) => { const m = html.match(new RegExp(`<th[^>]*>\\s*${name}\\s*</th>\\s*<td[^>]*>([\\s\\S]*?)</td>`)); const v = m ? text(m[1]) : ''; return v || undefined; };
  d.category = pair('입찰분류'); d.bidKind = pair('입찰종류');
  const pre = html.match(/<th[^>]*>\s*내용\s*<\/th>[\s\S]*?<pre>([\s\S]*?)<\/pre>/); if (pre) d.content = text(pre[1]).slice(0, 2000) || undefined;
  const files = [...html.matchAll(/href="([^"]*(?:fileDown|download|attach)[^"]*)"/gi)].map((m) => m[1].replace(/&amp;/g, '&')).map((u) => (u.startsWith('http') ? u : `${BASE()}${u.startsWith('/') ? '' : '/'}${u}`)).slice(0, 10);
  if (files.length) d.attachments = files;
  return d;
}
export const regionFromTitle = (title: string) => title.match(/^\s*\[([^\]]{1,12})\]/)?.[1]?.trim() ?? null;
export function toPayload(r: KaptBidRow, d?: KaptBidDetail): Record<string, unknown> {
  return { source_type: 'kapt_bid', source_external_id: r.bidNum, source_url: `${BASE().replace(/\/kapt$/, T() ? '/kapt' : '')}/bid/bidDetail.do?bidNum=${encodeURIComponent(r.bidNum)}`, issuer: r.complex || null, facility_name: r.complex || null, title: r.title, region: regionFromTitle(r.title),
    posted_date: r.registeredAt.slice(0, 10), deadline_at: r.deadline, notice_state: r.state, bid_system: r.system, award_method: r.awardMethod, contract_method: d?.bidKind ?? null, bid_category: d?.category ?? null, task_scope: d?.content ?? null,
    office_phone: d?.phone ?? null, office_fax: d?.fax ?? null, office_address: d?.officeAddress ?? null, household_count: d?.households ?? null, attachment_urls: d?.attachments ?? [] };
}
async function getText(url: string, fetchImpl: typeof fetch, timeoutMs: number, init: RequestInit = {}) { const res = await fetchImpl(url, { ...init, headers: { ...HEADERS, ...(init.headers as any) }, signal: AbortSignal.timeout(timeoutMs) }); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); }
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> { const out: R[] = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }

export const kaptBidNotices: Collector = {
  slug: 'kapt_bid_notices', label: 'K-apt 전국 입찰공고', hourKst: 6, source: 'k-apt.go.kr/bid/bidList.do (K-APT·조달청·민간 전자입찰 통합, 키 불필요)',
  async run({ fetchImpl, deadlineMs, now }: CollectorCtx): Promise<CollectorResult> {
    const started = now(); const left = () => deadlineMs - (now() - started); const errors: string[] = []; let listFailures = 0;
    const all: KaptBidRow[] = []; let malformed = 0;
    const first = parseKaptBidList(await getText(`${BASE()}/bid/bidList.do?pageNo=1&pageSelect=${PAGE_SIZE}`, fetchImpl, 15000));
    if (!first.rows.length) return { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: 'K-apt 목록 0건 — 원천 형식 변경 의심', summary: 'K-apt 입찰공고: 목록 파싱 0건', providerMode: 'web_scrape' };
    all.push(...first.rows); malformed += first.malformed;
    if (first.rows.length === PAGE_SIZE) for (let p = 2; p <= MAX_PAGES && left() > 20000; p += 4) {
      const pages = [p, p + 1, p + 2, p + 3].filter((x) => x <= MAX_PAGES);
      const res = await pool(pages, 4, async (pg) => { try { return parseKaptBidList(await getText(`${BASE()}/bid/bidList.do?pageNo=${pg}&pageSelect=${PAGE_SIZE}`, fetchImpl, 12000)); } catch (e) { listFailures++; errors.push(`목록 ${pg}쪽: ${e instanceof Error ? e.message : String(e)}`); return null; } });
      let done = false; for (const r of res) { if (!r) continue; all.push(...r.rows); malformed += r.malformed; if (r.rows.length < PAGE_SIZE) done = true; } if (done) break;
    }
    if (malformed) errors.push(`형식이 다른 줄 ${malformed}건 건너뜀`);
    const seen = new Set<string>(); const uniq = all.filter((r) => (seen.has(r.bidNum) ? false : (seen.add(r.bidNum), true)));
    const fitRows = uniq.filter((r) => matchFit(r.title, '공동주택').fit); const details = new Map<string, KaptBidDetail>();
    await pool(fitRows.slice(0, DETAIL_LIMIT), 6, async (r) => { if (left() < 15000) return; try { details.set(r.bidNum, parseKaptBidDetail(await getText(`${BASE()}/bid/bidDetail.do?bidNum=${encodeURIComponent(r.bidNum)}`, fetchImpl, 8000))); } catch (e) { if (errors.length < 15) errors.push(`상세 ${r.bidNum}: ${e instanceof Error ? e.message : String(e)}`); } });
    const fitIds = new Set(fitRows.map((r) => r.bidNum));
    const ordered = [...fitRows, ...uniq.filter((r) => !fitIds.has(r.bidNum))].map((r) => toPayload(r, details.get(r.bidNum)));
    let inserted = 0, updated = 0, unchanged = 0, writeErrors = 0, invalid = 0, written = 0;
    for (let i = 0; i < ordered.length; i += CHUNK) {
      if (left() < 5000) { errors.push(`시간 한도 근접 — ${ordered.length - i}건(비관련 공고)은 다음 실행에서`); break; }
      const batch = ordered.slice(i, i + CHUNK);
      try { const r = await upsertNotices(batch); inserted += r.inserted; updated += r.updated; unchanged += r.unchanged; writeErrors += r.errors; invalid += r.invalid; written += batch.length; if (r.errorLog && errors.length < 15) errors.push(r.errorLog); }
      catch (e) { writeErrors += batch.length; errors.push(`쓰기 실패 x${batch.length}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    let direct = 0; const fitCount = { 다짐: 0, 하이링크: 0, 둘다: 0 };
    for (const r of fitRows) { const d = details.get(r.bidNum); const m = matchFit(r.title, d?.category, d?.content, '공동주택'); if (m.direct) direct++; if (m.fit === '다짐') fitCount.다짐++; else if (m.fit === '하이링크') fitCount.하이링크++; else if (m.fit) fitCount.둘다++; }
    return { inserted, updated, unchanged, errors: writeErrors + invalid + listFailures + (written < ordered.length ? 1 : 0), errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape',
      summary: `K-apt 입찰공고 목록 ${uniq.length}건 · 관련 ${fitRows.length}건(즉시 검토 ${direct} · 다짐 ${fitCount.다짐}·하이링크 ${fitCount.하이링크}·둘다 ${fitCount.둘다}, 상세 ${details.size}) · 적재 ${written}건: 신규 ${inserted} · 갱신 ${updated} · 변화없음 ${unchanged}` + (invalid ? ` · 무효 ${invalid}` : '') };
  },
};

/** 입찰결과(낙찰) — 세션 쿠키 + _csrf → bidResultListAjax(검색어 18개, 최근 1년). 관련 결과만 낙찰 병합(기존 공고 없으면 신규) */
export const KAPT_RESULT_WORDS = ['헬스', '피트니스', '운동기구', '커뮤니티', '주민공동', '주민운동', '체력단련', 'GX', '골프', '수영', '사우나', '위탁운영', '위탁 운영', '출입통제', '출입관리', '안면인식', '키오스크', '무인'];
export function parseKaptResultRows(body: string): { bidNum: string; title: string; complex: string; winner: string | null; amount: string | null; date: string | null }[] {
  const out: { bidNum: string; title: string; complex: string; winner: string | null; amount: string | null; date: string | null }[] = [];
  let j: any = null; try { j = JSON.parse(body); } catch { /* HTML */ }
  const list = Array.isArray(j) ? j : Array.isArray(j?.list) ? j.list : Array.isArray(j?.resultList) ? j.resultList : Array.isArray(j?.data) ? j.data : null;
  if (list) { for (const it of list) { const bidNum = String(it.bidNum ?? it.BID_NUM ?? it.bidNo ?? ''); if (!bidNum) continue; out.push({ bidNum, title: String(it.bidTitle ?? it.BID_TITLE ?? it.title ?? ''), complex: String(it.kaptName ?? it.KAPT_NAME ?? it.complexName ?? ''), winner: it.sucsBidder ?? it.SUCS_BIDDER ?? it.winner ?? null, amount: it.sucsAmt ?? it.SUCS_AMT ?? it.amount ?? null, date: it.sucsDate ?? it.SUCS_DATE ?? it.openDate ?? null }); } return out; }
  for (const m of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) { const tr = m[1]; const id = tr.match(/goView\('([^']+)'\)|bidNum=([^&'"]+)/); const bidNum = id?.[1] ?? id?.[2]; if (!bidNum) continue; const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1])); if (cells.length < 5) continue;
    out.push({ bidNum, title: cells[2] ?? '', complex: cells[1] ?? '', winner: cells[cells.length - 3] || null, amount: cells[cells.length - 2] || null, date: cells[cells.length - 1] || null }); }
  return out;
}
export const kaptBidResults: Collector = {
  slug: 'kapt_bid_results', label: 'K-apt 입찰결과(낙찰)', hourKst: 7, source: 'k-apt.go.kr bidResultListAjax (세션 쿠키·_csrf, 검색어 18개, 최근 1년)',
  async run({ fetchImpl, deadlineMs, now }: CollectorCtx): Promise<CollectorResult> {
    const started = now(); const left = () => deadlineMs - (now() - started); const errors: string[] = [];
    let cookie = '', csrf = '';
    try { const res = await fetchImpl(`${BASE()}/bid/bidResultList.do`, { headers: HEADERS, signal: AbortSignal.timeout(12000) }); const html = await res.text(); cookie = (res.headers.get('set-cookie') ?? '').split(/,(?=[^;]+=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; '); csrf = html.match(/name="_csrf"\s+(?:content|value)="([^"]+)"|_csrf['"]?\s*[:=]\s*['"]([^'"]+)/)?.[1] ?? html.match(/_csrf['"]?\s*[:=]\s*['"]([^'"]+)/)?.[1] ?? ''; }
    catch (e) { return { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: `세션 준비 실패: ${e instanceof Error ? e.message : String(e)}`, summary: 'K-apt 입찰결과: 세션 준비 실패', providerMode: 'web_scrape' }; }
    const from = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), to = new Date().toISOString().slice(0, 10);
    const items: Record<string, unknown>[] = []; let seen = new Set<string>();
    for (const w of KAPT_RESULT_WORDS) {
      if (left() < 8000) { errors.push(`시간 한도 근접 — 검색어 '${w}' 부터는 다음 실행에서`); break; }
      try {
        const body = new URLSearchParams({ searchKeyword: w, sortType: '01', pageNo: '1', pageSelect: '100', startDate: from, endDate: to, ...(csrf ? { _csrf: csrf } : {}) });
        const res = await fetchImpl(`${BASE()}/bid/bidResultListAjax.do`, { method: 'POST', headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}), ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}) }, body, signal: AbortSignal.timeout(10000) });
        if (!res.ok) { errors.push(`'${w}': HTTP ${res.status}`); continue; }
        for (const r of parseKaptResultRows(await res.text())) { if (seen.has(r.bidNum) || !matchFit(r.title, '공동주택').fit) continue; seen.add(r.bidNum);
          items.push({ source_type: 'kapt_bid', source_external_id: r.bidNum, source_url: `${BASE()}/bid/bidDetail.do?bidNum=${encodeURIComponent(r.bidNum)}`, title: r.title, issuer: r.complex || null, facility_name: r.complex || null, region: regionFromTitle(r.title), winner_name: r.winner, winner_amount: r.amount, award_date: r.date }); }
      } catch (e) { errors.push(`'${w}': ${e instanceof Error ? e.message : String(e)}`); }
    }
    const r = items.length ? await upsertNotices(items, { mergeScope: 'award' }) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, duplicatesMerged: 0, errorLog: undefined as string | undefined };
    if (r.errorLog) errors.push(r.errorLog);
    return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + errors.length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape', summary: `K-apt 입찰결과 관련 ${items.length}건 · 낙찰 병합 ${r.updated} · 신규 ${r.inserted} · 변화없음 ${r.unchanged}` };
  },
};

// ---- 사업자선정 결과 OpenAPI (KAPT_SERVICE_KEY) ----
const KAPT_API = () => (T() ? `${T()}/kaptapi/getKaptBidResultList` : process.env.KAPT_API_BASE?.trim() || 'https://apis.data.go.kr/B553530/kaptBidResult/getKaptBidResultList');
const toStr = (v: unknown) => { if (v == null) return null; const s = String(v).trim(); return s.length ? s : null; };
const toInt = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : null; };
const toYmd = (v: unknown) => { if (!v) return null; const s = String(v).trim(); if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
export function toKaptRaw(r: any) {
  const ext = toStr(r.bidNo) ?? toStr(r.selectNo) ?? toStr(r.bidId) ?? toStr(r.selectBidId); const url = toStr(r.bidUrl) ?? toStr(r.detailUrl) ?? toStr(r.url) ?? (ext ? `https://www.k-apt.go.kr/bid/bidList.do?bidNo=${ext}` : null);
  const complexName = toStr(r.kaptName) ?? toStr(r.aptName) ?? toStr(r.danjiName) ?? ''; if (!ext || !url || !complexName) return null;
  return { source_type: 'kapt_sa_sun', source_external_id: ext, source_url: url, complex_code: toStr(r.kaptCode) ?? toStr(r.danjiCode), complex_name: complexName, address: toStr(r.doroJuso) ?? toStr(r.jibunJuso) ?? toStr(r.address), region: toStr(r.sido) ?? toStr(r.sigungu),
    household_count: toInt(r.hhldCnt) ?? toInt(r.householdCount), task_category: toStr(r.bidCategoryName) ?? toStr(r.taskCategory), task_detail: toStr(r.bidDetail) ?? toStr(r.taskDetail), announcement_date: toYmd(r.anncYmd) ?? toYmd(r.announcementDate), bid_open_date: toYmd(r.openYmd) ?? toYmd(r.bidOpenDate),
    selected_vendor: toStr(r.selectedCompany) ?? toStr(r.winnerName), selected_vendor_biz_no: toStr(r.selectedBizNo) ?? toStr(r.winnerBizNo), selected_amount: (() => { const v = r.selectAmount ?? r.contractAmount; if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) ? n : null; })(),
    contract_start_date: toYmd(r.ctrtStartYmd) ?? toYmd(r.contractStartDate), contract_end_date: toYmd(r.ctrtEndYmd) ?? toYmd(r.contractEndDate) };
}
export const kaptSaSun: Collector = {
  slug: 'kapt_sa_sun', label: 'K-apt 사업자선정 결과', hourKst: 8, source: 'apis.data.go.kr/B553530/kaptBidResult (최근 18개월)', needs: ['KAPT_SERVICE_KEY'],
  async run({ fetchImpl }: CollectorCtx): Promise<CollectorResult> {
    const key = process.env.KAPT_SERVICE_KEY?.trim();
    const from = new Date(Date.now() - 18 * 30 * 864e5).toISOString().slice(0, 10), to = new Date().toISOString().slice(0, 10);
    if (!key) return { inserted: 0, updated: 0, unchanged: 0, errors: 0, summary: `K-apt 사업자선정 ${from}~${to} · KAPT_SERVICE_KEY 미설정 — 공공데이터포털 무료 신청 후 Vercel env 추가`, providerMode: 'manual' };
    const u = new URL(KAPT_API()); u.searchParams.set('serviceKey', key); u.searchParams.set('numOfRows', '500'); u.searchParams.set('pageNo', '1'); u.searchParams.set('_type', 'json'); u.searchParams.set('searchStartYmd', from.replaceAll('-', '')); u.searchParams.set('searchEndYmd', to.replaceAll('-', ''));
    let items: any[] = [];
    try { const res = await fetchImpl(u.toString(), { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) }); if (!res.ok) throw new Error(`HTTP ${res.status}`); const raw: any = await res.json(); const body = raw?.response?.body ?? raw?.body; const it = body?.items; items = Array.isArray(it) ? it : Array.isArray(it?.item) ? it.item : it?.item ? [it.item] : []; }
    catch (e) { const msg = (e instanceof Error ? e.message : String(e)).split(key).join('***'); return { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: `OpenAPI 호출 실패: ${msg}`, summary: `K-apt 사업자선정 ${from}~${to} · OpenAPI 호출 실패`, providerMode: 'api' }; }
    let inserted = 0, updated = 0, skipped = 0; const errors: string[] = [];
    for (const it of items) { const r = toKaptRaw(it); if (!r) continue; try { const res = await upsertKaptVendor(r); if (res.result === 'insert') inserted++; else if (res.result === 'update') updated++; else skipped++; } catch (e) { errors.push(`${r.source_external_id}: ${e instanceof Error ? e.message : String(e)}`); } }
    return { inserted, updated, unchanged: skipped, errors: errors.length, errorLog: errors.length ? errors.slice(0, 10).join('\n') : undefined, providerMode: 'api', summary: `K-apt 사업자선정 ${from}~${to} · 응답 ${items.length}건 · 신규 ${inserted}, 갱신 ${updated}, 변화없음 ${skipped}, 오류 ${errors.length}` };
  },
};
export const operatingFromKapt: Collector = {
  slug: 'operating_from_kapt', label: '운영중 공동주택 — K-apt 사업자선정 파생', hourKst: 8, source: 'DB 내부 파생(외부 호출 없음) — 커뮤니티·운동시설 위탁 업무만',
  async run({ params }: CollectorCtx): Promise<CollectorResult> {
    try { const r = await deriveOperatingFromKapt(typeof params?.limit === 'number' ? params.limit : 500); return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + r.invalid, errorLog: r.errorLog, providerMode: 'manual', summary: `신규 ${r.inserted} · 갱신 ${r.updated} · 변화없음 ${r.unchanged} · 대상외 업무 ${r.filtered}` + (r.errors ? ` · 오류 ${r.errors}` : '') }; }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); return { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: msg, summary: `파생 적재 실패: ${msg}`, providerMode: 'manual' }; }
  },
};
