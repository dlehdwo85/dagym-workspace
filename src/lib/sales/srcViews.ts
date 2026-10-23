import { isAdmin } from '../access';
import { db } from '../db';
import { assertSpace } from '../spaces';
import { badRequest, notFound } from '../errors';
import { tenantOf, type SessionUser } from '../types';
import { type BizCat, bizKey, listBizCats, matchBiz } from './bizCats';
import { vendorDateOk } from './collectors/vendorRules';
import { sourceFiles } from './files';

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

async function rows(scope: string, tbl: string, limit = 5000) {
  return (await db()<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = ${scope} and tbl = ${tbl} and not gone limit ${limit}`).map((r) => ({ ...r.row, __id: r.src_id }));
}
/** 전환 뒤(쓰기 열림): 리드는 정식 표(sales_leads)가 정본 — 원본 행 칸 이름으로 맞춰 돌려줌(화면 코드 그대로) */
/** date 칸: 운영 DB 연결은 date 를 'YYYY-MM-DD' 문자열로, 시험 DB 는 Date 로 줄 수 있음 — 둘 다(핫픽스 10/19: 문자열을 format 해 500) */
const ymdOf = (v: unknown) => (v == null || v === '' ? null : typeof v === 'string' ? v.slice(0, 10) : v instanceof Date && !Number.isNaN(v.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(v) : null);
async function formalLeads(tenant: string, id?: string) {
  const r = await db()<any[]>`select l.*, u.name as owner_name, (select max(x.occurred_at) from sales_lead_records x where x.lead_id = l.id and x.kind in ('sales_activities', 'proposals', 'contracts')) as last_activity_at from sales_leads l left join users u on u.id = l.owner_id where l.tenant = ${tenant} and l.deleted_at is null ${id ? db()`and l.id = ${id}` : db()``} order by l.updated_at desc limit 5000`;
  return r.map((l) => ({ ...(l.src ?? {}), __id: l.id, __src_id: l.src_id, __owner: l.owner_name ?? '', __owner_id: l.owner_id, name: l.name, sales_status: l.status, priority: l.priority, facility_type: l.facility_type, region: l.region,
    next_contact_date: ymdOf(l.next_contact_date), contact_name: l.contact_name, phone: l.phone, expected_revenue: l.expected_revenue, email: l.email, scale: l.scale, homepage: l.homepage ?? l.src?.homepage ?? null,
    memo: l.memo, updated_at: l.updated_at, created_at: l.created_at, last_activity_at: l.last_activity_at }));
}
async function userNames(tenant: string) {
  const m = await db()<{ src_user_id: string; name: string | null }[]>`select m.src_user_id, coalesce(u.name, m.name) as name from sales_user_map m left join users u on u.id = m.user_id where m.tenant = ${tenant}`;
  return new Map(m.map((x) => [x.src_user_id, x.name ?? '']));
}

/** 영업관리 11단계(원본 leads.sales_status) · 종결 단계 · 우선순위 한글 */
export const STAGES = ['신규리드', '1차연락완료', '미팅예정', '현장방문완료', '제안서작성중', '제안서발송완료', '견적협의', '계약검토', '계약완료', '보류', '실패', '되돌림']; // 되돌림 = 영업 재편 2) 배정 이전으로 되돌린 리드
const CLOSED = new Set(['계약완료', '보류', '실패', '되돌림']);
const PRIORITY: Record<string, string> = { urgent: '긴급', high: '높음', medium: '보통', low: '낮음' };
/** 지역 칸에 단지명 같은 값(원본 데이터 오류)은 '지역 미정' 묶음으로 — 값은 고치지 않음 */
const regionOf = (v: unknown) => { const r = String(v ?? '').trim(); return !r || r.length > 8 || /\s/.test(r) ? '지역 미정' : r; };
const lead = (r: any, names: Map<string, string>) => ({
  id: r.__id, name: pick(r, 'name', 'company_name', 'facility_name', 'title', 'organization') ?? '(이름 없음)', status: pick(r, 'sales_status', 'status', 'stage'),
  priority: PRIORITY[String(pick(r, 'priority') ?? '').toLowerCase()] ?? pick(r, 'priority'), priorityCode: pick(r, 'priority'),
  facility: pick(r, 'facility_type', 'type', 'category'), region: pick(r, 'region', 'sido', 'area'), next: day(pick(r, 'next_contact_date', 'next_contact_at', 'next_action_date')),
  owner: r.__owner !== undefined ? r.__owner || null : names.get(String(pick(r, 'owner_id', 'assigned_to', 'sales_owner_id', 'user_id') ?? '')) ?? null, ownerId: r.__owner_id ?? null, memo: r.__id && r.__owner !== undefined ? r.memo ?? null : undefined, revenue: pick(r, 'expected_revenue', 'expected_amount', 'estimated_revenue'),
  updated: day(pick(r, 'updated_at', 'created_at')), phone: pick(r, 'phone', 'contact_phone'), contact: pick(r, 'contact_name', 'manager_name'),
  homepage: pick(r, 'homepage', 'website', 'url'), // 대표 검수 10/20 ②: 앱 목록 홈페이지 칩
  // S2 2차: 이메일·규모·등록일·최근 활동(상담·제안·계약 최신, 없으면 수정일)
  email: pick(r, 'email', 'contact_email'), scale: pick(r, 'scale', 'facility_scale', 'size'), created: day(pick(r, 'created_at')), lastActivity: day(pick(r, 'last_activity_at', 'last_activity_date', 'last_contact_at')) ?? day(pick(r, 'updated_at', 'created_at')),
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
function todayReason(n: { posted: string | null; noticeDate: string | null; vendorRecruit: boolean }, firstSeenAt: unknown, since: number | null): { hit: boolean; label: string | null } {
  if (n.vendorRecruit && !n.noticeDate) return { hit: false, label: null };
  const td = today(), yd = plus(-1);
  if (n.posted === td) return { hit: true, label: n.noticeDate && n.noticeDate < td ? `${n.noticeDate === yd ? '어제' : md(n.noticeDate)} 공고·오늘 수집` : null };
  if (n.noticeDate === td) return { hit: true, label: n.posted && n.posted < td ? `공고일 오늘·${n.posted === yd ? '어제' : md(n.posted)} 처음 수집` : null }; // 정정·재공고로 공고일이 오늘이 된 옛 공고
  const seen = Date.parse(String(firstSeenAt ?? ''));
  if (since != null && !Number.isNaN(seen) && seen >= since) return { hit: true, label: `${n.posted === yd ? '어제' : n.posted ? md(n.posted) : ''} 메일 뒤 수집`.trim() };
  return { hit: false, label: null };
}
/** #507 후속(로컬 10/23): 같은 공고(원천 종류 + 원천 번호)가 여러 줄(원본 복사 + 워크인 수집)이면 한 줄로 — 이 회사 진행 기록이 걸린 줄을 남기고(여럿이면 다), 첨부는 묶음 전체.
 *  수집 뒤 합치기(mergeNoticeDuplicates)가 못 숨긴 경우(두 줄 모두 진행 기록)의 화면 보완 */
function oneRowPerNotice(list: any[], linked: (id: string) => boolean) {
  const groups = new Map<string, any[]>();
  for (const r of list) { const ext = String(r.source_external_id ?? ''); const k = ext ? `${r.source_type}|${ext}` : `#${r.__id}`; const g = groups.get(k); if (g) g.push(r); else groups.set(k, [r]); }
  const out: any[] = [];
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue; }
    const keep = g.filter((r) => linked(String(r.id ?? r.__id)));
    const files = sourceFiles(...g.flatMap((r) => [r.attachment_urls ?? r.attachments, r.notice_file_url])).map((x) => (x.name ? { name: x.name, url: x.url } : x.url));
    for (const r of keep.length ? keep : [g[0]]) out.push({ ...r, attachment_urls: files });
  }
  return out;
}
const attachmentsOf = (r: any) => { const a = pick(r, 'attachment_urls', 'attachments'); return Array.isArray(a) ? a : typeof a === 'string' && a.startsWith('[') ? (() => { try { return JSON.parse(a); } catch { return []; } })() : a ? [a] : []; };
/** S1-3: 시설 규모 facility_scale + facility_scale_unit(㎡·평·세대 등) */
const scaleOf = (r: any) => { const v = pick(r, 'facility_scale', 'scale', 'size', 'area'); if (v === null || v === undefined || v === '') return null; const u = pick(r, 'facility_scale_unit', 'scale_unit'); return u ? `${v}${u}` : v; };
/** 입주·준공 뒤 지난 날수(KST 오늘 기준, 미래면 null) */
const daysSince = (d: string | null) => { if (!d) return null; const n = Math.floor((Date.parse(today()) - Date.parse(d)) / 864e5); return Number.isFinite(n) && n >= 0 ? n : null; };
/** #476 후속(로컬 10/23 14:20): 협력사 모집 줄은 수집기가 게시판 날짜로 확인한 것(또는 '안내 페이지 바뀜')만 공고일을 믿음 — 예전 방식·원본 복사 줄의 공고일은 수집한 날 */
const vendorUnchecked = (r: any) => String(r?.source_type ?? '') === 'vendor_recruit' && !vendorDateOk(r);
const notice = (r: any, cats: BizCat[] = []) => { const m = matchBiz(r, cats); return ({ id: r.__id, title: pick(r, 'title', 'notice_title', 'bid_name', 'name') ?? '(제목 없음)', agency: pick(r, 'issuer', 'agency', 'org_name', 'demand_agency', 'organization', 'buyer'),
  region: pick(r, 'region'), posted: firstSeen(r), noticeDate: vendorUnchecked(r) ? null : day(pick(r, 'posted_date', 'posted_at', 'notice_date', 'published_at', 'bid_notice_date')), deadline: pick(r, 'deadline_at', 'close_at', 'deadline', 'bid_close_at', 'closing_date', 'end_date'),
  close: day(pick(r, 'deadline_at', 'close_at', 'deadline', 'bid_close_at', 'closing_date', 'end_date')), source: pick(r, 'source_type', 'source', 'source_code'), url: pick(r, 'source_url', 'url', 'detail_url', 'link'),
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
  estimated: pick(r, 'estimated_amount', 'estimated_price', 'presumed_price', 'base_amount'), contractMethod: pick(r, 'contract_method', 'award_method', 'bid_system', 'contract_type'), contractPeriod: pick(r, 'contract_period', 'contract_term', 'service_period'),
  address: pick(r, 'office_address', 'address'), fax: pick(r, 'office_fax', 'fax'), salesPoint: pick(r, 'sales_point'), qualificationGap: pick(r, 'qualification_gap'),
  detail: { tasks: pick(r, 'main_tasks', 'scope_of_work', 'tasks'), qualification: pick(r, 'qualification', 'participation_requirements', 'bid_qualification'), performance: pick(r, 'performance_requirements', 'track_record'),
    regionLimit: pick(r, 'region_restriction', 'region_limit'), license: pick(r, 'license_requirements', 'license'), joint: pick(r, 'joint_bid', 'subcontract', 'consortium'), briefing: pick(r, 'site_briefing', 'pre_bid_meeting', 'site_meeting'), presentation: pick(r, 'proposal_presentation', 'presentation') } }); };
