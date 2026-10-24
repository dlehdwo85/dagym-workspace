// 입찰공고 공용 로직(영업관리 원본 supabase/functions/_shared/procurement.ts 이식, 10/21) — 다짐·하이링크 적합 분류 · 상태 · 검증 · 병합 계획.
// 순수 함수(외부 import 없음). 수집기는 ETL 필드만 갱신하고 담당자 판단(분류·대표 판단·영업 포인트)은 건드리지 않는다.
export const DAGYM_KEYWORDS = [
  '피트니스', '휘트니스', '헬스', '헬스장', '운동시설', '주민운동', '체력단련', '스포츠센터', '체육센터', '국민체육센터', '생활체육', '실내체육관', '체육시설', '수영장', '사우나', '목욕탕',
  '골프연습장', '골프장', '스크린골프', '골프', 'GX', '필라테스', '요가', '스피닝', '줌바', '커뮤니티', '주민공동시설', '주민공동', '부대복리시설', '독서실', '도서관', '작은도서관', '게스트하우스',
  '카페', '조식', '위탁운영', '운영위탁', '운영업체', '강사'] as const;
export const HILINK_KEYWORDS = ['출입통제', '출입관리', '출입시스템', '출입구축', '출입장치', '자동출입', '통합보안', '안면인식', '얼굴인식', '생체인식', '스피드게이트', '스피드 게이트', '게이트', '키오스크', '무인', '회원관리',
  '예약시스템', '예약 시스템', '통합관리시스템', '커뮤니티시스템', '커뮤니티 시스템', '커뮤니티 프로그램', '타석', '골프타석', '타석관제', '오토티업', 'RFID', '카드리더', '락커', '사물함', 'IoT'] as const;
export const NOISE_KEYWORDS = ['도장', '방수', '보수공사', '공사', '청소', '소독', '경비', '승강기', '전기', '소방', '도색', '조경', '수목', '전지', '급수', '배관', '누수', '하자', '옥상', '외벽', '주차', '차단기', 'CCTV', '보험',
  '회계감사', '감사', '변압기', '택배', '리모델링', '바닥재', '인테리어', '교체'] as const;
export const EXCLUDE_TOPICS = ['어린이집', '보육', '알뜰', '장터', '야시장', '자판기', '주차관제', '주차장', '음식물', '종량기', '재활용', '택배', '이동통신', '중계기', '헬스케어', '구내식당', '급식', '매점', '학위복', '방과후',
  '영어마을', '정보시스템', '전산', '선거', '투표', '돼지', '가축', '축산', '양돈', '농장', '개체식별', '해외연수', '바이오헬스', '헬스산업', '조기경보', '재난', '하천', '임대공실', '공실', '점포', '장서'] as const;
// #476 d: '주민 운동시설 위탁관리업체 선정'(K-apt 분류 '사업자-용역-주민운동시설의 위탁')이 중장기로 빠졌다 → 위탁 관리(업체)·시설의 위탁·위탁 업체/사업자 선정도 즉시 검토
const DIRECT = /(위탁\s*운영|운영\s*위탁|운영\s*업체|운영\s*사업자|운영자|위탁\s*용역|위탁\s*관리(?:\s*업체)?|시설의\s*위탁|위탁\s*(?:업체|사업자)\s*선정|출입\s*통제|출입\s*시스템|출입시스템|출입\s*구축|출입\s*장치|자동\s*출입|통합\s*보안|안면\s*인식|얼굴\s*인식|키오스크|회원\s*관리|예약\s*시스템|타석|스크린\s*골프|커뮤니티\s*시스템)/;
const WEAK = new Set(['커뮤니티', '주민공동시설', '주민공동', '부대복리시설', '카페', '강사', '골프', '게이트', '무인', '도서관', '운영업체', 'IoT', '락커', '사물함', '통합관리시스템']);
const APT_CONTEXT = /아파트|단지|주민|입주|공동주택|커뮤니티|관리사무소|오피스텔|레지던스/;
const CONSTRUCTION_RE = /공사|관급자재|설계|감리|측량|폐기물|골재|건립|신축|증축|개축|철거|타일|안전진단|기술지도|시공/;
const FACILITY_SERVICE_RE = /청소|경비|소독|방역|안전점검|정기점검|점검용역|제습|공조기|냉난방|보일러|여과기|승강기/;
const OPERATION_ONLY = new Set(['위탁운영', '운영위탁', '운영업체', '강사', '조식']);

