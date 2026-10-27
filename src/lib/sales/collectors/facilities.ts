// 운영시설 파일형 수집기 4종 — 산업단지(KICOX CSV)·공공체육시설(문체부 XLSX)·관광숙박업(행안부 OpenAPI)·신규 준공 공동주택(부동산원 CSV 40MB). 원본 이식(10/21).
import { dataGoKey } from '../collect';
import { RECENT_COMPLETION_DAYS } from './prospects';
import { addDaysYmd, parseCsv, regionFromAddress, resolveDataGoKrFile, resolveDataGoKrFileUrl, rotatingWindow, runFileProspectCollector, todayIndex, todayKst, toYmd, type Extracted, type FileSourceSpec, type ProspectPayload } from './files';
import { setSourceAsOf, upsertProspects } from './store';
import { readXlsx } from './xlsx';
import type { Collector, CollectorCtx, CollectorResult, SourceStat } from './types';

const T = () => process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, '');
// ---- 산업단지 ----
const DL = (id: string) => `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=${id}&fileDetailSn=1&insertDataPrcus=N`;
export const KICOX_FILES = [{ label: '국가', page: 'https://www.data.go.kr/data/15085874/fileData.do', fallback: DL('FILE_000000007689096') }, { label: '일반', page: 'https://www.data.go.kr/data/15085886/fileData.do', fallback: DL('FILE_000000007689090') },
  { label: '농공', page: 'https://www.data.go.kr/data/15085878/fileData.do', fallback: DL('FILE_000000007686218') }, { label: '도시첨단', page: 'https://www.data.go.kr/data/15085880/fileData.do', fallback: DL('FILE_000000007686250') }];
