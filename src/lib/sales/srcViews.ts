import { isAdmin } from '../access';
import { db } from '../db';
import { assertSpace } from '../spaces';
import { badRequest, notFound } from '../errors';
import { tenantOf, type SessionUser } from '../types';
import { type BizCat, bizKey, listBizCats, matchBiz } from './bizCats';
import { vendorDateOk } from './collectors/vendorRules';
import { isAwardResult, onbidSale, partnerNeed } from './collectors/procurement';
import { groupNotices, isCancel, oneCardPerNotice, plainTitle, skipLinks } from './noticeGroups';
import { fixG2bUrl, searchHint } from './sourceLink';
import { hubTabsOn } from './hubTabs';
import { LEAD_STAGES, stageName } from './terms';
import { sourceAsOf } from './collectors/store';
import { briefingLine, briefingOf, termsLine, termsRows } from './bidTerms';
import { eligView } from './eligibilityText';

/**
 * V41 단계 2 영업 공간 화면(V39 B) — 옮긴 영업관리 원본(sales_src_rows)을 읽어 보여 줌. **전환일까지 읽기 전용**:
 * 원본(영업관리)이 아직 운영 중이고 매일 다시 가져오기가 덮어쓰므로, 고치는 것은 영업관리에서(전환 후 워크인 쓰기로 바꿈).
 * 칸 이름은 원본마다 다를 수 있어 후보를 차례로 시도(pick). 상세는 원본 칸 전부를 그대로 보여 줌.
 */
const pick = (o: any, ...keys: string[]) => { for (const k of keys) { const v = o?.[k]; if (v !== undefined && v !== null && String(v).trim() !== '') return v; } return null; };
// 로컬 10/19: 전환 뒤 리드(DB)의 날짜는 Date 객체 → String() 하면 'Wed Sep 09' 가 됨 — 서울 날짜(YYYY-MM-DD)로
const day = (v: unknown) => (!v ? null : v instanceof Date ? (Number.isNaN(v.getTime()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(v)) : String(v).slice(0, 10));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const plus = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));

/** 185차(로컬 10/26 19:20 A5): 상한(limit)은 최근 것부터 채우고(처음 본 때 최근순) 공고는 3년 창 — 정렬 없이 limit 하면 행이 상한(2만)을 넘을 때 공고가 무작위로 빠진다.
 *  돌려줄 때는 예전처럼 들어온 순서(오래된 것 → 새것, 같은 때는 저장 위치 순)로 되돌린다 — 동률 정렬(지역 묶음 순서 등)이 바뀌지 않게 */
