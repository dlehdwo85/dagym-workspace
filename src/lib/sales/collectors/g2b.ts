// 나라장터·누리장터 입찰공고 + 사전규격 + 낙찰정보 — data.go.kr OpenAPI(DATA_GO_KR_SERVICE_KEY). 원본 g2b_bid_notices·g2b_prespec_awards 이식(10/21, 명세는 FEATURES 4장).
// 운영 참고: 서비스마다 활용신청이 필요하다. 'SERVICE ACCESS DENIED' 등은 '활용신청 필요'로 기록하고 다른 서비스는 계속 돈다.
import { dataGoKey } from '../collect';
import { matchFit } from './procurement';
import { upsertNotices } from './store';
import { endpoints } from './endpoints';
import { SIDO_ALIASES } from './prospects';
import type { Collector, CollectorCtx, CollectorResult } from './types';

const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
const API = () => (T() ? `${T()}/g2b` : 'https://apis.data.go.kr/1230000');
export const G2B_WORDS = ['피트니스', '헬스', '체력단련', '스포츠센터', '체육센터', '체육시설', '수영장', '골프', '커뮤니티', '주민공동', '위탁운영', '출입통제', '안면인식', '키오스크', '회원관리'];
/** 나라장터 입찰공고 4대상(용역·물품·공사·외자) — 공고명 검색(bidNtceNm) */
const BID_OPS = [['ad/BidPublicInfoService/getBidPblancListInfoServcPPSSrch', '용역'], ['ad/BidPublicInfoService/getBidPblancListInfoThngPPSSrch', '물품'], ['ad/BidPublicInfoService/getBidPblancListInfoCnstwkPPSSrch', '공사'], ['ad/BidPublicInfoService/getBidPblancListInfoFrgcptPPSSrch', '외자']] as const;
/** 누리장터는 확인된 주소가 없어 플랫폼 설정(endpoints)으로 — 전체 URL 을 op 자리에 넣는다 */
const nuriOps = async () => { const ep = await endpoints(); return [[ep.nuri_bid_servc, '용역'], [ep.nuri_bid_thng, '물품']] as const; };
const PRESPEC_OPS = [['ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoServc', '용역'], ['ao/HrcspSsstndrdInfoService/getPublicPrcureThngInfoThng', '물품']] as const;
// 낙찰정보는 'as/' 접두(2026-10-21 실측: ao/ 는 '서비스 없음', as/ 는 키 오류 = 주소 존재)
const AWARD_OPS = [['as/ScsbidInfoService/getScsbidListSttusServcPPSSrch', '용역'], ['as/ScsbidInfoService/getScsbidListSttusThngPPSSrch', '물품']] as const;
const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d).replace(/-/g, '');
const kstHourNow = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const str = (v: unknown) => { if (v == null) return null; const s = String(v).trim(); return s ? s : null; };
export type ApiErr = { denied: boolean; msg: string };
/** data.go.kr 표준 응답 → items[]. 결과코드가 성공이 아니면 throw(키·활용신청 오류 구분) */
/** 응답 통계(로컬 10/23 '누리장터 0건 — 진짜 0건인지 못 읽은 건지'): 호출 수·결과코드·totalCount 합·받은 줄 수·첫 줄 칸 이름(값은 안 씀) */
/** sent = 마지막에 보낸 주소(키는 ***) · head = 실패한 응답 앞 300자(키·메일·전화 가림) — 로컬 10/24 LH 오류 11 확인용 */
export type DataGoStats = { calls: number; codes: Record<string, number>; total: number; raw: number; keys?: string[]; sent?: string; head?: string };
const unxml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
/** #522 XML 만 주는 원천(LH OpenBidInfoList·OpenAdvcinfoReqList = produces application/xml): <item> 마다 한 단계 칸만 읽음 */
export function xmlItems(txt: string): Record<string, string>[] {
  return [...txt.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => Object.fromEntries([...m[1].matchAll(/<([A-Za-z_][\w.-]*)>([\s\S]*?)<\/\1>/g)].map(([, k, v]) => [k, unxml(v).trim()])));
}
const noPii = (s: string) => s.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '***@***').replace(/\b0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, '***-****-****');
export async function callDataGo(url: URL, fetchImpl: typeof fetch, key: string, timeoutMs = 12000, stats?: DataGoStats, accept = 'application/json'): Promise<any[]> {
  const mask = (s: string) => s.split(key).join('***').split(encodeURIComponent(key)).join('***');
  if (stats) stats.sent = mask(url.toString()).slice(0, 400);
  let res: Response; try { res = await fetchImpl(url.toString(), { headers: { Accept: accept }, signal: AbortSignal.timeout(timeoutMs) }); } catch (e) { throw new Error(`요청 실패 (${e instanceof Error ? e.name : 'Error'})`); }
  const txt = await res.text(); const safe = (s: string) => mask(s).slice(0, 160);
  if (stats) stats.head = noPii(mask(txt)).slice(0, 300); // 성공하면 아래에서 지움
  // data.go.kr 공통 오류(XML): returnReasonCode 20·21·22·30·31·32·33 = 활용신청·키·호출 제한 문제 → '활용신청 필요'(그 서비스는 이번 실행에서 건너뜀)
  let j: any = null; try { j = JSON.parse(txt); } catch { const code = txt.match(/<returnReasonCode>([^<]+)</)?.[1] ?? txt.match(/<resultCode>([^<]+)</)?.[1] ?? ''; const msg = txt.match(/<returnAuthMsg>([^<]+)</)?.[1] ?? txt.match(/<errMsg>([^<]+)</)?.[1] ?? txt.match(/<resultMsg>([^<]+)</)?.[1] ?? ''; const both = `${code} ${msg}`;
    if (/^(00|0|INFO-000)$/.test(code.trim())) { // #522 XML 정상 응답(JSON 을 안 주는 원천) → <item> 읽기
      const list = xmlItems(txt); const total = Number(txt.match(/<totalCount>(\d+)</)?.[1] ?? list.length) || 0;
      if (stats) { delete stats.head; stats.calls++; stats.codes[code.trim()] = (stats.codes[code.trim()] ?? 0) + 1; stats.total += total; stats.raw += list.length; if (list[0] && !stats.keys) stats.keys = Object.keys(list[0]).slice(0, 60); }
      return list;
    }
    throw new Error(/^(20|21|22|30|31|32|33)\b/.test(code.trim()) || /DENIED|UNREGISTERED|NOT_REGISTERED|LIMITED|FORBIDDEN|EXPIRED/i.test(both) ? `활용신청 필요: ${safe(both.trim())}` : `응답 오류 (HTTP ${res.status}): ${safe(both.trim() || txt.slice(0, 80))}`); }
  // JSON 형식의 공통 오류(OpenAPI_ServiceResponse): NO_OPENAPI_SERVICE_ERROR(12) = 주소가 틀리거나 폐기된 서비스 → '주소 확인 필요'(그 서비스는 건너뜀)
  const cm = j?.OpenAPI_ServiceResponse?.cmmMsgHeader; if (cm) { const em = String(cm.errMsg ?? ''); const rc = String(cm.returnReasonCode ?? ''); if (/NO_OPENAPI_SERVICE|^12$/.test(em) || rc === '12') throw new Error(`주소 확인 필요: ${safe(em)} (해당 오픈API 서비스가 없거나 폐기됨 — 플랫폼 운영 › 영업 수집기 설정)`); if (/^(20|21|22|30|31|32|33)$/.test(rc) || /DENIED|UNREGISTERED|NOT_REGISTERED|LIMITED|FORBIDDEN|EXPIRED/i.test(em)) throw new Error(`활용신청 필요: ${safe(`${rc} ${em}`.trim())}`); throw new Error(`응답 오류 (HTTP ${res.status}): ${safe(`${rc} ${em}`.trim())}`); }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${safe(JSON.stringify(j).slice(0, 120))}`);
  const header = j?.response?.header ?? j?.header; const code = header?.resultCode != null ? String(header.resultCode) : null;
  if (code != null && !['00', '0', 'INFO-000'].includes(code)) throw new Error(/03|04|30|31|32|33/.test(code) ? `활용신청 필요: ${safe(String(header?.resultMsg ?? code))}` : `결과코드 ${code}: ${safe(String(header?.resultMsg ?? ''))}`);
  // #522 LH(OpenBidInfoList 등)는 body.items 없이 body.item 에 바로
  const b = j?.response?.body ?? j?.body ?? {}; const raw = b?.items?.item ?? b?.items ?? b?.item ?? []; const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  if (stats) { delete stats.head; stats.calls++; stats.codes[code ?? '없음'] = (stats.codes[code ?? '없음'] ?? 0) + 1; stats.total += Number(b?.totalCount) || 0; stats.raw += list.length; if (list[0] && typeof list[0] === 'object' && !stats.keys) stats.keys = Object.keys(list[0]).slice(0, 60); }
  return list;
}
const attachments = (it: any) => { const out: string[] = []; for (let i = 1; i <= 10; i++) { const u = str(it[`ntceSpecDocUrl${i}`] ?? it[`atchFileUrl${i}`]); if (u && /^https?:\/\//.test(u)) out.push(u); } return out; };
export function g2bPayload(it: any, sourceType: 'g2b_bid' | 'nuri_bid', cat: string): Record<string, unknown> | null {
  const no = str(it.bidNtceNo), ord = str(it.bidNtceOrd) ?? '00', title = str(it.bidNtceNm); if (!no || !title) return null;
  const url = str(it.bidNtceDtlUrl) ?? str(it.bidNtceUrl) ?? `https://www.g2b.go.kr/ep/invitation/publish/bidInfoDtl.do?bidno=${no}&bidseq=${ord}`;
  return { source_type: sourceType, source_external_id: `${no}-${ord}`, source_url: url, title, issuer: str(it.ntceInsttNm), demand_agency: str(it.dminsttNm), region: str(it.prtcptLmtRgnNm) ?? str(it.rgnNm) ?? null, region_restriction: str(it.prtcptLmtRgnNm),
    posted_date: str(it.bidNtceDt)?.slice(0, 10), deadline_at: str(it.bidClseDt), opening_at: str(it.opengDt), participation_deadline_at: str(it.bidBeginDt) ? null : str(it.rbidPrtcptLmtRgstClseDt ?? it.prtcptLmtRgstClseDt),
    estimated_amount: str(it.presmptPrce), budget_amount: str(it.asignBdgtAmt), contract_method: str(it.cntrctCnclsMthdNm), award_method: str(it.sucsfbidMthdNm), notice_state: str(it.ntceKindNm), bid_category: cat, notice_type: cat === '공사' ? '공사' : undefined,
    industry_code: str(it.indstrytyLmtNm) ?? str(it.indstrytyNm), task_scope: str(it.bidNtceDtlCntnts ?? it.ntceSpecFileNm1), attachment_urls: attachments(it), notice_file_url: str(it.ntceSpecDocUrl1),
    site_briefing_at: str(it.dcmtgOprtnDt), site_briefing_place: str(it.dcmtgOprtnPlce) }; // #510 메일 3행 '현장설명'
}
/** 누리장터(PrvtBidNtceService getPrvtBidPblancListInfo*PPSSrch) — 나라장터와 칸 이름이 다름(로컬 10/23 운영 응답: ntceNm·nticeDt…, 명세 = 공공데이터포털 '조달청_누리장터 민간입찰공고서비스').
 * 담당자 이름·전화·메일(ofclNm·ofclTelNo·ofclEmail)은 개인정보 → 나라장터 공고(담당자 칸 안 읽음)와 같게 저장하지 않음. 아파트 관리사무소 전화는 K-apt 와 같게 office_phone */