// S1-3: 원본 source_type 9값(kapt_bid·g2b_bid·nuri_bid·g2b_prespec·lh_bid·lh_prespec·d2b_bid·onbid_lease·vendor_recruit) + 예전 짧은 코드
const SOURCE_LABEL: Record<string, string> = { kapt_bid: 'K-apt', g2b_bid: '나라장터', nuri_bid: '누리장터', g2b_prespec: '나라장터 사전규격', lh_bid: 'LH', lh_prespec: 'LH 사전규격', d2b_bid: '국방', onbid_lease: '온비드 임대', vendor_recruit: '협력사 모집',
  kapt: 'K-apt', 'k-apt': 'K-apt', g2b: '나라장터', nara: '나라장터', g2b_pre: '나라장터 사전규격', nuri: '누리장터', lh: 'LH', lh_pre: 'LH 사전규격', defense: '국방', d2b: '국방', onbid: '온비드 임대', vendor: '협력사 모집' };
/** 진행 중 입찰(SALES_SCREEN_INVENTORY 2-5·143행) — 현황 숫자와 입찰 '진행 중' 탭이 같은 기준: 관련 공고 · 마감·취소·낙찰·유찰 아님 · KST 마감일 ≥ 오늘(마감일 없으면 진행으로)
 * · 사전규격(입찰 예정)은 빼고 · 작업 상태 미참여·대상아님은 뺀다. 원본 상태 문구가 '공고중'만이 아니어서(운영 10/19 진행 중 0건) 닫힌 상태만 거른다 */