const WINDOW_DAYS: Record<string, number> = { procurement_notices: 1095 };
async function rows(scope: string, tbl: string, limit = 5000) {
  const sql = db(); const days = WINDOW_DAYS[tbl]; const since = days ? new Date(Date.now() - days * 864e5).toISOString() : null;
  return (await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = ${scope} and tbl = ${tbl} and not gone
    ${since ? sql`and coalesce(row->>'first_seen_at', row->>'created_at', synced_at::text) >= ${since}` : sql``}
    order by coalesce(row->>'first_seen_at', row->>'created_at', synced_at::text) desc, ctid desc limit ${limit}`).reverse().map((r) => ({ ...r.row, __id: r.src_id }));
}
/** 191차(로컬 10/27 — 관련으로 저장된 원본 복사 줄이 입찰 목록·검색에 안 나옴): 공고는 관련 줄과 이 회사 진행 기록·참고 줄만 DB 에서 바로 읽는다.
 *  예전엔 모든 공고(관련 아님 포함, K-apt 전체 등)의 최신 2만 줄을 읽은 뒤 관련을 골라 — 수집 줄이 많으면 관련 줄이 읽기 상한 밖으로 밀렸다.
 *  3년 창은 그대로(처음 본 시각이 날짜 꼴이 아닌 줄은 창으로 빼지 않음). related = false 면 ids 줄만 */
async function noticeRows(ids: Iterable<string> = [], opt: { related?: boolean } = {}) {
  const sql = db(); const since = new Date(Date.now() - WINDOW_DAYS.procurement_notices * 864e5).toISOString();
  const list = [...new Set([...ids].map(String).filter(Boolean))]; const rel = opt.related !== false;
  if (!rel && !list.length) return [];
  return (await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone
    and (${rel ? sql`coalesce(row->>'related', 'false') = 'true'` : sql`false`} or src_id = any(${list}::text[]) or row->>'id' = any(${list}::text[]))
    and (coalesce(row->>'first_seen_at', row->>'created_at', synced_at::text) >= ${since} or coalesce(row->>'first_seen_at', row->>'created_at', synced_at::text) !~ '^[0-9]{4}-')
    order by coalesce(row->>'first_seen_at', row->>'created_at', synced_at::text) desc, ctid desc limit 20000`).reverse().map((r) => ({ ...r.row, __id: r.src_id }));
}
/** 전환 뒤(쓰기 열림): 리드는 정식 표(sales_leads)가 정본 — 원본 행 칸 이름으로 맞춰 돌려줌(화면 코드 그대로) */
/** date 칸: 운영 DB 연결은 date 를 'YYYY-MM-DD' 문자열로, 시험 DB 는 Date 로 줄 수 있음 — 둘 다(핫픽스 10/19: 문자열을 format 해 500) */
const ymdOf = (v: unknown) => (v == null || v === '' ? null : typeof v === 'string' ? v.slice(0, 10) : v instanceof Date && !Number.isNaN(v.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(v) : null);
async function formalLeads(tenant: string, id?: string) {
  const r = await db()<any[]>`select l.*, u.name as owner_name, (select max(x.occurred_at) from sales_lead_records x where x.lead_id = l.id and x.kind in ('sales_activities', 'proposals', 'contracts')) as last_activity_at from sales_leads l left join users u on u.id = l.owner_id where l.tenant = ${tenant} and l.deleted_at is null ${id ? db()`and l.id = ${id}` : db()``} order by l.updated_at desc limit 5000`;
  return r.map((l) => ({ ...(l.src ?? {}), __id: l.id, __src_id: l.src_id, __owner: l.owner_name ?? '', __owner_id: l.owner_id, name: l.name, sales_status: l.status, priority: l.priority, facility_type: l.facility_type, region: l.region,
    next_contact_date: ymdOf(l.next_contact_date), contact_name: l.contact_name, phone: l.phone, expected_revenue: l.expected_revenue, email: l.email, scale: l.scale, homepage: l.homepage ?? l.src?.homepage ?? null,
    memo: l.memo, updated_at: l.updated_at, created_at: l.created_at, last_activity_at: l.last_activity_at, next_action: l.next_action ?? null, revisit_date: ymdOf(l.revisit_date), biz_no: l.biz_no ?? null }));
}
async function userNames(tenant: string) {
  const m = await db()<{ src_user_id: string; name: string | null }[]>`select m.src_user_id, coalesce(u.name, m.name) as name from sales_user_map m left join users u on u.id = m.user_id where m.tenant = ${tenant}`;
  return new Map(m.map((x) => [x.src_user_id, x.name ?? '']));
}

/** 영업관리 11단계(원본 leads.sales_status) · 종결 단계 · 우선순위 한글 */
export const STAGES: string[] = [...LEAD_STAGES]; // 되돌림 = 영업 재편 2) 배정 이전으로 되돌린 리드 · 207차: 목록은 terms.ts(화면 이름·색·숨김은 회사 설정)
const CLOSED = new Set(['계약완료', '보류', '실패', '되돌림']);
/** #610·#614 리드 보관함(보류·실패·되돌림) — 계약완료는 대표 결정(⑩ 이름·숨김) 전까지 기본 목록에 그대로 */
const ARCHIVED_STAGES = new Set(['보류', '실패', '되돌림']);
/** 오늘 기준 n개월 앞뒤(KST 날짜) — #606 기간 필터 */
const shiftMonths = (d: string, months: number) => { const x = new Date(`${d}T12:00:00+09:00`); x.setUTCMonth(x.getUTCMonth() + months); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(x); };
const PRIORITY: Record<string, string> = { urgent: '긴급', high: '높음', medium: '보통', low: '낮음' };
/** 지역 칸에 단지명 같은 값(원본 데이터 오류)은 '지역 미정' 묶음으로 — 값은 고치지 않음 */
const regionOf = (v: unknown) => { const r = String(v ?? '').trim(); return !r || r.length > 8 || /\s/.test(r) ? '지역 미정' : r; };
const lead = (r: any, names: Map<string, string>) => ({
  id: r.__id, name: pick(r, 'name', 'company_name', 'facility_name', 'title', 'organization') ?? '(이름 없음)', status: pick(r, 'sales_status', 'status', 'stage'),
  priority: PRIORITY[String(pick(r, 'priority') ?? '').toLowerCase()] ?? pick(r, 'priority'), priorityCode: pick(r, 'priority'),
  facility: r.__owner !== undefined ? r.facility_type ?? null : pick(r, 'facility_type', 'type', 'category'), region: pick(r, 'region', 'sido', 'area'), next: day(pick(r, 'next_contact_date', 'next_contact_at', 'next_action_date')),
  owner: r.__owner !== undefined ? r.__owner || null : names.get(String(pick(r, 'owner_id', 'assigned_to', 'sales_owner_id', 'user_id') ?? '')) ?? null, ownerId: r.__owner_id ?? null, memo: r.__id && r.__owner !== undefined ? r.memo ?? null : undefined, revenue: pick(r, 'expected_revenue', 'expected_amount', 'estimated_revenue'),
  updated: day(pick(r, 'updated_at', 'created_at')), phone: pick(r, 'phone', 'contact_phone'), contact: pick(r, 'contact_name', 'manager_name'),
  homepage: pick(r, 'homepage', 'website', 'url'), // 대표 검수 10/20 ②: 앱 목록 홈페이지 칩
  bizNo: pick(r, 'biz_no', 'business_number', 'business_no'), // 205차: 사업자번호(중복 대조)
  // S2 2차: 이메일·규모·등록일·최근 활동(상담·제안·계약 최신, 없으면 수정일)
  email: pick(r, 'email', 'contact_email'), scale: pick(r, 'scale', 'facility_scale', 'size'), created: day(pick(r, 'created_at')), lastActivity: day(pick(r, 'last_activity_at', 'last_activity_date', 'last_contact_at')) ?? day(pick(r, 'updated_at', 'created_at')),
  nextAction: pick(r, 'next_action'), revisit: day(pick(r, 'revisit_date')), // 197차(#461): 다음 할 일(다음 연락일과 한 쌍) · 다시 볼 날(보류·실패)
});
/** 영업관리 기준(SALES_SCREEN_INVENTORY 10/19): '오늘 등록'·'새 공고'는 원본 first_seen_at 하나만(KST 날짜). posted_date·created_at 은 쓰지 않음.
 * 옮긴 행은 원본 first_seen_at 을 그대로 가져오므로 옮긴 날로 바뀌지 않는다(값이 없으면 신규 판단에서 빠짐) */
const firstSeen = (r: any) => {
  const v = r?.first_seen_at;
  if (!v) return null;
  const d = new Date(String(v));
  return /T|\s\d{2}:/.test(String(v)) && !Number.isNaN(d.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d) : String(v).slice(0, 10);
};
/** #476 b: '오늘' 탭 = 공고일 오늘 · 처음 본 날 오늘 · 지난 메일(전날까지 마지막 다이제스트) 뒤 처음 본 공고 — 메일 링크(오늘 탭)와 같은 범위.
 * 오늘이 된 까닭이 공고일·수집일 차이면 배지('어제 공고·오늘 수집' / '어제 메일 뒤 수집'). 게시일을 못 읽은 협력사 글은 뺌 */
async function lastMailAt(tenant: string): Promise<number | null> {
  const td = today(); const [prev] = await db()<{ created_at: Date }[]>`select created_at from sales_digests where tenant = ${tenant} and day < ${td} order by day desc limit 1`;
  const at = prev ? new Date(prev.created_at).getTime() : null; const start = Date.parse(`${td}T00:00:00+09:00`);
  return at != null && at < start && start - at <= 3 * 864e5 ? at : null;
}
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
function todayReason(n: { posted: string | null; noticeDate: string | null; vendorRecruit: boolean }, firstSeenAt: unknown, since: number | null, refoundAt?: unknown): { hit: boolean; label: string | null } {
  if (n.vendorRecruit && !n.noticeDate) return { hit: false, label: null };
  const td = today(), yd = plus(-1);
  if (n.posted === td) return { hit: true, label: n.noticeDate && n.noticeDate < td ? `${n.noticeDate === yd ? '어제' : md(n.noticeDate)} 공고·오늘 수집` : null };
  if (n.noticeDate === td) return { hit: true, label: n.posted && n.posted < td ? `공고일 오늘·${n.posted === yd ? '어제' : md(n.posted)} 처음 수집` : null }; // 정정·재공고로 공고일이 오늘이 된 옛 공고
  const seen = Date.parse(String(firstSeenAt ?? ''));
  if (since != null && !Number.isNaN(seen) && seen >= since) return { hit: true, label: `${n.posted === yd ? '어제' : n.posted ? md(n.posted) : ''} 메일 뒤 수집`.trim() };
  // 185차: 예전 규칙으로 '관련 아님'이었다가 다시 판정으로 찾은 공고(마감 전) — 찾은 날 오늘 새 공고에 한 번
  const ref = Date.parse(String(refoundAt ?? ''));
  if (!Number.isNaN(ref) && ref >= (since ?? Date.parse(`${td}T00:00:00+09:00`))) return { hit: true, label: `다시 찾은 공고${n.posted ? `(${n.posted === yd ? '어제' : md(n.posted)} 처음 수집)` : ''}` };
  return { hit: false, label: null };
}
/** 대표 10/24 추가 ②: 공고 id → 이 회사 진행 기록을 고친 시각 — 같은 공고 묶음(취소·정정·재게시·중복, noticeGroups)에서 카드로 쓸 줄 고르기. 분류만 있으면 0 */
const workTime = (W: any[], P?: Map<string, unknown>) => {
  const m = new Map(W.map((w) => [String(pick(w, 'notice_id', 'procurement_notice_id') ?? ''), Date.parse(String(pick(w, '__updated_at', 'updated_at') ?? '')) || 1]));
  return (id: string) => m.get(id) ?? (P?.has(id) ? 0 : null);
};
const attachmentsOf = (r: any) => { const a = pick(r, 'attachment_urls', 'attachments'); return Array.isArray(a) ? a : typeof a === 'string' && a.startsWith('[') ? (() => { try { return JSON.parse(a); } catch { return []; } })() : a ? [a] : []; };
/** S1-3: 시설 규모 facility_scale + facility_scale_unit(㎡·평·세대 등) */
const scaleOf = (r: any) => { const v = pick(r, 'facility_scale', 'scale', 'size', 'area'); if (v === null || v === undefined || v === '') return null; const u = pick(r, 'facility_scale_unit', 'scale_unit'); return u ? `${v}${u}` : v; };
/** 입주·준공 뒤 지난 날수(KST 오늘 기준, 미래면 null) */
const daysSince = (d: string | null) => { if (!d) return null; const n = Math.floor((Date.parse(today()) - Date.parse(d)) / 864e5); return Number.isFinite(n) && n >= 0 ? n : null; };
/** #476 후속(로컬 10/23 14:20): 협력사 모집 줄은 수집기가 게시판 날짜로 확인한 것(또는 '안내 페이지 바뀜')만 공고일을 믿음 — 예전 방식·원본 복사 줄의 공고일은 수집한 날 */
const vendorUnchecked = (r: any) => String(r?.source_type ?? '') === 'vendor_recruit' && !vendorDateOk(r);
const notice = (r: any, cats: BizCat[] = []) => { const m = matchBiz(r, cats); return ({ id: r.__id, title: pick(r, 'title', 'notice_title', 'bid_name', 'name') ?? '(제목 없음)', agency: pick(r, 'issuer', 'agency', 'org_name', 'demand_agency', 'organization', 'buyer'),
  region: pick(r, 'region'), posted: firstSeen(r), noticeDate: vendorUnchecked(r) ? null : day(pick(r, 'posted_date', 'posted_at', 'notice_date', 'published_at', 'bid_notice_date')), deadline: pick(r, 'deadline_at', 'close_at', 'deadline', 'bid_close_at', 'closing_date', 'end_date'),
  close: day(pick(r, 'deadline_at', 'close_at', 'deadline', 'bid_close_at', 'closing_date', 'end_date')), source: pick(r, 'source_type', 'source', 'source_code'), url: fixG2bUrl(pick(r, 'source_url', 'url', 'detail_url', 'link')),
  // #543 옛 나라장터 주소는 새 형식으로, 바로 가는 주소가 없는 원천은 번호 검색 안내
  search: searchHint({ source: pick(r, 'source_type', 'source', 'source_code'), url: pick(r, 'source_url', 'url', 'detail_url', 'link'), externalId: pick(r, 'source_external_id'), noticeNo: pick(r, 'notice_no') }),
  attachments: attachmentsOf(r),
  fit: pick(r, 'fit_score'), status: pick(r, 'current_status', 'status'), amount: pick(r, 'amount', 'budget', 'estimated_price', 'base_amount', 'presumed_price'), related: r.related === true || r.related === 'true',
  // 영업관리 입찰 카드 칸(SALES_SCREEN_INVENTORY 2-5): 사업·분류·출처·단지·세대·업종·낙찰·키워드·전화·DB 등록·오늘 등록
  business: bizKey(m), businesses: m.map((c) => ({ key: c.key, name: c.name, color: c.color })), category: pick(r, 'classification', 'category_label', 'lead_class'), sourceLabel: SOURCE_LABEL[String(pick(r, 'source_type', 'source', 'source_code') ?? '').toLowerCase()] ?? pick(r, 'source_type', 'source', 'source_code'),
  complex: pick(r, 'complex_name', 'facility_name', 'apartment_name'), households: pick(r, 'household_count', 'households', 'total_households', 'units'), industry: pick(r, 'industry', 'business_type', 'work_type', 'notice_type', 'bid_category'),
  winner: pick(r, 'winner_name', 'award_company', 'successful_bidder'), awardAmount: pick(r, 'winner_amount', 'award_amount', 'winning_amount', 'contract_amount'), awardDate: day(pick(r, 'award_date', 'opened_at')),
  keywords: (() => { const k = pick(r, 'matched_keywords', 'keywords', 'keyword_hits'); return Array.isArray(k) ? k.join(', ') : k; })(), phone: pick(r, 'office_phone', 'management_phone', 'phone', 'contact_phone'),
  todayNew: firstSeen(r) === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()),
  // S1-4(로컬 10/20): 원본 상세 화면 정보 칸(SALES_SCREEN_INVENTORY 2-5 상세) — 추정가격·계약방식·계약기간·공고번호·주소·팩스, 대표 판단·영업 포인트·부족 자격, 접힘 '과업·참가자격·요건 상세' 8칸
  // S1-3(로컬 10/20): 감사(AUDIT_SALES_MIGRATION)에 적힌 원본 실제 칸을 후보 맨 앞에 — source_type(9값)·household_count·winner_amount·notice_type·fit_business. 나머지 추측 칸은 원본 스키마 복사(docs/sales-src)가 오면 다시 맞춤
  vendorRecruit: /vendor_recruit|협력사/.test(String(pick(r, 'source_type', 'notice_type', 'bid_category', 'source') ?? '')),
  noticeNo: pick(r, 'source_external_id', 'notice_no', 'bid_no', 'external_id'), noticeType: pick(r, 'notice_type', 'bid_category'), fitBusiness: pick(r, 'fit_business'),
  partner: partnerNeed(r), // #752 하이링크 공사 공고 — '면허 업체 협력 필요'
  estimated: pick(r, 'estimated_amount', 'estimated_price', 'presumed_price', 'base_amount'), contractMethod: pick(r, 'contract_method', 'award_method', 'bid_system', 'contract_type'), contractPeriod: pick(r, 'contract_period', 'contract_term', 'service_period'),
  address: pick(r, 'office_address', 'address'), fax: pick(r, 'office_fax', 'fax'), salesPoint: pick(r, 'sales_point'), qualificationGap: pick(r, 'qualification_gap'),
  // 239차(#743·#744): 참가 조건 한 줄·펼치기 표·현장설명(종류·일시·장소) — K-apt 상세 칸·나라장터 API 칸에서(파일 안 열고)
  terms: termsLine(r, { limits: false }), termRows: termsRows(r), briefing: briefingOf(r),
  // 252차 #786: 참가자격 = 첨부 공고문 '참가자격' 절(원문·뽑은 요건 한 줄·못 찾은 이유) — 아직 안 읽었으면 나라장터 API 업종·지역만
  elig: eligView(r),
  // #751(로컬 10/28 17:25): 취소 사유(K-apt 상세 '낙찰/유찰/취소 사유')
  cancelReason: /취소/.test(String(r.current_status ?? '')) ? pick(r, 'result_note') : null,
  detail: { tasks: pick(r, 'main_tasks', 'scope_of_work', 'tasks') ?? (/^\s*(첨부\s*)?공고문\s*참조\s*$/.test(String(r.task_scope ?? '')) ? null : pick(r, 'task_scope')),
    qualification: r.eligibility?.text ?? pick(r, 'qualification', 'participation_requirements', 'bid_qualification'), performance: pick(r, 'performance_requirements', 'track_record') ?? (r.performance_cert ? `실적증명서 ${r.performance_cert}` : null),
    regionLimit: pick(r, 'region_restriction', 'region_limit'), license: pick(r, 'license_requirements', 'license', 'license_limit', 'industry_code'), joint: pick(r, 'joint_bid', 'subcontract', 'consortium'),
    briefing: pick(r, 'site_briefing', 'pre_bid_meeting', 'site_meeting') ?? briefingLine(r), presentation: pick(r, 'proposal_presentation', 'presentation') } }); };
// S1-3: 원본 source_type 9값(kapt_bid·g2b_bid·nuri_bid·g2b_prespec·lh_bid·lh_prespec·d2b_bid·onbid_lease·vendor_recruit) + 예전 짧은 코드
export const SOURCE_LABEL: Record<string, string> = { kapt_bid: 'K-apt', g2b_bid: '나라장터', nuri_bid: '누리장터', g2b_prespec: '나라장터 사전규격', lh_bid: 'LH', lh_prespec: 'LH 사전규격', d2b_bid: '국방', onbid_lease: '온비드 임대', vendor_recruit: '협력사 모집',
  kapt: 'K-apt', 'k-apt': 'K-apt', g2b: '나라장터', nara: '나라장터', g2b_pre: '나라장터 사전규격', nuri: '누리장터', lh: 'LH', lh_pre: 'LH 사전규격', defense: '국방', d2b: '국방', onbid: '온비드 임대', vendor: '협력사 모집' };
/** 진행 중 입찰(SALES_SCREEN_INVENTORY 2-5·143행) — 현황 숫자와 입찰 '진행 중' 탭이 같은 기준: 관련 공고 · 마감·취소·낙찰·유찰 아님 · KST 마감일 ≥ 오늘(마감일 없으면 진행으로)
 * · 사전규격(입찰 예정)은 빼고 · 작업 상태 미참여·대상아님은 뺀다. 원본 상태 문구가 '공고중'만이 아니어서(운영 10/19 진행 중 0건) 닫힌 상태만 거른다 */
