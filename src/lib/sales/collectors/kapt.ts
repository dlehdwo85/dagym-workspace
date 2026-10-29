// K-apt(공동주택) 수집기 3종 — 전국 입찰공고 HTML(키 불필요) · 입찰결과 HTML(낙찰 병합) · 사업자선정 결과 OpenAPI(KAPT_SERVICE_KEY). 원본 lib/collectors/kapt_* 이식(10/21).
import { db } from '../../db';
import { dataGoKey } from '../collect';
import { kaptDetailUrl, kaptFileList, kaptFileUrl, kaptSession } from '../files';
import { callDataGo } from './g2b';
import { matchFit } from './procurement';
import { upsertKaptVendor, upsertNotices, deriveOperatingFromKapt, knownKaptVendors, refitNotices } from './store';
import { KAPT_RELEVANT_TASK } from './prospects';
import type { Collector, CollectorCtx, CollectorResult } from './types';

const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
const BASE = () => (T() ? `${T()}/kapt` : 'https://www.k-apt.go.kr');
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; WorkIn-collector/1.0)', 'Accept-Language': 'ko-KR' };
const PAGE_SIZE = 100, MAX_PAGES = 40, QUICK_PAGES = 5, DETAIL_LIMIT = 150, CHUNK = 500, WATCH_LIMIT = 40;
const kstHourNow = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const kstYmd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
/** #476 f: K-apt 공공데이터 키 — KAPT_SERVICE_KEY 가 없으면 같은 포털 키(플랫폼 운영에 넣은 공공데이터포털 키 → DATA_GO_KR_SERVICE_KEY) */
export async function kaptKey(): Promise<string | null> {
  const k = dataGoKey(process.env.KAPT_SERVICE_KEY); if (k) return k;
  return (await (await import('./support')).supportKeys().catch(() => null))?.datago ?? dataGoKey();
}
/** 활용신청 안 된 키(포털 공통 오류) → '활용신청 필요(서비스 번호)' — #172 화면이 번호로 [활용신청] 링크를 붙임 */
export const portalErr = (msg: string, service: string) => (/활용신청 필요|SERVICE_KEY_IS_NOT_REGISTERED|SERVICE ACCESS DENIED|등록되지 않은 (서비스|인증)키/i.test(msg) ? `공공데이터포털 활용신청 필요(서비스 ${service}) — 키는 그대로 두고 포털(data.go.kr)에서 [활용신청]` : msg);
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
  /** #507 후속: 첨부 목록 API(bidFileListData.do)로 읽은 원래 이름·파일 번호 */ files?: { name: string | null; url: string }[];
  /** 239차(#743·#744): 참가 조건·현장설명 칸 */ terms?: KaptBidTerms;
  /** #751(로컬 10/28 17:25): 마감 전에 취소된 공고 — '낙찰업체 정보' 표에 '취소된 계약 입니다' · '낙찰/유찰/취소 사유' */ canceled?: boolean; cancelReason?: string | null };
/** 239차(#743·#744 로컬 10/28 19:30·19:45): 입찰공고 상세의 참가 조건·현장설명 — 파일을 열지 않고 목록 줄·상세·메일에 */
export type KaptBidTerms = { briefingKind: '필수' | '임의' | '없음' | '공고문 참조' | null; briefingAt: string | null; briefingPlace: string | null; bidDocs: string | null; creditCert: string | null;
  perfCert: string | null; bidBond: string | null; docsDeadline: string | null; bidMethod: string | null; urgent: boolean | null; payTerms: string | null };
/** 칸 이름은 줄바꿈(<br>)·빈칸을 빼고 비교('신용평가등급확인서<br>제출여부'). 고르기 칸은 checked='checked' 인 것 — K-apt 는 안 고른 칸에 checked="" 를 씀(10/28 실제 화면).
 *  숨긴 줄(display:none — '입찰구비서류'는 2023-02-20 전 공고에만 화면 스크립트가 보여 줌)은 읽지 않음 */
