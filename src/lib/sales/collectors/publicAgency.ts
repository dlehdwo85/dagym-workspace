// 공공기관 입찰 — LH 입찰공고·사전규격, 방위사업청 경쟁입찰, 온비드 공유재산 임대(모두 data.go.kr OpenAPI, 웹 스크래핑 없음). 원본 public_agency_bids 이식(10/21).
// 서비스 주소는 활용신청 뒤 운영에서 확인해 app_settings 'sales_collector_endpoints' 로 바꿀 수 있다(기본값은 공공데이터포털 명세 기준).
import { dataGoKey } from '../collect';
import { callDataGo } from './g2b';
import { matchFit } from './procurement';
import { upsertNotices } from './store';
import type { Collector, CollectorCtx, CollectorResult } from './types';

export { DEFAULT_ENDPOINTS, endpoints } from './endpoints';
import { endpoints } from './endpoints';
const str = (v: unknown) => { if (v == null) return null; const s = String(v).trim(); return s ? s : null; };
const pick = (it: any, ...keys: string[]) => { for (const k of keys) { const v = str(it?.[k]); if (v) return v; } return null; };
export const D2B_WORDS = ['체력단련', '헬스', '피트니스', '체육', '수영', '골프', '출입통제', '키오스크', '위탁운영'];
export const ONBID_WORDS = ['체육', '헬스', '수영장', '골프', '스포츠', '커뮤니티', '카페'];
const fmt = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d).replace(/-/g, '');
/** 기관별 응답 칸 이름이 달라 후보를 차례로 — 공고명·발주처·마감·주소 */
export function agencyPayload(it: any, sourceType: string, fallbackIssuer: string): Record<string, unknown> | null {
  const no = pick(it, 'bidNtceNo', 'bidNum', 'bidNo', 'ntceNo', 'pbctNo', 'cltrMngNo', 'preStdNo', 'id'); const title = pick(it, 'bidNtceNm', 'bidNm', 'ntceNm', 'pbctNm', 'cltrNm', 'preStdNm', 'title'); if (!no || !title) return null;
  const ord = pick(it, 'bidNtceOrd', 'ntceOrd') ?? '';
  return { source_type: sourceType, source_external_id: ord ? `${no}-${ord}` : no, source_url: pick(it, 'bidNtceDtlUrl', 'bidNtceUrl', 'ntceUrl', 'dtlUrl', 'pbctDtlUrl', 'url') ?? { lh_bid: 'https://ebid.lh.or.kr', lh_prespec: 'https://ebid.lh.or.kr', d2b_bid: 'https://www.d2b.go.kr', onbid_lease: 'https://www.onbid.co.kr' }[sourceType]!,
    title, issuer: pick(it, 'ntceInsttNm', 'dminsttNm', 'orgNm', 'ognzNm', 'insttNm', 'clntNm') ?? fallbackIssuer, demand_agency: pick(it, 'dminsttNm', 'dmndInsttNm'), region: pick(it, 'rgnNm', 'areaNm', 'ldnmAdrs', 'addr', 'sido'),
    posted_date: pick(it, 'bidNtceDt', 'ntceDt', 'pbctBgnDt', 'rgstDt', 'regDate')?.slice(0, 10), deadline_at: pick(it, 'bidClseDt', 'clseDt', 'pbctClsDt', 'opninClseDt', 'bidEndDt'), opening_at: pick(it, 'opengDt', 'opbidDt'),
    estimated_amount: pick(it, 'presmptPrce', 'estmtAmt', 'minBidPrc', 'bidAmt'), budget_amount: pick(it, 'asignBdgtAmt', 'bdgtAmt'), contract_method: pick(it, 'cntrctCnclsMthdNm', 'cntrctMthdNm'), notice_state: pick(it, 'ntceKindNm', 'pbctStatNm', 'bidStatNm'),
    bid_category: sourceType === 'onbid_lease' ? '임대' : pick(it, 'bidKindNm', 'bsnsDivNm', 'cntrctKindNm'), notice_type: sourceType === 'onbid_lease' ? '공유재산 임대' : sourceType.endsWith('prespec') ? '사전규격' : undefined, task_scope: pick(it, 'bidNtceDtlCntnts', 'cntnts', 'rmk'),
    attachment_urls: [1, 2, 3, 4, 5].map((i) => pick(it, `atchFileUrl${i}`, `ntceSpecDocUrl${i}`)).filter(Boolean) };
}
export const publicAgencyBids: Collector = {
  slug: 'public_agency_bids', label: 'LH·국방·온비드 공고', hourKst: 6, source: 'LH 입찰공고(최근 7일)·LH 사전규격(의견마감 오늘~+30일)·방위사업청 경쟁입찰(최근 30일, 검색어 9개)·온비드 공유재산 임대(+90일 개찰, 검색어 7개) — matchFit 통과분만', needs: ['DATA_GO_KR_SERVICE_KEY'],
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const key = dataGoKey(); if (!key) return { inserted: 0, updated: 0, unchanged: 0, errors: 0, summary: 'LH·국방·온비드: DATA_GO_KR_SERVICE_KEY 미설정 — 건너뜀', providerMode: 'api' };
    const ep = await endpoints(); const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started);
    const items: Record<string, unknown>[] = []; const errors: string[] = []; const denied: string[] = []; const counts: Record<string, number> = {};
    const call = async (sourceType: string, issuer: string, params: Record<string, string>) => {
      if (left() < 6000) { errors.push(`시간 한도 근접 — ${sourceType} 건너뜀`); return; }
      const u = new URL(ep[sourceType]); u.searchParams.set('serviceKey', key); u.searchParams.set('numOfRows', '100'); u.searchParams.set('pageNo', '1'); u.searchParams.set('type', 'json'); u.searchParams.set('_type', 'json'); for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      try { for (const it of await callDataGo(u, ctx.fetchImpl, key, Math.min(12000, left() - 2000))) { const p = agencyPayload(it, sourceType, issuer); if (!p) continue; if (!matchFit(String(p.title), String(p.bid_category ?? ''), String(p.task_scope ?? '')).fit) continue; items.push(p); counts[sourceType] = (counts[sourceType] ?? 0) + 1; } }
      catch (e) { const m = e instanceof Error ? e.message : String(e); if (/활용신청 필요|주소 확인 필요/.test(m)) { if (!denied.includes(sourceType)) denied.push(sourceType); } if (errors.length < 12) errors.push(`${sourceType}: ${m}`); }
    };
    const d = (n: number) => new Date(Date.now() + n * 864e5);
    await call('lh_bid', 'LH 한국토지주택공사', { inqryBgnDt: fmt(d(-7)), inqryEndDt: fmt(d(0)), bidNtceBgnDt: fmt(d(-7)), bidNtceEndDt: fmt(d(0)) });
    await call('lh_prespec', 'LH 한국토지주택공사', { opninClseBgnDt: fmt(d(0)), opninClseEndDt: fmt(d(30)) });
    for (const w of D2B_WORDS) await call('d2b_bid', '방위사업청', { bidNtceNm: w, inqryBgnDt: fmt(d(-30)), inqryEndDt: fmt(d(0)) });
    for (const w of ONBID_WORDS) await call('onbid_lease', '온비드(한국자산관리공사)', { cltrNm: w, searchWord: w, pbctBgnDt: fmt(d(0)), pbctClsDt: fmt(d(90)) });
    const seen = new Set<string>(); const uniq = items.filter((p) => { const k = `${p.source_type}|${p.source_external_id}`; if (seen.has(k)) return false; seen.add(k); return true; });
    const r = uniq.length ? await upsertNotices(uniq) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, errorLog: undefined as string | undefined }; if (r.errorLog) errors.push(r.errorLog);
    return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + r.invalid + denied.length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'api',
      summary: `관련 공고 ${uniq.length}건(${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}) · 신규 ${r.inserted} · 갱신 ${r.updated}` + (denied.length ? ` · 활용신청·주소 확인 필요: ${denied.join(', ')} (플랫폼 운영 › 영업 수집기 설정)` : '') };
  },
};
