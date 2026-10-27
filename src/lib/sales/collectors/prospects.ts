// 운영시설 위탁 잠재수요(operating_facility_prospects) ETL 공용 로직 — 영업관리 원본 _shared/operating-prospect.ts·prospect-assessment.ts 이식(10/21). 순수 함수.
// 소유권: ETL_OWNED_FIELDS 만 수집기가 갱신. MANUAL_FIELDS(next_action·notes·lead_id·verification_status…)는 insert 에도 넣지 않고 update 에도 손대지 않는다. 원천 null 은 기존 값을 지우지 않는다.
export const PROSPECT_FACILITY_TYPES = ['아파트', '오피스텔·주상복합', '공공체육시설', '호텔·리조트', '산업단지', '대학교', '기업·사옥', '기타'] as const;
export const OPERATING_STATUSES = ['운영중', '입주중', '준공', '입주예정', '미확인'] as const;
export const SALES_LIKELIHOODS = ['상', '중', '하', '미확인'] as const;
export const ETL_OWNED_FIELDS = ['facility_type', 'name', 'region', 'address', 'operating_status', 'completion_date', 'move_in_date', 'household_count', 'facility_scale', 'facility_scale_unit', 'scale_note', 'management_company',
  'current_operator', 'contract_scope', 'contract_start_date', 'contract_end_date', 'source_slug', 'source_name', 'source_url', 'source_external_id', 'source_observed_at', 'sales_likelihood', 'sales_likelihood_reason', 'etl_suggested_next_action',
  'office_phone', 'amenities'] as const; // 186차: K-apt 기본·상세정보의 관리사무소 전화·부대복리시설(허브 카드 '관리사무소 전화'·'부대시설' 칸)
export type EtlField = (typeof ETL_OWNED_FIELDS)[number];
export const SIDO_ALIASES: Record<string, string> = { 서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전', 울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기', 강원도: '강원',
  강원특별자치도: '강원', 충청북도: '충북', 충청남도: '충남', 전라북도: '전북', 전북특별자치도: '전북', 전라남도: '전남', 경상북도: '경북', 경상남도: '경남', 제주특별자치도: '제주', 제주도: '제주' };
export const LEAD_WINDOW_DAYS = 180;
export const RECENT_COMPLETION_DAYS = 548;
export const CONTACT_DONE: readonly string[] = ['영업완료', '대상아님'];
export const CORE_FACILITY_TYPES = new Set(['아파트', '오피스텔·주상복합', '공공체육시설', '호텔·리조트', '산업단지']);
export const KAPT_RELEVANT_TASK = /(커뮤니티|주민공동|피트니스|헬스|운동|체육|골프|수영|사우나|GX|필라테스|요가|독서실|위탁운영)/i;
export const SCALE_UNITS = ['가동업체', '연면적㎡', '객실', '기타'] as const;
export const SCALE_THRESHOLDS: Record<string, [number, number]> = { 가동업체: [200, 50], '연면적㎡': [10000, 3000], 객실: [300, 100] };

