// K-apt(공동주택) 수집기 3종 — 전국 입찰공고 HTML(키 불필요) · 입찰결과 HTML(낙찰 병합) · 사업자선정 결과 OpenAPI(KAPT_SERVICE_KEY). 원본 lib/collectors/kapt_* 이식(10/21).
import { db } from '../../db';
import { dataGoKey } from '../collect';
import { kaptFileList, kaptFileUrl, kaptSession } from '../files';
import { callDataGo } from './g2b';
import { matchFit } from './procurement';
import { upsertKaptVendor, upsertNotices, deriveOperatingFromKapt, knownKaptVendors, refitNotices } from './store';
import { KAPT_RELEVANT_TASK } from './prospects';
import type { Collector, CollectorCtx, CollectorResult } from './types';

const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
const BASE = () => (T() ? `${T()}/kapt` : 'https://www.k-apt.go.kr');
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; WorkIn-collector/1.0)', 'Accept-Language': 'ko-KR' };
const PAGE_SIZE = 100, MAX_PAGES = 40, QUICK_PAGES = 5, DETAIL_LIMIT = 150, CHUNK = 500;
const kstHourNow = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const kstYmd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
/** #476 f: K-apt 공공데이터 키 — KAPT_SERVICE_KEY 가 없으면 같은 포털 키(플랫폼 운영에 넣은 공공데이터포털 키 → DATA_GO_KR_SERVICE_KEY) */
export async function kaptKey(): Promise<string | null> {
  const k = dataGoKey(process.env.KAPT_SERVICE_KEY); if (k) return k;
  return (await (await import('./support')).supportKeys().catch(() => null))?.datago ?? dataGoKey();
}
/** 활용신청 안 된 키(포털 공통 오류) → '활용신청 필요(서비스 번호)' — #172 화면이 번호로 [활용신청] 링크를 붙임 */
const portalErr = (msg: string, service: string) => (/활용신청 필요|SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|등록되지 않은 (서비스|인증)키/i.test(msg) ? `공공데이터포털 활용신청 필요(서비스 ${service}) — 키는 그대로 두고 포털(data.go.kr)에서 [활용신청]` : msg);
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
export type KaptBidDetail = { manager?: string; officeAddress?: string; phone?: string; fax?: string; households?: number; category?: string; bidKind?: string; content?: string; attachments?: string[];
  /** #507 후속: 첨부 목록 API(bidFileListData.do)로 읽은 원래 이름·파일 번호 */ files?: { name: string | null; url: string }[] };
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
  const files = [...html.matchAll(/href="([^"]*(?:fileDown|download|attach)[^"]*)"/gi)].map((m) => m[1].replace(/&amp;/g, '&')).filter((u) => !/^\s*javascript:/i.test(u)).map((u) => (u.startsWith('http') ? u : `${BASE()}${u.startsWith('/') ? '' : '/'}${u}`)).slice(0, 10);
  if (files.length) d.attachments = files;
  return d;
}
export const regionFromTitle = (title: string) => title.match(/^\s*\[([^\]]{1,12})\]/)?.[1]?.trim() ?? null;
export function toPayload(r: KaptBidRow, d?: KaptBidDetail): Record<string, unknown> {
  return { source_type: 'kapt_bid', source_external_id: r.bidNum, source_url: `${BASE().replace(/\/kapt$/, T() ? '/kapt' : '')}/bid/bidDetail.do?bidNum=${encodeURIComponent(r.bidNum)}`, issuer: r.complex || null, facility_name: r.complex || null, title: r.title, region: regionFromTitle(r.title),
    posted_date: r.registeredAt.slice(0, 10), deadline_at: r.deadline, notice_state: r.state, bid_system: r.system, award_method: r.awardMethod, contract_method: d?.bidKind ?? null, bid_category: d?.category ?? null, task_scope: d?.content ?? null,
    office_phone: d?.phone ?? null, office_fax: d?.fax ?? null, office_address: d?.officeAddress ?? null, household_count: d?.households ?? null,
    // 첨부는 첨부 목록 API 로 읽은 것만(상세 HTML 의 링크는 화면 스크립트가 그려 실제 K-apt 에선 비거나 엉뚱한 주소 — 10/23 a7e4efad·086aeff2)
    attachment_urls: d?.files ? d.files.map((f) => (f.name ? { name: f.name, url: f.url } : f.url)) : [], files_checked_at: d?.files ? new Date().toISOString() : null };
}
// #507 후속(로컬 10/23): 관련 공고의 첨부 목록 — 상세를 열 때 받은 세션으로 POST bidFileListData.do. 새 공고만(첨부가 있거나 이미 읽은 공고는 건너뜀), 하루 300건·한 번에 80건
const FILE_LIST_DAY = 300, FILE_LIST_RUN = 80;
async function filesNeeded(bids: string[]): Promise<Set<string>> {
  if (!bids.length) return new Set();
  const done = await db()<{ ext: string }[]>`select distinct row->>'source_external_id' as ext from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and row->>'source_type' = 'kapt_bid' and row->>'source_external_id' = any(${bids})
    and ((row->>'files_checked_at') is not null or coalesce(row->>'notice_file_url', '') <> '' or case when jsonb_typeof(row->'attachment_urls') = 'array' then jsonb_array_length(row->'attachment_urls') > 0 else false end)`;
  const has = new Set(done.map((r) => r.ext));
  return new Set(bids.filter((b) => !has.has(b)));
}
const kstDay = () => kstYmd(new Date());
async function fileListBudget(): Promise<number> {
  const [s] = await db()<{ value: any }[]>`select value from app_settings where key = 'kapt_file_list'`;
  const used = s?.value?.day === kstDay() ? Number(s.value.n) || 0 : 0;
  return Math.max(0, Math.min(FILE_LIST_RUN, FILE_LIST_DAY - used));
}
async function fileListUsed(n: number) {
  if (!n) return; const d = kstDay(); const sql = db();
  await sql`insert into app_settings (key, value) values ('kapt_file_list', ${sql.json({ day: d, n } as never)})
    on conflict (key) do update set value = case when app_settings.value->>'day' = ${d} then jsonb_build_object('day', ${d}::text, 'n', coalesce((app_settings.value->>'n')::int, 0) + ${n}::int) else excluded.value end, updated_at = now()`;
}
async function getText(url: string, fetchImpl: typeof fetch, timeoutMs: number, init: RequestInit = {}) { const res = await fetchImpl(url, { ...init, headers: { ...HEADERS, ...(init.headers as any) }, signal: AbortSignal.timeout(timeoutMs) }); if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.text(); }
export async function pool<T, R>(items: T[], n: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> { const out: R[] = new Array(items.length); let next = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } })); return out; }

