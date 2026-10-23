// 공공기관 입찰 — LH 입찰공고·사전규격, 방위사업청 경쟁입찰(국내 물품·용역 + 시설 공사), 온비드 공고(모두 data.go.kr OpenAPI, 웹 스크래핑 없음). 원본 public_agency_bids 이식(10/21).
// #522(로컬 10/24 '입찰공고 놓치지 않게'): 옛 주소가 모두 '서비스 없음'이라 매일 실패 → 각 서비스 swagger 명세의 주소·입력값·응답 칸으로 다시.
// 실행 기록에 원천별 받은 줄 수·관련(저장) 수·첫 줄 칸 이름(값은 안 씀)·오류를 남긴다(하루 한 번 누락 점검이 읽음). 주소는 플랫폼 운영 › 영업 수집기 설정으로 바꿀 수 있다.
import { createHash } from 'node:crypto';
import { db } from '../../db';
import { dataGoKey } from '../collect';
import { callDataGo, type DataGoStats } from './g2b';
import { matchFit } from './procurement';
import { regionFromAddress } from './files';
import { noticeLinks, upsertNotices } from './store';
import type { Collector, CollectorCtx, CollectorResult, SourceStat } from './types';

export { DEFAULT_ENDPOINTS, endpoints } from './endpoints';
import { ENDPOINT_LABEL, endpoints } from './endpoints';
const str = (v: unknown) => { if (v == null) return null; const s = String(v).trim(); return s ? s : null; };
const pick = (it: any, ...keys: string[]) => { for (const k of keys) { const v = str(it?.[k]); if (v) return v; } return null; };
export const D2B_WORDS = ['체력단련', '헬스', '피트니스', '체육', '수영', '골프', '출입통제', '키오스크', '위탁운영'];
/** 온비드 공고명 검색어(onbidPbancNm) — 21라인에만 있던 '진영스포츠센터 내 용품점 및 자판기 사용·수익허가(3차)'는 '스포츠'로 잡힘 */
export const ONBID_WORDS = ['스포츠', '체육', '헬스', '수영장', '골프', '커뮤니티', '카페'];
/** 온비드 체육시설 임대·사용수익허가는 제외 낱말(자판기·매점)이 섞여도 다짐 대상으로 */
const SPORTS = /스포츠|체육|헬스|피트니스|휘트니스|수영장|골프|운동시설|체력단련/;
const ymd8 = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d).replace(/-/g, '');
const ymdDash = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
/** '202610281700' · '2026-10-28 17:00' → '10/28 17:00'(설명 줄용) */
const short = (v: string | null) => { const m = v?.replace(/[^\d]/g, '').match(/^\d{4}(\d{2})(\d{2})(\d{2})?(\d{2})?/); return m ? `${Number(m[1])}/${Number(m[2])}${m[3] ? ` ${m[3]}:${m[4] ?? '00'}` : ''}` : null; };
const line = (...parts: (string | null | false | undefined)[]) => parts.filter(Boolean).join(' · ') || null;