export type FitBusiness = '다짐' | '하이링크' | '다짐·하이링크';
export type FitResult = { fit: FitBusiness | null; matched: string[]; direct: boolean };
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '');

/** 제목·분류·내용에서 키워드를 찾아 적합 사업을 정한다(띄어쓰기 무시, 긴 단어에 포함된 짧은 단어는 하나로). */
export function matchFit(...texts: (string | null | undefined)[]): FitResult {
  // #522 조달 사이트 이름(나라장터·누리장터)은 제외 주제 '장터'(알뜰장터 등)가 아님 — '나라장터 공고번호 …' 가 붙은 국방 공고가 통째로 빠졌다
  const text = texts.filter(Boolean).join(' ').replace(/나라\s*장터|누리\s*장터/g, ' ');
  if (!text.trim()) return { fit: null, matched: [], direct: false };
  const title = String(texts[0] ?? '');
  const upper = norm(text);
  const has = (k: string) => upper.includes(norm(k));
  if (EXCLUDE_TOPICS.some(has)) return { fit: null, matched: [], direct: false };
  const noisy = NOISE_KEYWORDS.some(has);
  const apt = APT_CONTEXT.test(text);
  const pick = (list: readonly string[]) => {
    const hits = list.filter(has);
    const uniq = hits.filter((k) => !hits.some((o) => o !== k && norm(o).includes(norm(k))));
    const strong = uniq.filter((k) => !WEAK.has(k));
    const ok = strong.length > 0 || (uniq.length > 0 && !noisy && apt);
    return ok ? uniq : [];
  };
  const direct = DIRECT.test(text);
  let d = pick(DAGYM_KEYWORDS);
  const h = pick(HILINK_KEYWORDS);
  // 공사·설비·청소 등 시설 서비스는 DIRECT 가 아니면 다짐에서 제외(하이링크 판정은 유지)
  if (d.length && !direct && (CONSTRUCTION_RE.test(title) || FACILITY_SERVICE_RE.test(title))) d = [];
  if (d.length && d.every((k) => OPERATION_ONLY.has(k))) d = []; // 위탁운영만으로는 시설 단어 필요
  const fit: FitBusiness | null = d.length && h.length ? '다짐·하이링크' : d.length ? '다짐' : h.length ? '하이링크' : null;
  return { fit, matched: [...d, ...h], direct: !!fit && direct };
}