// ---- #476 c: 국토교통부_공동주택 입찰공고 정보제공 서비스(data.go.kr 15058166) — 포털 명세(Swagger) 그대로: 입찰공고일 조회 getPblAncDeSearchV3(startDate·endDate)
// 키 승인 전이라 실제 응답은 아직 확인 못 함(가짜 서버 구조 시험). 날짜는 같은 서비스 예시값 형식(YYYYMMDD)
const KAPT_BID_API = () => (T() ? `${T()}/kaptbidapi` : 'https://apis.data.go.kr/1613000/ApHusBidPblAncInfoOfferServiceV3');
const SIDO_CODE: Record<string, string> = { 11: '서울', 26: '부산', 27: '대구', 28: '인천', 29: '광주', 30: '대전', 31: '울산', 36: '세종', 41: '경기', 42: '강원', 51: '강원', 43: '충북', 44: '충남', 45: '전북', 52: '전북', 46: '전남', 47: '경북', 48: '경남', 50: '제주' };
const API_AUTH: Record<string, string> = { '01': 'K-APT', '02': '조달청', '03': '아파트비드포유', '04': 'KG2B전자입찰', '05': '나이스아파트', '06': '이 아파트', '99': '기타민간업체' };
const API_KIND: Record<string, string> = { '01': '일반경쟁', '02': '제한경쟁', '03': '지명경쟁' };
const API_SUC: Record<string, string> = { '01': '최저(고) 낙찰', '02': '적격심사', '03': '최저 낙찰', '04': '최고 낙찰', '05': '적격심사(최저)', '06': '적격심사(최고)' };
const API_STATE: Record<string, string> = { 1: '신규공고', 2: '정정공고', 3: '재공고' };
const s0 = (v: unknown) => { if (v == null) return null; const t = String(v).trim(); return t ? t : null; };
/** 공식 API 한 줄 → 공고(목록 화면과 같은 source_external_id = 입찰번호라 한 줄로 합쳐짐). 공고문·내용은 목록 상세 쪽 값을 두고 덮지 않음 */
export function kaptApiPayload(it: any): Record<string, unknown> | null {
  const no = s0(it?.bidNum), title = s0(it?.bidTitle); if (!no || !title) return null;
  return { source_type: 'kapt_bid', source_external_id: no, source_url: `${BASE()}/bid/bidDetail.do?bidNum=${encodeURIComponent(no)}`, issuer: s0(it.bidKaptname), facility_name: s0(it.bidKaptname), title,
    region: regionFromTitle(title) ?? SIDO_CODE[String(it.bidArea ?? '').slice(0, 2)] ?? null, posted_date: s0(it.bidRegDate), deadline_at: s0(it.bidDeadline), notice_state: API_STATE[String(it.bidState ?? '')] ?? null,
    bid_system: API_AUTH[String(it.codeAuth ?? '')] ?? null, award_method: API_SUC[String(it.codeSucWay ?? '')] ?? null, contract_method: API_KIND[String(it.codeKind ?? '')] ?? null, participation_deadline_at: s0(it.bidDocsDeadline) };
}
async function kaptApiNotices(ctx: CollectorCtx, days: number): Promise<{ items: Record<string, unknown>[]; note: string; error?: string }> {
  const key = await kaptKey(); if (!key) return { items: [], note: '공식 API: 키 없음(KAPT_SERVICE_KEY·DATA_GO_KR_SERVICE_KEY) — 목록 화면만' };
  const end = new Date(ctx.now()); const start = new Date(end.getTime() - days * 864e5); const ymd = (d: Date) => kstYmd(d).replace(/-/g, '');
  const items: Record<string, unknown>[] = []; const t0 = ctx.now(); // 수집기 45초 안 — 공식 API 는 모두 합쳐 15초·3쪽(1,500건)까지
  try {
    for (let page = 1; page <= 3 && ctx.now() - t0 < 12000; page++) {
      const u = new URL(`${KAPT_BID_API()}/getPblAncDeSearchV3`); u.searchParams.set('serviceKey', key); u.searchParams.set('startDate', ymd(start)); u.searchParams.set('endDate', ymd(end)); u.searchParams.set('pageNo', String(page)); u.searchParams.set('numOfRows', '500'); u.searchParams.set('_type', 'json');
      const rows = await callDataGo(u, ctx.fetchImpl, key, Math.max(3000, 15000 - (ctx.now() - t0)));
      for (const it of rows) { const p = kaptApiPayload(it); if (p) items.push(p); }
      if (rows.length < 500) break;
    }
  } catch (e) { const msg = portalErr(e instanceof Error ? e.message : String(e), '15058166'); return { items, note: `공식 API: ${msg}`, error: `공식 API(15058166): ${msg}` }; }
  return { items, note: `공식 API ${items.length}건(최근 ${days}일)` };
}