/** LH 입찰공고(15159012 OpenBidInfoList) — body.item 에 바로 줄 */
export function lhBidPayload(it: any): Record<string, unknown> | null {
  const no = pick(it, 'bidNum'), title = pick(it, 'bidnmKor', 'bidNm'); if (!no || !title) return null;
  const deg = pick(it, 'bidDegree'); const zones = [1, 2, 3, 4].map((i) => pick(it, `zoneRstrct${i}`)).filter(Boolean);
  const lic = [1, 2, 3].map((i) => pick(it, `req1Reqlic${i}Nm`)).filter(Boolean);
  return { source_type: 'lh_bid', source_external_id: deg ? `${no}-${deg}` : no, source_url: 'https://ebid.lh.or.kr', title, issuer: 'LH 한국토지주택공사', demand_agency: pick(it, 'zoneHqCd'),
    region_restriction: zones.join(', ') || null, posted_date: pick(it, 'tndrbidRegDt'), deadline_at: pick(it, 'tndrdocAcptEndDtm'), opening_at: pick(it, 'openDtm'),
    estimated_amount: pick(it, 'presmtPrc'), base_amount: pick(it, 'fdmtlAmt'), contract_method: pick(it, 'tndrCtrctMedCd'), award_method: pick(it, 'sunjungNm'),
    notice_state: line(pick(it, 'bidKind'), pick(it, 'bidProgrsStatus')), bid_category: pick(it, 'cstrtnJobGbNm'), industry_code: lic.join(', ') || null,
    task_scope: line(pick(it, 'tndrdocAcptBgninDtm') && `입찰서 접수 ${short(pick(it, 'tndrdocAcptBgninDtm'))}~${short(pick(it, 'tndrdocAcptEndDtm')) ?? ''}`,
      pick(it, 'cooperdocAcptEndDtm') && `공동수급 협정서 마감 ${short(pick(it, 'cooperdocAcptEndDtm'))}`, pick(it, 'gongdongNm') && `공동수급 ${pick(it, 'gongdongNm')}`) };
}
/** LH 사전규격(15159011 OpenAdvcinfoReqList) — 응답에 번호 칸이 없어 이름·의견 마감·담당 부서로 번호를 만든다. 담당자 메일·연락처는 개인정보라 저장 안 함 */
export function lhPrespecPayload(it: any): Record<string, unknown> | null {
  const title = pick(it, 'inadvcStddztNm', 'gdsnm'); if (!title) return null;
  const end = pick(it, 'opinionRegEndDtm'), dept = pick(it, 'revertDeptNm'), spot = pick(it, 'dlvgdsSpot');
  const id = createHash('sha1').update(`${title}|${end ?? ''}|${dept ?? ''}`).digest('hex').slice(0, 16);
  return { source_type: 'lh_prespec', source_external_id: `lhpre-${id}`, source_url: 'https://ebid.lh.or.kr', title, issuer: 'LH 한국토지주택공사', demand_agency: dept,
    region: spot ? regionFromAddress(spot) : null, deadline_at: end, budget_amount: pick(it, 'assignBudgetAmt'), bid_category: pick(it, 'cstrtnJobGbNm'), notice_type: '사전규격',
    task_scope: line(pick(it, 'gdsnm') && `품명 ${pick(it, 'gdsnm')}`, spot && `납품 장소 ${spot}`, pick(it, 'dlvgdsTmlmt') && `납품 기한 ${pick(it, 'dlvgdsTmlmt')}`) };
}
/** 방위사업청 경쟁입찰(15158416, 기관 1690000) — 국내 물품·용역 / 시설 공사·용역. 나라장터 공고번호(g2bPblancNo)가 있으면 나라장터와 같은 공고 */
export function d2bPayload(it: any, kind: 'dmstc' | 'fclty'): (Record<string, unknown> & { g2b_no?: string | null }) | null {
  const no = pick(it, 'pblancNo'), title = kind === 'fclty' ? pick(it, 'cntrwkNm', 'bidNm') : pick(it, 'bidNm', 'cntrwkNm'); if (!no || !title) return null;
  const odr = pick(it, 'pblancOdr'); const g2b = pick(it, 'g2bPblancNo')?.split('-')[0] ?? null;
  return { source_type: 'd2b_bid', source_external_id: `${kind === 'fclty' ? 'F-' : ''}${no}${odr ? `-${odr}` : ''}`, source_url: 'https://www.d2b.go.kr', title, issuer: pick(it, 'ornt') ?? '방위사업청',
    posted_date: pick(it, 'pblancDate'), participation_deadline_at: pick(it, 'bidPartcptRegistClosDt'), deadline_at: pick(it, 'biddocPresentnClosDt'), opening_at: pick(it, 'opengDt'),
    base_amount: pick(it, 'bsicExpt', 'baseAmnt'), contract_method: pick(it, 'cntrctMth'), bid_system: pick(it, 'bidStle'), bid_category: pick(it, 'busiDivs') ?? (kind === 'fclty' ? '공사' : null), notice_state: pick(it, 'pblancSe'),
    notice_type: kind === 'fclty' ? '시설 공사' : undefined, task_scope: line(g2b && `나라장터 공고번호 ${g2b}${pick(it, 'g2bPblancOdr') ? `-${pick(it, 'g2bPblancOdr')}` : ''}`, pick(it, 'excutTy') && `집행 ${pick(it, 'excutTy')}`), g2b_no: g2b };
}
/** 온비드 차세대 공고목록(15157216 OnbidPbancListSrvc2) — 공유·국유·기타일반재산 부동산 */
export function onbidPayload(it: any): Record<string, unknown> | null {
  const no = pick(it, 'onbidPbancNo', 'pbancMngNo', 'pbctNo'), title = pick(it, 'onbidPbancNm'); if (!no || !title) return null;
  const sports = title.match(SPORTS)?.[0]; const dsps = pick(it, 'dspsMthodNm');
  return { source_type: 'onbid_lease', source_external_id: no, source_url: 'https://www.onbid.co.kr', title, issuer: pick(it, 'orgNm') ?? '온비드(한국자산관리공사)', demand_agency: pick(it, 'rspbSbrNm'),
    posted_date: pick(it, 'pbancYmd'), deadline_at: pick(it, 'cltrBidEndDt'), opening_at: pick(it, 'cltrOpbdDt'), contract_method: pick(it, 'bidDivNm'), notice_state: pick(it, 'pbancKindNm'),
    bid_category: dsps ?? '임대', notice_type: [pick(it, 'prptDivNm'), dsps].filter(Boolean).join(' ') || '공유재산 임대', task_scope: line(pick(it, 'cltrBidBgngDt') && `입찰 ${short(pick(it, 'cltrBidBgngDt'))}~${short(pick(it, 'cltrBidEndDt')) ?? ''}`, pick(it, 'pbctNsq') && `${pick(it, 'pbctNsq')}회차`),
    ...(sports ? { fit_hint: '다짐', fit_words: [sports] } : {}) };
}