export function parseKaptBidTerms(html0: string): KaptBidTerms {
  const html = html0.replace(/<tr[^>]*display\s*:\s*none[^>]*>[\s\S]*?<\/tr>/gi, '');
  const cells = new Map([...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => [text(m[1]).replace(/\s/g, ''), m[2]]));
  const cell = (name: string) => cells.get(name.replace(/\s/g, ''));
  const plain = (h: string | undefined) => (h == null ? null : text(h.replace(/<p[^>]*font_red[^>]*>[\s\S]*?<\/p>/g, '')) || null); // 빨간 안내 문장('불참업체는 불이익…')은 뺌
  // #743 개인정보: 장소·지급조건 칸에 함께 적힌 담당자·전화는 지움('관리사무소 (담당 ○○○ 02-…)')
  const scrub = (v: string | null) => { if (!v) return null; const t = v.replace(/\(?\s*(?:담당자?|문의|연락처|전화|☎|tel\.?)\s*[:：]?[^)·,]*\)?/gi, ' ').replace(/\d{2,4}[-.)\s]\d{3,4}[-.\s]\d{4}/g, ' ').replace(/\s+/g, ' ').replace(/[\s,·(]+$/, '').trim(); return t || null; };
  const picked = (h: string | undefined) => { if (!h) return null; const m = [...h.matchAll(/<input[^>]*>/g)].map((x) => x[0]).find((x) => /\bchecked\s*=\s*['"]checked['"]/i.test(x)); return m ? (m.match(/\bid\s*=\s*['"]([^'"]+)/)?.[1] ?? null) : null; };
  const ref = (v: string | null) => !!v && /공고문\s*참조/.test(v);
  const when = (v: string | null) => { const m = String(v ?? '').match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/); return m ? `${m[1]}T${m[2]}:${m[3]}:00+09:00` : null; };
  const yn = (v: string | null) => (v == null ? null : ref(v) ? '공고문 참조' : /미\s*제출|제출\s*안/.test(v) ? '미제출' : /제출/.test(v) ? '제출' : v.slice(0, 40));
  const sb = cell('현장설명'); const sbPick = picked(sb);
  const kinds: Record<string, '필수' | '임의' | '없음'> = { isFiledDesP: '필수', isFiledDesY: '임의', isFiledDesN: '없음' };
  const place = scrub(plain(cell('현장설명장소'))); const docs = cell('입찰구비서류'); const dp = picked(docs); const bond = plain(cell('입찰보증금')); const em = picked(cell('긴급입찰여부')); const pay = scrub(plain(cell('지급조건')));
  return {
    briefingKind: sbPick ? kinds[sbPick] ?? null : ref(plain(sb)) ? '공고문 참조' : null,
    briefingAt: when(plain(cell('현장설명일시'))), briefingPlace: place && !ref(place) ? place.slice(0, 100) : null,
    bidDocs: [dp === 'bidReqDocsY' ? '있음' : dp === 'bidReqDocsN' ? '없음' : null, ref(plain(docs)) ? '공고문 참조' : null].filter(Boolean).join(' · ') || null,
    creditCert: yn(plain(cell('신용평가등급확인서 제출여부'))), perfCert: yn(plain(cell('관리(공사용역) 실적증명서 제출여부'))),
    bidBond: bond ? bond.replace(/\[\s*([\d.]+)\s*\]/g, ' $1').replace(/\s+/g, ' ').trim().slice(0, 80) : null, // '입찰가격의[5]% 이상 제출' → '입찰가격의 5% 이상 제출'
    docsDeadline: when(plain(cell('서류제출마감일'))), bidMethod: plain(cell('입찰방법'))?.slice(0, 40) ?? null,
    urgent: em === 'emrgBidY' ? true : em === 'emrgBidN' ? false : null, payTerms: pay ? pay.slice(0, 100) : null,
  };
}
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
  if (/현장설명|입찰보증금|신용평가/.test(html)) d.terms = parseKaptBidTerms(html);
  // #751(광명자이더샵포레나 kg2b_142624): K-apt 목록은 취소된 공고도 '신규공고'로 두고 상세에만 '취소된 계약 입니다'·사유를 보여 줌
  if (/취소된\s*계약/.test(html)) { d.canceled = true; d.cancelReason = parseKaptAwardDetail(html).reason; }
  return d;
}
/** 241차(로컬 10/28 19:20 'kg2b_142624 상세 요청의 응답 코드·길이·취소된 계약 포함 여부'): 플랫폼 공고 조회의 [상세 지금 받아 보기] — 저장하지 않음.
 *  화면 글·대표자·전화는 돌려주지 않고 응답 코드·길이·취소 여부·사유·참가 조건을 읽었는지만 */
export async function probeKaptDetail(bid: string) {
  const at = new Date().toISOString();
  try {
    const s = await kaptSession(bid, fetch, 10000); const d = parseKaptBidDetail(s.html);
    return { at, url: kaptDetailUrl(bid), status: s.status, length: s.html.length, canceledText: /취소된\s*계약/.test(s.html), canceled: !!d.canceled, reason: d.cancelReason ?? null,
      termsFound: !!d.terms, briefing: d.terms?.briefingKind ?? null, title: /입찰제목/.test(s.html) };
  } catch (e) { return { at, url: kaptDetailUrl(bid), status: 0, length: 0, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) }; }
}
export const regionFromTitle = (title: string) => title.match(/^\s*\[([^\]]{1,12})\]/)?.[1]?.trim() ?? null;
export function toPayload(r: KaptBidRow, d?: KaptBidDetail): Record<string, unknown> {
  return { source_type: 'kapt_bid', source_external_id: r.bidNum, source_url: `${BASE().replace(/\/kapt$/, T() ? '/kapt' : '')}/bid/bidDetail.do?bidNum=${encodeURIComponent(r.bidNum)}`, issuer: r.complex || null, facility_name: r.complex || null, title: r.title, region: regionFromTitle(r.title),
    posted_date: r.registeredAt.slice(0, 10), deadline_at: r.deadline, notice_state: d?.canceled ? '취소' : r.state, bid_system: r.system, award_method: r.awardMethod, contract_method: d?.bidKind ?? null, bid_category: d?.category ?? null, task_scope: d?.content ?? null,
    office_phone: d?.phone ?? null, office_fax: d?.fax ?? null, office_address: d?.officeAddress ?? null, household_count: d?.households ?? null,
    // 첨부는 첨부 목록 API 로 읽은 것만(상세 HTML 의 링크는 화면 스크립트가 그려 실제 K-apt 에선 비거나 엉뚱한 주소 — 10/23 a7e4efad·086aeff2)
    attachment_urls: d?.files ? d.files.map((f) => (f.name ? { name: f.name, url: f.url } : f.url)) : [], files_checked_at: d?.files ? new Date().toISOString() : null,
    // 239차(#743·#744): 참가 조건·현장설명(상세를 읽은 때만 — 못 읽은 실행은 칸을 안 보내 저장된 값을 지우지 않음)
    ...(d?.canceled && d.cancelReason ? { result_note: d.cancelReason } : {}), // #751 취소 사유(상태 '취소'·공고구분 'cancel' 은 notice_state 로 계산)
    ...(d?.canceled ? { kapt_cancel_at: new Date().toISOString() } : {}), // #751 후속: 상세로 취소를 안 때(처음 한 번) — 원본 매일 복사가 '진행중'으로 되돌리지 않게
    ...(d?.terms ? { site_briefing_kind: d.terms.briefingKind, site_briefing_at: d.terms.briefingAt, site_briefing_place: d.terms.briefingPlace, bid_docs: d.terms.bidDocs,
      credit_rating_cert: d.terms.creditCert, performance_cert: d.terms.perfCert, bid_bond: d.terms.bidBond, docs_deadline_at: d.terms.docsDeadline, bid_method: d.terms.bidMethod,
      urgent_bid: d.terms.urgent, payment_terms: d.terms.payTerms, terms_read_at: new Date().toISOString() } : {}) };
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
    // 239차(#743 로컬 10/28 19:30): 상세(참가 조건·현장설명)는 아직 마감 안 된 관련 공고부터 — 한 번에 읽는 수(DETAIL_LIMIT) 안에서 지난 공고에 밀리지 않게
    const td = kstYmd(new Date(now())); const ended = (r: KaptBidRow) => r.deadline.slice(0, 10) < td || /마감(?!임박)|종료|취소|낙찰|유찰/.test(r.state);
    const detailRows = [...fitRows.filter((r) => !ended(r)), ...fitRows.filter(ended)].slice(0, DETAIL_LIMIT);
    const need = await filesNeeded(detailRows.map((r) => r.bidNum)).catch(() => new Set<string>());
    let budget = need.size ? await fileListBudget().catch(() => 0) : 0; let filesRead = 0, listFiles = 0, listFailed = 0;
    await pool(detailRows, 6, async (r) => {
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
    // 241차 #751 후속(로컬 10/28 19:20 kg2b_142624 — 빠른 수집 목록(최신 500건) 밖으로 밀린 공고는 상세를 다시 못 읽어 취소를 놓침): 이번에 상세를 못 읽은
    // 마감 전 관련 K-apt 공고를 DB 에서 상세를 오래전에 읽은 순으로 한 번에 40건 다시 읽음 — 목록 칸은 저장된 값 그대로, 상세 칸(취소·참가 조건)만 고침
    const watched: Record<string, unknown>[] = []; let watchCanceled = 0;
    if (left() > 20000) {
      const skip = [...new Set([...details.keys(), ...detailRows.map((r) => r.bidNum)])];
      const rows0 = await db()<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and row->>'source_type' = 'kapt_bid'
          and coalesce(row->>'related', 'false') = 'true' and coalesce(row->>'deadline_at', '') >= ${td} and coalesce(row->>'current_status', '') !~ '취소|낙찰|유찰'
          and not (row->>'source_external_id' = any(${skip}::text[]))
        order by row->>'detail_seen_at' asc nulls first, row->>'deadline_at' asc limit ${WATCH_LIMIT * 2}`.catch(() => []);
      const seenExt = new Set<string>();
      const wl = rows0.map((x) => x.row).filter((x) => { const k = String(x?.source_external_id ?? ''); if (!k || seenExt.has(k)) return false; seenExt.add(k); return true; }).slice(0, WATCH_LIMIT);
      await pool(wl, 6, async (x) => {
        if (left() < 15000) return;
        try {
          const s = await kaptSession(String(x.source_external_id), fetchImpl, 8000); if (s.status !== 200) throw new Error(`HTTP ${s.status}`);
          const d = parseKaptBidDetail(s.html); if (d.canceled) watchCanceled++;
          // 목록 칸(제목·마감·공고 구분·주소·지역·발주처)은 저장된 값 그대로 — 상태·공고 종류 계산이 목록에서 읽을 때와 같고, 표기 차이로 '변경'이 되지 않게. 상세 칸만 새로
          const p = toPayload({ bidNum: String(x.source_external_id), title: String(x.title ?? ''), deadline: String(x.deadline_at ?? ''), state: String(x.notice_state ?? ''),
            complex: String(x.facility_name ?? x.issuer ?? ''), registeredAt: String(x.posted_date ?? ''), system: String(x.bid_system ?? ''), awardMethod: String(x.award_method ?? '') }, d);
          watched.push({ ...p, source_url: x.source_url || p.source_url, region: x.region ?? p.region, issuer: x.issuer ?? p.issuer, facility_name: x.facility_name ?? p.facility_name,
            detail_seen_at: new Date().toISOString() }); // 다시 확인한 때 — 다음 실행은 오래전에 확인한 공고부터
        } catch (e) { if (errors.length < 15) errors.push(`다시 확인 ${x.source_external_id}: ${e instanceof Error ? e.message : String(e)}`); }
      });
    }
    const fitIds = new Set(fitRows.map((r) => r.bidNum));
    const listed = new Set(uniq.map((r) => r.bidNum));
    // 공식 API 에만 있는 공고(목록 화면 쪽에서 놓친 것)를 앞에 — 같은 입찰번호는 목록 화면 값(상세 포함)이 기준
    const apiOnly = api.items.filter((p) => !listed.has(String(p.source_external_id)));
    const ordered = [...watched, ...apiOnly.filter((p) => matchFit(String(p.title), '공동주택').fit), ...fitRows.map((r) => toPayload(r, details.get(r.bidNum))), ...apiOnly.filter((p) => !matchFit(String(p.title), '공동주택').fit), ...uniq.filter((r) => !fitIds.has(r.bidNum)).map((r) => toPayload(r, details.get(r.bidNum)))];
    let inserted = 0, updated = 0, unchanged = 0, writeErrors = 0, invalid = 0, written = 0;
    for (let i = 0; i < ordered.length; i += CHUNK) {
      if (left() < 5000) { errors.push(`시간 한도 근접 — ${ordered.length - i}건(비관련 공고)은 다음 실행에서`); break; }
      const batch = ordered.slice(i, i + CHUNK);
      try { const r = await upsertNotices(batch); inserted += r.inserted; updated += r.updated; unchanged += r.unchanged; writeErrors += r.errors; invalid += r.invalid; written += batch.length; if (r.errorLog && errors.length < 15) errors.push(r.errorLog); }
      catch (e) { writeErrors += batch.length; errors.push(`쓰기 실패 x${batch.length}: ${e instanceof Error ? e.message : String(e)}`); }
    }
    // 185차(로컬 10/26 19:20 A4): 규칙이 바뀐 뒤에도 예전 판정('관련 아님')으로 남은 최근 공고를 다시 판정(올리기만) — 모든 원천 공고
    const refit = left() > 4000 ? await refitNotices().catch((e) => { errors.push(`다시 판정: ${e instanceof Error ? e.message : String(e)}`); return null; }) : null;
    // 258차(로컬 10/29 09:20 ⓒ 20260528163030684): 마감일 칸이 빈 K-apt 줄이 전체 목록에 14일 넘게 안 보이면 '사라짐'(다시 보이면 수집이 되돌림) — 마감이 있는 줄은 결과(낙찰) 추적이 쓰므로 그대로
    const stale = uniq.length > 0 && !listFailures && written === ordered.length && left() > 3000 // 매일 06시 전체 수집이 목록에 있는 줄의 last_seen 을 새로 함
      ? await db()`update sales_src_rows set gone = true, row = row || ${db().json({ gone_reason: 'K-apt 목록에 14일 넘게 안 보임(마감일 칸 없음)' } as never)}::jsonb, synced_at = now()
          where scope = 'global' and tbl = 'procurement_notices' and not gone and row->>'source_type' = 'kapt_bid' and coalesce(row->>'deadline_at', '') = '' and coalesce(row->>'related', 'false') = 'true'
            and left(coalesce(row->>'last_seen_at', row->>'first_seen_at', ''), 10) < ${kstYmd(new Date(now() - 14 * 864e5))}`.then((r) => r.count, () => 0) : 0;
    let direct = 0; const fitCount = { 다짐: 0, 하이링크: 0, 둘다: 0 };
    for (const r of fitRows) { const d = details.get(r.bidNum); const m = matchFit(r.title, d?.category, d?.content, '공동주택'); if (m.direct) direct++; if (m.fit === '다짐') fitCount.다짐++; else if (m.fit === '하이링크') fitCount.하이링크++; else if (m.fit) fitCount.둘다++; }
    return { inserted, updated, unchanged, errors: writeErrors + invalid + listFailures + (api.error ? 1 : 0) + (written < ordered.length ? 1 : 0), errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape',
      summary: `${full ? '' : '빠른 수집(최신 500건) · '}K-apt 입찰공고 목록 ${uniq.length}건 · 관련 ${fitRows.length}건(즉시 검토 ${direct} · 다짐 ${fitCount.다짐}·하이링크 ${fitCount.하이링크}·둘다 ${fitCount.둘다}, 상세 ${details.size}${watched.length ? ` · 목록 밖 마감 전 공고 다시 확인 ${watched.length}건${watchCanceled ? `(취소 ${watchCanceled})` : ''}` : ''}${filesRead || listFailed ? ` · 첨부 목록 ${filesRead}건(파일 ${listFiles}${listFailed ? `, 못 읽음 ${listFailed}` : ''})` : ''}) · ${api.note}${apiOnly.length ? `(목록에 없던 ${apiOnly.length}건 추가)` : ''} · 적재 ${written}건: 신규 ${inserted} · 갱신 ${updated} · 변화없음 ${unchanged}` + (invalid ? ` · 무효 ${invalid}` : '') + (refit?.raised ? ` · 다시 판정으로 관련 ${refit.raised}건(마감 전 ${refit.reopened})` : '') + (stale ? ` · 마감일 없이 14일 넘게 안 보인 줄 ${stale}건 사라짐 표시` : '') + (refit?.lowered || refit?.changed ? ` · 다시 판정으로 내림 ${refit.lowered}건·사업 바꿈 ${refit.changed}건` : '') };
  },
};

/** 입찰결과(낙찰) — 세션 쿠키 + _csrf → bidResultListAjax(검색어 18개, 최근 1년). 관련 결과만 낙찰 병합(기존 공고 없으면 신규) */
export const KAPT_RESULT_WORDS = ['헬스', '피트니스', '운동기구', '커뮤니티', '주민공동', '주민운동', '체력단련', 'GX', '골프', '수영', '사우나', '위탁운영', '위탁 운영', '출입통제', '출입관리', '안면인식', '키오스크', '무인'];
export function parseKaptResultRows(body: string): { bidNum: string; title: string; complex: string; winner: string | null; amount: string | null; date: string | null }[] {
  const out: { bidNum: string; title: string; complex: string; winner: string | null; amount: string | null; date: string | null }[] = [];
  let j: any = null; try { j = JSON.parse(body); } catch { /* HTML */ }
  const list = Array.isArray(j) ? j : Array.isArray(j?.list) ? j.list : Array.isArray(j?.resultList) ? j.resultList : Array.isArray(j?.data) ? j.data : null;
  if (list) { for (const it of list) { const bidNum = String(it.bidNum ?? it.BID_NUM ?? it.bidNo ?? ''); if (!bidNum) continue; out.push({ bidNum, title: String(it.bidTitle ?? it.BID_TITLE ?? it.title ?? ''), complex: String(it.kaptName ?? it.KAPT_NAME ?? it.complexName ?? ''), winner: it.sucsBidder ?? it.SUCS_BIDDER ?? it.winner ?? null, amount: it.sucsAmt ?? it.SUCS_AMT ?? it.amount ?? null, date: it.sucsDate ?? it.SUCS_DATE ?? it.openDate ?? null }); } return out; }
  // 234차(로컬 10/28 16:20 '목록 1,800 · 관련 0'): 지금 K-apt 결과 표는 순번·단지명·세대수·입찰공고명·입찰마감일·낙찰금액·낙찰업체·응찰금액·낙찰 업체 —
  // 칸 자리로 읽어 세대수를 제목으로 판정하던 것 → 표 머리 칸 이름으로 찾음(머리가 없으면 예전 자리)
  const heads = [...body.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]).replace(/\s/g, ''));
  const at = (...names: string[]) => heads.findIndex((h) => names.includes(h));
  const ix = { title: at('입찰공고명', '공고명'), complex: at('단지명'), winner: at('낙찰업체'), amount: at('낙찰금액'), date: at('낙찰일', '입찰마감일') };
  for (const m of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) { const tr = m[1]; const id = m[0].match(/goView\('([^']+)'\)|bidNum=([^&'"]+)/); /* 원본 K-apt 는 <tr onclick="goView('…')"> — 행 여는 태그까지 본다 */ const bidNum = id?.[1] ?? id?.[2]; if (!bidNum) continue; const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => text(c[1])); if (cells.length < 5) continue;
    const c = (i: number) => (i >= 0 ? cells[i] || null : null);
    if (ix.title >= 0) out.push({ bidNum, title: cells[ix.title] ?? '', complex: cells[ix.complex] ?? '', winner: c(ix.winner), amount: c(ix.amount), date: c(ix.date)?.slice(0, 10) ?? null });
    else out.push({ bidNum, title: cells[2] ?? '', complex: cells[1] ?? '', winner: cells[cells.length - 3] || null, amount: cells[cells.length - 2] || null, date: cells[cells.length - 1] || null }); }
  return out;
}
/** 231차(로컬 10/28 11:45 '참여업체 정보' 제안): 결과가 난 K-apt 입찰 상세 — 낙찰업체 정보(다른 입찰 사이트를 거친 건) · 참여업체 정보(K-apt 전자입찰) · 낙찰/유찰/취소 사유.
 *  표 머리 칸 이름으로 열을 찾음. 대표자·대표명·전화·연락처·회사주소 칸은 읽지 않음(로컬 10/28 "대표자 이름 · 전화는 저장하지 마세요") */
export type KaptAwardBidder = { name: string; bizNo: string | null; amount: number | null; won: boolean; invalid: boolean; score?: number | null;
  /** 237차(로컬 10/28 17:25): 입찰구비서류 적정·현장설명 참석(잠긴 고르기 칸의 선택값) · 응찰금액 칸이 없거나 '*' 로 가려짐 */ docs?: boolean | null; site?: boolean | null; hidden?: boolean };
export type KaptAwardDetail = { winner: { name: string; bizNo: string | null; amount: number | null; method: string | null } | null; bidders: KaptAwardBidder[] | null; reason: string | null };
export function parseKaptAwardDetail(html: string): KaptAwardDetail {
  const table = (title: string) => { const i = html.indexOf(title); if (i < 0) return null; const s = html.lastIndexOf('<table', i), e = html.indexOf('</table>', i); return s >= 0 && e > i ? html.slice(s, e) : null; };
  const rowsOf = (t: string) => [...t.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  const cells = (row: string, tag: 'th' | 'td') => [...row.matchAll(tag === 'th' ? /<th[^>]*>([\s\S]*?)<\/th>/g : /<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
  const col = (heads: string[], ...names: string[]) => heads.findIndex((h) => names.some((n) => h.replace(/\s/g, '').startsWith(n.replace(/\s/g, ''))));
  const money = (v: string | undefined) => { const n = Number(String(v ?? '').replace(/[^\d]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
  const biz = (v: string | undefined) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length === 10 ? d : null; };
  const yes = (v: string | undefined) => /^(Y|예|O|낙찰|무효)/i.test(String(v ?? '').trim());
  let winner: KaptAwardDetail['winner'] = null, bidders: KaptAwardBidder[] | null = null;
  const w = table('낙찰업체 정보');
  if (w) {
    const rs = rowsOf(w); const heads = rs.map((r) => cells(r, 'th')).find((h) => h.length > 1) ?? []; const vals = rs.map((r) => cells(r, 'td')).find((v) => v.length > 1) ?? [];
    const at = (...n: string[]) => { const i = col(heads, ...n); return i >= 0 ? vals[i] : undefined; };
    const name = at('회사명', '업체명'); if (name) winner = { name, bizNo: biz(at('사업자등록번호')), amount: money(at('계약금액', '낙찰금액')), method: at('계약선정방법') || null };
  }
  const p = table('참여업체 정보');
  if (p) {
    const rs = rowsOf(p); const heads = rs.map((r) => cells(r, 'th')).find((h) => h.length > 1) ?? [];
    const iName = col(heads, '응찰회사', '회사명', '업체명'), iBiz = col(heads, '사업자등록번호'), iAmt = col(heads, '응찰금액', '투찰금액'), iWon = col(heads, '낙찰여부'), iBad = col(heads, '낙찰무효');
    // 234차(로컬 10/28 16:20): 적격심사 입찰은 '평가점수' 칸 — 1위는 금액이 아니라 점수로 정해짐
    const iScore = col(heads, '평가점수'); const score = (v: string | undefined) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return String(v ?? '').trim() && Number.isFinite(n) && n > 0 ? n : null; };
    // 237차(로컬 10/28 17:25): 서류·현장설명 칸은 잠긴 고르기(select disabled) — 글자로는 'Y N'이 다 보이므로 선택된 값을 읽음. 응찰금액 칸이 없거나(다른 입찰 사이트 건) '*' 로 가렸으면 비공개
    const iDocs = col(heads, '입찰구비서류적정여부', '입찰구비서류', '구비서류'), iSite = col(heads, '현장설명참석여부', '현장설명');
    // 고르기 칸인데 선택 표시가 없으면 모름('Y N' 글자를 Y 로 읽지 않음)
    const chosen = (h: string | undefined) => { const s = String(h ?? ''); const o = s.match(/<option[^>]*\bselected\b[^>]*>([\s\S]*?)<\/option>/i);
      return (o ? text(o[1]) || (o[0].match(/\bvalue\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? '') : /<option/i.test(s) ? '' : text(s)).trim(); };
    const yn = (h: string | undefined) => { const v = chosen(h); return /^(Y|예|O|적정|참석)/i.test(v) ? true : /^(N|아니|X|부적|불참|미참)/i.test(v) ? false : null; };
    const raws = (row: string) => [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
    if (iName >= 0) bidders = rs.map((r) => ({ v: cells(r, 'td'), raw: raws(r) })).filter(({ v }) => v.length > iName && v[iName]).slice(0, 60)
      .map(({ v, raw }) => ({ name: v[iName], bizNo: iBiz >= 0 ? biz(v[iBiz]) : null, amount: iAmt >= 0 ? money(v[iAmt]) : null, won: iWon >= 0 && yes(chosen(raw[iWon])), invalid: iBad >= 0 && yes(chosen(raw[iBad])),
        ...(iScore >= 0 && score(v[iScore]) != null ? { score: score(v[iScore]) } : {}),
        ...(iDocs >= 0 ? { docs: yn(raw[iDocs]) } : {}), ...(iSite >= 0 ? { site: yn(raw[iSite]) } : {}),
        ...(iAmt < 0 || (/\*/.test(v[iAmt] ?? '') && !/\d/.test(v[iAmt] ?? '')) ? { hidden: true } : {}) }));
    const top = bidders?.find((b) => b.won && !b.invalid); if (!winner && top) winner = { name: top.name, bizNo: top.bizNo, amount: top.amount, method: null };
  }
  const rz = table('낙찰/유찰/취소 사유'); const reason = rz ? rowsOf(rz).map((r) => cells(r, 'td').join(' ').trim()).find(Boolean) ?? null : null;
  return { winner, bidders, reason: reason ? reason.slice(0, 200) : null };
}
const DETAIL_RESULT_RUN = 60;
/** 234차: 상세 읽기 판 — 2 = 평가점수 칸, 3(237차) = 서류·현장설명·금액 비공개. 참여업체 표를 예전 판으로 읽은 줄은 한 번 더 읽음 */
const DETAIL_V = 3;
/** 231차: 관련 K-apt 결과(낙찰자 있음)와 마감 지난 관련 공고(결과 미상, 45일 안)의 상세를 실행당 60건 — 아직 안 읽은 것부터, 결과 미상은 3일마다 다시.
 *  참가 업체 수·참여업체(이름·사업자번호·응찰금액·낙찰 여부·무효)·낙찰업체 사업자번호·사유 → 유찰 사유면 상태 '유찰' */
async function awardDetails(fetchImpl: typeof fetch, left: () => number, now: Date) {
  const day = kstYmd(now);
  const rows = await db()<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and row->>'source_type' = 'kapt_bid'
      and (row->>'related' = 'true' or coalesce(row->>'fit_business', '') <> '')
      and (coalesce(row->>'winner_name', '') <> '' or (left(coalesce(row->>'deadline_at', ''), 10) < ${day} and left(coalesce(row->>'deadline_at', ''), 10) >= ${kstYmd(new Date(now.getTime() - 45 * 864e5))}))
      and (row->>'kapt_detail_at' is null or (coalesce(row->>'winner_name', '') = '' and coalesce(row->>'current_status', '') !~ '유찰' and row->>'kapt_detail_at' < ${new Date(now.getTime() - 3 * 864e5).toISOString()})
        or (jsonb_typeof(row->'participants') = 'array' and coalesce(row->>'kapt_detail_v', '1') < ${String(DETAIL_V)}))
    order by coalesce(row->>'award_date', row->>'deadline_at') desc nulls last limit ${DETAIL_RESULT_RUN}`;
  const out: Record<string, unknown>[] = []; let withBidders = 0, failed = 0, missed = 0;
  await pool(rows.map((x) => x.row), 4, async (r) => {
    if (left() < 8000) return;
    const bid = String(r.source_external_id ?? ''); if (!bid || !r.title || !r.source_url) return;
    try {
      const s = await kaptSession(bid, fetchImpl, 8000); if (s.status !== 200) { missed++; return; }
      const d = parseKaptAwardDetail(s.html);
      // 마감일을 같이 넘겨 상태 계산(낙찰자 없으면 '마감')이 지금 상태를 '진행중'으로 바꾸지 않게
      const p: Record<string, unknown> = { source_type: 'kapt_bid', source_external_id: bid, title: r.title, source_url: r.source_url, deadline_at: r.deadline_at ?? null, kapt_detail_at: now.toISOString(), kapt_detail_v: DETAIL_V };
      if (d.winner) { p.winner_name = d.winner.name; if (d.winner.bizNo) p.winner_biz_no = d.winner.bizNo; if (d.winner.amount) p.winner_amount = d.winner.amount; }
      if (d.bidders) { p.participants = d.bidders; p.bidders = d.bidders.length; withBidders++; }
      if (d.reason) p.result_note = d.reason;
      if (!d.winner && d.reason && /유찰/.test(d.reason)) { p.notice_state = '유찰'; failed++; } // 상태 계산이 '유찰'로
      out.push(p);
    } catch { missed++; } // 다음 실행에서 다시
  });
  const w = out.length ? await upsertNotices(out, { mergeScope: 'award' }) : null;
  return { read: out.length, withBidders, failed, missed, updated: w?.updated ?? 0, errorLog: w?.errorLog };
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
        // 234차: K-apt 결과 화면 검색 칸 이름 그대로(bidTitle·searchDateGb·dateStart·dateEnd) — searchKeyword·startDate 는 무시되어 검색어마다 같은 최신 100건이 왔다
        const body = new URLSearchParams({ bidTitle: w, searchDateGb: 'reg', dateStart: from, dateEnd: to, tabNum: '1', codeWay: '', sortType: '01', pageNo: '1', pageSelect: '100', ...(csrf ? { _csrf: csrf } : {}) });
        const res = await fetchImpl(`${BASE()}/bid/bidResultListAjax.do`, { method: 'POST', headers: { ...HEADERS, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}), ...(csrf ? { 'X-CSRF-TOKEN': csrf } : {}) }, body, signal: AbortSignal.timeout(10000) });
        if (!res.ok) { errors.push(`'${w}': HTTP ${res.status}`); continue; }
        // 235차(로컬 10/28 16:55 '체력단련 0건'): 표 머리(입찰공고명)는 왔는데 줄이 없으면 정상 0건 — 표 자체가 없을 때만 형식 확인 오류
        const html = await res.text(); const rows = parseKaptResultRows(html); listed += rows.length; if (!rows.length && !html.includes('입찰공고명') && !/^\s*\[/.test(html) && errors.length < 12) errors.push(`'${w}': 결과 목록 0건(응답 형식 확인 필요)`);
        // 235차: 낙찰업체가 빈 줄은 결과가 아님 — 마감일 없이 병합되면 상태 계산이 '진행중'으로 되돌릴 수 있어 건너뜀(유찰은 상세 읽기가 사유로 앎)
        for (const r of rows) { if (seen.has(r.bidNum) || !r.winner || !matchFit(r.title, '공동주택').fit) continue; seen.add(r.bidNum);
          items.push({ source_type: 'kapt_bid', source_external_id: r.bidNum, source_url: `${BASE()}/bid/bidDetail.do?bidNum=${encodeURIComponent(r.bidNum)}`, title: r.title, issuer: r.complex || null, facility_name: r.complex || null, region: regionFromTitle(r.title), winner_name: r.winner, winner_amount: r.amount, award_date: r.date }); }
      } catch (e) { errors.push(`'${w}': ${e instanceof Error ? e.message : String(e)}`); }
    }
    const r = items.length ? await upsertNotices(items, { mergeScope: 'award' }) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, duplicatesMerged: 0, errorLog: undefined as string | undefined };
    if (r.errorLog) errors.push(r.errorLog);
    // 231차: 상세 화면(참여업체·낙찰업체·사유) — 목록 병합 뒤, 남은 시간 안에서
    const det = left() > 20000 ? await awardDetails(fetchImpl, left, new Date(now())).catch((e) => { errors.push(`상세 읽기: ${e instanceof Error ? e.message : String(e)}`); return null; }) : null;
    if (det?.errorLog) errors.push(det.errorLog);
    // 상세로 고친 줄 수는 요약에만(목록 병합 숫자와 섞지 않음)
    return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + errors.length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'web_scrape',
      summary: `K-apt 입찰결과 목록 ${listed}건 · 관련 ${items.length}건 · 낙찰 병합 ${r.updated} · 신규 ${r.inserted} · 변화없음 ${r.unchanged}`
        + (det ? ` · 상세 ${det.read}건(참여업체 표 ${det.withBidders} · 유찰 ${det.failed}${det.missed ? ` · 못 읽음 ${det.missed}` : ''} · 고침 ${det.updated})` : '') };
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