const CLOSED_NOTICE = /마감|종료|취소|낙찰|유찰|개찰완료|closed|cancel|award|expired|done/i;
const SKIP_WORK = /미참여|대상아님|not[_\s-]?target|skip/i;
/** 마감 시각(KST) → epoch ms. 시각이 없거나 읽을 수 없으면 null. 오프셋 없는 'YYYY-MM-DD HH:MM' 은 서울 시각으로 */
function deadlineAt(v: unknown): number | null {
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) { const t = Date.parse(s); return Number.isNaN(t) ? null : t; }
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:00+09:00`);
}
export function isOpenBid(n: { related?: boolean; status?: unknown; close?: string | null; source?: unknown; deadline?: unknown }, work: unknown, td: string) {
  if (!n.related) return false;
  if (n.status && CLOSED_NOTICE.test(String(n.status))) return false;
  if (n.close && n.close < td) return false;
  // 로컬 10/19: 오늘 09:00·14:59 처럼 이미 지난 마감 — 시각이 있으면 지금 시각과 비교(시각 없으면 날짜만)
  if (n.close === td && n.deadline) { const at = deadlineAt(n.deadline); if (at !== null && at <= Date.now()) return false; }
  if (/pre|사전/i.test(String(n.source ?? ''))) return false;
  if (work && SKIP_WORK.test(String(work))) return false;
  return true;
}

export async function salesView(u: SessionUser, view: string, q: { q?: string; id?: string; status?: string; tab?: string; day?: string; from?: string; to?: string; biz?: string }) {
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
    for (const r of raw) {
      const l = lead(r, names);
      if (!l.next || l.next < from || l.next > to || CLOSED.has(String(l.status))) continue;
      const act = pick(r, 'next_action', 'next_step', 'next_action_type');
      const tm = String(pick(r, 'next_contact_at', 'next_action_at') ?? '').match(/[T ](\d{2}:\d{2})/)?.[1] ?? null;
      items.push({ date: l.next, time: tm, title: `${act ? String(act).slice(0, 20) : '연락'} · ${l.name}`, kind: 'lead', owner: l.owner ?? null, href: `/s/sales/leads?q=${encodeURIComponent(String(l.name))}` });
    }
    if (bidsOn) {
      const W = (await rows(t, 'opportunity_work')).filter((w) => !/완료|미참여|대상아님|done|closed/i.test(String(pick(w, 'status') ?? '')));
      const ids = new Set(W.map((w) => String(pick(w, 'notice_id', 'procurement_notice_id') ?? '')));
      if (ids.size) for (const r of await rows('global', 'procurement_notices', 20000)) {
        if (!ids.has(String(r.id ?? r.__id))) continue;
        const n = notice(r, cats);
        if (!n.close || n.close < from || n.close > to) continue;
        items.push({ date: n.close, time: String(n.deadline ?? '').match(/[T ](\d{2}:\d{2})/)?.[1] ?? null, title: `입찰 마감 · ${String(n.complex ? `${n.complex} ` : '')}${n.title}`.slice(0, 80), kind: 'bid', owner: null, href: '/s/sales/bids?tab=working' });
      }
    }
    items.sort((a, b) => (a.date + (a.time ?? '')).localeCompare(b.date + (b.time ?? '')));
    return { from, to, items: items.slice(0, 100) };
  }
  if (view === 'summary') {
    const L = (await leadRows()).map((r) => lead(r, names));
    const W = await prog('opportunity_work'); // S2-5: 전환 뒤에는 정식 진행 기록 표(원본 행 모양)
    const workOf = new Map(W.map((w) => [String(pick(w, 'notice_id', 'procurement_notice_id') ?? ''), pick(w, 'status')]));
    const NR = oneRowPerNotice((await rows('global', 'procurement_notices', 20000)).filter((r) => (r.related === true || r.related === 'true') && (!vendorUnchecked(r) || workOf.has(String(r.id ?? r.__id)))), (id) => workOf.has(id)); // 입찰 목록과 같은 기준(확인 안 된 협력사 줄 빼기·같은 공고 한 줄)
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
      return { id: isBid ? nid : bid, kind: isBid ? 'bid' : 'building', name: isBid ? `${n!.complex ? n!.complex + ' ' : ''}${n!.title}` : buildings.get(bid) ?? '(이름 없음)', status: pick(w, 'status'), next: nextOf(w), memo: pick(w, 'memo', 'note'), href: isBid ? '/s/sales/bids?tab=working' : '/s/sales/hub?tab=buildings' };
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
      .map((n) => ({ id: n.id, kind: 'bid', name: nameOfNotice(n), status: workOf.get(String(n.id)) ?? null, next: n.close, memo: null, href: '/s/sales/bids?tab=working' }));
    const closingSoon = NR.map((r) => notice(r, cats)).filter((n) => { const w = workOf.get(String(n.id)); return (n.close === td || n.close === tm) && isOpenBid(n, w, td) && (!w || /미검토|검토중|연락중|즉시/.test(String(w))); })
      .sort((a, b) => String(a.deadline ?? '').localeCompare(String(b.deadline ?? '')))
      .map((n) => ({ id: n.id, kind: 'bid', name: nameOfNotice(n), status: n.close === td ? '오늘 마감' : '내일 마감', next: n.close, memo: String(n.deadline ?? '').match(/[T ](\d{2}:\d{2})/)?.[1] ?? null, href: '/s/sales/bids?tab=closing' }));
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
    return { ...meta, bidsOn, setupNeeded, todo, tiles, progress, support, kpi: { leads: L.length, dueSoon: due.length, overdue: overdue.length, bidsWorking: W.filter((w) => !/완료|미참여|대상아님|done|closed/i.test(String(pick(w, 'status') ?? ''))).length,
      bidsOpen: NR.filter((r) => isOpenBid(notice(r), workOf.get(String(r.id ?? r.__id)), today())).length,
      relatedNotices: N.length, newNotices7d: N.filter((n) => n.noticeDate && n.noticeDate >= plus(-7) && n.noticeDate <= today()).length /* 로컬 10/19: 원본 초기 적재(10/13 3,343건) 때문에 first_seen 7일은 부풀려짐 → 공고일 기준 */ }, due: due.slice(0, 10), overdueList: overdue.slice(0, 10), statuses,
      // 대표(10/19): 첫 화면 맨 위 '오늘' — 새 공고·새 영업 DB(신규단지·시설·협력사)·오늘 연락할 리드·오늘 마감 입찰
      today: await (async () => { const td = today();
        const db3 = await Promise.all((['building_sales_pipeline', 'operating_facility_prospects', 'vendor_registrations'] as const).map(async (tb) => (await rows('global', tb, 20000)).filter((r) => firstSeen(r) === td).length));
        const since = await lastMailAt(t); // #476 b: 홈 '오늘 새 공고' 수 = 오늘 탭과 같은 기준
        return { date: td, newNotices: NR.filter((r, i) => todayReason(N[i], r.first_seen_at, since).hit).length, newDb: { buildings: db3[0], facilities: db3[1], vendors: db3[2] }, contact: live.filter((l) => l.next === td).length, closing: N.filter((n) => n.close === td).length }; })() };
  }
  // S2-6 계약만료·재입찰(영업관리 2-6): 타 업체 계약 종료일이 있는 공고 → 영업 시작(−12·−9개월)·제안(−6)·재입찰(−3) 역산, 단계 5, 요약 4(90/180/365일 내·지남)
  if (view === 'contracts') {
    const W = await prog('opportunity_work'); const td = today();
    const workOf = new Map(W.map((w) => [String(pick(w, 'notice_id', 'procurement_notice_id') ?? ''), pick(w, 'status')]));
    const endOf = (r: any) => day(pick(r, 'contract_end_date', 'contract_end', 'service_end_date', 'contract_expiry_date'));
    const shift = (d: string, months: number) => { const x = new Date(`${d}T12:00:00+09:00`); x.setUTCMonth(x.getUTCMonth() + months); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(x); };
    const items = (await rows('global', 'procurement_notices', 20000)).filter((r) => (r.related === true || r.related === 'true') && endOf(r)).map((r) => { const n = notice(r); const end = endOf(r)!;
      const start = shift(end, -12), start2 = shift(end, -9), propose = shift(end, -6), rebid = shift(end, -3);
      const stage = td < start ? '영업 전' : td < propose ? '영업 시작' : td < rebid ? '제안' : td <= end ? '재입찰' : '종료';
      const daysLeft = Math.round((Date.parse(end) - Date.parse(td)) / 864e5);
      return { id: n.id, name: `${n.complex ? n.complex + ' ' : ''}${n.title}`, agency: n.agency, region: n.region, winner: n.winner, amount: n.awardAmount ?? n.amount, end, start, start2, propose, rebid, stage, daysLeft, work: workOf.get(String(n.id)) ?? null, url: n.url, href: '/s/sales/bids?tab=all&q=' + encodeURIComponent(String(n.title)) }; })
      .filter(hit).sort((a, b) => a.end.localeCompare(b.end));
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
    return { ...meta, stages: STAGES, canAssign, people, me: u.id, leads: L.map(({ raw, ...l }) => ({ ...l, interests: I.get(String(raw.__src_id ?? raw.id ?? l.id)) ?? [] })).sort((a, b) => String(b.updated).localeCompare(String(a.updated))) };
  }
  if (view === 'lead') {
    if (!q.id) throw badRequest('id 가 필요합니다');
    if (formal) {
      if (!/^[0-9a-f-]{36}$/i.test(q.id)) throw notFound();
      const [r] = await formalLeads(t, q.id);
      if (!r) throw notFound();
      const srcId = r.__src_id as string | null;
      const lid = q.id;
      const recs = async (kind: string) => (await sql<any[]>`select id, data, occurred_at from sales_lead_records where tenant = ${t} and lead_id = ${lid} and kind = ${kind} order by occurred_at desc nulls last`).map((x) => ({ ...x.data, __id: x.id }));
      const relSrc = async (tbl: string) => (srcId ? (await rows(t, tbl)).filter((x) => String(pick(x, 'lead_id')) === srcId) : []);
      const log = await sql`select g.from_status, g.to_status, g.reason, g.changed_at, u.name as by from sales_status_log g left join users u on u.id = g.changed_by where g.lead_id = ${lid} order by g.changed_at desc limit 50`;
      const people = await sql`select id, name from users where tenant = ${t} and status = 'active' and not is_demo order by name`;
      const { src: _s, ...raw } = r;
      // S2 2차: 업무 탭 = 워크인 업무(lead_id) + 옮겨 온 원본 업무, 타임라인 = 상담·상태 변경·업무·제안·계약 통합(최신순)
      const wTasks = await sql<any[]>`select t.id, t.title, t.status, t.due_date::text as due_date, t.created_at, t.completed_at, au.name as assignee, t.sales_ref from tasks t left join users au on au.id = t.assignee_id where t.lead_id = ${lid} and t.deleted_at is null order by (t.status = 'done'), t.due_date nulls last limit 100`;
      const acts = await recs('sales_activities'), props = await recs('proposals'), cons = await recs('contracts');
      // 영업 재편 5): 리드 일정(넘기기 자동 일정·리드에서 만든 일정) — 다가오는 것 먼저
      const events = await sql<any[]>`select e.id, e.title, e.start_at, e.end_at, e.all_day, c.name as calendar from events e join calendars c on c.id = e.calendar_id where e.lead_id = ${lid} and e.deleted_at is null order by e.start_at desc limit 50`;
      const timeline = [...acts.map((a: any) => ({ kind: 'act', at: a.activity_date ?? a.created_at, title: `${a.activity_type ?? '상담'} · ${String(a.content ?? '').slice(0, 80)}`, by: a.created_by_name ?? null, id: a.__id })),
        ...log.map((g: any) => ({ kind: 'status', at: g.changed_at, title: `${g.from_status ?? '—'} → ${g.to_status}${g.reason ? ` (${g.reason})` : ''}`, by: g.by ?? null, id: String(g.changed_at) })),
        ...wTasks.map((x: any) => ({ kind: 'task', at: x.completed_at ?? x.created_at, title: `${x.status === 'done' ? '완료' : '업무'} · ${x.title}`, by: x.assignee ?? null, id: x.id, href: `/tasks/${x.id}` })),
        ...props.map((p: any) => ({ kind: 'proposal', at: p.proposal_date, title: `제안 · ${p.title}${p.amount ? ` ${Number(p.amount).toLocaleString('ko-KR')}원` : ''}`, by: null, id: p.__id })),
        ...cons.map((c: any) => ({ kind: 'contract', at: c.contract_date ?? c.start_date, title: `계약 · ${c.title}${c.amount ? ` ${Number(c.amount).toLocaleString('ko-KR')}원` : ''}`, by: null, id: c.__id })),
        ...events.map((e: any) => ({ kind: 'event', at: e.start_at, title: `일정 · ${e.title}`, by: null, id: e.id, href: `/calendar?event=${e.id}` }))]
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
    let N = oneRowPerNotice((await rows('global', 'procurement_notices', 20000)).filter((r) => byNotice.has(String(r.id ?? r.__id)) || ((r.related === true || r.related === 'true') && !vendorUnchecked(r))), (id) => byNotice.has(id) || P.has(id)); // 확인 안 된 협력사 줄(메뉴·안내문 조각·예전 방식) 빼기 · 같은 공고 한 줄
    const since = await lastMailAt(t);
    const items = N.map((r) => { const id = String(r.id ?? r.__id); const w = byNotice.get(id); const p = P.get(id); const n0 = notice(r, cats); const why = todayReason(n0, r.first_seen_at, since);
      return { ...n0, todayHit: why.hit, todayLabel: why.label, work: w ? pick(w, 'status') : null, classification: p?.classification ?? pick(r, 'classification'), judgment: p?.representative_judgment ?? pick(r, 'representative_judgment'),
        // 대표 검수 10/20 ②: 입찰 상세(메모·다음 조치·원본)
        workMemo: w ? pick(w, 'memo', 'note') : null, workNext: w ? day(pick(w, 'next_action_date', 'next_date', 'due_date')) : null, workLeadId: w?.lead_id ?? null, raw: r }; })
      .filter((n) => hit(n) && (tab !== 'working' || n.work) && (tab !== 'open' || isOpenBid({ ...n, related: true }, n.work, today()))
        && (tab !== 'today' || n.todayHit) && (tab !== 'closing' || n.close === today()) && (tab !== 'recruit' || n.vendorRecruit)
        && (!q.biz || (q.biz === 'none' ? !n.businesses.length : n.businesses.some((b) => b.key === q.biz))))
      .sort((a, b) => tab === 'open' ? String(a.deadline ?? '9999').localeCompare(String(b.deadline ?? '9999')) : String(b.posted).localeCompare(String(a.posted))).slice(0, 300);
    return { ...meta, tab, total: N.length, items, biz: q.biz ?? null, categories: cats.map((c) => ({ key: c.key, name: c.name, color: c.color })) };
  }
  if (view === 'hub') {
    const tab = q.tab ?? 'buildings';
    const dayOk = (r: any) => q.day !== 'today' || firstSeen(r) === today(); // 오늘 새 영업 DB
    // S1-2: 신규단지 진행(opportunity_work · source_id = 단지 id)
    const BW = new Map((await prog('opportunity_work')).filter((w) => String(pick(w, 'source_type') ?? '') === 'building' || pick(w, 'building_id')).map((w) => [String(pick(w, 'source_id', 'building_id') ?? ''), w]));
    if (tab === 'buildings') return { ...meta, tab, items: (await rows('global', 'building_sales_pipeline')).filter((r) => hit(r) && dayOk(r)).map((r) => ({ id: r.__id, name: pick(r, 'name', 'complex_name', 'project_name', 'house_name') ?? '(이름 없음)',
      work: BW.get(String(r.id ?? r.__id)) ? { status: pick(BW.get(String(r.id ?? r.__id)), 'status'), memo: pick(BW.get(String(r.id ?? r.__id)), 'memo', 'note'), next: day(pick(BW.get(String(r.id ?? r.__id)), 'next_date', 'next_action_date')), leadId: BW.get(String(r.id ?? r.__id))?.lead_id ?? null } : null,
      // S1-3: 원본 칸 current_stage·sales_priority·household_count·source_url·attachment_urls 먼저
      address: pick(r, 'address', 'location'), households: pick(r, 'household_count', 'households', 'total_households', 'units'), start: day(pick(r, 'sales_start_date', 'start_date', 'notice_date')), status: pick(r, 'current_stage', 'status', 'stage'),
      url: pick(r, 'source_url', 'url', 'detail_url'), attachments: attachmentsOf(r), estimated: pick(r, 'is_estimated', 'date_estimated', 'estimated') === true || pick(r, 'is_estimated', 'date_estimated', 'estimated') === 'true',
      // 영업관리 2-7 칸 순서: 승인일·착공·준공(예정)·입주(예정)·세대수·시행사·시공사·영업 시작·제안 시작·운영사 선정 예상
      kind: pick(r, 'building_type', 'type', 'kind'), region: pick(r, 'region', 'sido'), priority: pick(r, 'sales_priority', 'priority'),
      dates: [['승인일', day(pick(r, 'approval_date', 'approved_at'))], ['착공', day(pick(r, 'construction_start_date', 'start_construction_date'))], ['준공(예정)', day(pick(r, 'completion_date', 'expected_completion_date'))],
        ['입주(예정)', day(pick(r, 'move_in_date', 'expected_move_in_date'))], ['세대수', pick(r, 'household_count', 'households', 'total_households', 'units')], ['시행사', pick(r, 'developer', 'executor')], ['시공사', pick(r, 'builder', 'constructor', 'contractor')],
        ['영업 시작', day(pick(r, 'sales_start_date', 'start_date'))], ['제안 시작', day(pick(r, 'proposal_start_date'))], ['운영사 선정 예상', day(pick(r, 'operator_selection_date', 'expected_operator_selection'))]],
      firstSeen: firstSeen(r), raw: r })) };
    if (tab === 'facilities') {
      const P = new Map((await prog('operating_facility_prospects__progress', 20000)).map((p) => [String(p.id ?? p.__id), p]));
      const items = (await rows('global', 'operating_facility_prospects', 20000)).filter((r) => hit(r) && dayOk(r)).map((r) => { const p = P.get(String(r.id ?? r.__id));
        return { id: r.__id, name: pick(r, 'name', 'facility_name', 'complex_name') ?? '(이름 없음)', address: pick(r, 'address', 'road_address'), score: Number(pick(r, 'score', 'priority_score') ?? 0) || null,
          lane: pick(r, 'facility_type', 'lane', 'category', 'kind'), region: pick(r, 'region'), operating: pick(r, 'operating_status'), date: day(pick(r, 'completion_date', 'use_approval_date', 'completed_at', 'move_in_date')),
          contact: p?.contact_status ?? null, next: day(p?.next_action_date ?? null), leadId: p?.lead_id ?? null,
          // 영업관리 2-8 한 줄 순서: 판정 · 유형·지역·세대·규모·현 위탁사 · 주소 · 관리사무소 전화 · 부대시설 · DB 등록 · 준공·입주 · 다음 연락 · 최근 기록 · 다음 조치
          // S1-3: 원본 칸 household_count·facility_scale(+facility_scale_unit)·completion_date, 다음 조치는 회사 진행(__progress.next_action) → 수집기 제안(etl_suggested_next_action) 순, 최근 기록 notes
          verdict: pick(r, 'verdict', 'judgment', 'stage_label', 'opportunity_label'), households: pick(r, 'household_count', 'households', 'total_households', 'units'), scale: scaleOf(r),
          operator: pick(r, 'current_operator', 'operator', 'management_company'), phone: pick(r, 'office_phone', 'management_phone', 'phone'), amenities: pick(r, 'amenities', 'facilities', 'community_facilities'),
          firstSeen: firstSeen(r), moveIn: day(pick(r, 'move_in_date', 'move_in_start')), lastNote: p?.notes ?? p?.last_note ?? p?.memo ?? null,
          nextAction: p?.next_action ?? pick(r, 'etl_suggested_next_action', 'next_action', 'recommended_action'), nextActionFrom: p?.next_action ? '진행 기록' : pick(r, 'etl_suggested_next_action') ? '수집기 제안' : null,
          elapsedDays: daysSince(day(pick(r, 'move_in_date', 'move_in_start')) ?? day(pick(r, 'completion_date', 'use_approval_date', 'completed_at'))), raw: r }; })
        .sort((a, b) => (Number(b.households ?? 0) - Number(a.households ?? 0)) || ((b.score ?? -1) - (a.score ?? -1))).slice(0, 300);
      return { ...meta, tab, items };
    }
    if (tab === 'vendors') {
      const P = new Map((await prog('vendor_registrations__progress')).map((p) => [String(p.id ?? p.__id), p]));
      return { ...meta, tab, items: (await rows('global', 'vendor_registrations')).filter((r) => hit(r) && dayOk(r)).map((r) => { const p = P.get(String(r.id ?? r.__id));
        return { id: r.__id, name: pick(r, 'company', 'company_name', 'name') ?? '(이름 없음)', division: pick(r, 'category', 'division', 'kind'), rank: pick(r, 'rank_label', 'rank'), notice: pick(r, 'notice_title', 'title', 'notice'),
          url: pick(r, 'recruit_url', 'url', 'notice_url'), status: p?.status ?? null, memo: p?.memo ?? null, next: day(p?.next_date ?? null), leadId: p?.lead_id ?? null,
          // 영업관리 2-9 카드: 모집 공지 공개 여부·모집 시기·등록 요건·공동인증서·비고·링크
          // S1-3: 원본 칸 recruit_visibility·recruit_timing·cert_required·register_url·recruit_url 먼저
          open: pick(r, 'recruit_visibility', 'recruit_open', 'notice_open', 'is_open'), period: pick(r, 'recruit_timing', 'recruit_period', 'period'), requirement: pick(r, 'requirements', 'registration_requirements', 'register_requirements'), cert: pick(r, 'cert_required', 'certificate', 'joint_certificate'),
          note: pick(r, 'notes', 'note', 'remark'), applyUrl: pick(r, 'register_url', 'apply_url', 'registration_url'), portalUrl: pick(r, 'portal_url'), homepage: pick(r, 'homepage', 'website'), firstSeen: firstSeen(r), raw: r }; }) };
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