export const kaptBidNotices: Collector = {
  slug: 'kapt_bid_notices', label: 'K-apt 전국 입찰공고', hourKst: 6, againKst: [10, 14, 18],
  source: 'k-apt.go.kr/bid/bidList.do (K-APT·조달청·민간 전자입찰 통합, 키 불필요) + 공식 API(data.go.kr 15058166, 키 있으면 함께) — 06시 전체, 10·14·18시는 최신 500건',
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const { fetchImpl, deadlineMs, now } = ctx;
    const started = now(); const left = () => deadlineMs - (now() - started); const errors: string[] = []; let listFailures = 0;
    const all: KaptBidRow[] = []; let malformed = 0;
    // #476 c: 06시는 전체(최대 40쪽), 10·14·18시·그 뒤 [지금 수집]은 최신순 앞 5쪽(500건) — 목록은 등록 시각 최신순(10/23 실측)
    const full = ctx.params?.full === true || kstHourNow() < 10; const pagesMax = full ? MAX_PAGES : QUICK_PAGES;
    const api = await kaptApiNotices(ctx, full ? 3 : 2); if (api.error) errors.push(api.error);
    // 목록 화면이 실패해도 공식 API 로 받은 공고는 적재
    const first = await getText(`${BASE()}/bid/bidList.do?pageNo=1&pageSelect=${PAGE_SIZE}`, fetchImpl, 15000).then(parseKaptBidList).catch((e) => { listFailures++; errors.push(`목록 1쪽: ${e instanceof Error ? e.message : String(e)}`); return { rows: [] as KaptBidRow[], malformed: 0 }; });
    if (!first.rows.length && !api.items.length) return { inserted: 0, updated: 0, unchanged: 0, errors: 1 + (api.error ? 1 : 0), errorLog: [listFailures ? null : 'K-apt 목록 0건 — 원천 형식 변경 의심', ...errors].filter(Boolean).join('\n'), summary: `K-apt 입찰공고: 목록 ${listFailures ? '불러오기 실패' : '파싱 0건'} · ${api.note}`, providerMode: 'web_scrape' };
    if (!first.rows.length && !listFailures) errors.push('K-apt 목록 0건 — 원천 형식 변경 의심(공식 API 공고만 적재)');
    all.push(...first.rows); malformed += first.malformed;
    if (first.rows.length === PAGE_SIZE) for (let p = 2; p <= pagesMax && left() > 20000; p += 4) {
      const pages = [p, p + 1, p + 2, p + 3].filter((x) => x <= pagesMax);
      const res = await pool(pages, 4, async (pg) => { try { return parseKaptBidList(await getText(`${BASE()}/bid/bidList.do?pageNo=${pg}&pageSelect=${PAGE_SIZE}`, fetchImpl, 12000)); } catch (e) { listFailures++; errors.push(`목록 ${pg}쪽: ${e instanceof Error ? e.message : String(e)}`); return null; } });
      let done = false; for (const r of res) { if (!r) continue; all.push(...r.rows); malformed += r.malformed; if (r.rows.length < PAGE_SIZE) done = true; } if (done) break;
    }
    if (malformed) errors.push(`형식이 다른 줄 ${malformed}건 건너뜀`);
    const seen = new Set<string>(); const uniq = all.filter((r) => (seen.has(r.bidNum) ? false : (seen.add(r.bidNum), true)));
    const fitRows = uniq.filter((r) => matchFit(r.title, '공동주택').fit); const details = new Map<string, KaptBidDetail>();
    // 상세 = K-apt 세션(쿠키·_csrf). #507 후속: 새 관련 공고는 같은 세션으로 첨부 목록(이름·파일 번호)까지 — 하루 상한
    const need = await filesNeeded(fitRows.slice(0, DETAIL_LIMIT).map((r) => r.bidNum)).catch(() => new Set<string>());
    let budget = need.size ? await fileListBudget().catch(() => 0) : 0; let filesRead = 0, listFiles = 0, listFailed = 0;
    await pool(fitRows.slice(0, DETAIL_LIMIT), 6, async (r) => {
      if (left() < 15000) return;
      try {
        const s = await kaptSession(r.bidNum, fetchImpl, 8000); if (s.status !== 200) throw new Error(`HTTP ${s.status}`);
        const d = parseKaptBidDetail(s.html);
        if (need.has(r.bidNum) && budget > 0 && left() > 15000) {
          budget--;
          try { const list = await kaptFileList(r.bidNum, { fetchImpl, session: s, timeoutMs: 8000 }); d.files = list.map((f) => ({ name: f.name, url: kaptFileUrl(r.bidNum, f.seq) })); filesRead++; listFiles += list.length; }
          catch (e) { listFailed++; if (errors.length < 15) errors.push(`첨부 목록 ${r.bidNum}: ${e instanceof Error ? e.message : String(e)}`); }
        }
        details.set(r.bidNum, d);
      } catch (e) { if (errors.length < 15) errors.push(`상세 ${r.bidNum}: ${e instanceof Error ? e.message : String(e)}`); }
    });
    await fileListUsed(filesRead + listFailed).catch(() => {});
    const fitIds = new Set(fitRows.map((r) => r.bidNum));
    const listed = new Set(uniq.map((r) => r.bidNum));
    // 공식 API 에만 있는 공고(목록 화면 쪽에서 놓친 것)를 앞에 — 같은 입찰번호는 목록 화면 값(상세 포함)이 기준
    const apiOnly = api.items.filter((p) => !listed.has(String(p.source_external_id)));
    const ordered = [...apiOnly.filter((p) => matchFit(String(p.title), '공동주택').fit), ...fitRows.map((r) => toPayload(r, details.get(r.bidNum))), ...apiOnly.filter((p) => !matchFit(String(p.title), '공동주택').fit), ...uniq.filter((r) => !fitIds.has(r.bidNum)).map((r) => toPayload(r, details.get(r.bidNum)))];
    let inserted = 0, updated = 0, unchanged = 0, writeErrors = 0, invalid = 0, written = 0;
    for (let i = 0; i < ordered.length; i += CHUNK) {
      if (left() < 5000) { errors.push(`시간 한도 근접 — ${ordered.length - i}건(비관련 공고)은 다음 실행에서`); break; }
      const batch = ordered.slice(i, i + CHUNK);
      try { const r = await upsertNotices(batch); inserted += r.inserted; updated += r.updated; unchanged += r.unchanged; writeErrors += r.errors; invalid += r.invalid; written += batch.length; if (r.errorLog && errors.length < 15) errors.push(r.errorLog); }
      catch (e) { writeErrors += batch.length; errors.push(`쓰기 실패 x${batch.length}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    // 185차(로컬 10/26 19:20 A4): 규칙이 바뀐 뒤에도 예전 판정('관련 아님')으로 남은 최근 공고를 다시 판정(올리기만) — 모든 원천 공고
    const refit = left() > 4000 ? await refitNotices().catch((e) => { errors.push(`다시 판정: ${e instanceof Error ? e.message : String(e)}`); return null; }) : null;
    let direct = 0; const fitCount = { 다짐: 0, 하이링크: 0, 둘다: 0 };
    for (const r of fitRows) { const d = details.get(r.bidNum); const m = matchFit(r.title, d?.category, d?.content, '공동주택'); if (m.direct) direct++; if (m.fit === '다짐') fitCount.다짐++; else if (m.fit === '하이링크') fitCount.하이링크++; else if (m.fit) fitCount.둘다++; }
    return { inserted, updated, unchanged, errors: writeErrors + invalid + listFailures + (api.error ? 1 : 0) + (written < ordered.length ? 1 : 0), errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape',
      summary: `${full ? '' : '빠른 수집(최신 500건) · '}K-apt 입찰공고 목록 ${uniq.length}건 · 관련 ${fitRows.length}건(즉시 검토 ${direct} · 다짐 ${fitCount.다짐}·하이링크 ${fitCount.하이링크}·둘다 ${fitCount.둘다}, 상세 ${details.size}${filesRead || listFailed ? ` · 첨부 목록 ${filesRead}건(파일 ${listFiles}${listFailed ? `, 못 읽음 ${listFailed}` : ''})` : ''}) · ${api.note}${apiOnly.length ? `(목록에 없던 ${apiOnly.length}건 추가)` : ''} · 적재 ${written}건: 신규 ${inserted} · 갱신 ${updated} · 변화없음 ${unchanged}` + (invalid ? ` · 무효 ${invalid}` : '') + (refit?.raised ? ` · 다시 판정으로 관련 ${refit.raised}건(마감 전 ${refit.reopened})` : '') };
  },
};

/** 입찰결과(낙찰) — 세션 쿠키 + _csrf → bidResultListAjax(검색어 18개, 최근 1년). 관련 결과만 낙찰 병합(기존 공고 없으면 신규) */
export const KAPT_RESULT_WORDS = ['헬스', '피트니스', '운동기구', '커뮤니티', '주민공동', '주민운동', '체력단련', 'GX', '골프', '수영', '사우나', '위탁운영', '위탁 운영', '출입통제', '출입관리', '안면인식', '키오스크', '무인'];
export function parseKaptResultRows(body: string): { bidNum: string; title: string; complex: string; winner: string | null; amount: string | null; date: string | null }[] {
  const out: { bidNum: string; title: string; complex: string; winner: string | null; amount: string | null; date: string | null }[] = [];
  let j: any = null; try { j = JSON.parse(body); } catch { /* HTML */ }
  const list = Array.isArray(j) ? j : Array.isArray(j?.list) ? j.list : Array.isArray(j?.resultList) ? j.resultList : Array.isArray(j?.data) ? j.data : null;
  if (list) { for (const it of list) { const bidNum = String(it.bidNum ?? it.BID_NUM ?? it.bidNo ?? ''); if (!bidNum) continue; out.push({ bidNum, title: String(it.bidTitle ?? it.BID_TITLE ?? it.title ?? ''), complex: String(it.kaptName ?? it.KAPT_NAME ?? it.complexName ?? ''), winner: it.sucsBidder ?? it.SUCS_BIDDER ?? it.winner ?? null, amount: it.sucsAmt ?? it.SUCS_AMT ?? it.amount ?? null, date: it.sucsDate ?? it.SUCS_DATE ?? it.openDate ?? null }); } return out; }
  for (const m of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) { const tr = m[1]; const id = m[0].match(/goView\('([^']+)'\)|bidNum=([^&'"]+)/); /* 원본 K-apt 는 <tr onclick="goView('…')"> — 행 여는 태그까지 본다 */ const bidNum = id?.[1] ?? id?.[2]; if (!bidNum) continue; const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1])); if (cells.length < 5) continue;
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
    const items: Record<string, unknown>[] = []; let seen = new Set<string>(); let listed = 0;
    for (const w of KAPT_RESULT_WORDS) {
      if (left() < 8000) { errors.push(`시간 한도 근접 — 검색어 '${w}' 부터는 다음 실행에서`); break; }
      try {
        const body = new URLSearchParams({ searchKeyword: w, sortType: '01', pageNo: '1', pageSelect: '100', startDate: from, endDate: to, ...(csrf ? { _csrf: csrf } : {}) });
        const res = await fetchImpl(`${BASE()}/bid/bidResultListAjax.do`, { method: 'POST', headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}), ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}) }, body, signal: AbortSignal.timeout(10000) });
        if (!res.ok) { errors.push(`'${w}': HTTP ${res.status}`); continue; }
        const rows = parseKaptResultRows(await res.text()); listed += rows.length; if (!rows.length && errors.length < 12) errors.push(`'${w}': 결과 목록 0건(응답 형식 확인 필요)`);
        for (const r of rows) { if (seen.has(r.bidNum) || !matchFit(r.title, '공동주택').fit) continue; seen.add(r.bidNum);
          items.push({ source_type: 'kapt_bid', source_external_id: r.bidNum, source_url: `${BASE()}/bid/bidDetail.do?bidNum=${encodeURIComponent(r.bidNum)}`, title: r.title, issuer: r.complex || null, facility_name: r.complex || null, region: regionFromTitle(r.title), winner_name: r.winner, winner_amount: r.amount, award_date: r.date }); }
      } catch (e) { errors.push(`'${w}': ${e instanceof Error ? e.message : String(e)}`); }
    }
    const r = items.length ? await upsertNotices(items, { mergeScope: 'award' }) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, duplicatesMerged: 0, errorLog: undefined as string | undefined };
    if (r.errorLog) errors.push(r.errorLog);
    return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + errors.length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape', summary: `K-apt 입찰결과 목록 ${listed}건 · 관련 ${items.length}건 · 낙찰 병합 ${r.updated} · 신규 ${r.inserted} · 변화없음 ${r.unchanged}` };
  },
};

// ---- 사업자선정 결과: 국토교통부_공동주택 입찰결과공지 정보제공 서비스(data.go.kr 15059177) — 포털 명세(Swagger) 그대로 ----
// 로컬 10/24 19:20(운영 'OpenAPI 호출 실패'): 예전 주소(B553530/kaptBidResult/getKaptBidResultList)는 명세에 없는 주소였다 →
// 입찰 상태 조회 getBidSttusSearchV3(bidState=5 낙찰공고 · searchYear 올해·작년), 낙찰 업체는 커뮤니티·운동시설 위탁 건만 입찰 참여업체 조회 getBidEntrpsInfoSearchV3(bidNum)의 낙찰여부 Y
const KAPT_API = () => (T() ? `${T()}/kaptapi` : process.env.KAPT_API_BASE?.trim() || 'https://apis.data.go.kr/1613000/ApHusBidResultNoticeInfoOfferServiceV3');
const toStr = (v: unknown) => { if (v == null) return null; const s = String(v).trim(); return s.length ? s : null; };
const toYmd = (v: unknown) => { if (!v) return null; const s = String(v).trim(); if (/^\d{8}/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10); };
/** 명세 칸(bidNum·bidKaptname·aptCode·bidArea·bidTitle·bidResultContent·bidRegdate·amount·contractPeriodSdate/Edate) → kapt_vendor_selection 한 줄 */
export function toKaptRaw(r: any) {
  const ext = toStr(r.bidNum); const complexName = toStr(r.bidKaptname); if (!ext || !complexName) return null;
  const title = toStr(r.bidTitle);
  const amount = (() => { const v = r.amount; if (v == null || v === '') return null; const n = Number(String(v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; })();
  return { source_type: 'kapt_sa_sun', source_external_id: ext, source_url: `${BASE()}/bid/bidDetail.do?bidNum=${encodeURIComponent(ext)}`, complex_code: toStr(r.aptCode), complex_name: complexName, address: null as string | null,
    region: (title ? regionFromTitle(title) : null) ?? SIDO_CODE[String(r.bidArea ?? '').slice(0, 2)] ?? null, household_count: null as number | null, task_category: title, task_detail: toStr(r.bidResultContent) ?? toStr(r.bidContent),
    announcement_date: toYmd(r.bidRegdate ?? r.bidRegDate), bid_open_date: toYmd(r.bidDeadline), selected_vendor: null as string | null, selected_vendor_biz_no: null as string | null, selected_amount: amount,
    contract_start_date: toYmd(r.contractPeriodSdate), contract_end_date: toYmd(r.contractPeriodEdate) };
}
export const kaptSaSun: Collector = {
  slug: 'kapt_sa_sun', label: 'K-apt 사업자선정 결과', hourKst: 8, source: 'apis.data.go.kr/1613000/ApHusBidResultNoticeInfoOfferServiceV3 낙찰공고(올해·작년) — 키는 KAPT_SERVICE_KEY, 없으면 공공데이터포털 키(15059177 활용신청)', needs: ['KAPT_SERVICE_KEY(없으면 DATA_GO_KR_SERVICE_KEY)'],
  keyReady: async () => !!(await kaptKey()),
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const key = await kaptKey(); const year = Number(kstYmd(new Date(ctx.now())).slice(0, 4));
    if (!key) return { inserted: 0, updated: 0, unchanged: 0, errors: 0, summary: `K-apt 사업자선정 ${year - 1}~${year} · 키 없음(KAPT_SERVICE_KEY·DATA_GO_KR_SERVICE_KEY) — 공공데이터포털 15059177 활용신청 후 플랫폼 운영 또는 Vercel env`, providerMode: 'api' };
    const t0 = ctx.now(); const items: any[] = [];
    try {
      for (const y of [year, year - 1]) for (let page = 1; page <= 4 && ctx.now() - t0 < 20000; page++) {
        const u = new URL(`${KAPT_API()}/getBidSttusSearchV3`); u.searchParams.set('serviceKey', key); u.searchParams.set('bidState', '5'); u.searchParams.set('searchYear', String(y)); u.searchParams.set('pageNo', String(page)); u.searchParams.set('numOfRows', '500');
        const rows = await callDataGo(u, ctx.fetchImpl, key, Math.max(3000, 20000 - (ctx.now() - t0)));
        items.push(...rows); if (rows.length < 500) break;
      }
    } catch (e) { const msg = portalErr((e instanceof Error ? e.message : String(e)).split(key).join('***'), '15059177'); return { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: `OpenAPI 호출 실패: ${msg}`, summary: `K-apt 사업자선정: ${msg}`, providerMode: 'api' }; } // 예전엔 활용신청 말고는 'OpenAPI 호출 실패'만 보여 원인을 몰랐음
    const seen = new Set<string>(); // 올해·작년 두 번 물어 같은 입찰번호가 겹치면 한 줄
    const raws = items.map(toKaptRaw).filter((r): r is NonNullable<ReturnType<typeof toKaptRaw>> => !!r && !seen.has(r.source_external_id) && !!seen.add(r.source_external_id));
    // 커뮤니티·운동시설 위탁 건(운영중 단지로 이어지는 것)만 낙찰 업체 이름 — 이미 아는 건은 다시 묻지 않음, 한 번에 30건
    const relevant = raws.filter((r) => KAPT_RELEVANT_TASK.test(`${r.task_category ?? ''} ${r.task_detail ?? ''}`));
    const known = await knownKaptVendors(relevant.map((r) => r.source_external_id)); let named = 0; const vendorErrors: string[] = [];
    for (const r of relevant) {
      if (named >= 30 || ctx.now() - t0 > 35000) break; if (known.has(r.source_external_id)) continue;
      try { const u = new URL(`${KAPT_API()}/getBidEntrpsInfoSearchV3`); u.searchParams.set('serviceKey', key); u.searchParams.set('bidNum', r.source_external_id); u.searchParams.set('pageNo', '1'); u.searchParams.set('numOfRows', '50');
        const es = await callDataGo(u, ctx.fetchImpl, key, 5000); const win = es.find((e: any) => /^(Y|낙찰)/i.test(String(e?.bidSuccessfulYn ?? '').trim()));
        if (win) { r.selected_vendor = toStr(win.companyName); named++; } }
      catch (e) { if (vendorErrors.length < 3) vendorErrors.push(`낙찰 업체 ${r.source_external_id}: ${(e instanceof Error ? e.message : String(e)).split(key).join('***').slice(0, 120)}`); }
    }
    let inserted = 0, updated = 0, skipped = 0; const errors: string[] = [...vendorErrors];
    for (const r of raws) { try { const res = await upsertKaptVendor(r); if (res.result === 'insert') inserted++; else if (res.result === 'update') updated++; else skipped++; } catch (e) { errors.push(`${r.source_external_id}: ${e instanceof Error ? e.message : String(e)}`); } }
    return { inserted, updated, unchanged: skipped, errors: errors.length, errorLog: errors.length ? errors.slice(0, 10).join('\n') : undefined, providerMode: 'api',
      summary: `K-apt 사업자선정(낙찰공고) ${year - 1}~${year} · 응답 ${items.length}건 · 커뮤니티·운동 관련 ${relevant.length}건(낙찰 업체 새로 ${named}건) · 신규 ${inserted} · 갱신 ${updated}` };
  },
};
export const operatingFromKapt: Collector = {
  slug: 'operating_from_kapt', label: '운영중 공동주택 — K-apt 사업자선정 파생', hourKst: 8, source: 'DB 내부 파생(외부 호출 없음) — 커뮤니티·운동시설 위탁 업무만',
  async run({ params }: CollectorCtx): Promise<CollectorResult> {
    try { const r = await deriveOperatingFromKapt(typeof params?.limit === 'number' ? params.limit : 500); return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + r.invalid, errorLog: r.errorLog, providerMode: 'manual', summary: `신규 ${r.inserted} · 갱신 ${r.updated} · 변화없음 ${r.unchanged} · 대상외 업무 ${r.filtered}` + (r.errors ? ` · 오류 ${r.errors}` : '') }; }
    catch (e) { const msg = e instanceof Error ? e.message : String(e); return { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: msg, summary: `파생 적재 실패: ${msg}`, providerMode: 'manual' }; }
  },
};