const SIDO_SHORT = new Set(Object.values(SIDO_ALIASES));
const sidoOf = (addr: string | null) => { const w = addr?.trim().split(/\s+/)[0] ?? ''; return SIDO_ALIASES[w] ?? (SIDO_SHORT.has(w) ? w : null); };
const ymd19 = (v: unknown) => str(v)?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? str(v)?.match(/^(\d{4})(\d{2})(\d{2})/)?.slice(1).join('-') ?? null;
export function nuriPayload(it: any, cat: string): Record<string, unknown> | null {
  const no = str(it.bidNtceNo), ord = str(it.bidNtceOrd) ?? '00', title = str(it.ntceNm) ?? str(it.bidNtceNm); if (!no || !title) return null;
  const docs = attachments(it); const kind = str(it.bidNtceClsfc); const apt = str(it.aptHsmpNm); const addr = str(it.aptCeoAdrs);
  const list = (v: unknown) => (typeof v === 'string' ? str(v) : null);
  return { source_type: 'nuri_bid', source_external_id: `${no}-${ord}`, source_url: docs[0] ?? 'https://nuri.g2b.go.kr/', title, issuer: str(it.ntceInsttNm) ?? apt, facility_name: apt,
    region: sidoOf(addr), region_restriction: str(it.rgnLmtDivNm), posted_date: ymd19(it.nticeDt) ?? ymd19(it.rgstDt), deadline_at: str(it.bidClseDt), opening_at: str(it.opengDt),
    estimated_amount: str(it.refAmtOpenYn) === 'N' ? null : str(it.refAmt), budget_amount: str(it.asignBdgtAmt), contract_method: str(it.cntrctMthdNm), bid_system: str(it.bidMethdNm), award_method: str(it.sucsfbidMthdNm),
    notice_state: str(it.ntceDivNm), bid_category: kind && kind !== '기타' ? kind : cat, notice_type: (kind ?? cat) === '공사' ? '공사' : undefined, task_scope: list(it.servcDtlList) ?? list(it.prdctDtlList),
    office_phone: str(it.aptMngOfficeTelNo), office_address: addr, household_count: str(it.aptHshldNum), attachment_urls: docs, notice_file_url: docs[0] ?? null };
}
function windowParams(days: number) { const end = new Date(); const start = new Date(end.getTime() - days * 864e5); return { inqryDiv: '1', inqryBgnDt: `${fmt(start)}0000`, inqryEndDt: `${fmt(end)}2359` }; }
async function searchAll(ops: readonly (readonly [string, string])[], words: string[], days: number, map: (it: any, cat: string) => Record<string, unknown> | null, ctx: CollectorCtx, key: string, extra: Record<string, string> = {}) {
  const items: Record<string, unknown>[] = []; const errors: string[] = []; const denied = new Set<string>(); const seen = new Set<string>(); const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started); const stats: DataGoStats = { calls: 0, codes: {}, total: 0, raw: 0 };
  const tasks: [string, string, string][] = []; for (const [op, cat] of ops) for (const w of words) tasks.push([op, cat, w]);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (next < tasks.length) { const [op, cat, w] = tasks[next++]; if (denied.has(op) || left() < 6000) continue;
    const u = new URL(/^https?:\/\//.test(op) ? op : `${API()}/${op}`); u.searchParams.set('serviceKey', key); u.searchParams.set('numOfRows', '100'); u.searchParams.set('pageNo', '1'); u.searchParams.set('type', 'json'); for (const [k, v] of Object.entries({ ...windowParams(days), ...extra })) u.searchParams.set(k, v); if (w) u.searchParams.set('bidNtceNm', w);
    try { for (const it of await callDataGo(u, ctx.fetchImpl, key, Math.min(12000, left() - 2000), stats)) { const p = map(it, cat); if (!p) continue; const k = `${p.source_type}|${p.source_external_id}`; if (seen.has(k)) continue; seen.add(k); items.push(p); } }
    catch (e) { const m = e instanceof Error ? e.message : String(e); if (/활용신청 필요|주소 확인 필요/.test(m)) { denied.add(op); errors.push(`${cat}(${op.split('/').slice(-1)[0]}): ${m}`); /* 서비스 단위 오류 — 같은 op 의 남은 검색어는 건너뜀 */ } else if (errors.length < 12) errors.push(`${cat} '${w}': ${m}`); } } }));
  return { items, errors, denied: [...denied], stats };
}
/** 요약 한 줄: '검색 30회 · 응답 00 · 전체 0건' — 받은 줄이 있는데 하나도 못 읽었으면 첫 줄 칸 이름(형식 확인용) */
const statLine = (s: DataGoStats, read: number) => !s.calls ? '응답 없음' : `검색 ${s.calls}회 · 응답 ${Object.entries(s.codes).map(([c, n]) => (Object.keys(s.codes).length > 1 ? `${c}×${n}` : c)).join('·')} · 전체 ${s.total}건` + (s.raw && !read ? ` · 받은 ${s.raw}줄을 못 읽음(칸: ${(s.keys ?? []).slice(0, 15).join(',')})` : '');
async function write(items: Record<string, unknown>[], errors: string[], opt: { mergeScope?: 'all' | 'award' } = {}) { if (!items.length) return { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0 }; const r = await upsertNotices(items, opt); if (r.errorLog) errors.push(r.errorLog); return r; }
const noKey = (label: string): CollectorResult => ({ inserted: 0, updated: 0, unchanged: 0, errors: 0, summary: `${label}: DATA_GO_KR_SERVICE_KEY 미설정 — 건너뜀`, providerMode: 'api' });