/** 로컬 10/24 12:20(#537 후속): 결과(낙찰·유찰) 줄 — 영업 기회가 아니라 결과. 오늘 새 공고·새 공고 수에서 빼고 '결과' 묶음으로(당일 메일·영업기회 오늘 탭·영업 홈 같은 기준) */
export const isAwardResult = (r: any) => /낙찰|유찰/.test(String(r?.current_status ?? '')) || ['winner_name', 'award_company', 'successful_bidder'].some((k) => String(r?.[k] ?? '').trim() !== '');
/** 닫힌 공고 상태 — '마감임박'(3일 안 마감, 아직 진행 중)은 닫힘이 아님(로컬 10/24 12:58: 마감 10/26 공고가 '마감·취소'로 보였음) */
export const CLOSED_STATUS = /마감(?!임박)|종료|취소|낙찰|유찰|개찰완료/;
/** 로컬 10/24 12:58(#537 후속2): 온비드는 처분방식 임대·사용(수익)허가만 영업 대상 — 매각(재산 팔기)은 뺌. 처분방식 칸이 '매각'이거나, 공고명에 매각만 있고 임대·사용허가가 없으면 */
export function onbidSale(r: { source_type?: unknown; bid_category?: unknown; notice_type?: unknown; title?: unknown }) {
  if (String(r?.source_type ?? '') !== 'onbid_lease') return false;
  if (/매각/.test(`${r.bid_category ?? ''} ${r.notice_type ?? ''}`)) return true;
  const t = String(r.title ?? ''); return /매각/.test(t) && !/임대|대부|사용|허가/.test(t);
}
/** 공고 상태: 취소 → 취소, 낙찰자 있음 → 낙찰, 사전규격·발주계획 → 예정, 마감 지남 → 마감, 3일 이내 → 마감임박, 그 외 진행중 */
export function noticeStatus(state: string | null, deadlineAt: string | null, now: Date, opt: { winner?: string | null; sourceType?: string } = {}): string {
  if (state && /취소/.test(state)) return '취소';
  if (opt.winner) return '낙찰';
  if (opt.sourceType && /prespec|plan/.test(opt.sourceType)) return '예정';
  if (deadlineAt) { const t = Date.parse(deadlineAt); if (!Number.isNaN(t)) { if (t < now.getTime()) return '마감'; if (t - now.getTime() <= 3 * 86_400_000) return '마감임박'; } }
  return '진행중';
}
/** 21라인 공고구분: 정정·취소·재공고·긴급 — 제목·원천 구분(ntceKindNm)으로 */
export function noticeKind(title: string | null, kindName: string | null): 'new' | 'amend' | 'cancel' | 'rebid' | 'urgent' {
  const s = `${kindName ?? ''} ${title ?? ''}`;
  if (/취소/.test(s)) return 'cancel';
  if (/정정|변경/.test(s)) return 'amend';
  if (/재공고|재입찰/.test(s)) return 'rebid';
  if (/긴급/.test(s)) return 'urgent';
  return 'new';
}

export const PROCUREMENT_ETL_FIELDS = ['source_url', 'notice_file_url', 'issuer', 'title', 'region', 'notice_type', 'posted_date', 'deadline_at', 'budget_amount', 'estimated_amount', 'contract_method', 'current_status', 'task_scope',
  'bid_system', 'award_method', 'notice_state', 'facility_name', 'bid_category', 'office_phone', 'office_fax', 'office_address', 'household_count', 'fit_business', 'matched_keywords', 'related', 'attachment_urls',
  'notice_kind', 'participation_deadline_at', 'opening_at', 'demand_agency', 'region_restriction', 'industry_code', 'winner_name', 'winner_amount', 'award_date', 'files_checked_at', 'site_briefing_at', 'site_briefing_place',
  'base_amount', 'notice_no'] as const; // #522 기초금액(LH fdmtlAmt·국방 기초예비가격) — 추정가격·배정예산과 따로 · #543 공고번호(바로 가는 주소가 없는 원천의 '번호 검색' 안내)
export const AWARD_FIELDS = ['winner_name', 'winner_amount', 'award_date', 'current_status'] as const;
export type NoticeRow = Record<string, unknown> & { source_type: string; source_external_id: string; title: string; source_url: string };