export type ProspectRow = Record<string, unknown> & { dedupe_key: string; facility_type: string; name: string; operating_status: string; source_slug: string; source_name: string; source_url: string; operator_explicitly_none?: boolean };
const s = (v: unknown): string | null => { if (v == null) return null; const t = String(v).trim(); return t ? t : null; };
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const ymd = (v: unknown): string | null => { const t = s(v); if (!t) return null; const d = t.replace(/[./]/g, '-').slice(0, 10); if (!YMD.test(d)) return null; const p = new Date(d + 'T00:00:00Z'); return Number.isNaN(p.getTime()) || p.toISOString().slice(0, 10) !== d ? null : d; };
const nonNegInt = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isInteger(n) && n >= 0 ? n : null; };
const scaleNum = (v: unknown): number | null => { if (v == null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const oneOf = <T extends readonly string[]>(v: unknown, set: T, fallback: T[number]): T[number] => { const t = s(v); return t && (set as readonly string[]).includes(t) ? (t as T[number]) : fallback; };
export const normalizeName = (name: string) => name.normalize('NFKC').toLowerCase().replace(/[\s()[\]{}·.,\-_'"]/g, '').replace(/아파트$/, '');
export function normalizeRegion(region: string | null, address: string | null): string {
  const toks = (v: string | null) => (v ?? '').normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  const r = toks(region), a = toks(address);
  const [sido = '', sigungu = ''] = r.length >= 2 ? r : a.length >= 2 ? a : r.length ? r : a;
  return (SIDO_ALIASES[sido] ?? sido) + sigungu;
}
export function makeDedupeKey(facilityType: string, name: string, region: string | null, address: string | null, facilityCode?: string | null): string {
  if (facilityCode) return [facilityType, `code:${facilityCode}`].join('|');
  return [facilityType, normalizeName(name), normalizeRegion(region, address)].join('|');
}
export type ValidateResult = { ok: true; row: ProspectRow } | { ok: false; reason: string };
export function validateProspectPayload(p: Record<string, unknown>): ValidateResult {
  const name = s(p.name); if (!name) return { ok: false, reason: 'name required' };
  const facilityType = s(p.facility_type);
  if (!facilityType || !(PROSPECT_FACILITY_TYPES as readonly string[]).includes(facilityType)) return { ok: false, reason: `facility_type must be one of ${PROSPECT_FACILITY_TYPES.join(',')}` };
  const sourceUrl = s(p.source_url); if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return { ok: false, reason: 'source_url must be http(s)' };
  const sourceSlug = s(p.source_slug); if (!sourceSlug) return { ok: false, reason: 'source_slug required' };
  const sourceName = s(p.source_name); if (!sourceName) return { ok: false, reason: 'source_name required' };
  const region = s(p.region), address = s(p.address);
  const row: ProspectRow = {
    dedupe_key: makeDedupeKey(facilityType, name, region, address, s(p.facility_code)), facility_type: facilityType, name, region, address,
    operating_status: oneOf(p.operating_status, OPERATING_STATUSES, '미확인'), completion_date: ymd(p.completion_date), move_in_date: ymd(p.move_in_date), household_count: nonNegInt(p.household_count),
    facility_scale: scaleNum(p.facility_scale), facility_scale_unit: scaleNum(p.facility_scale) == null ? null : oneOf(p.facility_scale_unit, SCALE_UNITS, '기타'), scale_note: s(p.scale_note),
    management_company: s(p.management_company), current_operator: s(p.current_operator), contract_scope: s(p.contract_scope), contract_start_date: ymd(p.contract_start_date), contract_end_date: ymd(p.contract_end_date),
    source_slug: sourceSlug, source_name: sourceName, source_url: sourceUrl, source_external_id: s(p.source_external_id), source_observed_at: s(p.source_observed_at),
    sales_likelihood: oneOf(p.sales_likelihood, SALES_LIKELIHOODS, '미확인'), sales_likelihood_reason: s(p.sales_likelihood_reason), etl_suggested_next_action: s(p.etl_suggested_next_action),
    office_phone: s(p.office_phone), amenities: s(p.amenities),
    operator_explicitly_none: p.operator_explicitly_none === true && !s(p.current_operator),
  };
  if (row.contract_start_date && row.contract_end_date && String(row.contract_start_date) > String(row.contract_end_date)) return { ok: false, reason: 'contract_start_date after contract_end_date' };
  return { ok: true, row };
}
const FACT_FIELDS: EtlField[] = ['operating_status', 'completion_date', 'move_in_date', 'household_count', 'facility_scale', 'management_company', 'current_operator', 'contract_scope', 'contract_start_date', 'contract_end_date'];
const SOFT_FIELDS: EtlField[] = ['source_observed_at', 'sales_likelihood_reason', 'etl_suggested_next_action'];
export type MergePlan = { action: 'insert' | 'update' | 'skip_no_change'; patch: Record<string, unknown>; changeSummary: string | null };
export function planMerge(prev: Record<string, unknown> | null, next: ProspectRow): MergePlan {
  if (!prev) { const patch: Record<string, unknown> = {}; for (const f of ETL_OWNED_FIELDS) patch[f] = next[f]; return { action: 'insert', patch: { ...patch, dedupe_key: next.dedupe_key }, changeSummary: '신규' }; }
  const patch: Record<string, unknown> = {}; const changes: string[] = []; let material = false;
  for (const f of ETL_OWNED_FIELDS) {
    const v = next[f]; if (v == null) continue;
    const old = prev[f] ?? null; if (String(old) === String(v)) continue;
    patch[f] = v; if (!SOFT_FIELDS.includes(f)) material = true; if (FACT_FIELDS.includes(f)) changes.push(`${f} ${old ?? '-'}→${v}`);
  }
  if (next.operator_explicitly_none && prev.current_operator != null) { patch.current_operator = null; material = true; changes.push(`current_operator ${prev.current_operator}→(직영·공단, 위탁 없음)`); }
  if (!material) return { action: 'skip_no_change', patch: {}, changeSummary: null };
  return { action: 'update', patch, changeSummary: changes.join(' · ') || '출처/평가 갱신' };
}
// ---- 평가(가능성·lane·다음 조치) ----
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);
const within = (today: string, d: string | null, days: number) => { if (!d) return null; const n = dayDiff(today, d); return n >= 0 && n <= days ? n : null; };
const since = (today: string, d: string | null, days: number) => { if (!d) return null; const n = dayDiff(d, today); return n >= 1 && n <= days ? n : null; };
export type Likelihood = { grade: '상' | '중' | '하' | '미확인'; score: number; reasons: string[] };
export function scoreLikelihood(p: any, today: string): Likelihood {
  const reasons: string[] = []; let score = 0; let signals = 0;
  if (CORE_FACILITY_TYPES.has(p.facility_type)) { score += 1; reasons.push(`핵심 업종(${p.facility_type})`); }
  if (p.household_count != null) { signals++; if (p.household_count >= 1000) { score += 2; reasons.push(`대단지 ${p.household_count}세대`); } else if (p.household_count >= 300) { score += 1; reasons.push(`${p.household_count}세대`); } }
  if (p.contract_end_date) { signals++; const n = dayDiff(today, p.contract_end_date); if (n >= 0 && n <= LEAD_WINDOW_DAYS) { score += 3; reasons.push(`계약종료 D-${n}`); } else if (n > LEAD_WINDOW_DAYS && n <= 365) { score += 1; reasons.push(`계약종료 ${n}일 후`); } else if (n < 0 && n >= -90) { score += 1; reasons.push(`계약종료 ${-n}일 경과(재계약 확인)`); } }
  const occ = within(today, p.move_in_date, LEAD_WINDOW_DAYS) ?? within(today, p.completion_date, LEAD_WINDOW_DAYS);
  if (p.move_in_date || p.completion_date) signals++;
  if (occ != null) { score += 2; reasons.push(`입주·준공 D-${occ}`); }
  else { const done = since(today, p.move_in_date, RECENT_COMPLETION_DAYS) ?? since(today, p.completion_date, RECENT_COMPLETION_DAYS); if (done != null && done <= LEAD_WINDOW_DAYS) { score += 2; reasons.push(`준공 ${done}일 경과(초기 위탁 선정기)`); } else if (done != null) { score += 1; reasons.push(`준공 ${done}일 경과`); } }
  if (p.operating_status !== '미확인') { signals++; if (p.operating_status === '운영중' || p.operating_status === '입주중') { score += 1; reasons.push(`현재 ${p.operating_status}`); } }
  if (p.facility_scale != null && p.facility_scale_unit) { signals++; const [hi, lo] = SCALE_THRESHOLDS[p.facility_scale_unit] ?? [Infinity, Infinity]; const label = `${p.facility_scale_unit} ${Number(p.facility_scale).toLocaleString('ko-KR')}`; if (p.facility_scale >= hi) { score += 2; reasons.push(`대규모(${label})`); } else if (p.facility_scale >= lo) { score += 1; reasons.push(label); } }
  if (p.current_operator) { score += 1; reasons.push(`현 위탁사 ${p.current_operator}`); }
  if (p.verification_status === 'verified') { score += 1; reasons.push('검증됨'); }
  if (signals === 0) return { grade: '미확인', score, reasons: [...reasons, '운영상태·계약·규모 근거 없음'] };
  return { grade: score >= 5 ? '상' : score >= 3 ? '중' : '하', score, reasons };
}
export type ProspectAssessment = { lane: string; rank: number; date: string | null; dateLabel: string; likelihood: Likelihood; nextAction: string };
export function assessProspect(p: any, today: string): ProspectAssessment {
  const likelihood = scoreLikelihood(p, today); const owner = p.management_company ?? '관리주체';
  let lane: string, rank: number, date: string | null = null, dateLabel = '다음 조치', rule: string;
  const renewal = within(today, p.contract_end_date, LEAD_WINDOW_DAYS), moveIn = within(today, p.move_in_date, LEAD_WINDOW_DAYS), completion = within(today, p.completion_date, LEAD_WINDOW_DAYS);
  const movedIn = since(today, p.move_in_date, RECENT_COMPLETION_DAYS), completed = since(today, p.completion_date, RECENT_COMPLETION_DAYS);
  if (p.verification_status === 'excluded') { lane = '제외'; rank = 9; rule = '제외됨'; }
  else if (p.contact_status && CONTACT_DONE.includes(p.contact_status)) { lane = '제외'; rank = 9; rule = `처리 완료(${p.contact_status})`; }
  else if (renewal != null) { lane = '계약갱신 6개월'; rank = renewal <= 60 ? 0 : renewal <= 120 ? 1 : 2; date = p.contract_end_date; dateLabel = '계약 종료'; rule = `계약종료 D-${renewal}: ${owner}에 재계약·입찰 일정 확인 → 제안서 준비`; }
  else if (moveIn != null || completion != null) { lane = '입주·준공 6개월'; const n = (moveIn ?? completion) as number; rank = n <= 90 ? 1 : 2; date = moveIn != null ? p.move_in_date : p.completion_date; dateLabel = moveIn != null ? '입주 예정' : '준공 예정'; rule = `${dateLabel} D-${n}: 시행·시공사·입주자대표 구성 일정 확인, 초기 위탁운영 제안`; }
  else if (movedIn != null || completed != null) { lane = '신규 준공 단지'; const n = (movedIn ?? completed) as number; rank = n <= LEAD_WINDOW_DAYS ? 1 : 2; date = movedIn != null ? p.move_in_date : p.completion_date; dateLabel = movedIn != null ? '입주' : '준공'; rule = `준공 ${n}일 경과: 관리사무소에 현 관리·경비·청소 위탁업체와 계약기간 확인 → 입주자대표회의에 위탁 제안`; }
  else if ((p.operating_status === '운영중' || p.operating_status === '입주중') && (likelihood.grade === '상' || likelihood.grade === '중')) { lane = '운영중 위탁검토'; rank = 3; rule = p.contract_end_date ? `현 계약(종료 ${p.contract_end_date}) 이후 재입찰 시점·현 위탁 만족도 확인` : '현 운영방식(직영/위탁)·현 위탁사·계약만료일 확인'; }
  else { lane = '후속조사 필요'; rank = 5; rule = `운영상태·계약기간 원문 확인 (출처: ${p.source_name})`; }
  if (lane !== '제외' && p.next_action_date && p.next_action_date <= today) { rank = Math.min(rank, 0); if (!date) { date = p.next_action_date; dateLabel = '조치 예정'; } }
  return { lane, rank, date, dateLabel, likelihood, nextAction: p.next_action ?? p.etl_suggested_next_action ?? rule };
}
export function prospectFromKaptSelection(r: any): Record<string, unknown> | null {
  const task = [r.task_category, r.task_detail].filter(Boolean).join(' ');
  if (!KAPT_RELEVANT_TASK.test(task)) return null;
  return { facility_type: '아파트', name: r.complex_name, region: r.region ?? null, address: r.address ?? null, operating_status: '운영중', household_count: r.household_count ?? null, current_operator: r.selected_vendor ?? null,
    contract_scope: task || null, contract_start_date: r.contract_start_date ?? null, contract_end_date: r.contract_end_date ?? null, source_slug: 'operating_from_kapt', source_name: 'K-apt 사업자선정 결과', source_url: r.source_url,
    source_external_id: r.source_external_id ?? r.complex_code ?? r.id, facility_code: r.complex_code ?? null };
}
export type PrepareResult = { ok: true; row: ProspectRow; plan: MergePlan } | { ok: false; reason: string };
/** 200차 #699 준공·입주 단지 원천 우선순위(숫자가 작을수록 먼저): K-apt 자료실 주간 엑셀 > K-apt 단지 목록·기본정보 > 한국부동산원(연 1회).
 *  더 높은 원천이 쓴 줄에 낮은 원천은 빈 칸만 채움 — 부동산원 순환 실행과 K-apt 주간 실행이 같은 줄을 번갈아 덮어쓰지 않게 */
export const COMPLEX_RANK: Record<string, number> = { kapt_weekly_complexes: 1, kapt_new_complexes: 2, reb_recent_complexes: 3 };
/** 200차: 원천마다 단지 번호가 달라(K-apt 단지 코드 · 한국부동산원 단지 번호) 키로는 같은 단지를 못 찾음 — 지역 + (단지명 또는 도로명주소) + 사용승인일이 같으면 같은 단지 */
export function complexMatchKeys(p: Record<string, unknown>): string[] {
  const d = s(p.completion_date); if (!d) return [];
  const region = normalizeRegion(s(p.region), s(p.address)); const name = s(p.name) ? normalizeName(String(p.name)) : '';
  const road = String(p.address ?? '').match(/\(([^()]+)\)\s*$/)?.[1]?.normalize('NFKC').replace(/\s+/g, '') ?? '';
  return [name && region ? `n|${region}|${name}|${d}` : '', road ? `r|${road}|${d}` : ''].filter(Boolean);
}
export function prepareProspectWrite(payload: Record<string, unknown>, prev: Record<string, unknown> | null, today: string): PrepareResult {
  const v = validateProspectPayload(payload); if (!v.ok) return v;
  const row = v.row;
  const pr = COMPLEX_RANK[String(prev?.source_slug ?? '')], nr = COMPLEX_RANK[row.source_slug];
  if (prev && pr && nr && nr > pr) for (const f of ETL_OWNED_FIELDS) if (prev[f] != null) (row as Record<string, unknown>)[f] = prev[f];
  const merged: Record<string, unknown> = { ...row };
  if (prev) { for (const f of ETL_OWNED_FIELDS) if (merged[f] == null && prev[f] != null) merged[f] = prev[f]; if (row.operator_explicitly_none) merged.current_operator = null; }
  const a = assessProspect({ ...merged, id: String(prev?.id ?? 'new'), verification_status: String(prev?.verification_status ?? 'raw'), next_action: null, next_action_date: prev?.next_action_date ?? null, etl_suggested_next_action: null, lead_id: prev?.lead_id ?? null }, today);
  row.sales_likelihood = a.likelihood.grade; row.sales_likelihood_reason = a.likelihood.reasons.join(' · ') || null;
  return { ok: true, row, plan: planMerge(prev, row) };
}
export type BatchPlan = { inserts: { key: string; patch: Record<string, unknown>; externalId: string | null; summary: string | null }[]; updates: { id: string; patch: Record<string, unknown>; externalId: string | null; summary: string | null }[]; unchangedIds: string[]; invalid: number; duplicatesMerged: number; errLog: string[] };
export function planBatch(items: Record<string, unknown>[], prevByKey: Map<string, Record<string, unknown>>, today: string): BatchPlan {
  const byKey = new Map<string, { payload: Record<string, unknown>; end: string }>(); let invalid = 0; const errLog: string[] = [];
  for (const c of items) { const v = validateProspectPayload(c); if (!v.ok) { invalid++; if (errLog.length < 20) errLog.push(`invalid ${String(c.name ?? '?')}: ${v.reason}`); continue; } const end = String(v.row.contract_end_date ?? ''); const cur = byKey.get(v.row.dedupe_key); if (!cur || end >= cur.end) byKey.set(v.row.dedupe_key, { payload: c, end }); }
  const plan: BatchPlan = { inserts: [], updates: [], unchangedIds: [], invalid, duplicatesMerged: items.length - invalid - byKey.size, errLog };
  for (const [key, { payload }] of byKey) {
    const prev = prevByKey.get(key) ?? null; const prep = prepareProspectWrite(payload, prev, today);
    if (!prep.ok) { plan.invalid++; continue; }
    const ext = (prep.row.source_external_id as string | null) ?? null;
    if (prep.plan.action === 'insert') plan.inserts.push({ key, patch: prep.plan.patch, externalId: ext, summary: prep.plan.changeSummary });
    else if (prep.plan.action === 'update') plan.updates.push({ id: String(prev!.id), patch: prep.plan.patch, externalId: ext, summary: prep.plan.changeSummary });
    else plan.unchangedIds.push(String(prev!.id));
  }
  return plan;
}