type Src = 'lh_bid' | 'lh_prespec' | 'd2b_bid' | 'd2b_fclty' | 'onbid_lease';
const NEED = /활용신청 필요|주소 확인 필요/;
export const publicAgencyBids: Collector = {
  slug: 'public_agency_bids', label: 'LH·국방·온비드 공고', hourKst: 6,
  source: 'LH 입찰공고(최근 7일)·LH 사전규격(의견마감 오늘~+30일)·방위사업청 국내·시설 경쟁입찰(최근 30일, 검색어 9개)·온비드 공고(개찰 오늘~+60일, 검색어 7개) — matchFit 통과분만(온비드 체육시설 임대는 포함)', needs: ['DATA_GO_KR_SERVICE_KEY'],
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const key = dataGoKey(); if (!key) return { inserted: 0, updated: 0, unchanged: 0, errors: 0, summary: 'LH·국방·온비드: DATA_GO_KR_SERVICE_KEY 미설정 — 건너뜀', providerMode: 'api' };
    const ep = await endpoints(); const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started);
    const items: (Record<string, unknown> & { g2b_no?: string | null })[] = []; const errors: string[] = []; const denied = new Set<Src>();
    const stats: Partial<Record<Src, SourceStat>> = {};
    const S = (src: Src) => (stats[src] ??= { label: ENDPOINT_LABEL[src] ?? src, ok: false, calls: 0, received: 0, kept: 0, total: 0 });
    /** 날짜 형식은 명세에 예시가 없음(로컬 10/24) — yyyyMMdd 로 먼저, 활용신청·주소 문제가 아닌 오류면 yyyy-MM-dd 로 한 번 더(그 원천은 그 뒤 계속 그 형식) */
    const dash = new Set<Src>(); const D = (src: Src, d: Date) => (dash.has(src) ? ymdDash(d) : ymd8(d));
    const call = async (src: Src, params: (d: (x: Date) => string) => Record<string, string>, page = 1): Promise<{ rows: any[]; total: number } | null> => {
      if (left() < 6000) { S(src).note = '시간 한도 근접 — 일부만 받음'; return null; }
      const once = async () => {
        const u = new URL(ep[src]); u.searchParams.set('serviceKey', key); u.searchParams.set('numOfRows', '100'); u.searchParams.set('pageNo', String(page));
        if (src === 'onbid_lease') u.searchParams.set('resultType', 'json'); else { u.searchParams.set('type', 'json'); u.searchParams.set('_type', 'json'); }
        for (const [k, v] of Object.entries(params((x) => D(src, x)))) u.searchParams.set(k, v);
        const ds: DataGoStats = { calls: 0, codes: {}, total: 0, raw: 0 };
        const rows = await callDataGo(u, ctx.fetchImpl, key, Math.min(12000, left() - 2000), ds);
        const st = S(src); st.calls++; st.received += rows.length; st.total = (st.total ?? 0) + ds.total; if (!st.keys && ds.keys) st.keys = ds.keys;
        return { rows, total: ds.total };
      };
      try { return await once(); }
      catch (e) { const m = e instanceof Error ? e.message : String(e); if (dash.has(src) || NEED.test(m) || src === 'onbid_lease') throw e; dash.add(src); S(src).note = '날짜를 yyyy-MM-dd 로 다시 보냄'; return once(); }
    };
    const keep = (src: Src, p: Record<string, unknown> | null) => {
      if (!p) return; if (!matchFit(String(p.title), String(p.bid_category ?? ''), String(p.task_scope ?? '')).fit && !p.fit_hint) return;
      items.push(p); S(src).kept++;
    };
    /** 쪽 넘기며(100줄씩) — totalCount 만큼, 최대 maxPages 쪽 */
    const pages = async (src: Src, params: (d: (x: Date) => string) => Record<string, string>, map: (it: any) => Record<string, unknown> | null, maxPages: number) => {
      for (let page = 1; page <= maxPages; page++) {
        const r = await call(src, params, page); if (!r) break;
        for (const it of r.rows) keep(src, map(it));
        if (r.rows.length < 100 || page * 100 >= (r.total || 0)) break;
        if (page === maxPages) S(src).note = `${maxPages}쪽까지만 받음(전체 ${r.total}줄)`;
      }
    };
    /** 원천 하나: 성공·실패 기록. 검색어 여러 번은 하나라도 받으면 성공(활용신청·주소 문제면 바로 멈춤) */
    const source = async (src: Src, fn: () => Promise<void>) => {
      S(src);
      try { await fn(); S(src).ok = true; }
      catch (e) { const m = e instanceof Error ? e.message : String(e); S(src).error = m.slice(0, 200); if (NEED.test(m)) denied.add(src); if (errors.length < 12) errors.push(`${src}: ${m}`); }
    };
    const words = async (src: Src, list: string[], params: (w: string, d: (x: Date) => string) => Record<string, string>, map: (it: any) => Record<string, unknown> | null) => {
      let okCalls = 0, last: unknown = null;
      for (const w of list) {
        try { const r = await call(src, (d) => params(w, d)); if (!r) break; okCalls++; for (const it of r.rows) keep(src, map(it)); }
        catch (e) { last = e; if (NEED.test(e instanceof Error ? e.message : String(e))) throw e; if (errors.length < 12) errors.push(`${src}(${w}): ${e instanceof Error ? e.message : String(e)}`); }
      }
      if (!okCalls && last) throw last;
    };
    const d = (n: number) => new Date(Date.now() + n * 864e5);
    await source('lh_bid', () => pages('lh_bid', (f) => ({ tndrbidRegDtStart: f(d(-7)), tndrbidRegDtEnd: f(d(0)) }), lhBidPayload, 8));
    await source('lh_prespec', () => pages('lh_prespec', (f) => ({ opinionRegEndDtmStart: f(d(0)), opinionRegEndDtmEnd: f(d(30)) }), lhPrespecPayload, 4));
    await source('d2b_bid', () => words('d2b_bid', D2B_WORDS, (w, f) => ({ bidNm: w, anmtDateBegin: f(d(-30)), anmtDateEnd: f(d(0)) }), (it) => d2bPayload(it, 'dmstc')));
    await source('d2b_fclty', () => words('d2b_fclty', D2B_WORDS, (w, f) => ({ cntrwkNm: w, anmtDateBegin: f(d(-30)), anmtDateEnd: f(d(0)) }), (it) => d2bPayload(it, 'fclty')));
    // 온비드: 부동산(0001) · 공유(0002)·국유(0010)·기타일반(0005) 재산 · 개찰일 오늘~+60일(필수 입력, yyyyMMdd)
    await source('onbid_lease', () => words('onbid_lease', ONBID_WORDS, (w) => ({ cltrTypeCd: '0001', prptDivCd: '0002,0010,0005', opbdDtStart: ymd8(d(0)), opbdDtEnd: ymd8(d(60)), onbidPbancNm: w }), onbidPayload));
    // 국방 공고 중 나라장터 공고번호가 있는 것: 나라장터 줄이 이미 있으면 국방 줄은 만들지 않고, 예전에 만든 국방 줄은(진행 기록·업무가 없을 때) 숨겨 한 줄로
    let joined = 0;
    const g2bNos = [...new Set(items.map((p) => p.g2b_no).filter((x): x is string => !!x))];
    if (g2bNos.length) {
      const sql = db();
      const have = new Map((await sql<{ n: string; id: string }[]>`select split_part(row->>'source_external_id', '-', 1) as n, src_id as id from sales_src_rows
        where tbl = 'procurement_notices' and scope = 'global' and not gone and row->>'source_type' = 'g2b_bid' and split_part(row->>'source_external_id', '-', 1) = any(${g2bNos}::text[])`).map((r) => [r.n, r.id]));
      for (let i = items.length - 1; i >= 0; i--) {
        const g = items[i].g2b_no; if (!g || !have.has(g)) continue;
        const [old] = await sql<{ id: string }[]>`select src_id as id from sales_src_rows where tbl = 'procurement_notices' and scope = 'global' and not gone and row->>'source_type' = 'd2b_bid' and row->>'source_external_id' = ${String(items[i].source_external_id)}`;
        if (old && !(await noticeLinks([old.id])).get(old.id)) await sql`update sales_src_rows set gone = true, row = row || ${sql.json({ merged_into: have.get(g) } as never)}::jsonb, synced_at = now() where src_id = ${old.id} and tbl = 'procurement_notices' and scope = 'global'`;
        items.splice(i, 1); joined++;
      }
    }
    const seen = new Set<string>(); const uniq = items.filter((p) => { const k = `${p.source_type}|${p.source_external_id}`; if (seen.has(k)) return false; seen.add(k); return true; }).map(({ g2b_no: _g, ...p }) => p);
    const r = uniq.length ? await upsertNotices(uniq) : { inserted: 0, updated: 0, unchanged: 0, errors: 0, invalid: 0, errorLog: undefined as string | undefined }; if (r.errorLog) errors.push(r.errorLog);
    const by = (Object.entries(stats) as [Src, SourceStat][]).map(([, s]) => `${s.label} ${s.ok ? `받음 ${s.received}·관련 ${s.kept}` : '실패'}`).join(' / ');
    return { inserted: r.inserted, updated: r.updated, unchanged: r.unchanged, errors: r.errors + r.invalid + Object.values(stats).filter((s) => !s.ok).length, errorLog: errors.length ? errors.join('\n') : undefined, providerMode: 'api', sources: stats as Record<string, SourceStat>,
      summary: `관련 공고 ${uniq.length}건 · 신규 ${r.inserted} · 갱신 ${r.updated}${joined ? ` · 나라장터와 같은 국방 공고 ${joined}건은 나라장터 줄로` : ''} — ${by}` + (denied.size ? ` · 활용신청·주소 확인 필요: ${[...denied].join(', ')} (플랫폼 운영 › 영업 수집기 설정)` : '') };
  },
};