const txt = (v: unknown): string | null => { if (v == null) return null; const t = String(v).replace(/\s+/g, ' ').trim(); return t ? t : null; };
const num = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[,원\s]/g, '')); return Number.isFinite(n) && n >= 0 ? n : null; };
export const ymdOf = (v: unknown): string | null => { const m = String(v ?? '').match(/^(\d{4})-?(\d{2})-?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
/** 원천 시각(한국) → ISO(+09:00). '2026-10-21 14:00' · '20261021 1400' · '2026/10/21' 모두 */
export const ts = (v: unknown): string | null => {
  const s = String(v ?? '').trim().replace(/[./]/g, '-');
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[ T]?(\d{2}):?(\d{2})(?::?(\d{2}))?)?/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '23'}:${m[5] ?? '59'}:${m[6] ?? '00'}+09:00`;
};
const phone = (v: unknown): string | null => {
  const d = String(v ?? '').replace(/[^\d]/g, '');
  if (d.length < 8 || d.length > 12) return null;
  if (d.startsWith('02')) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : `02-${d.slice(2, 6)}-${d.slice(6)}`;
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : d;
};
/** 첨부 칸: 주소 문자열 또는 {name, url}(#507 후속 K-apt 첨부 목록 — 원래 파일 이름) */
const urls = (v: unknown): (string | { name: string; url: string })[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []).map((a: any) => {
  const u = a && typeof a === 'object' ? String(a.url ?? a.href ?? '') : String(a ?? ''); const n = a && typeof a === 'object' ? txt(a.name) : null;
  if (!(/^https?:\/\//i.test(u) || u.startsWith('/api/bids/'))) return null;
  return n ? { name: n.slice(0, 200), url: u } : u;
}).filter((x): x is string | { name: string; url: string } => x !== null).slice(0, 20);

export type NoticeValidate = { ok: true; row: NoticeRow } | { ok: false; reason: string };
/** 수집 payload → 저장 행(ETL 필드만). 적합 분류·상태·공고구분은 여기서 계산 */
export function validateNoticePayload(p: Record<string, unknown>, now: Date): NoticeValidate {
  const sourceType = txt(p.source_type), ext = txt(p.source_external_id), title = txt(p.title), url = txt(p.source_url);
  if (!sourceType) return { ok: false, reason: 'source_type required' };
  if (!ext) return { ok: false, reason: 'source_external_id required' };
  if (!title) return { ok: false, reason: 'title required' };
  if (!url || !/^https?:\/\//i.test(url)) return { ok: false, reason: 'source_url must be http(s)' };
  const deadline = ts(p.deadline_at); const state = txt(p.notice_state);
  const fit0 = matchFit(title, txt(p.bid_category), txt(p.task_scope), sourceType === 'kapt_bid' ? '공동주택' : null);
  // #522 온비드: '스포츠센터 내 용품점 및 자판기 사용·수익허가'처럼 제외 낱말(자판기)이 섞인 체육시설 임대도 놓치지 않게 — 수집기가 준 적합 힌트
  const hint = txt(p.fit_hint) as FitBusiness | null;
  const fit: FitResult = fit0.fit || !hint ? fit0 : { fit: hint, matched: Array.isArray(p.fit_words) ? (p.fit_words as string[]).slice(0, 5) : [], direct: false };
  const winner = txt(p.winner_name);
  const row: NoticeRow = {
    source_type: sourceType, source_external_id: ext, source_url: url, notice_file_url: txt(p.notice_file_url), issuer: txt(p.issuer), title, region: txt(p.region),
    notice_type: txt(p.notice_type) ?? (fit.fit ? '위탁운영' : '기타용역'), posted_date: ymdOf(p.posted_date), deadline_at: deadline,
    budget_amount: num(p.budget_amount), estimated_amount: num(p.estimated_amount), contract_method: txt(p.contract_method),
    current_status: noticeStatus(state, deadline, now, { winner, sourceType }), task_scope: txt(p.task_scope), bid_system: txt(p.bid_system), award_method: txt(p.award_method), notice_state: state,
    facility_name: txt(p.facility_name), bid_category: txt(p.bid_category), office_phone: phone(p.office_phone), office_fax: phone(p.office_fax), office_address: txt(p.office_address), household_count: num(p.household_count),
    fit_business: fit.fit, matched_keywords: fit.matched, related: !!fit.fit || sourceType === 'vendor_recruit', attachment_urls: urls(p.attachment_urls),
    notice_kind: noticeKind(title, state), participation_deadline_at: ts(p.participation_deadline_at), opening_at: ts(p.opening_at), demand_agency: txt(p.demand_agency), region_restriction: txt(p.region_restriction),
    industry_code: txt(p.industry_code), winner_name: winner, winner_amount: num(p.winner_amount), award_date: ymdOf(p.award_date),
    files_checked_at: txt(p.files_checked_at), // #507 후속: K-apt 첨부 목록을 읽은 때(다음 수집에서 다시 읽지 않음)
    site_briefing_at: ts(p.site_briefing_at), site_briefing_place: txt(p.site_briefing_place), // #510 현장설명(나라장터 dcmtgOprtnDt·Plce)
    base_amount: num(p.base_amount),
    notice_no: txt(p.notice_no), // #543 차수·구분 없는 공고번호(온비드·국방·LH — 원천 사이트에서 검색할 번호)
  };
  return { ok: true, row };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** #476 d: K-apt 입찰분류에 '주민운동시설의 위탁'·커뮤니티(공사 제외)가 있으면 즉시 검토 */
const IMMEDIATE_CATEGORY = /주민\s*운동\s*시설의\s*위탁|커뮤니티/;
/** 처음 적재할 때의 분류(담당자 판단은 회사별 진행 칸에 — 공용 행은 규칙이 바뀌면 '중장기 → 즉시 검토'로만 올림, planNoticeBatch) */
export function initialClassification(row: { title?: unknown; bid_category?: unknown; task_scope?: unknown; fit_business?: unknown; source_type?: unknown }): string {
  if (row.source_type === 'vendor_recruit') return '중장기 영업리드'; // #476 후속 d(로컬 10/23): 협력사 모집은 등록 준비 — 즉시 검토로 두지 않음
  if (!row.fit_business) return '참고(비관련)';
  const cat = String(row.bid_category ?? '');
  if (IMMEDIATE_CATEGORY.test(cat) && !/공사/.test(cat)) return '즉시 검토';
  const f = matchFit(String(row.title ?? ''), row.bid_category as string | null, row.task_scope as string | null);
  return f.direct ? '즉시 검토' : '중장기 영업리드';
}
export type NoticePlan = { inserts: { key: string; row: Record<string, unknown> }[]; updates: { id: string; key: string; patch: Record<string, unknown>; summary: string }[]; unchangedIds: string[]; invalid: number; errLog: string[] };
/** prev: source_external_id → 기존 행(같은 source_type). 신규는 insert, 기존은 '새 값이 있고 달라진 것'만 patch. 낙찰된 공고는 되돌리지 않음. mergeScope='award' 면 낙찰 칸만 */
export function planNoticeBatch(items: Record<string, unknown>[], prev: Map<string, Record<string, unknown>>, now: Date, mergeScope: 'all' | 'award' = 'all'): NoticePlan {
  const plan: NoticePlan = { inserts: [], updates: [], unchangedIds: [], invalid: 0, errLog: [] };
  const seen = new Set<string>();
  for (const it of items) {
    const v = validateNoticePayload(it, now);
    if (!v.ok) { plan.invalid++; if (plan.errLog.length < 20) plan.errLog.push(`invalid: ${v.reason}`); continue; }
    const key = `${v.row.source_type}|${v.row.source_external_id}`;
    if (seen.has(key)) continue; seen.add(key);
    const p = prev.get(v.row.source_external_id);
    if (!p) {
      if (mergeScope === 'award' && !v.row.winner_name) continue; // 낙찰 병합인데 기존 공고가 없고 낙찰자도 없으면 버림
      plan.inserts.push({ key, row: { ...v.row, classification: initialClassification(v.row) } }); continue;
    }
    const patch: Record<string, unknown> = {}; const changed: string[] = [];
    const fields = mergeScope === 'award' ? AWARD_FIELDS : PROCUREMENT_ETL_FIELDS;
    for (const f of fields) {
      const nv = v.row[f];
      const empty = nv == null || (Array.isArray(nv) && nv.length === 0 && f !== 'matched_keywords');
      if (empty && f !== 'fit_business' && f !== 'matched_keywords') continue;
      if (f === 'current_status' && p.current_status === '낙찰' && nv !== '낙찰') continue; // 낙찰된 공고는 재수집으로 되돌리지 않음
      if (!same(nv, p[f])) { patch[f] = nv; changed.push(f); }
    }
    // #476 d: 규칙이 바뀌어 즉시 검토가 된 공고는 공용 분류를 올림(내리지는 않음 — 회사별 판단은 진행 칸에 따로)
    if (mergeScope === 'all' && p.classification === '중장기 영업리드') {
      const merged = { ...p, ...Object.fromEntries(Object.entries(v.row).filter(([, x]) => x != null)) };
      if (initialClassification(merged) === '즉시 검토') { patch.classification = '즉시 검토'; changed.push('classification'); }
    }
    if (changed.length) plan.updates.push({ id: String(p.id), key, patch, summary: `변경: ${changed.join(', ')}` });
    else plan.unchangedIds.push(String(p.id));
  }
  return plan;
}