/** #751: 취소 공고와 그 재공고 — 같은 원천 + 같은 제목(표시 뺌) + 같은 기관, 취소 공고보다 늦게 게시(처음 본 때)된 취소 아닌 공고. 마감일이 달라도 이음(K-apt 재공고는 마감이 바뀜) */
function renoticeLinks(rows: any[]) {
  const key = (r: any) => { const t = plainTitle(pick(r, 'title', 'notice_title')); const a = String(pick(r, 'issuer', 'facility_name', 'complex_name', 'agency') ?? '').replace(/[^0-9A-Za-z가-힣]/g, ''); return t.length >= 6 ? `${r.source_type ?? ''}|${t}|${a}` : null; };
  const at = (r: any) => String(r.posted_date ?? r.first_seen_at ?? '');
  const cancels = new Map<string, any[]>(); const lives = new Map<string, any[]>();
  for (const r of rows) { const k = key(r); if (!k) continue; const m = isCancel(r) ? cancels : lives; (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return (r: any): { prevCancel?: { title: string; reason: string | null; day: string | null }; renotice?: { title: string; close: string | null } } => {
    const k = key(r); if (!k) return {};
    if (isCancel(r)) { const next = (lives.get(k) ?? []).filter((x) => at(x) >= at(r)).sort((a, b) => at(b).localeCompare(at(a)))[0];
      return next ? { renotice: { title: String(pick(next, 'title') ?? ''), close: day(pick(next, 'deadline_at')) } } : {}; }
    const prev = (cancels.get(k) ?? []).filter((x) => at(x) <= at(r)).sort((a, b) => at(b).localeCompare(at(a)))[0];
    return prev ? { prevCancel: { title: String(pick(prev, 'title') ?? ''), reason: pick(prev, 'result_note'), day: day(pick(prev, 'posted_date', 'first_seen_at')) } } : {};
  };
}
/** 239차(#744): 필수 현장설명이 오늘~3일 안 — 입찰 마감보다 먼저 다가와 '마감 임박'에 함께 */
const briefSoon = (n: { briefing?: { required: boolean; at: string | null } | null }, td: string) => { const d = n.briefing?.required && n.briefing.at ? String(n.briefing.at).slice(0, 10) : null; return !!d && d >= td && d <= plus(3); };
const CLOSED_NOTICE = /마감(?!임박)|종료|취소|낙찰|유찰|개찰완료|closed|cancel|award|expired|done/i; // '마감임박'(3일 안 마감)은 진행 중(#537 후속2)
const SKIP_WORK = /미참여|대상아님|not[_\s-]?target|skip/i;
/** 마감 시각(KST) → epoch ms. 시각이 없거나 읽을 수 없으면 null. 오프셋 없는 'YYYY-MM-DD HH:MM' 은 서울 시각으로 */
function deadlineAt(v: unknown): number | null {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:00+09:00`);
}
/** 끝난 공고: 마감·취소·낙찰 상태이거나 마감일이 지남 — #537 후속2(로컬 10/24 12:58) 오늘 새 공고에서도 뺌 */
export function bidEnded(n: { status?: unknown; close?: string | null; deadline?: unknown }, td: string) {
  if (n.status && CLOSED_NOTICE.test(String(n.status))) return true;
  if (n.close && n.close < td) return true;
  // 로컬 10/19: 오늘 09:00·14:59 처럼 이미 지난 마감 — 시각이 있으면 지금 시각과 비교(시각 없으면 날짜만)
  if (n.close === td && n.deadline) { const at = deadlineAt(n.deadline); if (at !== null && at <= Date.now()) return true; }
  return false;
}
export function isOpenBid(n: { related?: boolean; status?: unknown; close?: string | null; source?: unknown; deadline?: unknown }, work: unknown, td: string) {
  if (!n.related) return false;
  if (bidEnded(n, td)) return false;
  if (/pre|사전/i.test(String(n.source ?? ''))) return false;
  if (work && SKIP_WORK.test(String(work))) return false;
  return true;
}

export async function salesView(u: SessionUser, view: string, q: { q?: string; id?: string; status?: string; tab?: string; day?: string; from?: string; to?: string; biz?: string; sort?: string; box?: string; region?: string; hh?: string; period?: string; my?: string; trace?: string[] }) {
  await assertSpace(u, 'sales');
  const t = tenantOf(u); const sql = db();
  const [applied] = await sql<{ value: any }[]>`select value from app_settings where key = 'sales_migrate_applied'`;
  const { writesOpen } = await import('./cutover');
  const formal = await writesOpen(t);
  const cats = await listBizCats(t); // 대표 10/21 12:00 영업 재편 4): 회사 관심 사업(카테고리) — 공고 사업 배지·탭 근거
  // 대표 검수 10/20 ②: 앱 상세는 한국어 칸만, 원본 전체는 관리자만 접힘 안에 — 모든 화면 공통
  const terms = await (await import('./options')).salesTerms(t); // #408 업종 중립 문구 — 화면 용어는 회사 업종 템플릿
  const meta = { readOnly: !formal, syncedAt: applied?.value?.tenant === t ? applied.value.at : null, imported: applied?.value?.tenant === t, canAssign: ['owner', 'admin'].includes(u.role), terms };
  const leadRows = () => (formal ? formalLeads(t) : rows(t, 'leads'));
  // S1-2(로컬 10/20): 전환 뒤에는 회사별 진행 기록(입찰·신규단지·시설·협력사)을 정식 표 sales_work_records 에서 — 원본 행 모양으로 돌려줘 아래 읽기 코드는 그대로
  const { workRows } = await import('./work');
  const prog = (tbl: string, limit = 5000) => (formal ? workRows(sql, t, tbl) : rows(t, tbl, limit));
  const names = await userNames(t);
  const term = (q.q ?? '').trim().toLowerCase();
  const hit = (o: any) => !term || JSON.stringify(o).toLowerCase().includes(term);

  const bidsOn = await (await import('./options')).salesBidsOn(t); // 입찰·공고 선택 기능
  if (view === 'bids' && !bidsOn) throw notFound('입찰·공고를 쓰지 않는 회사입니다');
  // 대표 확정(10/19): 홈 '이번 주'·캘린더에 영업 주요 일정만 — 리드 다음 연락(미팅·방문·제안 등 다음 조치 이름), 작업 중인 입찰 마감. 공고 하나하나는 안 넣음
  if (view === 'agenda') {
    const ok = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''));
    const from = ok(q.from) ? q.from! : today(), to = ok(q.to) ? q.to! : plus(7);
    const raw = await leadRows();
    const items: { date: string; time: string | null; title: string; kind: string; owner: string | null; href: string }[] = [];
    // 대표 10/27 ④('입찰 마감이 업무·일정·영업에 세 번 뜸 — 하나만'): 끝나지 않은 업무가 이미 있는 리드·입찰은 주요 일정에 다시 넣지 않음(그 업무·입찰 일정이 캘린더에 보임)
    const busy = await sql<{ lead: string | null; bid: string | null }[]>`select lead_id::text as lead, case when sales_ref->>'kind' = 'bid' then sales_ref->>'id' end as bid from tasks
      where deleted_at is null and status <> 'done' and (lead_id is not null or sales_ref->>'kind' = 'bid') and created_by in (select id from users where tenant = ${t})`;
    const leadBusy = new Set(busy.map((b) => b.lead).filter(Boolean)), bidBusy = new Set(busy.map((b) => b.bid).filter(Boolean));
    for (const r of raw) {
      const l = lead(r, names);
      if (!l.next || l.next < from || l.next > to || CLOSED.has(String(l.status))) continue;
      if (r.__id && leadBusy.has(String(r.__id))) continue;
      const act = pick(r, 'next_action', 'next_step', 'next_action_type');
      const tm = String(pick(r, 'next_contact_at', 'next_action_at') ?? '').match(/[T ](\d{2}:\d{2})/)?.[1] ?? null;
      items.push({ date: l.next, time: tm, title: `${act ? String(act).slice(0, 20) : '연락'} · ${l.name}`, kind: 'lead', owner: l.owner ?? null, href: `/s/sales/leads?q=${encodeURIComponent(String(l.name))}` });
    }
    if (bidsOn) {
      // 196차: 전환 뒤 정식 진행 기록(prog) — 예전에는 원본 복사본만 읽어 워크인에서 넘긴 입찰이 빠졌음 · 결과(낙찰·유찰·취소)가 난 공고는 뺌
      const W = (await prog('opportunity_work')).filter((w) => !/완료|미참여|대상\s?아님|done|closed|낙찰|유찰|취소/i.test(String(pick(w, 'status') ?? '')))
        // 대표 10/27 ④: 입찰 업무로 넘긴 공고(업무·입찰 일정이 있음)·예전에 리드로 넘겨 그 리드에 열린 업무가 있는 공고·상태 단추로 업무가 생긴 공고는 빼고, 업무·일정이 없는 것만
        // (전환 전 원본 복사본의 lead_id 는 원본 리드라 워크인 업무가 없음 → 그대로 넣음)
        .filter((w) => !pick(w, 'bid_task_id') && !(w.bid_events && Object.keys(w.bid_events).length) && !leadBusy.has(String(pick(w, 'lead_id') ?? '')) && !bidBusy.has(String(pick(w, 'notice_id', 'procurement_notice_id') ?? '')));
      const ids = new Set(W.map((w) => String(pick(w, 'notice_id', 'procurement_notice_id') ?? '')));
      if (ids.size) for (const r of await noticeRows(ids, { related: false })) {
        if (!ids.has(String(r.id ?? r.__id))) continue;
        const n = notice(r, cats);
        if (!n.close || n.close < from || n.close > to) continue;
        items.push({ date: n.close, time: String(n.deadline ?? '').match(/[T ](\d{2}:\d{2})/)?.[1] ?? null, title: `입찰 마감 · ${String(n.complex ? `${n.complex} ` : '')}${n.title}`.slice(0, 80), kind: 'bid', owner: null, href: '/s/sales/hub?tab=bids&bt=working' });
      }
    }
    items.sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
    return { from, to, items: items.slice(0, 100) };
  }
  if (view === 'summary') {
    const L = (await leadRows()).map((r) => lead(r, names));
    const W = await prog('opportunity_work'); // S2-5: 전환 뒤에는 정식 진행 기록 표(원본 행 모양)
    const workOf = new Map(W.map((w) => [String(pick(w, 'notice_id', 'procurement_notice_id') ?? ''), pick(w, 'status')]));
    const NR0 = oneCardPerNotice((await noticeRows()).filter((r) => (r.related === true || r.related === 'true') && ((!vendorUnchecked(r) && !onbidSale(r)) || workOf.has(String(r.id ?? r.__id)))), workTime(W));
    const skips = skipLinks(NR0, (id) => workOf.get(id));
    const NR = NR0.filter((r) => !skips.hidden(r)); // 입찰 목록과 같은 기준(확인 안 된 협력사 줄·온비드 매각 빼기·같은 공고 한 장·대상 아님 빼기 — 137차 같은 사업 사전규격·본 공고 함께)
    const N = NR.map((r) => notice(r, cats));
    const live = L.filter((l) => !CLOSED.has(String(l.status))); // 종결(계약완료·보류·실패) 제외
    const due = live.filter((l) => l.next && l.next >= today() && l.next <= plus(7)).sort((a, b) => String(a.next).localeCompare(String(b.next)));
    const overdue = live.filter((l) => l.next && l.next < today()).sort((a, b) => String(b.next).localeCompare(String(a.next)));
    const cnt = L.reduce((m: Record<string, number>, l) => { const k = String(l.status ?? '미정'); m[k] = (m[k] ?? 0) + 1; return m; }, {});
    const statuses = [...STAGES.filter((k) => cnt[k]), ...Object.keys(cnt).filter((k) => !STAGES.includes(k))].map((k) => [k, cnt[k]]);
    // 로컬 10/19: 영업 공간을 처음 켠 회사(관리자) — 출처 고르기 안내(다짐·하이링크처럼 이미 켠 출처가 있으면 안 보임)
    const [st] = await sql<{ n: number; done: boolean }[]>`select (select count(*)::int from tenant_data_sources where tenant = ${t} and enabled) as n, exists (select 1 from sales_settings where tenant = ${t} and setup_done_at is not null) as done`;
    const setupNeeded = isAdmin(u) && !st.done && st.n === 0;
    // 대표 10/20 S2-5 홈 '오늘 할 일' 7묶음(영업관리 2-2): ① 입찰·신규단지 후속(next_date ≤ 오늘) ② 준공시설 연락 ③ 협력사 할 일 ④ 지난 영업 업무(자동 업무 포함) ⑤ 지금 영업 상위 5(작업 중 입찰 마감 임박순) ⑥ 리드 연락(지남·오늘) ⑦ 입찰 오늘·내일 마감(즉시 검토·검토중·연락중)
    const td = today(), tm = plus(1);
    const notDone = (st: unknown) => !/완료|미참여|대상아님|대상 아님|전환|done|closed/i.test(String(st ?? ''));
    const byNoticeId = new Map(NR.map((r) => [String(r.id ?? r.__id), notice(r, cats)]));
    const buildings = new Map((await rows('global', 'building_sales_pipeline', 20000)).map((r) => [String(r.id ?? r.__id), pick(r, 'name', 'complex_name', 'project_name', 'house_name') ?? '(이름 없음)']));
    const nextOf = (w: any) => day(pick(w, 'next_date', 'next_action_date'));
    const followUp = W.filter((w) => notDone(pick(w, 'status')) && nextOf(w) && nextOf(w)! <= td).map((w) => {
      const nid = String(pick(w, 'notice_id', 'procurement_notice_id') ?? ''); const bid = String(pick(w, 'source_id', 'building_id') ?? '');
      const n = byNoticeId.get(nid); const isBid = !!n && !(String(pick(w, 'source_type') ?? '') === 'building');
      return { id: isBid ? nid : bid, kind: isBid ? 'bid' : 'building', name: isBid ? `${n!.complex ? n!.complex + ' ' : ''}${n!.title}` : buildings.get(bid) ?? '(이름 없음)', status: pick(w, 'status'), next: nextOf(w), memo: pick(w, 'memo', 'note'), href: isBid ? '/s/sales/hub?tab=bids&bt=working' : '/s/sales/hub?tab=buildings' };
    }).sort((a, b) => String(a.next).localeCompare(String(b.next)));
    const FPall = await prog('operating_facility_prospects__progress', 20000);
    const FP = FPall.filter((p) => notDone(pick(p, 'contact_status', 'status')) && day(pick(p, 'next_action_date', 'next_date')) && day(pick(p, 'next_action_date', 'next_date'))! <= td);
    const facNames = FP.length ? new Map((await rows('global', 'operating_facility_prospects', 20000)).map((r) => [String(r.id ?? r.__id), pick(r, 'name', 'facility_name', 'complex_name') ?? '(이름 없음)'])) : new Map<string, string>();
    const facilities = FP.map((p) => ({ id: String(p.id ?? p.__id), kind: 'facility', name: facNames.get(String(p.id ?? p.__id)) ?? '(이름 없음)', status: pick(p, 'contact_status', 'status'), next: day(pick(p, 'next_action_date', 'next_date')), memo: pick(p, 'last_note', 'memo'), href: '/s/sales/hub?tab=facilities' })).sort((a, b) => String(a.next).localeCompare(String(b.next)));
    const VPall = await prog('vendor_registrations__progress', 20000);
    const VP = VPall.filter((p) => notDone(pick(p, 'status')) && day(pick(p, 'next_date')) && day(pick(p, 'next_date'))! <= td);
    const venNames = VP.length ? new Map((await rows('global', 'vendor_registrations', 20000)).map((r) => [String(r.id ?? r.__id), pick(r, 'company', 'company_name', 'name') ?? '(이름 없음)'])) : new Map<string, string>();
    const vendors = VP.map((p) => ({ id: String(p.id ?? p.__id), kind: 'vendor', name: venNames.get(String(p.id ?? p.__id)) ?? '(이름 없음)', status: pick(p, 'status'), next: day(pick(p, 'next_date')), memo: pick(p, 'memo'), href: '/s/sales/hub?tab=vendors' })).sort((a, b) => String(a.next).localeCompare(String(b.next)));
    // ④ 지난 영업 업무(space=sales, 자동 업무 포함) — 업무 공간과 같은 표(한쪽에서 완료하면 양쪽 반영)
    const pastTasks = await sql<{ id: string; title: string; due_date: string | null; status: string; assignee: string | null; sales_ref: any }[]>`select t.id, t.title, t.due_date::text, t.status, au.name as assignee, t.sales_ref from tasks t join users cu on cu.id = t.created_by left join users au on au.id = t.assignee_id
      where cu.tenant = ${t} and t.deleted_at is null and t.space = 'sales' and t.status <> 'done' and t.due_date is not null and t.due_date < ${td}::date order by t.due_date limit 30`;
    const nameOfNotice = (n: ReturnType<typeof notice>) => `${n.complex ? n.complex + ' ' : ''}${n.title}`;
    const nowSales = NR.filter((r) => { const w = workOf.get(String(r.id ?? r.__id)); return w && /검토중|연락중|즉시/.test(String(w)) && isOpenBid(notice(r), w, td); }).map((r) => notice(r, cats))
      .sort((a, b) => String(a.deadline ?? a.close ?? '9999').localeCompare(String(b.deadline ?? b.close ?? '9999'))).slice(0, 5)
      .map((n) => ({ id: n.id, kind: 'bid', name: nameOfNotice(n), status: workOf.get(String(n.id)) ?? null, next: n.close, memo: null, href: '/s/sales/hub?tab=bids&bt=working' }));
    const closingSoon = NR.map((r) => notice(r, cats)).filter((n) => { const w = workOf.get(String(n.id)); return (n.close === td || n.close === tm) && isOpenBid(n, w, td) && (!w || /미검토|검토중|연락중|즉시/.test(String(w))); })
      .sort((a, b) => String(a.deadline ?? '').localeCompare(String(b.deadline ?? '')))
      .map((n) => ({ id: n.id, kind: 'bid', name: nameOfNotice(n), status: n.close === td ? '오늘 마감' : '내일 마감', next: n.close, memo: String(n.deadline ?? '').match(/[T ](\d{2}:\d{2})/)?.[1] ?? null, href: '/s/sales/hub?tab=bids&bt=closing' }));
    const todo = { followUp, facilities, vendors, pastTasks, nowSales, leads: [...overdue, ...live.filter((l) => l.next === td)].map((l) => ({ id: l.id, kind: 'lead', name: l.name, status: l.status, next: l.next, memo: null, href: `/s/sales/leads?id=${encodeURIComponent(String(l.id))}` })), closingSoon };
    // S2-6 영업기회 요약 타일 6 + 목록별 진행 현황표(4행 × 상태)
    const endOf = (r: any) => day(pick(r, 'contract_end_date', 'contract_end', 'service_end_date', 'contract_expiry_date'));
    const tiles = { nowSales: W.filter((w) => notDone(pick(w, 'status')) && /검토중|연락중/.test(String(pick(w, 'status') ?? ''))).length, bidsOpen: NR.filter((r) => isOpenBid(notice(r), workOf.get(String(r.id ?? r.__id)), td)).length,
      contracts: NR.map(endOf).filter((e) => !!e && e >= td && e <= plus(365)).length, buildings: buildings.size, facilities: (await rows('global', 'operating_facility_prospects', 20000)).length, vendors: (await rows('global', 'vendor_registrations', 20000)).length };
    const tally = (arr: any[], key: (x: any) => unknown) => arr.reduce((m: Record<string, number>, x) => { const k = String(key(x) ?? '미검토'); m[k] = (m[k] ?? 0) + 1; return m; }, {} as Record<string, number>);
    const isBuildingWork = (w: any) => String(pick(w, 'source_type') ?? '') === 'building' || !!pick(w, 'building_id'); // 정식 표는 notice_id 에 ref_id 가 들어가므로 source_type 으로 구분
    const progress: [string, Record<string, number>][] = [['입찰', tally(W.filter((w: any) => !isBuildingWork(w)), (w) => pick(w, 'status'))], [terms.kind.building, tally(W.filter(isBuildingWork), (w) => pick(w, 'status'))],
      [terms.facilitiesTab, tally(FPall, (p) => pick(p, 'contact_status', 'status'))], [terms.kind.vendor, tally(VPall, (p) => pick(p, 'status'))]];
    // #450 홈 카드 '마감 임박 지원사업 n건'(7일 안: 관심·준비 중 + 맞춤)
    const support = await (await import('./support')).supportHomeCard(t, sql).catch(() => null);
    // #522 영업 DB 누락 점검 — 원천이 24시간 넘게 성공 없음·2회 연속 실패면 홈 맨 위 빨간 띠
    const collectorAlerts = bidsOn || isAdmin(u) ? await (await import('./collectors')).collectorAlerts().catch(() => []) : [];
    return { ...meta, bidsOn, setupNeeded, todo, tiles, progress, support, collectorAlerts, kpi: { leads: L.length, dueSoon: due.length, overdue: overdue.length, bidsWorking: W.filter((w) => !/완료|미참여|대상아님|done|closed/i.test(String(pick(w, 'status') ?? ''))).length,
      bidsOpen: NR.filter((r) => isOpenBid(notice(r), workOf.get(String(r.id ?? r.__id)), today())).length,
      relatedNotices: N.length, newNotices7d: N.filter((n) => n.noticeDate && n.noticeDate >= plus(-7) && n.noticeDate <= today()).length /* 로컬 10/19: 원본 초기 적재(10/13 3,343건) 때문에 first_seen 7일은 부풀려짐 → 공고일 기준 */ }, due: due.slice(0, 10), overdueList: overdue.slice(0, 10), statuses,
      // 대표(10/19): 첫 화면 맨 위 '오늘' — 새 공고·새 영업 DB(신규단지·시설·협력사)·오늘 연락할 리드·오늘 마감 입찰
      today: await (async () => { const td = today();
        const db3 = await Promise.all((['building_sales_pipeline', 'operating_facility_prospects', 'vendor_registrations'] as const).map(async (tb) => (await rows('global', tb, 20000)).filter((r) => firstSeen(r) === td).length));
        const since = await lastMailAt(t); // #476 b: 홈 '오늘 새 공고' 수 = 오늘 탭과 같은 기준
        return { date: td, newNotices: NR.filter((r, i) => !isAwardResult(r) && todayReason(N[i], r.first_seen_at, since, r.refound_at).hit && !bidEnded(N[i], td)).length /* 결과(낙찰·유찰)·끝난 공고는 새 공고가 아님 */, newDb: { buildings: db3[0], facilities: db3[1], vendors: db3[2] }, contact: live.filter((l) => l.next === td).length, closing: N.filter((n) => n.close === td).length }; })() };
  }
  // S2-6 계약만료·재입찰(영업관리 2-6): 타 업체 계약 종료일이 있는 공고 → 영업 시작(−12·−9개월)·제안(−6)·재입찰(−3) 역산, 단계 5, 요약 4(90/180/365일 내·지남)
  if (view === 'contracts') {
    const W = await prog('opportunity_work'); const td = today();
    const workOf = new Map(W.map((w) => [String(pick(w, 'notice_id', 'procurement_notice_id') ?? ''), pick(w, 'status')]));
    const endOf = (r: any) => day(pick(r, 'contract_end_date', 'contract_end', 'service_end_date', 'contract_expiry_date'));
    const shift = (d: string, months: number) => { const x = new Date(`${d}T12:00:00+09:00`); x.setUTCMonth(x.getUTCMonth() + months); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(x); };
    const rel = (await noticeRows()).filter((r) => r.related === true || r.related === 'true');
    const skips = skipLinks(rel, (id) => workOf.get(id)); // 137차: 대상 아님 + 같은 사업(사전규격 ↔ 본 공고)
    const timing = (end: string) => { const start = shift(end, -12), start2 = shift(end, -9), propose = shift(end, -6), rebid = shift(end, -3);
      return { start, start2, propose, rebid, stage: td < start ? '영업 전' : td < propose ? '영업 시작' : td < rebid ? '제안' : td <= end ? '재입찰' : '종료', daysLeft: Math.round((Date.parse(end) - Date.parse(td)) / 864e5) }; };
    const bidItems = rel.filter((r) => endOf(r) && !skips.hidden(r)).map((r) => { const n = notice(r); const end = endOf(r)!;
      return { id: n.id, kind: 'bid', name: `${n.complex ? n.complex + ' ' : ''}${n.title}`, agency: n.agency, region: n.region, winner: n.winner, amount: n.awardAmount ?? n.amount, end, ...timing(end), work: workOf.get(String(n.id)) ?? null, url: n.url, href: '/s/sales/hub?tab=bids&bt=all&bq=' + encodeURIComponent(String(n.title)) }; });
    // #605(대표 10/25 ①): 시설 보관함(대상 아님 = 이미 위탁 중)에서 적은 '현 위탁사·계약만료일'(회사 진행 기록) → 같은 역산으로 이 탭에
    const FP0 = await prog('operating_facility_prospects__progress', 20000); const FP = FP0.filter((p) => day(pick(p, 'contract_end_date')));
    // 212차 #612: 후속조사로 적은 계약만료일(회사 진행 기록에 없는 시설만 — 전환 전에는 진행 기록에 못 씀)
    const fpIds = new Set(FP.map((p) => String(p.id ?? p.__id)));
    const RS0 = await import('./research'); // #760 관리회사 ≠ 커뮤니티 운영사
    for (const [id, x] of await RS0.researchState(sql, t)) if (x.result.contractEnd && !fpIds.has(id)) {
      const p0 = FP0.find((p) => String(p.id ?? p.__id) === id); FP.push({ ...(p0 ?? {}), id, contract_end_date: x.result.contractEnd, current_operator: pick(p0, 'current_operator') ?? x.result.operator ?? null }); }
    const facRows = FP.length ? new Map((await rows('global', 'operating_facility_prospects', 20000)).map((r) => [String(r.id ?? r.__id), r])) : new Map<string, any>();
    const facItems = FP.flatMap((p) => { const id = String(p.id ?? p.__id); const r = facRows.get(id); if (!r) return []; const end = day(pick(p, 'contract_end_date'))!; const name = String(pick(r, 'name', 'facility_name', 'complex_name') ?? '(이름 없음)'); const st = pick(p, 'contact_status', 'status');
      return [{ id: `facility:${id}`, kind: 'facility', name, agency: null, region: pick(r, 'region'), winner: RS0.communityOperator(pick(p, 'current_operator') ?? pick(r, 'current_operator', 'operator'), pick(r, 'management_company')), amount: null, end, ...timing(end), work: st, url: null,
        href: `/s/sales/hub?tab=facilities${/^(대상\s?아님|영업완료)$/.test(String(st ?? '')) ? '&box=archive' : ''}&q=${encodeURIComponent(name)}` }]; });
    const items = [...bidItems, ...facItems].filter(hit).sort((a, b) => a.end.localeCompare(b.end));
    const within = (n: number) => items.filter((x) => x.daysLeft >= 0 && x.daysLeft <= n).length;
    return { ...meta, bidsOn, items: items.slice(0, 500), summary: { d90: within(90), d180: within(180), d365: within(365), past: items.filter((x) => x.daysLeft < 0).length }, stages: (['영업 전', '영업 시작', '제안', '재입찰', '종료'] as const).map((s) => [s, items.filter((x) => x.stage === s).length]) };
  }
  if (view === 'leads') {
    const L = (await leadRows()).map((r) => ({ ...lead(r, names), raw: r })).filter((l) => hit(l.raw) && (!q.status || String(l.status) === q.status) && (q.day !== 'today' || l.next === today()));
    // 영업관리 2-13 표 칸: 관심 사업(배지 2개 + n) — 원본 lead_business_interests
    const I = new Map<string, string[]>();
    for (const x of await rows(t, 'lead_business_interests', 20000)) { const k = String(pick(x, 'lead_id') ?? ''); const n = pick(x, 'category_name', 'business_category', 'category', 'name'); if (k && n) I.set(k, [...(I.get(k) ?? []), String(n)]); }
    // 대표 요청(영업관리 거래처 장): 표 안에서 단계·우선·다음 연락·거래처명·담당(관리자) 바로 고치기 — 전환 뒤(쓰기 열림)만
    const canAssign = ['owner', 'admin'].includes(u.role);
    const people = !meta.readOnly && canAssign ? await sql`select id, name from users where tenant = ${t} and status = 'active' and not is_demo order by name` : [];
    // #610 ⓒ·#614(대표 10/25): 보류·실패·되돌림 리드는 화면 기본 목록에서 빠져 '보류·실패' 보관함 — 마지막 단계 기록(사유·누가·언제·이전 단계)으로 [되돌리기]
    const logs = formal ? new Map((await sql<{ lead_id: string; from_status: string | null; to_status: string; reason: string | null; changed_at: Date; by: string | null }[]>`select distinct on (g.lead_id) g.lead_id, g.from_status, g.to_status, g.reason, g.changed_at, u.name as by
      from sales_status_log g join sales_leads l on l.id = g.lead_id left join users u on u.id = g.changed_by where l.tenant = ${t} and l.deleted_at is null and l.status in ('보류', '실패', '되돌림') order by g.lead_id, g.changed_at desc`).map((g) => [g.lead_id, g])) : new Map();
    const archiveOf = (l: { id: unknown; status: unknown }) => { if (!ARCHIVED_STAGES.has(String(l.status))) return null; const g = logs.get(String(l.id)); const same = g?.to_status === String(l.status);
      return { reason: same ? g!.reason ?? null : null, by: same ? g!.by ?? null : null, at: same && g!.changed_at ? new Date(g!.changed_at).toISOString() : null, prev: same && g!.from_status && !ARCHIVED_STAGES.has(g!.from_status) ? g!.from_status : null }; };
    // 197차(#461): 목록 칸(단계 머문 날·다음 할 일·마지막 접촉·출처·종결일·다시 볼 날) + 내 저장된 보기·열(기기 간 유지)
    const { leadExtras, getLeadViews } = await import('./leadList');
    const X = formal ? await leadExtras(sql, t, terms) : new Map();
    const myViews = await getLeadViews(sql, u.id);
    return { ...meta, stages: STAGES, canAssign, people, me: u.id, myViews, leads: L.map(({ raw, ...l }) => ({ ...l, interests: I.get(String(raw.__src_id ?? raw.id ?? l.id)) ?? [], archive: archiveOf(l), ...(X.get(String(l.id)) ?? {}) })).sort((a, b) => String(b.updated).localeCompare(String(a.updated))) };
  }
  if (view === 'lead') {
    if (!q.id) throw badRequest('id 가 필요합니다');
    if (formal) {
      if (!/^[0-9a-f-]{36}$/i.test(q.id)) throw notFound();
      const [r] = await formalLeads(t, q.id);
      if (!r) { // 206차: 합쳐서 빠진 거래처(예전 링크) → 남긴 거래처로
        const [m] = await sql<{ merged_into: string }[]>`select merged_into from sales_leads where id = ${q.id} and tenant = ${t} and deleted_at is not null and merged_into is not null`;
        if (m) return { ...meta, mergedInto: m.merged_into };
        throw notFound();
      }
      const srcId = r.__src_id as string | null;
      const lid = q.id;
      const mergedSrc = (await sql<{ src_id: string }[]>`select src_id from sales_leads where tenant = ${t} and merged_into = ${lid} and src_id is not null`).map((x) => x.src_id); // 합친 거래처의 옛 영업관리 원본 업무도
      const recs = async (kind: string) => (await sql<any[]>`select id, data, occurred_at from sales_lead_records where tenant = ${t} and lead_id = ${lid} and kind = ${kind} order by occurred_at desc nulls last`).map((x) => ({ ...x.data, __id: x.id }));
      const srcIds = new Set([srcId, ...mergedSrc].filter(Boolean).map(String));
      const relSrc = async (tbl: string) => (srcIds.size ? (await rows(t, tbl)).filter((x) => srcIds.has(String(pick(x, 'lead_id')))) : []);
      const log = await sql`select g.from_status, g.to_status, g.reason, g.changed_at, u.name as by from sales_status_log g left join users u on u.id = g.changed_by where g.lead_id = ${lid} order by g.changed_at desc limit 50`;
      const people = await sql`select id, name from users where tenant = ${t} and status = 'active' and not is_demo order by name`;
      const { src: _s, ...raw } = r;
      // S2 2차: 업무 탭 = 워크인 업무(lead_id) + 옮겨 온 원본 업무, 타임라인 = 상담·상태 변경·업무·제안·계약 통합(최신순)
      const wTasks = await sql<any[]>`select t.id, t.title, t.status, t.due_date::text as due_date, t.created_at, t.completed_at, au.name as assignee, t.sales_ref from tasks t left join users au on au.id = t.assignee_id where t.lead_id = ${lid} and t.deleted_at is null order by (t.status = 'done'), t.due_date nulls last limit 100`;
      const acts = await recs('sales_activities'), props = await recs('proposals'), cons = await recs('contracts');
      // 197차(#460): 리드 업무의 댓글·첨부도 거래처 타임라인에(업무에서 진행한 기록을 따로 옮겨 적지 않게)
      const tids = wTasks.map((x: any) => x.id);
      const tcom = tids.length ? await sql<any[]>`select c.id, c.task_id, c.body, c.created_at, au.name as by, t.title from comments c join tasks t on t.id = c.task_id left join users au on au.id = c.author_id
        where c.task_id = any(${tids}::uuid[]) and c.deleted_at is null order by c.created_at desc limit 100` : [];
      const tfile = tids.length ? await sql<any[]>`select f.id, f.task_id, coalesce(f.file_name, f.doc_title, f.url) as name, f.created_at, au.name as by, t.title from attachments f join tasks t on t.id = f.task_id left join users au on au.id = f.created_by
        where f.task_id = any(${tids}::uuid[]) and f.deleted_at is null and f.upload_status = 'ready' order by f.created_at desc limit 100` : [];
      // 영업 재편 5): 리드 일정(넘기기 자동 일정·리드에서 만든 일정) — 다가오는 것 먼저
      const events = await sql<any[]>`select e.id, e.title, e.start_at, e.end_at, e.all_day, c.name as calendar from events e join calendars c on c.id = e.calendar_id where e.lead_id = ${lid} and e.deleted_at is null order by e.start_at desc limit 50`;
      const timeline = [...acts.map((a: any) => ({ kind: 'act', at: a.activity_date ?? a.created_at, title: `${a.activity_type ?? '상담'} · ${String(a.content ?? '').slice(0, 80)}`, by: a.created_by_name ?? null, id: a.__id })),
        ...log.map((g: any) => ({ kind: 'status', at: g.changed_at, title: `${g.from_status ? stageName(terms.stages, g.from_status) : '—'} → ${stageName(terms.stages, g.to_status)}${g.reason ? ` (${g.reason})` : ''}` /* 207차: 회사 단계 이름 */, by: g.by ?? null, id: String(g.changed_at) })),
        ...wTasks.map((x: any) => ({ kind: 'task', at: x.completed_at ?? x.created_at, title: `${x.status === 'done' ? '완료' : '업무'} · ${x.title}`, by: x.assignee ?? null, id: x.id, href: `/tasks/${x.id}` })),
        ...props.map((p: any) => ({ kind: 'proposal', at: p.proposal_date, title: `제안 · ${p.title}${p.amount ? ` ${Number(p.amount).toLocaleString('ko-KR')}원` : ''}`, by: null, id: p.__id })),
        ...cons.map((c: any) => ({ kind: 'contract', at: c.contract_date ?? c.start_date, title: `계약 · ${c.title}${c.amount ? ` ${Number(c.amount).toLocaleString('ko-KR')}원` : ''}`, by: null, id: c.__id })),
        ...events.map((e: any) => ({ kind: 'event', at: e.start_at, title: `일정 · ${e.title}`, by: null, id: e.id, href: `/calendar?event=${e.id}` })),
        ...tcom.map((c: any) => ({ kind: 'comment', at: c.created_at, title: `댓글 · ${String(c.body).replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/gi, '@$1').slice(0, 120)}`, by: c.by ?? null, id: c.id, href: `/tasks/${c.task_id}`, task: c.title })),
        ...tfile.map((f: any) => ({ kind: 'file', at: f.created_at, title: `첨부 · ${String(f.name ?? '파일').slice(0, 80)}`, by: f.by ?? null, id: f.id, href: `/tasks/${f.task_id}`, task: f.title }))]
        .filter((x) => x.at).map((x) => ({ ...x, at: x.at instanceof Date ? x.at.toISOString() : String(x.at) })) // #148: Date 는 ISO 로(String(Date) 는 'Tue Oct…' 라 정렬이 틀림)
        .sort((a, b) => String(b.at).localeCompare(String(a.at)));
      return { ...meta, lead: lead(r, names), raw: Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('__'))), activities: acts, timing: await recs('lead_opportunity_timing'),
        interests: await recs('lead_business_interests'), tasks: await relSrc('tasks'), wTasks, timeline, proposals: props, contracts: cons,
        work: (await sql<any[]>`select src_id, src_tbl, status, data from sales_work_records where tenant = ${t} and lead_id = ${lid} order by updated_at desc`).map((w) => ({ ...w.data, status: w.status, __id: w.src_id })), // S1-2: 넘겨 온 공고·단지·시설·협력사
        events,
        statusLog: log, stages: STAGES, people, canAssign: ['owner', 'admin'].includes(u.role), canDelete: ['owner', 'admin'].includes(u.role) || r.__owner_id === u.id, me: u.id };
    }
    const [r] = await sql<{ row: any }[]>`select row from sales_src_rows where scope = ${t} and tbl = 'leads' and src_id = ${q.id}`;
    if (!r) throw notFound();
    const rel = async (tbl: string) => (await rows(t, tbl)).filter((x) => String(pick(x, 'lead_id')) === q.id);
    return { ...meta, lead: lead({ ...r.row, __id: q.id }, names), raw: r.row, activities: await rel('sales_activities'), timing: await rel('lead_opportunity_timing'), interests: await rel('lead_business_interests'),
      tasks: await rel('tasks'), proposals: await rel('proposals'), contracts: await rel('contracts'), work: await rel('opportunity_work') };
  }
  if (view === 'pipeline') {
    const L = (await leadRows()).map((r) => lead(r, names));
    const cols = new Map<string, typeof L>();
    for (const l of L) { const k = String(l.status ?? '미정'); cols.set(k, [...(cols.get(k) ?? []), l]); }
    const order = [...STAGES, ...[...cols.keys()].filter((k) => !STAGES.includes(k))];
    // 영업 재편 5) 파이프라인 메뉴에서 흡수한 전환율: 단계마다 '지금 n' + '거쳐 간 n'(상태 기록 + 현재 단계), 비율 = 거쳐 간 수 / 전체 리드. 계약 전환율 = 계약완료 거쳐 간 수 / 전체
    const reached = new Map<string, Set<string>>(); const add = (st: string, id: string) => { if (!reached.has(st)) reached.set(st, new Set()); reached.get(st)!.add(id); };
    for (const l of L) if (l.status) add(String(l.status), String(l.id));
    if (formal) for (const g of await sql<{ lead_id: string; to_status: string }[]>`select g.lead_id, g.to_status from sales_status_log g join sales_leads l on l.id = g.lead_id where l.tenant = ${t} and l.deleted_at is null`) add(g.to_status, g.lead_id);
    const total = L.length;
    const funnel = STAGES.filter((st) => !['보류', '실패', '되돌림'].includes(st)).map((st) => { const n = reached.get(st)?.size ?? 0; return { status: st, now: cols.get(st)?.length ?? 0, reached: n, pct: total ? Math.round((n / total) * 100) : 0 }; });
    const won = reached.get('계약완료')?.size ?? 0; const lost = (reached.get('실패')?.size ?? 0);
    return { ...meta, stages: STAGES, columns: order.map((status) => ({ status, items: cols.get(status) ?? [] })), funnel: { total, won, lost, conversion: total ? Math.round((won / total) * 1000) / 10 : null, stages: funnel } };
  }
  if (view === 'deals') {
    // S1-2: 전환 뒤에는 정식 표(sales_lead_records)에서 — 리드 이름·연결 id 포함
    const fr = async (kind: string) => (await sql<any[]>`select r.id, r.lead_id, r.occurred_at, r.data, l.name as lead_name from sales_lead_records r left join sales_leads l on l.id = r.lead_id where r.tenant = ${t} and r.kind = ${kind} order by r.occurred_at desc nulls last limit 500`)
      .map((x) => ({ ...x.data, lead_name: x.data?.lead_name ?? x.lead_name ?? null, __id: x.id, __lead_id: x.lead_id }));
    const leads = formal ? (await sql<{ id: string; name: string }[]>`select id, name from sales_leads where tenant = ${t} and deleted_at is null order by name limit 2000`) : [];
    const proposals = (formal ? await fr('proposals') : await rows(t, 'proposals')).filter(hit), contracts = (formal ? await fr('contracts') : await rows(t, 'contracts')).filter(hit);
    // S2 2차(감사 1-16): 계약 KPI(90/180/365일 내 종료·기간 경과) + ROI(기간 3/6/12개월: 계약금액·영업비용·ROI·전환율·출처별)
    const td = today(); const endOf = (c: any) => day(pick(c, 'end_date', 'contract_end_date', 'contract_end'));
    const within = (n: number) => contracts.filter((c) => { const e = endOf(c); return e && e >= td && e <= plus(n); }).length;
    const kpi = { d90: within(90), d180: within(180), d365: within(365), past: contracts.filter((c) => { const e = endOf(c); return e && e < td; }).length };
    const months = [3, 6, 12].includes(Number(q.status)) ? Number(q.status) : 6; // ?status=3|6|12 (기간)
    const from = plus(-30 * months);
    const costs = formal ? await fr('sales_costs') : [];
    const inPeriod = (d: unknown) => { const x = day(d); return !!x && x >= from && x <= td; };
    const cAmt = contracts.filter((c) => inPeriod(pick(c, 'contract_date', 'start_date'))).reduce((n, c) => n + (Number(pick(c, 'amount')) || 0), 0);
    const cost = costs.filter((c) => inPeriod(`${pick(c, 'month')}-01`)).reduce((n, c) => n + (Number(pick(c, 'amount')) || 0), 0);
    const newLeads = formal ? Number((await sql<{ n: number }[]>`select count(*)::int n from sales_leads where tenant = ${t} and deleted_at is null and created_at >= ${from}::date`)[0].n) : 0;
    const wonLeads = new Set(contracts.filter((c) => inPeriod(pick(c, 'contract_date', 'start_date'))).map((c) => c.__lead_id ?? c.lead_id).filter(Boolean)).size;
    // 출처별 전환(운영시설 DB/입찰 DB/신규단지/협력사/직접): 리드가 어느 원천에서 넘어왔는지(sales_work_records.lead_id)
    const srcOf = formal ? new Map((await sql<{ lead_id: string; src_tbl: string }[]>`select lead_id, src_tbl from sales_work_records where tenant = ${t} and lead_id is not null`).map((x) => [x.lead_id, x.src_tbl])) : new Map();
    const SRC_KO: Record<string, string> = { opportunity_work: `입찰·${terms.kind.building} DB`, operating_facility_prospects__progress: `${terms.kind.facility} DB`, vendor_registrations__progress: `${terms.kind.vendor} DB` };
    const bySource: Record<string, { leads: number; won: number }> = {};
    if (formal) for (const l of await sql<{ id: string }[]>`select id from sales_leads where tenant = ${t} and deleted_at is null`) { const k = SRC_KO[srcOf.get(l.id) ?? ''] ?? '직접'; (bySource[k] ??= { leads: 0, won: 0 }).leads++; }
    for (const c of contracts) { const lid = c.__lead_id ?? c.lead_id; if (!lid) continue; const k = SRC_KO[srcOf.get(lid) ?? ''] ?? '직접'; (bySource[k] ??= { leads: 0, won: 0 }).won++; }
    const roi = { months, from, contractAmount: cAmt, cost, roi: cost ? Math.round(((cAmt - cost) / cost) * 1000) / 10 : null, newLeads, wonLeads, conversion: newLeads ? Math.round((wonLeads / newLeads) * 1000) / 10 : null, bySource, costs: costs.sort((a, b) => String(b.month).localeCompare(String(a.month))) };
    return { ...meta, proposals, contracts, leads, kpi, roi };
  }
  if (view === 'bids') {
    const tab = q.tab ?? 'open'; // 기본 = 진행 중(마감 전·공고중/정정), 마감 임박순
    const W = await prog('opportunity_work');
    const P = new Map((await prog('procurement_notices__progress', 20000)).map((p) => [String(p.id ?? p.__id), p]));
    const byNotice = new Map(W.map((w) => [String(pick(w, 'notice_id', 'procurement_notice_id') ?? ''), w]));
    // #510: 메일 '참고(검색어만 일치)' [보기] = 마지막 다이제스트의 참고 줄(관련 사업은 아니고 관심 검색어만 맞은 공고)
    const refIds = tab === 'ref' ? new Set(((await db()<{ items: any }[]>`select items from sales_digests where tenant = ${t} order by day desc limit 1`)[0]?.items ?? []).filter((i: any) => i?.section === 'ref').map((i: any) => String(i.id))) : null;
    // 확인 안 된 협력사 줄(메뉴·안내문 조각·예전 방식)·온비드 매각 빼기 · 대표 10/24 추가 ②: 같은 공고(취소·정정 공고·재게시·완전 중복)는 카드 한 장(noticeGroups)
    const read = refIds ? await noticeRows([...refIds].map(String), { related: false }) : await noticeRows(byNotice.keys());
    const cand = read.filter((r) => refIds ? refIds.has(String(r.id ?? r.__id)) : byNotice.has(String(r.id ?? r.__id)) || ((r.related === true || r.related === 'true') && !vendorUnchecked(r) && !onbidSale(r)));
    const N = oneCardPerNotice(cand, workTime(W, P));
    // 137차: 대상 아님 = 자기 진행 기록 + 같은 사업(사전규격 ↔ 본 공고)으로 함께 숨김 — [대상 아님] 탭은 한 장(함께 숨긴 카드는 linked)
    const skips = skipLinks(N, (id) => pick(byNotice.get(id), 'status'));
    const folded = (r: any) => skips.under.has(String(r.id ?? r.__id));
    const since = await lastMailAt(t);
    // [대상 아님] 탭: 누가·언제·사유(진행 기록) — 사유 칸이 생기기 전에 넘긴 것은 마지막으로 고친 사람·시각
    const who = tab === 'skip' ? new Map((await sql<{ id: string; name: string }[]>`select id, name from users where tenant = ${t}`).map((x) => [x.id, x.name])) : null;
    const td = today();
    // #751: 취소된 공고 ↔ 같은 원천·같은 제목(취소·긴급·재공고 표시 뺌)·같은 기관으로 그 뒤에 올라온 공고(재공고) — 서로 잇는 한 줄
    const relink = renoticeLinks(cand);
    const all = N.map((r) => { const id = String(r.id ?? r.__id); const w = byNotice.get(id); const p = P.get(id); const n0 = notice(r, cats); const why = todayReason(n0, r.first_seen_at, since, r.refound_at); const skipped = skips.hidden(r);
      // 234차: 처음 본 날이 오늘이어도 결과를 안 때(result_at)가 지난 메일 전이면(오래된 결과를 이제야 모은 것) 오늘 결과 묶음에 넣지 않음 — 당일 메일과 같은 기준
      const oldResult = isAwardResult(r) && since != null && Date.parse(String(r.result_at ?? '')) < since;
      return { ...n0, todayHit: why.hit && !oldResult, todayLabel: why.label, result: isAwardResult(r), work: w ? pick(w, 'status') : null,
        // #752: 면허 업체 협력이 필요한 공사 공고는 규칙이 붙인 '즉시 검토'를 검토(중장기)로 — 회사가 직접 바꾼 분류는 그대로
        classification: p?.classification ?? (n0.partner && pick(r, 'classification') === '즉시 검토' ? '중장기 영업리드' : pick(r, 'classification')), judgment: p?.representative_judgment ?? pick(r, 'representative_judgment'),
        // 대표 검수 10/20 ②: 입찰 상세(메모·다음 조치·원본) · #610 넘기기로 만든 리드면 카드에 [되돌리기]
        workMemo: w ? pick(w, 'memo', 'note') : null, workNext: w ? day(pick(w, 'next_action_date', 'next_date', 'due_date')) : null, workLeadId: w?.lead_id ?? null, workHandoff: !!(w?.lead_id && pick(w, 'handoff_by')), raw: r.__orig ?? r,
        // 결정 15-35: 입찰 업무로 넘긴 공고 — 업무 열기·기한·결과·[되돌리기]
        workBid: w && pick(w, 'bid_task_id') ? { taskId: String(pick(w, 'bid_task_id')), due: pick(w, 'bid_due_auto'), dueTime: pick(w, 'bid_due_time'), result: pick(w, 'bid_result'), winner: pick(w, 'bid_winner'), amount: pick(w, 'bid_amount'), auto: !!pick(w, 'bid_result_auto'), contractTaskId: pick(w, 'bid_contract_task_id'), assignees: Array.isArray(w.assignees) ? w.assignees.length : 0 } : null,
        history: r.__history ?? null, ...relink(r), skipped, skip: who && skipped && !folded(r) ? { by: who.get(String(pick(w, 'skip_by', 'updated_by') ?? '')) ?? null, at: pick(w, 'skip_at', '__updated_at', 'updated_at'), reason: pick(w, 'skip_reason') } : null,
        linked: tab === 'skip' && skipped && !folded(r) ? skips.linked(r).map((x) => { const m = notice(x); return { id: m.id, title: m.title, sourceLabel: m.sourceLabel, noticeDate: m.noticeDate, close: m.close, own: skips.own(x) }; }) : undefined }; });
    // 탭 조건 — #613 '오늘 새 공고 n' 칩 건수도 같은 조건. soon(마감 임박)·prep(준비 기간) 탭은 칩에서 뺐지만(#608) 메일·홈 링크는 그대로 동작
    const inTab = (n: (typeof all)[number], tb: string) => (tb === 'skip' ? n.skipped && !!n.skip : !n.skipped) && (tb !== 'working' || !!n.work) && (tb !== 'open' || isOpenBid({ ...n, related: true }, n.work, td))
      && (tb !== 'today' || (n.todayHit && (n.result || !bidEnded(n, td)))) /* #537 후속2: 마감 지남·취소는 오늘 새 공고에서 뺌(결과는 아래 묶음) */ && (tb !== 'closing' || n.close === td) && (tb !== 'recruit' || n.vendorRecruit)
      && (tb !== 'soon' || (((!!n.close && n.close >= td && n.close <= plus(3)) || briefSoon(n, td)) && isOpenBid({ ...n, related: true }, n.work, td))) // #537 마감 임박 = 오늘~3일 안 마감, 아직 진행 중 · 239차 필수 현장설명 3일 안
      && (tb !== 'prep' || (!!n.close && n.close >= td && n.close <= plus(10) && isOpenBid({ ...n, related: true }, n.work, td))); // 대표 10/24 추가 ③ 준비 기간 = 오늘~10일 안 마감, 아직 진행 중
    // 191차(로컬 10/27): 플랫폼 조회 — 이 줄이 이 회사 입찰 목록(전체 탭)에 들어가는지, 빠지면 어느 단계에서(목록과 같은 계산)
    if (q.trace?.length) {
      const key = (r: any) => String(r.id ?? r.__id);
      const readIds = new Set(read.map(key)), candIds = new Set(cand.map(key)), cardIds = new Set(N.map(key));
      const repOf = new Map<string, string>();
      for (const g of groupNotices(cand)) { const rep = g.find((r) => cardIds.has(key(r))); for (const r of g) repOf.set(key(r), rep ? key(rep) : key(r)); }
      const shown = new Set(all.filter((n) => inTab(n, 'all')).map((n) => String(n.id)));
      return { trace: q.trace.map((id) => {
        if (!readIds.has(id)) return { id, listed: false, step: 'read', why: '목록 읽기에서 빠짐 — 관련 아님이고 이 회사 진행 기록이 없음(또는 사라짐·3년 창 밖)' };
        if (!candIds.has(id)) return { id, listed: false, step: 'filter', why: '확인 안 된 협력사 모집 줄 또는 온비드 매각 공고' };
        const card = repOf.get(id) ?? id;
        if (!shown.has(card)) return { id, listed: false, step: 'skip', card, why: card !== id ? `같은 공고 묶음(카드 ${card})이 이 회사 [대상 아님]` : '이 회사 [대상 아님](같은 사업 사전규격·본 공고 함께 숨김 포함)' };
        return { id, listed: true, step: 'listed', card, why: card !== id ? `같은 공고 묶음 카드(${card})로 보임` : '목록에 보임' };
      }) };
    }
    // #606 정렬(?sort=): 마감 D-day(deadline) · 공고일(notice) · 예산(amount) — 없으면 탭 기본(진행 중·마감순, 대상 아님·넘긴 순, 그 밖·DB 등록 최신순)
    const sortKey = ['deadline', 'notice', 'amount'].includes(String(q.sort ?? '')) ? String(q.sort) : null;
    const cmp = (a: (typeof all)[number], b: (typeof all)[number]) => sortKey === 'deadline' ? String(a.deadline ?? a.close ?? '9999').localeCompare(String(b.deadline ?? b.close ?? '9999'))
      : sortKey === 'notice' ? String(b.noticeDate ?? b.posted ?? '').localeCompare(String(a.noticeDate ?? a.posted ?? ''))
        : sortKey === 'amount' ? (Number(b.amount) || 0) - (Number(a.amount) || 0)
          : tab === 'open' || tab === 'soon' || tab === 'prep' ? String(a.deadline ?? '9999').localeCompare(String(b.deadline ?? '9999')) : tab === 'skip' ? String(b.skip?.at ?? '').localeCompare(String(a.skip?.at ?? '')) : String(b.posted).localeCompare(String(a.posted));
    const items = all.filter((n) => inTab(n, tab) && hit(n) && (!q.biz || (q.biz === 'none' ? !n.businesses.length : n.businesses.some((b) => b.key === q.biz)))).sort(cmp).slice(0, 300);
    // 로컬 10/24 12:20(#537 후속): 오늘 새 공고에서 결과(낙찰·유찰)는 빼고 아래 '결과' 묶음으로 — 당일 메일 결과 구역과 같은 기준(isAwardResult)
    const results = tab === 'today' ? items.filter((n) => n.result) : [];
    const skipCount = N.filter((r) => skips.own(r) && !folded(r)).length; // [대상 아님] 탭 장 수(같은 사업은 한 장)
    const todayCount = all.filter((n) => inTab(n, 'today') && !n.result).length; // #613 '오늘 새 공고 n' 칩(검색어와 무관)
    return { ...meta, tab, sort: sortKey, total: N.filter((r) => !skips.hidden(r)).length, skipCount, todayCount, items: tab === 'today' ? items.filter((n) => !n.result) : items, results, biz: q.biz ?? null, categories: cats.map((c) => ({ key: c.key, name: c.name, color: c.color })) };
  }
  if (view === 'hub') {
    const tab = q.tab ?? 'buildings'; const td = today();
    const dayOk = (r: any) => q.day !== 'today' || firstSeen(r) === td; // 오늘 새 영업 DB
    // #605(대표 10/25): '대상 아님'·완료(영업완료·등록 완료)로 넘긴 건은 기본 목록에서 빠지고 보관함(?box=archive)에 누가·언제·사유 + [되돌리기]
    const box = q.box === 'archive' ? 'archive' : 'open';
    // #459(대표 10/23): 상태 필터 칩(?status=) — 회사 진행 상태 글자로 묶음. 기본 목록은 미검토·검토중·연락중·신청·보류(·완료·전환), 보관함은 대상 아님·완료. 묶음별 건수도 돌려줌
    const STATUS_GROUPS: [string, string, RegExp | null][] = [['unreviewed', '미검토', null], ['review', '검토중', /검토/], ['contact', '연락중', /연락\s?중/], ['apply', '신청', /신청/], ['hold', '보류', /보류/], ['skip', '대상 아님', /대상\s?아님|미참여/], ['done', '완료·전환', /완료|전환/]];
    const stKey = STATUS_GROUPS.some(([k]) => k === q.status) ? String(q.status) : '';
    const stMatch = (k: string, st: unknown) => { const v = String(st ?? '').trim(); const re = STATUS_GROUPS.find(([x]) => x === k)?.[2]; return re ? re.test(v) : !v || /미검토|미연락|미등록/.test(v); };
    const done = (st: unknown) => /^(대상\s?아님|영업완료|등록 완료)$/.test(String(st ?? '').trim());
    const who = box === 'archive' ? new Map((await sql<{ id: string; name: string }[]>`select id, name from users where tenant = ${t}`).map((x) => [x.id, x.name])) : null;
    const archiveOf = (p: any) => (who && p && done(pick(p, 'status', 'contact_status')) ? { status: pick(p, 'status', 'contact_status'), by: who.get(String(pick(p, 'skip_by', 'updated_by') ?? '')) ?? null, at: pick(p, 'skip_at', '__updated_at', 'updated_at'), reason: pick(p, 'skip_reason'), prev: pick(p, 'skip_prev') } : null);
    // #606 정렬(?sort=)·필터(?region= 지역·주소 포함, ?hh= 세대수 이상, ?period= 오늘 앞뒤 n개월 — 준공·입주·DB 등록 기준)
    const sortKey = String(q.sort ?? '') || null; const region = String(q.region ?? '').trim(); const hh = Number(q.hh) > 0 ? Number(q.hh) : 0; const months = [1, 3, 6].includes(Number(q.period)) ? Number(q.period) : 0;
    const lo = months ? shiftMonths(td, -months) : null, hi = months ? shiftMonths(td, months) : null;
    const inPeriod = (...dates: (string | null | undefined)[]) => !months || dates.some((d) => !!d && d >= lo! && d <= hi!);
    // 242차 #759: 입주(없으면 준공·사용승인) 연도·달(?my=YYYY|YYYY-MM) — 영업기회 '2026년 입주' 목록에 K-apt 준공·입주 단지를 함께
    const my = /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(String(q.my ?? '')) ? String(q.my) : '';
    const myOk = (d: string | null | undefined) => !my || (!!d && d.startsWith(my));
    const regionOk = (x: { region?: unknown; address?: unknown }) => !region || String(x.region ?? '').includes(region) || String(x.address ?? '').includes(region);
    const hhOk = (x: { households?: unknown }) => !hh || Number(x.households) >= hh;
    const asc = (a: unknown, b: unknown) => String(a ?? '9999-99').localeCompare(String(b ?? '9999-99')); const desc = (a: unknown, b: unknown) => String(b ?? '').localeCompare(String(a ?? '')); const numDesc = (a: unknown, b: unknown) => (Number(b) || 0) - (Number(a) || 0);
    const tabs = await hubTabsOn(t, bidsOn);
    const pack = <T extends { region?: unknown }>(list: T[], isDone: (x: T) => boolean, keep: (x: T) => boolean, sorter: ((a: T, b: T) => number) | null, stOf: (x: T) => unknown) => {
      const regions = [...new Set(list.map((x) => String(x.region ?? '').trim()).filter((x) => x && x.length <= 8))].sort((a, b) => a.localeCompare(b, 'ko'));
      const archived = list.filter(isDone); const base = (box === 'archive' ? archived : list.filter((x) => !isDone(x))).filter(keep);
      const statusCounts = Object.fromEntries(STATUS_GROUPS.map(([k]) => [k, base.filter((x) => stMatch(k, stOf(x))).length])); // #459 칩 건수(상태 필터 전)
      const out = stKey ? base.filter((x) => stMatch(stKey, stOf(x))) : base;
      return { ...meta, tab, box, tabs, sort: sortKey, status: stKey || null, statusGroups: STATUS_GROUPS.map(([k, l]) => [k, l]), statusCounts, filters: { region: region || null, hh: hh || null, period: months || null, my: my || null }, regions, archiveCount: archived.length, total: out.length, items: (sorter ? [...out].sort(sorter) : out).slice(0, 300) };
    };
    // S1-2: 신규단지 진행(opportunity_work · source_id = 단지 id)
    const BW = new Map((await prog('opportunity_work')).filter((w) => String(pick(w, 'source_type') ?? '') === 'building' || pick(w, 'building_id')).map((w) => [String(pick(w, 'source_id', 'building_id') ?? ''), w]));
    if (tab === 'buildings') {
      const list = (await rows('global', 'building_sales_pipeline')).filter((r) => hit(r) && dayOk(r)).map((r) => { const w = BW.get(String(r.id ?? r.__id));
        return { id: r.__id, name: pick(r, 'name', 'complex_name', 'project_name', 'house_name') ?? '(이름 없음)',
          work: w ? { status: pick(w, 'status'), memo: pick(w, 'memo', 'note'), next: day(pick(w, 'next_date', 'next_action_date')), leadId: w?.lead_id ?? null, handoff: !!(w?.lead_id && pick(w, 'handoff_by')) } : null, archive: archiveOf(w),
          // S1-3: 원본 칸 current_stage·sales_priority·household_count·source_url·attachment_urls 먼저
          address: pick(r, 'address', 'location'), households: pick(r, 'household_count', 'households', 'total_households', 'units'), start: day(pick(r, 'sales_start_date', 'start_date', 'notice_date')), status: pick(r, 'current_stage', 'status', 'stage'),
          url: pick(r, 'source_url', 'url', 'detail_url'), attachments: attachmentsOf(r), estimated: pick(r, 'is_estimated', 'date_estimated', 'estimated') === true || pick(r, 'is_estimated', 'date_estimated', 'estimated') === 'true',
          // 영업관리 2-7 칸 순서: 승인일·착공·준공(예정)·입주(예정)·세대수·시행사·시공사·영업 시작·제안 시작·운영사 선정 예상
          kind: pick(r, 'building_type', 'type', 'kind'), region: pick(r, 'region', 'sido'), priority: pick(r, 'sales_priority', 'priority'),
          completion: day(pick(r, 'completion_date', 'expected_completion_date')), moveIn: day(pick(r, 'move_in_date', 'expected_move_in_date')),
          dates: [['승인일', day(pick(r, 'approval_date', 'approved_at'))], ['착공', day(pick(r, 'construction_start_date', 'start_construction_date'))], ['준공(예정)', day(pick(r, 'completion_date', 'expected_completion_date'))],
            ['입주(예정)', day(pick(r, 'move_in_date', 'expected_move_in_date'))], ['세대수', pick(r, 'household_count', 'households', 'total_households', 'units')], ['시행사', pick(r, 'developer', 'executor')], ['시공사', pick(r, 'builder', 'constructor', 'contractor')],
            ['영업 시작', day(pick(r, 'sales_start_date', 'start_date'))], ['제안 시작', day(pick(r, 'proposal_start_date'))], ['운영사 선정 예상', day(pick(r, 'operator_selection_date', 'expected_operator_selection'))]] as [string, unknown][],
          firstSeen: firstSeen(r), raw: r }; });
      type B = (typeof list)[number];
      const sorter: Record<string, (a: B, b: B) => number> = { completion: (a, b) => asc(a.completion, b.completion), moveIn: (a, b) => asc(a.moveIn, b.moveIn), households: (a, b) => numDesc(a.households, b.households), firstSeen: (a, b) => desc(a.firstSeen, b.firstSeen) };
      return pack(list, (x) => done(x.work?.status), (x) => regionOk(x) && hhOk(x) && inPeriod(x.completion, x.moveIn, x.firstSeen) && myOk(x.moveIn ?? x.completion), sorter[sortKey ?? ''] ?? null, (x) => x.work?.status);
    }
    if (tab === 'facilities') {
      const P = new Map((await prog('operating_facility_prospects__progress', 20000)).map((p) => [String(p.id ?? p.__id), p]));
      const RM = await import('./research'); const RS = await RM.researchState(sql, t); // 212차 #612 후속조사(조사 예정·조사함·확인 못함 + 적은 값)
      const NC = await RM.relatedNoticeCounts(sql).catch(() => new Map<string, number>()); // #758 단지 이름별 관련 공고 수
      const list = (await rows('global', 'operating_facility_prospects', 20000)).filter((r) => hit(r) && dayOk(r)).map((r) => { const p = P.get(String(r.id ?? r.__id)); const rs = RS.get(String(r.__id)) ?? null;
        return { id: r.__id, name: pick(r, 'name', 'facility_name', 'complex_name') ?? '(이름 없음)', address: pick(r, 'address', 'road_address'), score: Number(pick(r, 'score', 'priority_score') ?? 0) || null,
          lane: pick(r, 'facility_type', 'lane', 'category', 'kind'), region: pick(r, 'region'), operating: pick(r, 'operating_status'), date: day(pick(r, 'completion_date', 'use_approval_date', 'completed_at', 'move_in_date')),
          contact: p?.contact_status ?? null, next: day(p?.next_action_date ?? null), leadId: p?.lead_id ?? null, handoff: !!(p?.lead_id && pick(p, 'handoff_by')), archive: archiveOf(p),
          // 영업관리 2-8 한 줄 순서: 판정 · 유형·지역·세대·규모·현 위탁사 · 주소 · 관리사무소 전화 · 부대시설 · DB 등록 · 준공·입주 · 다음 연락 · 최근 기록 · 다음 조치
          // S1-3: 원본 칸 household_count·facility_scale(+facility_scale_unit)·completion_date, 다음 조치는 회사 진행(__progress.next_action) → 수집기 제안(etl_suggested_next_action) 순, 최근 기록 notes
          verdict: pick(r, 'verdict', 'judgment', 'stage_label', 'opportunity_label'), households: pick(r, 'household_count', 'households', 'total_households', 'units'), scale: scaleOf(r),
          // #605 보관함에서 적은 현 위탁사·계약만료일(회사 진행 기록)이 원본 칸보다 먼저 — 계약만료·재입찰 탭으로 이어짐
          // 212차 #612: 후속조사로 적은 값은 회사 진행 기록·원천 칸이 없을 때(현 위탁사는 관리 회사 칸보다 먼저 — 전화로 확인한 값)
          operator: RM.communityOperator(pick(p, 'current_operator') ?? pick(r, 'current_operator', 'operator') ?? rs?.result.operator, pick(r, 'management_company')), mgmt: pick(r, 'management_company') ?? null, // #760 관리회사 ≠ 커뮤니티 운영사
          contractEnd: day(pick(p, 'contract_end_date')) ?? rs?.result.contractEnd ?? null,
          phone: pick(r, 'office_phone', 'management_phone', 'phone') ?? rs?.result.phone ?? null, amenities: pick(r, 'amenities', 'facilities', 'community_facilities'),
          research: rs ? { status: rs.status, due: rs.due, assignee: rs.assignee, taskId: rs.taskId, doneAt: rs.doneAt, missing: rs.missing, note: rs.result.note ?? null, mode: rs.result.mode ?? null, firstPick: rs.result.firstPick ?? null,
            reaction: rs.result.reaction ?? null, meetingAt: rs.result.meetingAt ?? null, contactTitle: rs.result.contactTitle ?? null, nextDate: rs.result.nextDate ?? null } : null, // 247차 #778 연락 결과
          notices: RM.noticeCountOf(NC, pick(r, 'name', 'facility_name', 'complex_name')), // #758 '이 단지 관련 공고 n건'
          firstSeen: firstSeen(r), moveIn: day(pick(r, 'move_in_date', 'move_in_start')), lastNote: p?.notes ?? p?.last_note ?? p?.memo ?? null,
          nextAction: p?.next_action ?? pick(r, 'etl_suggested_next_action', 'next_action', 'recommended_action'), nextActionFrom: p?.next_action ? '진행 기록' : pick(r, 'etl_suggested_next_action') ? '수집기 제안' : null,
          elapsedDays: daysSince(day(pick(r, 'move_in_date', 'move_in_start')) ?? day(pick(r, 'completion_date', 'use_approval_date', 'completed_at'))), raw: r }; });
      type Fc = (typeof list)[number];
      const sorter: Record<string, (a: Fc, b: Fc) => number> = { completion: (a, b) => asc(a.date, b.date), moveIn: (a, b) => asc(a.moveIn, b.moveIn), elapsed: (a, b) => numDesc(a.elapsedDays, b.elapsedDays), households: (a, b) => numDesc(a.households, b.households), next: (a, b) => asc(a.next, b.next) };
      // 200차 #699: 원본 기준일 한 줄 — 준공·입주 단지 원천의 기준일(우선순위 순: K-apt 자료실 주 1회 · K-apt 단지 목록 매일 · 한국부동산원 연 1회)
      return { ...pack(list, (x) => done(x.contact), (x) => regionOk(x) && hhOk(x) && inPeriod(x.date, x.moveIn, x.firstSeen) && myOk(x.moveIn ?? x.date),
        sorter[sortKey ?? ''] ?? ((a, b) => (Number(b.households ?? 0) - Number(a.households ?? 0)) || ((b.score ?? -1) - (a.score ?? -1))), (x) => x.contact),
        sourceAsOf: await sourceAsOf(['kapt_weekly_complexes', 'kapt_new_complexes', 'reb_recent_complexes']) };
    }
    if (tab === 'vendors') {
      const P = new Map((await prog('vendor_registrations__progress')).map((p) => [String(p.id ?? p.__id), p]));
      const list = (await rows('global', 'vendor_registrations')).filter((r) => hit(r) && dayOk(r)).map((r) => { const p = P.get(String(r.id ?? r.__id));
        return { id: r.__id, name: pick(r, 'company', 'company_name', 'name') ?? '(이름 없음)', division: pick(r, 'category', 'division', 'kind'), rank: pick(r, 'rank_label', 'rank'), notice: pick(r, 'notice_title', 'title', 'notice'),
          url: pick(r, 'recruit_url', 'url', 'notice_url'), status: p?.status ?? null, memo: p?.memo ?? null, next: day(p?.next_date ?? null), leadId: p?.lead_id ?? null, handoff: !!(p?.lead_id && pick(p, 'handoff_by')), archive: archiveOf(p), region: pick(r, 'region', 'sido'),
          // 영업관리 2-9 카드: 모집 공지 공개 여부·모집 시기·등록 요건·공동인증서·비고·링크
          // S1-3: 원본 칸 recruit_visibility·recruit_timing·cert_required·register_url·recruit_url 먼저
          open: pick(r, 'recruit_visibility', 'recruit_open', 'notice_open', 'is_open'), period: pick(r, 'recruit_timing', 'recruit_period', 'period'), requirement: pick(r, 'requirements', 'registration_requirements', 'register_requirements'), cert: pick(r, 'cert_required', 'certificate', 'joint_certificate'),
          note: pick(r, 'notes', 'note', 'remark'), applyUrl: pick(r, 'register_url', 'apply_url', 'registration_url'), portalUrl: pick(r, 'portal_url'), homepage: pick(r, 'homepage', 'website'), firstSeen: firstSeen(r), raw: r }; });
      type V = (typeof list)[number];
      const rankNo = (v: unknown) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return n > 0 ? n : 1e9; };
      const sorter: Record<string, (a: V, b: V) => number> = { period: (a, b) => String(a.period ?? '').localeCompare(String(b.period ?? ''), 'ko'), rank: (a, b) => rankNo(a.rank) - rankNo(b.rank), firstSeen: (a, b) => desc(a.firstSeen, b.firstSeen) };
      return pack(list, (x) => done(x.status), (x) => inPeriod(x.firstSeen), sorter[sortKey ?? ''] ?? null, (x) => x.status);
    }
    throw notFound();
  }
  if (view === 'regions') {
    const L = (await leadRows()).map((r) => lead(r, names));
    const m = new Map<string, { region: string; total: number; byStatus: Record<string, number> }>();
    for (const l of L) { const k = regionOf(l.region); const e = m.get(k) ?? { region: k, total: 0, byStatus: {} }; e.total++; e.byStatus[String(l.status ?? '미정')] = (e.byStatus[String(l.status ?? '미정')] ?? 0) + 1; m.set(k, e); }
    return { ...meta, regions: [...m.values()].sort((a, b) => (a.region === '지역 미정' ? 1 : b.region === '지역 미정' ? -1 : b.total - a.total)) };
  }
  throw notFound();
}