const num = (v: string | undefined) => { const t = (v ?? '').replace(/,/g, '').trim(); return !t || !/^-?\d+(\.\d+)?$/.test(t) ? null : Number(t); };
export function mapKicoxRow(r: Record<string, string>): ProspectPayload | null {
  const name = (r['단지명'] ?? '').replace(/\s+/g, ' ').trim(); if (!name || /\([^)]*\+[^)]*\)/.test(name)) return null;
  const status = (r['조성상태'] ?? '').trim(); const operating = num(r['가동업체(개)']); const tenants = num(r['입주업체(개)']);
  let operating_status: string; if (status === '완료') operating_status = '운영중'; else if (status === '조성중') operating_status = operating == null ? '미확인' : operating > 0 ? '입주중' : '입주예정'; else return null;
  const type = (r['유형'] ?? '').trim(), sido = (r['시도'] ?? '').trim(), sigun = (r['시군'] ?? '').trim(), area = num(r['관리면적(천제곱미터)']);
  return { facility_type: '산업단지', name: name.endsWith('산업단지') || name.endsWith('산단') ? name : `${name} ${type}산업단지`, region: regionFromAddress(`${sido} ${sigun}`), operating_status, facility_scale: operating, facility_scale_unit: operating != null ? '가동업체' : null,
    scale_note: [`${type}산단`, tenants != null ? `입주 ${tenants}개사` : '입주 비공개', operating != null ? `가동 ${operating}개사` : '가동 비공개', area != null ? `관리면적 ${area.toLocaleString('ko-KR')}천㎡` : null, `조성 ${status}`].filter(Boolean).join(' · '), contract_scope: '산업단지 근로자 복지·체육시설', source_external_id: `${type}|${sido}|${sigun}|${name}` };
}
export const kicoxIndustrial: Collector = {
  slug: 'kicox_industrial_complexes', label: '산업단지 현황(한국산업단지공단)', hourKst: 7, source: 'data.go.kr 전국산업단지현황통계 CSV 4종(국가·일반·농공·도시첨단, 분기)',
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const files = T() ? [{ label: '일반', pageUrl: KICOX_FILES[1].page, url: `${T()}/files/kicox.csv` }] : await Promise.all(KICOX_FILES.map(async (f) => ({ label: f.label, pageUrl: f.page, url: await resolveDataGoKrFileUrl(f.page, f.fallback, ctx.fetchImpl) })));
    return runFileProspectCollector({ slug: 'kicox_industrial_complexes', sourceName: '한국산업단지공단 전국산업단지현황통계', pageUrl: KICOX_FILES[1].page, files, requiredHeaders: ['유형', '시도', '시군', '단지명', '조성상태', '입주업체(개)', '가동업체(개)'], mapRow: mapKicoxRow, maxRowsPerRun: 600 }, ctx.fetchImpl, ctx.deadlineMs, ctx.now);
  },
};
// ---- 공공체육시설(XLSX) ----
export const SPORTS_PAGE_URL = 'https://www.mcst.go.kr/site/s_policy/dept/deptView.jsp?pSeq=2107&pDataCD=0417000000';
export const SPORTS_FILE_URL_2025 = 'https://www.mcst.go.kr/servlets/eduport/front/upload/UplDownloadFile?pFileName=2025+%EC%A0%84%EA%B5%AD+%EA%B3%B5%EA%B3%B5%EC%B2%B4%EC%9C%A1%EC%8B%9C%EC%84%A4+%ED%98%84%ED%99%A9%28%EC%A2%85%ED%95%A9%EB%B3%B8%29.xlsx&pRealName=DEPTDATA_20260317100013749945.xlsx&pPath=0417000000&pFlag=';
export const SPORTS_SHEETS = [{ match: /수영장/, kind: '수영장' }, { match: /생활체육관/, kind: '생활체육관' }, { match: /구기체육관/, kind: '구기체육관' }, { match: /골프연습장/, kind: '골프연습장' }, { match: /빙상장/, kind: '빙상장' }];
const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim(); const normHeader = (s: string) => s.replace(/\s+/g, '').replace(/[ㆍ·]/g, '');
const PUBLIC_CORP = /(공단|공사|시설관리사업소|시설사업소)$/;
export function isExplicitlyDirect(raw: string | undefined): boolean { const m = (raw ?? '').replace(/\s+/g, ''); if (!m || /위탁/.test(m)) return false; return /직영/.test(m) || /(공단|공사)$/.test(m); }
export function parseManager(raw: string | undefined): { management_company: string | null; current_operator: string | null } {
  const m = clean(raw); if (!m) return { management_company: null, current_operator: null };
  if (!/위탁|수탁자/.test(m)) return { management_company: m, current_operator: null };
  const stripped = m.replace(/\((사|재|주|유|학|사단법인|재단법인|학교법인)\)|[㈜㈔㈕]/g, ''); const groups = [...stripped.matchAll(/[[(（［]([^[\]()（）［］]*)[\])）］]/g)].map((g) => g[1]); const outside = stripped.replace(/[[(（［][^[\]()（）［］]*[\])）］]/g, ' ');
  const tidy = (s: string) => { const t = clean(s.replace(/민간\s*위탁|수탁자\s*[:：]?|위탁\s*[:：]?/g, ' ')).replace(/^[-:：\s]+|[-:：\s]+$/g, ''); return /^(운영|관리|운영관리|민간|민간관리)$/.test(t) ? '' : t; };
  const candidates = [...groups.map(tidy), tidy(outside)].filter((c) => c && c !== '위탁'); const inner = groups.map(tidy).find((c) => c) ?? candidates[0] ?? '';
  if (!inner) return { management_company: m, current_operator: '위탁(업체 미기재)' }; if (/개인/.test(inner)) return { management_company: m, current_operator: '개인 위탁' }; if (PUBLIC_CORP.test(inner)) return { management_company: inner, current_operator: null };
  return { management_company: m, current_operator: inner };
}
export function extractSportsSheet(rows: string[][], kind: string): { payloads: ProspectPayload[]; filtered: number; error?: string } {
  const h = rows.findIndex((r) => r.some((c) => normHeader(c ?? '') === '시설명')); if (h < 0) return { payloads: [], filtered: 0, error: `${kind}: '시설명' 헤더 없음` };
  const col: Record<string, number> = {}; rows[h].forEach((c, i) => { const k = normHeader(c ?? ''); if (k && col[k] == null) col[k] = i; });
  for (const need of ['시도', '시군구', '시설명']) if (col[need] == null) return { payloads: [], filtered: 0, error: `${kind}: 필수 컬럼 없음 ${need}` };
  const get = (r: string[], k: string) => (col[k] == null ? '' : clean(r[col[k]])); const payloads: ProspectPayload[] = []; let filtered = 0; let sido = '';
  for (const r of rows.slice(h + 1)) {
    const rowSido = get(r, '시도'); if (rowSido && rowSido !== '전국') sido = rowSido; const sgg = get(r, '시군구'), name = get(r, '시설명'); if (!sgg && !name) continue;
    if (/^(소계|계)$/.test(sgg.replace(/\s/g, '')) || !name || /^\d+(\.\d+)?$/.test(name) || !sido) { filtered++; continue; }
    const { management_company, current_operator } = parseManager(r[col['관리주체']]); const area = Number(get(r, '연면적').replace(/,/g, '')); const year = get(r, '준공연도').match(/^(19|20)\d{2}/)?.[0] ?? null; const addr = get(r, '주소');
    payloads.push({ facility_type: '공공체육시설', name, region: `${sido} ${sgg}`, address: [sido, sgg, addr].filter(Boolean).join(' '), operating_status: '운영중', facility_scale: Number.isFinite(area) && area > 0 ? Math.round(area) : null, facility_scale_unit: Number.isFinite(area) && area > 0 ? '연면적㎡' : null,
      scale_note: [kind, year ? `준공 ${year}년` : null, get(r, '개보수연도') ? `개보수 ${get(r, '개보수연도')}` : null].filter(Boolean).join(' · '), management_company, current_operator, operator_explicitly_none: current_operator == null && isExplicitlyDirect(r[col['관리주체']]), contract_scope: `${kind} 운영`, source_external_id: `${kind}|${sido}|${sgg}|${name}` });
  }
  return { payloads, filtered };
}
export function mergeSameFacility(payloads: ProspectPayload[]): ProspectPayload[] {
  const byKey = new Map<string, ProspectPayload>();
  for (const p of payloads) { const key = `${p.name}|${p.region}`; const cur = byKey.get(key); if (!cur) { byKey.set(key, { ...p }); continue; }
    cur.contract_scope = [...new Set([...String(cur.contract_scope).split(' · '), String(p.contract_scope)])].join(' · '); const a = (cur.facility_scale as number | null) ?? null, b = (p.facility_scale as number | null) ?? null; if (b != null && (a == null || b > a)) { cur.facility_scale = b; cur.facility_scale_unit = p.facility_scale_unit; }
    cur.scale_note = [...new Set([...String(cur.scale_note).split(' · '), ...String(p.scale_note).split(' · ')])].join(' · '); if (!cur.current_operator && p.current_operator) { cur.current_operator = p.current_operator; cur.management_company = p.management_company; }
    cur.operator_explicitly_none = !cur.current_operator && Boolean(cur.operator_explicitly_none && p.operator_explicitly_none); }
  for (const p of byKey.values()) p.source_external_id = `시설|${String(p.region)}|${String(p.name)}`;
  return [...byKey.values()];
}
export function extractSportsWorkbook(bytes: Uint8Array): Extracted {
  const wb = readXlsx(bytes); const payloads: ProspectPayload[] = []; let filtered = 0; let rows = 0; const found: string[] = []; const errors: string[] = [];
  for (const { match, kind } of SPORTS_SHEETS) { const name = wb.sheetNames.find((n) => match.test(n)); if (!name) continue; found.push(kind); const ex = extractSportsSheet(wb.rows(name), kind); if (ex.error) errors.push(ex.error); rows += ex.payloads.length + ex.filtered; payloads.push(...ex.payloads); filtered += ex.filtered; }
  if (!found.length) return { rows: 0, payloads: [], filtered: 0, error: `대상 시트 없음 — 형식 변경 의심 (시트: ${wb.sheetNames.slice(0, 8).join(', ')})` };
  if (!payloads.length) return { rows, payloads: [], filtered, error: errors.join('; ') || '추출 0건 — 형식 변경 의심' };
  const merged = mergeSameFacility(payloads);
  return { rows, payloads: merged, filtered, note: `xlsx ${found.join('·')}${merged.length < payloads.length ? ` · 여러 시트 동일시설 ${payloads.length - merged.length}건 병합` : ''}`, warnings: [...errors, ...SPORTS_SHEETS.filter((s) => !found.includes(s.kind)).map((s) => `${s.kind} 시트 없음`)] };
}
export const publicSports: Collector = {
  slug: 'public_sports_facilities', label: '전국 공공체육시설(문체부)', hourKst: 7, source: '문체부 전국 공공체육시설 현황 XLSX(연 1회) — 수영장·생활체육관·구기체육관·골프연습장·빙상장', needs: ['PUBLIC_SPORTS_FILE_URL(선택)'],
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    return runFileProspectCollector({ slug: 'public_sports_facilities', sourceName: '문화체육관광부 전국 공공체육시설 현황', pageUrl: SPORTS_PAGE_URL, files: [{ url: T() ? `${T()}/files/sports.xlsx` : process.env.PUBLIC_SPORTS_FILE_URL?.trim() || SPORTS_FILE_URL_2025, label: '공공체육시설', pageUrl: SPORTS_PAGE_URL }], extract: (b) => extractSportsWorkbook(b), maxRowsPerRun: 600 }, ctx.fetchImpl, ctx.deadlineMs, ctx.now);
  },
};
// ---- 관광숙박업 OpenAPI ----
export const HOTEL_API = () => (T() ? `${T()}/hotels/info` : 'https://apis.data.go.kr/1741000/tourist_accommodations/info');
export const HOTEL_PAGE_URL = 'https://www.data.go.kr/data/15155090/openapi.do';
export function mapHotelItem(it: Record<string, any>): ProspectPayload | null {
  const name = String(it.BPLC_NM ?? '').replace(/\s+/g, ' ').trim(); if (!name || String(it.SALS_STTS_CD ?? '') !== '01') return null;
  const addr = String(it.ROAD_NM_ADDR ?? '').trim() || String(it.LOTNO_ADDR ?? '').trim(); const rooms = Number(it.GSRM_CNT); const licensed = toYmd(String(it.LCPMT_YMD ?? '')); const kind = String(it.TOUR_LDGBIZ_DTL_NM ?? '').trim();
  return { facility_type: '호텔·리조트', name, region: regionFromAddress(addr), address: addr || null, operating_status: '운영중', facility_scale: Number.isFinite(rooms) && rooms > 0 ? rooms : null, facility_scale_unit: Number.isFinite(rooms) && rooms > 0 ? '객실' : null,
    scale_note: [kind || '관광숙박업', licensed ? `인허가 ${licensed}` : null, it.TOTAL_NOFL ? `${it.TOTAL_NOFL}층` : null].filter(Boolean).join(' · '), contract_scope: '호텔 피트니스·부대시설 운영', source_external_id: String(it.MNG_NO ?? '') || null };
}
export const touristHotels: Collector = {
  slug: 'tourist_hotels_localdata', label: '관광숙박업(호텔·리조트)', hourKst: 7, source: '행안부 관광숙박업 조회 OpenAPI(15155090) — 영업중만, 하루 12쪽(1,200건) 순환', needs: ['DATA_GO_KR_SERVICE_KEY'],
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const key = dataGoKey(); const st: SourceStat = { label: '관광숙박업', ok: false, calls: 0, received: 0, kept: 0, total: 0 };
    const fail = (msg: string): CollectorResult => { st.error = msg.slice(0, 200); return { inserted: 0, updated: 0, unchanged: 0, errors: 1, errorLog: msg, summary: msg, providerMode: 'api', sources: { tourist_hotels: st } }; };
    if (!key) return fail('DATA_GO_KR_SERVICE_KEY 미설정');
    const started = ctx.now(); const left = () => ctx.deadlineMs - (ctx.now() - started); const safe = (s: string) => s.split(key).join('***').split(encodeURIComponent(key)).join('***').slice(0, 160);
    // #522(로컬 10/24 '10/22부터 실패'): 주소는 명세(15155090)와 같음 — 오류 응답이 JSON(OpenAPI_ServiceResponse)·XML 이라 예전 코드는 '0건'으로만 보였다 → 코드·사유를 그대로 남김
    let cond = true;
    const page = async (p: number) => { const u = new URL(HOTEL_API()); u.searchParams.set('serviceKey', key); u.searchParams.set('pageNo', String(p)); u.searchParams.set('numOfRows', '100'); u.searchParams.set('returnType', 'json'); if (cond) u.searchParams.set('cond[SALS_STTS_CD::EQ]', '01');
      const res = await ctx.fetchImpl(u.toString(), { signal: AbortSignal.timeout(Math.min(15000, Math.max(1000, left() - 2000))) }); const txt = await res.text(); st.calls++;
      let body: any; try { body = JSON.parse(txt); } catch { const code = txt.match(/<returnReasonCode>([^<]+)</)?.[1] ?? txt.match(/<resultCode>([^<]+)</)?.[1] ?? ''; const msg = txt.match(/<returnAuthMsg>([^<]+)</)?.[1] ?? txt.match(/<errMsg>([^<]+)</)?.[1] ?? txt.match(/<resultMsg>([^<]+)</)?.[1] ?? 'non-json';
        throw new Error(`관광숙박업 API 오류(HTTP ${res.status}): ${safe(`${code} ${msg}`.trim())}`); }
      const cm = body?.OpenAPI_ServiceResponse?.cmmMsgHeader; if (cm) { const rc = String(cm.returnReasonCode ?? ''); const em = String(cm.errMsg ?? cm.returnAuthMsg ?? '');
        throw new Error(`${/^(20|21|22|30|31|32|33)$/.test(rc) || /DENIED|UNREGISTERED|NOT_REGISTERED|LIMITED|FORBIDDEN|EXPIRED/i.test(em) ? '활용신청 필요' : rc === '12' ? '주소 확인 필요' : '관광숙박업 API 오류'}(HTTP ${res.status}): ${safe(`${rc} ${em}`.trim())}`); }
      const header = body?.response?.header ?? body?.header; const code = header?.resultCode != null ? String(header.resultCode) : null; if (code != null && !['00', '0', 'INFO-000'].includes(code)) throw new Error(`결과코드 ${safe(code)} ${safe(String(header?.resultMsg ?? ''))}`.trim());
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${safe(JSON.stringify(body).slice(0, 120))}`);
      const b = body?.response?.body ?? body?.body ?? {}; const raw = b?.items?.item ?? b?.items ?? []; const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
      st.received += items.length; if (!st.keys && items[0] && typeof items[0] === 'object') st.keys = Object.keys(items[0]).slice(0, 60);
      if (!header && !b?.totalCount && !items.length) throw new Error(`관광숙박업 응답 모양이 다름 — 맨 위 칸: ${Object.keys(body ?? {}).slice(0, 6).join(', ') || '없음'}`);
      return { items, totalCount: Number(b?.totalCount ?? items.length) }; };
    let first; try { first = await page(1); } catch (e) { return fail(safe(e instanceof Error ? e.message : String(e))); }
    // 영업상태 조건(cond[SALS_STTS_CD::EQ]=01)으로 0건이면 조건 없이 한 번 더(값 형식이 다를 때) — 영업중은 아래 mapHotelItem 이 거름
    if (!first.totalCount) { cond = false; try { first = await page(1); st.note = '영업상태 조건 없이 받음(조건으로는 0건)'; } catch (e) { return fail(safe(e instanceof Error ? e.message : String(e))); } }
    if (!first.totalCount) return fail('관광숙박업 API 응답 0건 — 서비스키 권한·요청 조건 확인 필요');
    st.total = first.totalCount;
    const totalPages = Math.max(1, Math.ceil(first.totalCount / 100)); const win = rotatingWindow(totalPages, 12, todayIndex()); const items: any[] = []; const errs: string[] = [];
    for (let p = win.start + 1; p <= win.end; p++) { if (left() < 5000) { errs.push(`시간 한도 근접 — ${win.end - p + 1}쪽은 다음 순환에서`); break; } try { items.push(...(p === 1 ? first.items : (await page(p)).items)); } catch (e) { errs.push(safe(`page ${p}: ${e instanceof Error ? e.message : String(e)}`)); } }
    const observedAt = new Date().toISOString(); const payloads: ProspectPayload[] = []; let filtered = 0;
    for (const it of items) { const p = mapHotelItem(it); if (!p) { filtered++; continue; } payloads.push({ source_slug: 'tourist_hotels_localdata', source_name: '행정안전부 관광숙박업 조회서비스', source_url: HOTEL_PAGE_URL, source_observed_at: observedAt, ...p }); }
    st.kept = payloads.length; st.ok = true;
    let inserted = 0, updated = 0, unchanged = 0, errors = errs.length, invalid = 0;
    for (let i = 0; i < payloads.length; i += 300) { if (left() < 5000) { errs.push(`시간 한도 근접 — ${payloads.length - i}건은 다음 순환에서`); errors++; break; } try { const r = await upsertProspects(payloads.slice(i, i + 300)); inserted += r.inserted; updated += r.updated; unchanged += r.unchanged; errors += r.errors; invalid += r.invalid; if (r.errorLog && errs.length < 10) errs.push(r.errorLog); } catch (e) { errors += Math.min(300, payloads.length - i); if (errs.length < 10) errs.push(e instanceof Error ? e.message : String(e)); } }
    return { inserted, updated, unchanged, errors: errors + invalid, errorLog: errs.length ? errs.join('\n') : undefined, providerMode: 'api', sources: { tourist_hotels: st }, summary: `영업중 ${first.totalCount}건 · 이번 페이지 ${win.start + 1}~${win.end}/${totalPages}` + (win.cycleDays > 1 ? ` (${win.cycleDays}일 순환)` : '') + ` · 신규 ${inserted} · 갱신 ${updated} · 변화없음 ${unchanged} · 대상외 ${filtered}` + (errors ? ` · 오류 ${errors}` : '') + (st.note ? ` · ${st.note}` : '') };
  },
};
// ---- 신규 준공 공동주택(부동산원 CSV) ----
export const REB_PAGE = 'https://www.data.go.kr/data/15106861/fileData.do';
export const REB_FALLBACK = 'https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000007644006&fileDetailSn=1&insertDataPrcus=N';
export const REB_REQUIRED = ['단지고유번호', '주소', '단지명_공시가격', '단지종류', '세대수', '사용승인일'];
const KIND: Record<string, string> = { '1': '아파트', '2': '연립', '3': '다세대' };
const int = (v: string | undefined) => { const t = (v ?? '').replace(/,/g, '').trim(); return /^\d+$/.test(t) ? Number(t) : null; };
export function mapRebRow(r: Record<string, string>, from: string, to: string): ProspectPayload | null {
  const approved = toYmd(r['사용승인일']); if (!approved || approved < from || approved > to) return null;
  const rawName = (r['단지명_공시가격'] || r['단지명_건축물대장'] || r['단지명_도로명주소'] || '').replace(/\s+/g, ' ').trim(); const addr = (r['주소'] ?? '').replace(/\s+/g, ' ').trim(); const id = (r['단지고유번호'] ?? '').trim(); const kind = KIND[(r['단지종류'] ?? '').trim()] ?? '공동주택';
  const name = /[가-힣A-Za-z]/.test(rawName) ? rawName : addr ? `${addr.split(' ').slice(-2).join(' ')} ${kind}` : ''; if (!name || !addr || !id) return null;
  const households = int(r['세대수']), blocks = int(r['동수']), road = (r['도로명주소'] ?? '').trim();
  return { facility_type: kind === '아파트' ? '아파트' : '기타', name, region: regionFromAddress(addr), address: road ? `${addr} (${road})` : addr, operating_status: '입주중', completion_date: approved, household_count: households, scale_note: [kind, blocks != null ? `${blocks}개동` : null, `사용승인 ${approved}`].filter(Boolean).join(' · '), contract_scope: '공동주택 관리·경비·청소 위탁', facility_code: id, source_external_id: id };
}
const DATE_TOKEN = /(?:^|,)\s*(\d{4})-?(\d{2})-?(\d{2})\s*(?=,|$)/g;
export function extractReb(bytes: Uint8Array, from: string, to: string): Extracted {
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 256 * 1024)); const enc = head.includes('�') ? 'euc-kr' : 'utf-8'; const text = new TextDecoder(enc).decode(bytes);
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; const nl = body.indexOf('\n'); const headers = (parseCsv(nl < 0 ? body : body.slice(0, nl))[0] ?? []).map((h) => h.trim());
  const missing = REB_REQUIRED.filter((h) => !headers.includes(h)); if (missing.length) return { rows: 0, payloads: [], filtered: 0, error: `원천 형식 변경 의심 — 필수 컬럼 없음: ${missing.join(', ')} (받은 컬럼: ${headers.slice(0, 12).join(', ')})` };
  let rows = 0, filtered = 0; const payloads: ProspectPayload[] = []; let start = nl < 0 ? body.length : nl + 1;
  while (start < body.length) { let end = body.indexOf('\n', start); if (end < 0) end = body.length; const line = body.slice(start, end).replace(/\r$/, ''); start = end + 1; if (!line.trim()) continue; rows++;
    let hit = false; for (const m of line.matchAll(DATE_TOKEN)) { const d = `${m[1]}-${m[2]}-${m[3]}`; if (d >= from && d <= to) { hit = true; break; } } if (!hit) { filtered++; continue; }
    const cells = parseCsv(line)[0] ?? []; const obj: Record<string, string> = {}; headers.forEach((h, i) => (obj[h] = (cells[i] ?? '').trim())); const p = mapRebRow(obj, from, to); if (p) payloads.push(p); else filtered++; }
  return { rows, payloads, filtered, note: `${enc} · 사용승인 ${from}~${to}` };
}
export const rebRecent: Collector = {
  slug: 'reb_recent_complexes', label: '신규 준공 공동주택(한국부동산원)', hourKst: 7, source: 'data.go.kr 공동주택 단지 식별정보 CSV(약 40MB, 연 1회) — 사용승인 최근 18개월',
  async run(ctx: CollectorCtx): Promise<CollectorResult> {
    const today = todayKst(); const from = addDaysYmd(today, -RECENT_COMPLETION_DAYS);
    // 200차: 같은 페이지의 수정일(dateModified) = 원본 기준일 줄('한국부동산원 9. 1.(화) 파일(연 1회, 전년도 사용승인분)')
    const f = T() ? await resolveDataGoKrFile(`${T()}/files/reb-page.html`, `${T()}/files/reb.csv`, ctx.fetchImpl) : await resolveDataGoKrFile(REB_PAGE, REB_FALLBACK, ctx.fetchImpl);
    const r = await runFileProspectCollector({ slug: 'reb_recent_complexes', sourceName: '한국부동산원 공동주택 단지 식별정보', pageUrl: REB_PAGE, files: [{ label: '단지 기본정보', pageUrl: REB_PAGE, url: f.url }], extract: (b) => extractReb(b, from, today), maxRowsPerRun: 1000, downloadTimeoutMs: 40000 }, ctx.fetchImpl, ctx.deadlineMs, ctx.now);
    if (f.modified && r.inserted + r.updated + r.unchanged > 0) await setSourceAsOf('reb_recent_complexes', f.modified, '파일(연 1회, 전년도 사용승인분)');
    return r;
  },
};