export const g2bBidNotices: Collector = {
  slug: 'g2b_bid_notices', label: '나라장터·누리장터 입찰공고', hourKst: 6, againKst: [10, 14, 18], source: 'apis.data.go.kr/1230000 BidPublicInfoService(4대상) + PrvtBidNtceService(누리장터) — 검색어 15개 × 06시 최근 14일, 10·14·18시 최근 3일', needs: ['DATA_GO_KR_SERVICE_KEY'],
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const key = dataGoKey(); if (!key) return noKey('나라장터');
    // #476 c: 06시는 최근 14일 전체, 낮 수집(10·14·18시·그 뒤 [지금 수집])은 최근 3일 — 낮에 올라온 공고를 그날 잡는다
    const days = ctx.params?.full === true || kstHourNow() < 10 ? 14 : 3;
    const a = await searchAll(BID_OPS, G2B_WORDS, days, (it, cat) => g2bPayload(it, 'g2b_bid', cat), ctx, key);
    const b = await searchAll(await nuriOps(), G2B_WORDS, days, nuriPayload, ctx, key);
    const errors = [...a.errors, ...b.errors]; const items = [...a.items, ...b.items];
    const r = await write(items, errors);
    return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + r.invalid + a.denied.length + b.denied.length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'api',
      summary: `${days === 14 ? '' : '빠른 수집(최근 3일) · '}나라장터 ${a.items.length}건 · 누리장터 ${b.items.length}건(${statLine(b.stats, b.items.length)}) (관련 ${items.filter((p) => matchFit(String(p.title), String(p.bid_category ?? '')).fit).length}) · 신규 ${r.inserted} · 갱신 ${r.updated} · 변화없음 ${r.unchanged}` + (a.denied.length + b.denied.length ? ` · 활용신청·주소 확인 필요 ${a.denied.length + b.denied.length}개 서비스` : '') };
  },
};
export function prespecPayload(it: any, cat: string): Record<string, unknown> | null {
  const no = str(it.bfSpecRgstNo) ?? str(it.refNo), title = str(it.prdctClsfcNoNm) ?? str(it.bfSpecNm) ?? str(it.bidNtceNm); if (!no || !title) return null;
  if (!matchFit(title, cat).fit) return null; // 사전규격은 전체를 받아 matchFit 으로 거름
  return { source_type: 'g2b_prespec', source_external_id: no, source_url: str(it.bfSpecDtlUrl) ?? `https://www.g2b.go.kr/ep/preparation/prestd/preStdDtl.do?preStdRegNo=${no}`, title, issuer: str(it.orderInsttNm) ?? str(it.rlDminsttNm), demand_agency: str(it.rlDminsttNm),
    posted_date: str(it.rcptDt)?.slice(0, 10), deadline_at: str(it.opninRgstClseDt), budget_amount: str(it.asignBdgtAmt), bid_category: cat, notice_type: '사전규격', task_scope: str(it.dlvrCndtnNm ?? it.bsnsDivNm), attachment_urls: attachments(it) };
}
export function awardPayload(it: any, cat: string): Record<string, unknown> | null {
  const no = str(it.bidNtceNo), ord = str(it.bidNtceOrd) ?? '00', title = str(it.bidNtceNm); if (!no || !title) return null;
  return { source_type: 'g2b_bid', source_external_id: `${no}-${ord}`, source_url: str(it.bidNtceDtlUrl) ?? `https://www.g2b.go.kr/ep/invitation/publish/bidInfoDtl.do?bidno=${no}&bidseq=${ord}`, title, issuer: str(it.ntceInsttNm), demand_agency: str(it.dminsttNm), bid_category: cat,
    winner_name: str(it.bidwinnrNm) ?? str(it.sucsfBidNm), winner_amount: str(it.sucsfbidAmt), award_date: str(it.opengDt)?.slice(0, 10), posted_date: str(it.bidNtceDt)?.slice(0, 10) };
}
export const g2bPrespecAwards: Collector = {
  slug: 'g2b_prespec_awards', label: '나라장터 사전규격·낙찰정보', hourKst: 6, source: 'HrcspSsstndrdInfoService(사전규격 최근 4일 전체 → matchFit) + ScsbidInfoService(낙찰, 검색어·최근 28일 + 돌아가며 지난 1년 중 한 달)', needs: ['DATA_GO_KR_SERVICE_KEY'],
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const key = dataGoKey(); if (!key) return noKey('나라장터 사전규격·낙찰');
    const pre = await searchAll(PRESPEC_OPS, [''], 4, prespecPayload, ctx, key);
    const r1 = await write(pre.items, pre.errors);
    const monthBack = (new Date().getUTCDate() % 12) + 1; const old = new Date(Date.now() - monthBack * 30 * 864e5);
    const aw = await searchAll(AWARD_OPS, G2B_WORDS, 28, awardPayload, ctx, key);
    const aw2 = ctx.deadlineMs - (ctx.now() - ctx.now()) > 0 ? await searchAll(AWARD_OPS, G2B_WORDS.slice(0, 5), 30, awardPayload, { ...ctx, deadlineMs: Math.max(0, ctx.deadlineMs - 10000) }, key, { inqryBgnDt: `${fmt(old)}0000`, inqryEndDt: `${fmt(new Date(old.getTime() + 30 * 864e5))}2359` }) : { items: [], errors: [], denied: [] };
    const awardItems = [...aw.items, ...aw2.items].filter((p) => matchFit(String(p.title), String(p.bid_category ?? '')).fit);
    const r2 = await write(awardItems, aw.errors, { mergeScope: 'award' });
    const errors = [...pre.errors, ...aw.errors, ...aw2.errors];
    return { inserted: r1.inserted + r2.inserted, updated: r1.updated + r2.updated, unchanged: r1.unchanged + r2.unchanged, errors: r1.errors + r2.errors + r1.invalid + r2.invalid + pre.denied.length + aw.denied.length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'api',
      summary: `사전규격 관련 ${pre.items.length}건(신규 ${r1.inserted}) · 낙찰 관련 ${awardItems.length}건(병합 ${r2.updated}·신규 ${r2.inserted})` + (pre.denied.length + aw.denied.length ? ` · 활용신청·주소 확인 필요 ${pre.denied.length + aw.denied.length}개 서비스` : '') };
  },
};
