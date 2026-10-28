// 당일 입찰 다이제스트(21라인 맞춤메일 역할) — 대표 10/21 08:45 ②③. 매일 회사 설정 시각(기본 08:00 KST) 그날 새로 들어온 공고(회사 맞춤 설정 통과분)를
// ① 메일(받는 사람 = 영업 담당·대표 + 직접 넣은 주소) ② 워크인 알림·앱 푸시 ③ 영업 홈 '오늘 새 공고' 카드로.
// #509(대표 10/23 17:30): 메일은 워크인 발송(받은메일함) 먼저 · 받는 주소 직접 추가(최대 5) · 보낸 사람 이름 · 답장 주소.
// #510(같은 날 '21라인 수준'): 구역(★ 즉시 검토 → 검토 → 마감 임박 → 정정·취소 → 참고) · 1부터 번호 · 빈칸 숨김 · 같은 공고번호는 최신 차수 1줄 · 구역 안 마감 임박 순 — 그리기는 digestMail.ts
import { z } from 'zod';
import { db } from '../db';
import { isAdmin } from '../access';
import { assertSpace } from '../spaces';
import { forbidden } from '../errors';
import { appUrl, mailConfigured, mailDevMode, sendMail } from '../mail';
import { notify } from '../notifications';
import { audit } from '../log';
import { zUuid } from '../api';
import { tenantOf, type SessionUser } from '../types';
import { CLOSED_STATUS, initialClassification, isAwardResult, matchFit, onbidSale, partnerNeed } from './collectors/procurement';
import { vendorDateOk } from './collectors/vendorRules';
import { BID_COLLECTORS } from './collectors';
import { listBizCats, matchBiz, type BizCat } from './bizCats';
import { regionLimit, sidoIn, type RegionLimit } from './region';
import { digestMail } from './digestMail';
import { eligSay, eligView } from './eligibilityText';
import { SKIP_ONLY, noKey, noticeKeys, projectSkipOf, settledWork, titleKey } from './noticeGroups';
import { fixG2bUrl, searchHint, type SearchHint } from './sourceLink';

const SIDO = ['서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종', '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'];
const words = z.array(z.string().trim().min(1).max(40)).max(50);
const email = z.string().trim().toLowerCase().email('메일 주소 형식이 아닙니다(예: name@company.co.kr)').max(200);
export const prefsInput = z.object({ keywords: words.optional(), excludes: words.optional(), regions: z.array(z.string().max(10)).max(17).optional(), issuers: words.optional(), itemCodes: z.array(z.string().trim().min(1).max(20)).max(50).optional(),
  amountMin: z.number().int().min(0).nullable().optional(), amountMax: z.number().int().min(0).nullable().optional(), digestEnabled: z.boolean().optional(), digestHour: z.number().int().min(0).max(23).optional(), digestMail: z.boolean().optional(), digestTo: z.array(zUuid).max(20).optional(),
  // #509 b·c: 직원 선택 말고 메일 주소 직접(회사 메일 등, 최대 5) · 보낸 사람 이름(비우면 '<회사 이름> 영업실') · 답장 주소(비우면 회사 메일 계정 주소)
  digestEmails: z.array(email).max(5, '메일 주소는 5개까지 넣을 수 있습니다').optional(), digestFromName: z.string().trim().max(60).nullable().optional(), digestReplyTo: z.union([z.literal(''), email]).nullable().optional() });
export type Prefs = { keywords: string[]; excludes: string[]; regions: string[]; issuers: string[]; item_codes: string[]; amount_min: number | null; amount_max: number | null; digest_enabled: boolean; digest_hour: number; digest_mail: boolean; digest_to: string[];
  digest_emails: string[]; digest_from_name: string | null; digest_reply_to: string | null };
const DEF: Prefs = { keywords: [], excludes: [], regions: [], issuers: [], item_codes: [], amount_min: null, amount_max: null, digest_enabled: true, digest_hour: 8, digest_mail: true, digest_to: [], digest_emails: [], digest_from_name: null, digest_reply_to: null };
export async function prefsOf(tenant: string): Promise<Prefs> { const [p] = await db()<any[]>`select * from sales_bid_prefs where tenant = ${tenant}`; return p ? { ...DEF, ...p, digest_emails: p.digest_emails ?? [], amount_min: p.amount_min == null ? null : Number(p.amount_min), amount_max: p.amount_max == null ? null : Number(p.amount_max) } : { ...DEF }; }
const companyName = async (tenant: string) => (await db()<{ name: string }[]>`select name from tenants where id = ${tenant}`)[0]?.name ?? '워크인';
const fromNameOf = (p: Prefs, company: string) => (p.digest_from_name?.trim() || `${company} 영업실`).slice(0, 60);
/** #509: 이 회사 당일 메일이 나가는 길 — 화면 안내·답장 주소 기본값 */
async function mailRoute(tenant: string, p: Prefs) {
  const { systemChannel } = await import('../mailbox');
  const r = await systemChannel(tenant);
  return { channel: r.channel, smtpFrom: r.smtpFrom, fallback: r.channel ? null : mailConfigured() ? 'resend' as const : mailDevMode() ? 'dev' as const : null,
    fromName: fromNameOf(p, await companyName(tenant)), replyTo: p.digest_reply_to || r.smtpFrom };
}
export async function getPrefs(u: SessionUser) {
  await assertSpace(u, 'sales'); const t = tenantOf(u);
  const people = await db()<{ id: string; name: string; email: string; role: string }[]>`select u.id, u.name, u.email, u.role from users u where u.tenant = ${t} and u.status = 'active' and (u.role in ('owner', 'admin') or exists (select 1 from space_members m where m.user_id = u.id and m.spaces @> array['sales']::text[])) order by u.name`;
  const [last] = await db()<any[]>`select day, counts, items, mailed, notified, created_at from sales_digests where tenant = ${t} order by day desc limit 1`;
  const prefs = await prefsOf(t);
  return { prefs, people, last: last ?? null, canEdit: isAdmin(u), mail: await mailRoute(t, prefs) };
}
export async function savePrefs(u: SessionUser, i: z.infer<typeof prefsInput>) {
  await assertSpace(u, 'sales'); if (!isAdmin(u)) throw forbidden('맞춤 설정은 관리자가 바꿉니다');
  const sql = db(); const t = tenantOf(u); const cur = await prefsOf(t);
  const n: Prefs = { keywords: i.keywords ?? cur.keywords, excludes: i.excludes ?? cur.excludes, regions: (i.regions ?? cur.regions).filter((r) => SIDO.includes(r)), issuers: i.issuers ?? cur.issuers, item_codes: i.itemCodes ?? cur.item_codes,
    amount_min: i.amountMin === undefined ? cur.amount_min : i.amountMin, amount_max: i.amountMax === undefined ? cur.amount_max : i.amountMax, digest_enabled: i.digestEnabled ?? cur.digest_enabled, digest_hour: i.digestHour ?? cur.digest_hour, digest_mail: i.digestMail ?? cur.digest_mail, digest_to: i.digestTo ?? cur.digest_to,
    digest_emails: i.digestEmails ? [...new Set(i.digestEmails)] : cur.digest_emails, digest_from_name: i.digestFromName === undefined ? cur.digest_from_name : i.digestFromName?.trim() || null,
    digest_reply_to: i.digestReplyTo === undefined ? cur.digest_reply_to : i.digestReplyTo || null };
  await sql`insert into sales_bid_prefs (tenant, keywords, excludes, regions, issuers, item_codes, amount_min, amount_max, digest_enabled, digest_hour, digest_mail, digest_to, digest_emails, digest_from_name, digest_reply_to, updated_by)
    values (${t}, ${n.keywords}, ${n.excludes}, ${n.regions}, ${n.issuers}, ${n.item_codes}, ${n.amount_min}, ${n.amount_max}, ${n.digest_enabled}, ${n.digest_hour}, ${n.digest_mail}, ${n.digest_to}::uuid[], ${n.digest_emails}, ${n.digest_from_name}, ${n.digest_reply_to}, ${u.id})
    on conflict (tenant) do update set keywords = excluded.keywords, excludes = excluded.excludes, regions = excluded.regions, issuers = excluded.issuers, item_codes = excluded.item_codes, amount_min = excluded.amount_min, amount_max = excluded.amount_max, digest_enabled = excluded.digest_enabled,
      digest_hour = excluded.digest_hour, digest_mail = excluded.digest_mail, digest_to = excluded.digest_to, digest_emails = excluded.digest_emails, digest_from_name = excluded.digest_from_name, digest_reply_to = excluded.digest_reply_to, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'sales_bid_prefs.save', 'tenant', null, { keywords: n.keywords.length, regions: n.regions, emails: n.digest_emails.length }).catch(() => {});
  return prefsOf(t);
}
const kstDay = (d: Date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const kstHour = () => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
const dayOf = (v: unknown) => { const s = String(v ?? ''); const m = s.match(/^(\d{4}-\d{2}-\d{2})/); if (!m) return null; if (/T|\s\d{2}:/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? m[1] : kstDay(d); } return m[1]; };
const plusDays = (day: string, n: number) => kstDay(new Date(Date.parse(`${day}T12:00:00+09:00`) + n * 864e5));
const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
/** 원천 날짜·시각 → 서울 기준 'YYYY-MM-DD HH:MM'(시각이 없거나 00:00 이면 날짜만). 형식: 2026-10-28 17:00(:00) · 2026-10-28T17:00:00+09:00 · 202610281700 */
function when(v: unknown): { d: string; t: string | null } | null {
  const s = String(v ?? '').trim(); const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T\s]?(\d{2}):?(\d{2}))?/); if (!m) return null;
  if (/[T\s]\d{2}:?\d{2}.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const x = new Date(s);
    if (!Number.isNaN(x.getTime())) { const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(x); return { d: kstDay(x), t: t === '00:00' ? null : t }; }
  }
  const t = m[4] ? `${m[4]}:${m[5]}` : null;
  return { d: `${m[1]}-${m[2]}-${m[3]}`, t: t === '00:00' ? null : t };
}
const fmtWhen = (w: ReturnType<typeof when>) => (w ? (w.t ? `${w.d} ${w.t}` : w.d) : null);
export type DigestSection = 'now' | 'review' | 'soon' | 'change' | 'result' | 'ref';
export type DigestItem = { id: string; title: string; issuer: string | null; region: string | null; source: string; url: string; kind: string; fit: string | null; keywords: string[]; estimated: number | null; deadline: string | null; dday: number | null; participation: string | null; opening: string | null; attachments: number; why: string; seenAt?: string | null; late?: boolean; /** 185차: 예전 규칙으로 빠졌다가 다시 판정으로 찾은 공고 */ refound?: boolean; posted?: string | null;
  /** #510 21라인 칸 */ section: DigestSection; noticeNo: string | null; badges: string[]; biz: { name: string; color: string }[]; tags: string[]; amount: string | null; deadlineAt: string | null; participationAt: string | null; openingAt: string | null; briefingAt: string | null; /** 239차(#744): 현장설명 필수·임의·공고문 참조 · 장소 */ briefingKind?: string | null; briefingPlace?: string | null; /** 252차 #786 참가자격 한 줄(공고문 절) */ elig?: string | null; bidSystem: string | null;
  /** #543 바로 가는 상세 주소가 없는 원천 — [원문] 대신 '○○에서 번호 검색' */ search?: SearchHint | null;
  /** 결과 줄: '낙찰 ○○ · 1.2억' / '유찰' */ result?: string | null;
  /** 215차(#530 로컬 10/24 ③④⑨): 금액 칸 나눔(기초금액·추정가격·배정예산) · 참가 제한 지역과 본사 기준 참가 가능 · 이 회사 진행(상태·담당) */ amounts?: string[]; limit?: RegionLimit | null; progress?: string | null };
/** 215차(#530 ①②): 메일 머리 — 받은 기간·맞춤 조건 상자 */
export type DigestCond = { biz: string[]; keywords: number; excludes: number; regions: string[]; issuers: number; itemCodes: number; amountMin: number | null; amountMax: number | null; hq: string | null };
/** #476 a: 지난 메일(그 전날까지의 마지막 다이제스트) 이후 처음 본 공고 — 그날 메일 뒤에 들어온 공고가 다음 날 메일에서 빠지지 않게. 3일 넘게 비었거나 처음이면 그날 0시(KST)부터 */
export async function digestSince(tenant: string, day: string): Promise<Date> {
  const start = new Date(`${day}T00:00:00+09:00`);
  const [prev] = await db()<{ created_at: Date }[]>`select created_at from sales_digests where tenant = ${tenant} and day < ${day} order by day desc limit 1`;
  const at = prev ? new Date(prev.created_at) : null;
  return at && at < start && start.getTime() - at.getTime() <= 3 * 864e5 ? at : start;
}
/** 회사 맞춤 필터: 우리 업종 적합(matchFit) 또는 관심 검색어 → 제외어·지역·발주처·금액으로 거름. fit = 적합 사업(없으면 검색어만 일치 → '참고') */
export function passPrefs(r: any, p: Prefs): { ok: boolean; why: string; fit: string | null } {
  const text = `${r.title ?? ''} ${r.bid_category ?? ''} ${r.task_scope ?? ''}`; const t = norm(text);
  if (p.excludes.some((w) => t.includes(norm(w)))) return { ok: false, why: '제외어', fit: null };
  const fit = r.fit_business ? String(r.fit_business) : matchFit(String(r.title ?? ''), r.bid_category, r.task_scope).fit;
  const kw = p.keywords.filter((w) => t.includes(norm(w)));
  if (!fit && !kw.length && r.source_type !== 'vendor_recruit') return { ok: false, why: '업종 무관', fit: null };
  if (p.regions.length) { const reg = String(r.region ?? r.region_restriction ?? ''); if (reg && !/전국/.test(reg) && !p.regions.some((s) => reg.includes(s))) return { ok: false, why: '지역', fit }; }
  if (p.issuers.length) { const iss = `${r.issuer ?? ''} ${r.demand_agency ?? ''}`; if (!p.issuers.some((w) => norm(iss).includes(norm(w)))) return { ok: false, why: '발주처', fit }; }
  if (p.item_codes.length) { const code = String(r.industry_code ?? r.item_code ?? ''); if (code && !p.item_codes.some((c) => code.includes(c))) return { ok: false, why: '물품코드', fit }; }
  const amt = r.estimated_amount ?? r.budget_amount; if (amt != null && amt !== '') { const n = Number(amt); if (p.amount_min != null && n < p.amount_min) return { ok: false, why: '금액 미만', fit }; if (p.amount_max != null && n > p.amount_max) return { ok: false, why: '금액 초과', fit }; }
  return { ok: true, why: [fit ? `적합 ${fit}` : null, kw.length ? `검색어 ${kw.join('·')}` : null, r.source_type === 'vendor_recruit' ? '협력사 모집' : null].filter(Boolean).join(' · '), fit };
}
const SRC: Record<string, string> = { kapt_bid: 'K-apt', g2b_bid: '나라장터', nuri_bid: '누리장터', g2b_prespec: '나라장터 사전규격', lh_bid: 'LH', lh_prespec: 'LH 사전규격', d2b_bid: '국방', onbid_lease: '온비드 임대', vendor_recruit: '협력사 모집' };
const SLUG_OF: Record<string, string> = { kapt_bid: 'kapt_bid_notices', g2b_bid: 'g2b_bid_notices', nuri_bid: 'g2b_bid_notices', g2b_prespec: 'g2b_prespec_awards', lh_bid: 'public_agency_bids', lh_prespec: 'public_agency_bids', d2b_bid: 'public_agency_bids', onbid_lease: 'public_agency_bids', vendor_recruit: 'vendor_recruit_watch' };
const SECTION_ORDER: DigestSection[] = ['now', 'review', 'soon', 'change', 'result', 'ref'];
const num = (v: unknown) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[,\s원]/g, '')); return Number.isFinite(n) ? n : null; };
const won = (n: number) => (n >= 1e8 ? `${(n / 1e8).toFixed(1).replace(/\.0$/, '')}억` : n >= 1e4 ? `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원` : `${n.toLocaleString('ko-KR')}원`);
/** 결과 한 줄: '낙찰 ○○ · 낙찰금액 1.2억' / '유찰' */
const resultOf = (r: any) => { const w = String(r.winner_name ?? r.award_company ?? r.successful_bidder ?? '').trim(); const a = num(r.winner_amount ?? r.award_amount);
  const rate = num(r.winner_rate), n = num(r.bidders); // #530 ⑥: 낙찰률·참가 업체 수(나라장터 낙찰정보에 있을 때)
  const tail = `${rate && rate > 0 ? ` · 낙찰률 ${Math.round(rate * 1000) / 1000}%` : ''}${n && n > 0 ? ` · 참가 ${n.toLocaleString('ko-KR')}곳` : ''}`;
  return w ? `낙찰 ${w}${a && a > 0 ? ` · 낙찰금액 ${won(a)}` : ''}${tail}` : /유찰/.test(String(r.current_status ?? '')) ? `유찰${tail}` : `낙찰${tail}`; };
/** 232차: 지난 메일 결과 줄(resultOf 문장)에 없던 낙찰자·낙찰금액·낙찰률·참가 수가 생겼나 */
const gained = (was: string, now: string) => (/^낙찰 (?!·)/.test(now) && !/^낙찰 (?!·)/.test(was)) || [' · 낙찰금액', ' · 낙찰률', ' · 참가 '].some((w) => now.includes(w) && !was.includes(w));
/** #530 ③(로컬 10/24): 금액 칸을 나눔 — 기초금액·추정가격·배정예산(사전규격·나라장터)을 있는 것만. 모두 0 이면 '미공개'('0만원' 금지), 없으면 칸을 숨김 */
const amountsOf = (r: any) => { const base = num(r.base_amount), est = num(r.estimated_amount), bud = num(r.budget_amount);
  const out = [base && base > 0 ? `기초금액 ${won(base)}` : null, est && est > 0 ? `추정가격 ${won(est)}` : null, bud && bud > 0 ? `배정예산 ${won(bud)}` : null].filter((x): x is string => !!x);
  return out.length ? out : est === 0 || bud === 0 || base === 0 ? ['추정가격 미공개'] : []; };
/** 지역: 원천 지역 → 비면(나라장터 '지역 -') 참가가능지역·발주처·수요기관·주소·단지·제목에서 시도 */
const regionOf = (r: any) => { const v = String(r.region ?? '').trim(); return v && v !== '-' ? v : sidoIn(r.region_restriction, r.issuer, r.demand_agency, r.office_address, r.facility_name, r.title); };
/** 업종 태그: 입찰 분류(K-apt '사업자 - 공사 - 일반보수'·'용역 > 주민운동시설의 위탁' 은 나눠서, 앞의 '사업자' 뺌) + 업종 제한 이름(숫자 코드는 뺌), 3개까지 */
const tagsOf = (r: any) => [...new Set([...String(r.bid_category ?? '').split(/\s*(?:&gt;|>|›)\s*|\s+-\s+/).map((x) => x.trim()).filter((x) => x && x !== '사업자' && x.length <= 20),
  ...(String(r.industry_code ?? '').trim() && !/^[\d,\s]+$/.test(String(r.industry_code)) ? [String(r.industry_code).trim().slice(0, 20)] : [])])].slice(0, 3);
/** 같은 공고 판단 열쇠(noticeGroups): 나라장터·누리장터는 '번호-차수'라 차수를 뗀 번호 — 번호가 없으면 그 줄만 */
const nk = (r: any, id: string) => noKey(r).key ?? `#${id}`;
const at = (v: unknown) => { const t = Date.parse(String(v ?? '')); return Number.isNaN(t) ? null : t; };
const sysKey = (v: unknown) => String(v ?? '').toUpperCase().replace(/[^0-9A-Z가-힣]/g, '');
/**
 * 회사의 공고 진행 기록 — 진행 기록(opportunity_work, 정식 표 sales_work_records)·영업 업무(tasks.sales_ref bid)가 걸린 공고 id,
 * 그리고 회사 판단으로 바꾼 분류(procurement_notices__progress.classification — '즉시 검토' 구역 판단에 우선)
 */
async function tenantLinks(tenant: string, ids: string[]) {
  const linked = new Set<string>(); const cls = new Map<string, string>(); const work = new Map<string, { status: string | null; who: string | null }>();
  if (!ids.length) return { linked, cls, work };
  const rows = await db()<{ id: string | null; kind: string; cls: string | null; status: string | null; who: string | null }[]>`
    select coalesce(data->>'notice_id', ref_id, src_id) as id, src_tbl as kind, data->>'classification' as cls, status, null::text as who from sales_work_records
      where tenant = ${tenant} and src_tbl in ('opportunity_work', 'procurement_notices__progress') and (ref_id = any(${ids}::text[]) or src_id = any(${ids}::text[]) or data->>'notice_id' = any(${ids}::text[]))
    union all select coalesce(w.row->>'notice_id', w.row->>'procurement_notice_id', w.src_id), w.tbl, w.row->>'classification', w.row->>'status', null::text from sales_src_rows w
      where w.scope = ${tenant} and w.tbl in ('opportunity_work', 'procurement_notices__progress') and (w.src_id = any(${ids}::text[]) or w.row->>'notice_id' = any(${ids}::text[]) or w.row->>'procurement_notice_id' = any(${ids}::text[]))
    union all select t.sales_ref->>'id', 'task', null::text, null::text, u.name from tasks t join org_units o on o.id = t.org_unit_id left join users u on u.id = t.assignee_id
      where o.tenant = ${tenant} and t.deleted_at is null and t.sales_ref->>'kind' = 'bid' and t.sales_ref->>'id' = any(${ids}::text[])`;
  for (const r of rows) {
    if (!r.id) continue;
    if (r.kind === 'procurement_notices__progress') { if (r.cls) cls.set(r.id, r.cls); continue; }
    linked.add(r.id);
    // 215차(#530 ⑨): 메일 줄에 이 회사 진행(미검토·대상 아님 말고 상태) · 입찰 업무 담당
    const w = work.get(r.id) ?? { status: null, who: null };
    if (r.kind === 'task') w.who ??= r.who; else if (settledWork(r.status)) w.status ??= String(r.status).trim();
    work.set(r.id, w);
  }
  return { linked, cls, work };
}
/** 대표 10/24 추가 ②: 이 회사가 '대상 아님'으로 넘긴 공고 — 같은 공고의 다른 게시(같은 번호 취소·정정 공고, 같은 제목·기관·마감 재게시)도 메일에서 뺌. 그 게시에 다른 진행 기록이 있으면 그대로.
 * 137차: 같은 사업(사전규격 ↔ 본 공고, noticeGroups.sameProject)도 — 목록과 같은 기준(미검토 말고 진행 기록이 있으면 그대로) */
async function notTargets(tenant: string) {
  const sql = db(); const { writesOpen } = await import('./cutover');
  const w = (await writesOpen(tenant))
    ? await sql<{ id: string | null; status: string | null }[]>`select coalesce(data->>'notice_id', ref_id) as id, status from sales_work_records where tenant = ${tenant} and src_tbl = 'opportunity_work'`
    : await sql<{ id: string | null; status: string | null }[]>`select coalesce(row->>'notice_id', row->>'procurement_notice_id') as id, row->>'status' as status from sales_src_rows where scope = ${tenant} and tbl = 'opportunity_work'`;
  const ids = new Set(w.filter((x) => x.id && SKIP_ONLY.test(String(x.status ?? ''))).map((x) => String(x.id)));
  const live = new Set(w.filter((x) => x.id && !SKIP_ONLY.test(String(x.status ?? ''))).map((x) => String(x.id)));
  const settled = new Set(w.filter((x) => x.id && settledWork(x.status)).map((x) => String(x.id)));
  const keys = new Set<string>(); const skippedRows: any[] = [];
  if (ids.size) for (const { row } of await sql<{ row: any }[]>`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and (src_id = any(${[...ids]}::text[]) or row->>'id' = any(${[...ids]}::text[]))`) { skippedRows.push(row); for (const k of noticeKeys(row)) keys.add(k); }
  const project = projectSkipOf(skippedRows);
  return (id: string, r: any) => ids.has(id) || (!live.has(id) && noticeKeys(r).some((k) => keys.has(k))) || (!settled.has(id) && !!project(r));
}
type Cand = { id: string; r: any; isNew: boolean; kind: string; late: boolean; fit: string | null; why: string; soon?: boolean; refound?: boolean; filled?: boolean };
/** 지난 메일 이후(digestSince) 처음 본 공고 + 그 뒤 정정·취소로 바뀐 공고 → 회사 맞춤 통과분 → 구역. 마감 임박 = 이미 받은 관련 공고 중 D-3 이내·진행 기록 없음 */
export async function buildDigest(tenant: string, day = kstDay()) {
  const sql = db(); const p = await prefsOf(tenant); const cats: BizCat[] = await listBizCats(tenant).catch(() => []);
  const off = new Set((await sql<{ slug: string }[]>`select slug from sales_collector_settings where tenant = ${tenant} and not enabled`).map((r) => r.slug));
  const since = await digestSince(tenant, day); const sinceMs = since.getTime(); const dayStart = Date.parse(`${day}T00:00:00+09:00`);
  // first_seen_at·updated_at 은 UTC ISO 문자열 — 하루 넓게 거르고(#148) 정확한 비교는 아래 시각으로
  const from = new Date(sinceMs - 864e5).toISOString().slice(0, 10);
  // 232차(로컬 10/28 15:40 남원시 '결과를 처음 안 때'가 빔 — 원본 영업관리 복사 줄): 지난 4일 메일에 이미 나간 결과 — result_at 이 없는 줄(215차 전에 알게 된 결과·원본 복사 줄)도
  // 같은 결과를 다시 '오늘 결과'로 내지 않고, 바로 전 메일 결과 줄에 없던 낙찰자·낙찰금액·낙찰률·참가 수가 생겼으면 '보완' 한 줄로(그 전 메일 줄은 다시 안 내기만). 원본 매일 복사가 updated_at 을 원본 값으로 돌려도 그 줄들은 읽음
  const sent = new Map<string, { v: string; last: boolean }>(); const sentIds = new Set<string>(), sentNos = new Set<string>();
  const past = await sql<{ day: string; items: any }[]>`select day::text as day, items from sales_digests where tenant = ${tenant} and day < ${day} and day >= ${plusDays(day, -4)} order by day`;
  for (const d of past) for (const it of Array.isArray(d.items) ? d.items : []) if (it?.section === 'result') {
    const e = { v: String(it.result ?? ''), last: d.day === past[past.length - 1].day }; sent.set(String(it.id), e); sentIds.add(String(it.id));
    if (it.noticeNo) { sent.set(`${it.source}|${it.noticeNo}`, e); sentNos.add(String(it.noticeNo)); }
  }
  const rows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where tbl = 'procurement_notices' and scope = 'global' and not gone and (row->>'first_seen_at' >= ${from} or row->>'updated_at' >= ${from} or row->>'refound_at' >= ${from}
    or row->>'result_at' >= ${from} or row->>'result_filled_at' >= ${from} or src_id = any(${[...sentIds]}::text[]) or row->>'source_external_id' = any(${[...sentNos]}::text[])) limit 5000`;
  const skipped: Record<string, number> = {}; const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };
  const notTarget = await notTargets(tenant);
  const cands: Cand[] = [];
  for (const { src_id, row: r } of rows) {
    const slug = SLUG_OF[String(r.source_type)] ?? ''; if (slug && off.has(slug)) continue;
    const seen = at(r.first_seen_at); const upd = at(r.updated_at);
    const ref = at(r.refound_at); const refound = ref != null && ref >= sinceMs && !(seen != null && seen >= sinceMs); // 185차: 다시 판정으로 찾은 공고는 찾은 날 한 번 새 공고로
    const isNew = (seen != null && seen >= sinceMs) || refound; const kind0 = String(r.notice_kind ?? 'new'); const result = isAwardResult(r);
    // 215차(#530): 결과는 처음 알게 된 때(result_at) 기준 — 낙찰률 채우기·금액 고침으로 결과 줄이 다시 고쳐져도 예전 결과가 '오늘 결과'로 다시 오르지 않게(result_at 없는 예전 줄은 개찰 3일 안만)
    const resAt = at(r.result_at); const awardDay = dayOf(r.award_date);
    const was = result ? sent.get(String(r.id ?? src_id)) ?? sent.get(`${SRC[String(r.source_type)] ?? r.source_type}|${String(r.source_external_id ?? '').trim()}`) : undefined;
    const resultToday = result && was === undefined && (resAt != null ? resAt >= sinceMs : upd != null && upd >= sinceMs && !(awardDay && awardDay < plusDays(day, -3)));
    // 230차(로컬 10/28 14:40 남원시): 지난 메일에 낙찰자·금액만 나간 결과에 낙찰률·참가 수가 뒤늦게 채워지면 '보완' 한 줄로 한 번 더
    // 232차: 지난 메일에 나간 결과는 그 메일 결과 줄과 비교(result_at 이 없어도) · 안 나간 결과는 230차대로 result_filled_at
    const filledAt = at(r.result_filled_at);
    const filledToday = result && !resultToday && (was !== undefined ? was.last && gained(was.v, resultOf(r)) : resAt != null && filledAt != null && filledAt >= sinceMs);
    const changedToday = (upd != null && upd >= sinceMs && (kind0 === 'cancel' || kind0 === 'amend' || String(r.current_status ?? '') === '취소')) || resultToday || filledToday;
    if (!isNew && !changedToday) continue;
    if (r.source_type === 'vendor_recruit' && (!r.posted_date || !vendorDateOk(r))) { skip('게시일 미상'); continue; } // #476 e·후속: 게시판 날짜로 확인 못 한 협력사 줄(조각·메뉴·예전 방식)은 메일·오늘 탭에서 뺌
    if (onbidSale(r)) { skip('온비드 매각'); continue; } // #537 후속2(로컬 10/24 12:58): 온비드는 임대·사용허가만
    if (notTarget(String(r.id ?? src_id), r)) { skip('대상 아님'); continue; }
    const f = passPrefs(r, p); if (!f.ok) { skip(f.why); continue; }
    // 234차: 결과 줄은 처음 본 날이 아니라 결과를 안 때로 — 새로 들어온 오래된 결과(result_at 이 그날 끝)는 오늘 결과가 아님
    if (result) { if ((isNew && resAt == null) || resultToday || filledToday) cands.push({ id: String(r.id ?? src_id), r, isNew, kind: 'result', late: false, fit: f.fit, why: f.why, ...(filledToday && !isNew ? { filled: true } : {}) }); continue; } // 결과는 마감이 지났어도(낙찰은 마감 뒤) '결과' 묶음
    const dl = dayOf(r.deadline_at);
    if (dl && dl < day) { skip('마감 지남'); continue; } // 첫 수집일에 과거 마감 공고가 '새 공고'로 섞이지 않게(로컬 10/21 10:55)
    cands.push({ id: String(r.id ?? src_id), r, isNew, kind: String(r.current_status ?? '') === '취소' ? 'cancel' : kind0, late: isNew && !refound && seen! < dayStart, fit: f.fit, why: f.why, refound });
  }
  // 같은 공고(원천 + 번호, 나라장터는 차수 뺌) → 최신 차수 1줄 · 번호가 달라도 제목·발주처·마감·종류가 같으면 1줄(삼척 정정 001·002, 같은 취소 두 줄)
  let merged = 0;
  const latest = <T extends { r: any }>(list: T[], keyOf: (c: T) => string, rank: (c: T) => number) => {
    const m = new Map<string, T>();
    for (const c of list) { const k = keyOf(c); const o = m.get(k); if (!o) { m.set(k, c); continue; } merged++; if (rank(c) > rank(o) || (rank(c) === rank(o) && (at(c.r.updated_at) ?? 0) > (at(o.r.updated_at) ?? 0))) m.set(k, c); }
    return [...m.values()];
  };
  const today = latest(latest(cands, (c) => nk(c.r, c.id), (c) => noKey(c.r).ord),
    (c) => `${norm(String(c.r.title ?? ''))}|${norm(String(c.r.issuer ?? c.r.demand_agency ?? ''))}|${dayOf(c.r.deadline_at) ?? ''}|${c.kind === 'amend' || c.kind === 'cancel' || c.kind === 'result' ? c.kind : 'new'}`, () => 0);
  // 마감 임박: 이미 받은 공고(지난 메일 전에 처음 본) 중 관련 사업·D-3 이내·취소/마감 아님·진행 기록 없음
  const end = plusDays(day, 4); const todayKeys = new Set(today.map((c) => nk(c.r, c.id)));
  // 239차(#744): 필수 현장설명이 D-3 안이면 입찰 마감이 멀어도 함께(현장설명에 빠지면 입찰 못 함)
  const soonRows = await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where tbl = 'procurement_notices' and scope = 'global' and not gone
    and ((row->>'deadline_at' >= ${plusDays(day, -1)} and row->>'deadline_at' < ${end})
      or (row->>'site_briefing_kind' = '필수' and row->>'site_briefing_at' >= ${plusDays(day, -1)} and row->>'site_briefing_at' < ${end} and row->>'deadline_at' >= ${day})) limit 3000`;
  const soonCands: Cand[] = [];
  for (const { src_id, row: r } of soonRows) {
    const slug = SLUG_OF[String(r.source_type)] ?? ''; if (slug && off.has(slug)) continue;
    if (todayKeys.has(nk(r, String(r.id ?? src_id))) || notTarget(String(r.id ?? src_id), r)) continue;
    const seen = at(r.first_seen_at); if (seen != null && seen >= sinceMs) continue;
    if (r.source_type === 'vendor_recruit' || String(r.notice_kind ?? '') === 'cancel' || CLOSED_STATUS.test(String(r.current_status ?? '')) || onbidSale(r)) continue; // '마감임박'은 진행 중(#537 후속2)
    const f = passPrefs(r, p); if (!f.ok || !f.fit) continue;
    const dl = when(r.deadline_at); if (!dl) continue;
    const ahead = (w: NonNullable<ReturnType<typeof when>>) => { const n = Math.round((Date.parse(w.d) - Date.parse(day)) / 864e5); return n >= 0 && n <= 3 && !(n === 0 && w.t && Date.parse(`${w.d}T${w.t}:00+09:00`) < Date.now()); }; // 오늘인데 시각이 지남은 뺌
    const bf = r.site_briefing_kind === '필수' ? when(r.site_briefing_at) : null;
    if (!ahead(dl) && !(bf && ahead(bf) && dl.d >= day)) continue;
    soonCands.push({ id: String(r.id ?? src_id), r, isNew: false, kind: String(r.notice_kind ?? 'new'), late: false, fit: f.fit, why: f.why, soon: true });
  }
  const soon = latest(soonCands, (c) => nk(c.r, c.id), (c) => noKey(c.r).ord);
  // 대표 10/24 추가 ②: 같은 제목·기관·마감으로 먼저 게시된 공고가 있으면 '재게시'(K-apt 같은 공고 두 번 게시) — 화면은 한 카드 '2회 게시(…)'
  const titles = [...new Set(today.filter((c) => c.kind === 'new').map((c) => String(c.r.title ?? '')).filter(Boolean))].slice(0, 300);
  const reposted = new Set<string>();
  if (titles.length) {
    const tk = new Map(today.map((c) => [titleKey(c.r), c] as const).filter(([k]) => !!k));
    for (const { src_id, row } of await sql<{ src_id: string; row: any }[]>`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone and row->>'title' = any(${titles}::text[])`) {
      const c = tk.get(titleKey(row)); const seen = at(row.first_seen_at);
      if (c && String(row.id ?? src_id) !== c.id && nk(row, String(row.id ?? src_id)) !== nk(c.r, c.id) && seen != null && seen < (at(c.r.first_seen_at) ?? 0)) reposted.add(c.id);
    }
  }
  const { linked, cls, work } = await tenantLinks(tenant, [...today, ...soon].map((c) => c.id));
  // #530 ②④: 본사 시·도(영업 › 지원사업 회사 프로필, 없으면 회사 정보 주소) — 참가 제한 지역 공고의 참가 가능 판단·맞춤 조건 상자
  const prof = (await (await import('./support')).profileOf(tenant).catch(() => null))?.profile;
  const hq = prof?.region_sido ? { sido: prof.region_sido, sigungu: prof.region_sigungu ?? null } : null;
  const items: DigestItem[] = [];
  for (const c of [...today, ...soon]) {
    const r = c.r; const st = String(r.source_type ?? ''); const isChange = c.kind === 'amend' || c.kind === 'cancel'; const partner = c.kind === 'result' ? null : partnerNeed(r);
    let section: DigestSection;
    if (c.soon) { if (linked.has(c.id)) continue; section = 'soon'; }
    else if (c.kind === 'result') section = 'result';
    else if (isChange) section = c.fit || linked.has(c.id) ? 'change' : 'ref'; // 정정·취소는 관련 사업이거나 진행 기록이 걸린 것만 — 나머지는 '참고'
    else if (!c.fit && st !== 'vendor_recruit') section = 'ref'; // 검색어만 일치
    else section = (cls.get(c.id) ?? (partner ? '검토' : r.classification ?? initialClassification({ ...r, fit_business: c.fit }))) === '즉시 검토' ? 'now' : 'review'; // #752 면허 업체 협력 필요는 검토(회사가 바꾼 분류는 그대로)
    const dl = when(r.deadline_at); const dd = dl ? Math.round((Date.parse(dl.d) - Date.parse(day)) / 864e5) : null; const dday = c.kind === 'cancel' || (dd != null && dd < 0) ? null : dd; // 결과 줄은 마감이 지났음 — D-day 없음 · 로컬 10/25 10:55 취소 공고는 'D-n · 준비 시작' 없이 마감일만
    const state = String(r.notice_state ?? '');
    const method = `${r.contract_method ?? ''} ${r.award_method ?? ''}`; const briefing = fmtWhen(when(r.site_briefing_at ?? r.briefing_at ?? r.explanation_at ?? r.field_briefing_at ?? r.site_visit_at));
    // #530 ⑦(로컬 10/24): 21라인 범례처럼 공고 유형 배지 — 정정·취소·재공고·재게시·긴급 + 수의계약·견적·현장설명 · 결과는 낙찰/유찰
    const badges = c.kind === 'result' ? [/유찰/.test(String(r.current_status ?? '')) && !String(r.winner_name ?? '').trim() ? '유찰' : '낙찰', ...(c.filled ? ['보완'] : [])]
      : [c.kind === 'cancel' ? '취소' : c.kind === 'amend' || /정정|변경/.test(state) ? '정정' : null, c.kind === 'rebid' || /재공고/.test(state) ? '재공고' : reposted.has(c.id) ? '재게시' : null, c.kind === 'urgent' || /긴급/.test(state) ? '긴급' : null,
        /수의/.test(method) ? '수의계약' : null, /견적/.test(`${method} ${r.title ?? ''}`) ? '견적' : null, briefing && briefing.slice(0, 10) >= day && c.kind !== 'cancel' ? (r.site_briefing_kind === '필수' ? '현장설명 필수' : '현장설명') : null, c.kind !== 'cancel' ? partner : null].filter((x): x is string => !!x); // 현장설명 배지는 아직 안 지난 것만 · #752
    const amounts = amountsOf(r); const wk = work.get(c.id);
    const progress = wk && (wk.status || wk.who) ? [wk.status ? `진행 ${wk.status}` : '진행 기록 있음', wk.who ? `담당 ${wk.who}` : null].filter(Boolean).join(' · ') : null;
    const biz = matchBiz(r, cats).map((b) => ({ name: b.name, color: b.color }));
    items.push({ id: c.id, title: String(r.title ?? ''), issuer: r.issuer ?? r.demand_agency ?? null, region: regionOf(r), source: SRC[st] ?? st, url: fixG2bUrl(r.source_url) ?? '', search: searchHint({ source: st, url: r.source_url, externalId: r.source_external_id, noticeNo: r.notice_no }), kind: c.kind,
      fit: c.fit, keywords: Array.isArray(r.matched_keywords) ? r.matched_keywords : [], estimated: num(r.estimated_amount) ?? num(r.budget_amount), deadline: dl?.d ?? null, dday,
      participation: dayOf(r.participation_deadline_at), opening: dayOf(r.opening_at), attachments: Array.isArray(r.attachment_urls) ? r.attachment_urls.length : 0, why: c.why, seenAt: r.first_seen_at ?? null, late: c.late, refound: !!c.refound, posted: dayOf(r.posted_date),
      section, noticeNo: st === 'vendor_recruit' ? null : String(r.source_external_id ?? '').trim() || null, badges, biz: biz.length ? biz : c.fit ? [{ name: c.fit, color: '#2563EB' }] : [], tags: tagsOf(r), amount: amounts.join(' · ') || null, amounts,
      limit: c.kind === 'result' || c.kind === 'cancel' ? null : regionLimit(r.region_restriction, hq), progress,
      deadlineAt: fmtWhen(dl), participationAt: fmtWhen(when(r.participation_deadline_at)), openingAt: fmtWhen(when(r.opening_at)),
      briefingAt: briefing, briefingKind: r.site_briefing_kind ?? null, briefingPlace: r.site_briefing_place ?? null, // 239차(#744)
      elig: c.kind === 'result' || c.kind === 'cancel' ? null : eligSay(eligView(r)), // 252차 #786 — 목록 줄과 같은 말
      bidSystem: st === 'kapt_bid' && r.bid_system && sysKey(r.bid_system) !== sysKey(SRC[st]) ? String(r.bid_system) : null, // 투찰처가 원천(K-APT)과 같으면 숨김 — KG2B 같은 다른 곳만
      result: c.kind === 'result' ? resultOf(r) : c.kind === 'cancel' && r.result_note ? `취소 사유: ${String(r.result_note).slice(0, 80)}` : null }); // #751 취소 사유(K-apt 상세)
  }
  // 구역 순서 → 구역 안 마감 임박 순(마감 모르면 뒤) → 제목
  items.sort((a, b) => SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || String(a.deadlineAt ?? '9999').localeCompare(String(b.deadlineAt ?? '9999')) || a.title.localeCompare(b.title));
  const by = (s: DigestSection) => items.filter((i) => i.section === s).length;
  const now = by('now'), review = by('review'), change = items.filter((i) => i.section === 'change');
  const counts = { total: now + review + change.length, new: now + review, now, review, soon: by('soon'), result: by('result'), ref: by('ref'), amend: change.filter((i) => i.kind !== 'cancel').length, cancel: change.filter((i) => i.kind === 'cancel').length, merged, skipped };
  const cond: DigestCond = { biz: cats.map((c) => c.name), keywords: p.keywords.length, excludes: p.excludes.length, regions: p.regions, issuers: p.issuers.length, itemCodes: p.item_codes.length, amountMin: p.amount_min, amountMax: p.amount_max,
    hq: hq ? `${hq.sido}${hq.sigungu ? ` ${hq.sigungu}` : ''}` : null };
  return { day, since: since.toISOString(), until: new Date().toISOString(), items: items.slice(0, 300), counts, prefs: p, cond };
}
/** 보내기(하루 1건, force 면 다시 만들어 덮어쓰고 다시 보냄). 받는 사람: digest_to 또는 영업 담당 규칙·대표 + 직접 넣은 주소 */
export async function sendDigest(tenant: string, opt: { force?: boolean; day?: string; actorId?: string | null } = {}) {
  const sql = db(); const day = opt.day ?? kstDay(); const p = await prefsOf(tenant);
  const [exists] = await sql<{ id: string }[]>`select id from sales_digests where tenant = ${tenant} and day = ${day}`;
  if (exists && !opt.force) return { sent: false, reason: 'already' };
  // 215차(#530 로컬 10/24 주의): 정기 시각 전(새벽)에 [지금 보내기]를 누르면 그날 정기 메일이 '이미 보냄'으로 건너뛰던 것 —
  // 정기 시각 전 수동 발송은 시험 발송: 누른 사람에게만 메일(제목 앞 [시험 발송]) · 알림·기록 없음 → 정기 메일·다음 날 받은 기간은 그대로
  const test = !!opt.actorId && !opt.day && !exists && p.digest_enabled && kstHour() < p.digest_hour;
  const d = await buildDigest(tenant, day);
  const company = await companyName(tenant);
  // #100: 받는 사람을 따로 안 정했으면 영업 담당 규칙(입찰) → 없으면 대표·관리자
  const rule = p.digest_to.length ? null : await (await import('../assignees')).resolveAssignee(sql, tenant, 'sales_source', 'bid').catch(() => null);
  const to = test ? await sql<{ id: string; email: string }[]>`select id, email from users where id = ${opt.actorId!} and tenant = ${tenant}`
    : p.digest_to.length ? await sql<{ id: string; email: string }[]>`select id, email from users where id = any(${p.digest_to}::uuid[]) and tenant = ${tenant} and status = 'active'`
    : rule ? await sql<{ id: string; email: string }[]>`select id, email from users where id = ${rule.userId}`
    : await sql<{ id: string; email: string }[]>`select id, email from users where tenant = ${tenant} and status = 'active' and not is_demo and role in ('owner', 'admin') order by (role = 'owner') desc, created_at asc limit 1`; // #104: 담당 미지정이면 관리자 1명(대표 우선)에게만
  const emails = [...new Set([...to.map((u) => u.email), ...(test ? [] : p.digest_emails)].map((e) => String(e ?? '').trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)))];
  let mailed = 0, notified = 0; let mailError: string | null = null; let mailVia: string | null = null;
  const shown = d.items.filter((i) => i.section !== 'ref');
  if (shown.length) {
    const fromName = fromNameOf(p, company);
    const mail = digestMail(fromName, d, appUrl(), test ? { testHour: p.digest_hour } : undefined);
    if (p.digest_mail && emails.length && to.length) {
      const { queueSystemMail, systemChannel } = await import('../mailbox');
      const replyTo = p.digest_reply_to || (await systemChannel(tenant)).smtpFrom;
      // #509 a: 워크인 발송(받은메일함) 먼저 → 없으면 회사 SMTP(보내는 회사 주소는 받는 사람에서 빠짐) → 둘 다 없으면 Resend(sendMail)
      const q = await queueSystemMail(tenant, { to: emails, subject: mail.subject, text: mail.text, html: mail.html, replyTo, createdBy: opt.actorId ?? to[0].id, fromName }).catch((e) => { mailError ??= e instanceof Error ? e.message : String(e); return null; });
      if (q?.skipped === 'self') { mailVia = q.channel; mailError = '받는 사람이 보내는 회사 메일 주소뿐이라 보내지 않았습니다 — 워크인 발송을 켜면 받은메일함으로 옵니다'; }
      else if (q) { mailed = q.to.length; mailVia = q.channel; if (opt.actorId) await (await import('../mailbox')).outboxTick().catch(() => null); } // [지금 보내기]는 바로(정시 발송은 같은 tick 의 보관함 단계가)
      else for (const e of emails) { try { mailVia = await sendMail(e, mail.subject, mail.text, mail.html); mailed++; } catch (err) { mailError ??= err instanceof Error ? err.message : String(err); /* 메일 경로 없음·실패면 알림만 — 사유는 기록 */ } }
    }
    const first = (d.counts.total ? shown.find((i) => i.section !== 'soon' && i.section !== 'result') : null) ?? shown[0];
    if (!test) notified = (await notify(sql, { userIds: to.map((u) => u.id), type: 'briefing', space: 'sales',
      title: d.counts.total ? `오늘 새 공고 ${d.counts.total}건 — ${first.title.slice(0, 40)}${shown.length > 1 ? ' 외' : ''}` : d.counts.soon ? `마감 임박 공고 ${d.counts.soon}건 — ${first.title.slice(0, 40)}` : `입찰 결과(낙찰·유찰) ${d.counts.result}건 — ${first.title.slice(0, 40)}`,
      body: shown.slice(0, 3).map((i) => `${i.badges.map((b) => `[${b}] `).join('')}${i.title}${i.dday != null ? ` (${i.dday === 0 ? 'D-day' : `D-${i.dday}`})` : ''}`).join('\n'), link: '/s/sales/hub?tab=bids&bt=today', push: true, dedupeKey: `salesdigest:${tenant}:${day}${opt.force ? `:${Date.now()}` : ''}` }).catch(() => [])).length;
  }
  if (test) {
    await audit(sql, opt.actorId!, 'sales_digest.test', 'tenant', null, { day, total: d.counts.total, mailed, hour: p.digest_hour }).catch(() => {});
    return { sent: true, test: true, hour: p.digest_hour, day, counts: { ...d.counts, mailError, mailVia, mailTo: emails.length }, mailed, notified, mailError, mailVia, items: d.items.slice(0, 50) };
  }
  await sql`insert into sales_digests (tenant, day, items, counts, mailed, notified) values (${tenant}, ${day}, ${sql.json(d.items as never)}, ${sql.json({ ...d.counts, mailError, mailVia, mailTo: emails.length } as never)}, ${mailed}, ${notified}) on conflict (tenant, day) do update set items = excluded.items, counts = excluded.counts, mailed = excluded.mailed, notified = excluded.notified, created_at = now()`;
  if (opt.actorId) await audit(sql, opt.actorId, 'sales_digest.send', 'tenant', null, { day, total: d.counts.total, mailed, notified }).catch(() => {});
  return { sent: true, day, counts: { ...d.counts, mailError, mailVia, mailTo: emails.length }, mailed, notified, mailError, mailVia, items: d.items.slice(0, 50) };
}
/** tick: 영업 공간 켠 회사마다 설정 시각 이후 하루 1번 */
export async function salesDigestTick() {
  const sql = db(); const hour = kstHour(); const day = kstDay(); let sent = 0;
  const tenants = await sql<{ id: string }[]>`select id from tenants where spaces @> array['sales']::text[] and coalesce(sales_bids, true)`;
  for (const t of tenants) {
    const p = await prefsOf(t.id); if (!p.digest_enabled || hour < p.digest_hour) continue;
    const [done] = await sql<{ id: string }[]>`select id from sales_digests where tenant = ${t.id} and day = ${day}`; if (done) continue;
    const r = await sendDigest(t.id, { day }).catch(() => null); if (r?.sent) sent++;
  }
  return { sent };
}
export async function sendDigestManual(u: SessionUser) { await assertSpace(u, 'sales'); if (!isAdmin(u)) throw forbidden('관리자만'); return sendDigest(tenantOf(u), { force: true, actorId: u.id }); }
export async function todayDigest(u: SessionUser) { await assertSpace(u, 'sales'); const t = tenantOf(u); const day = kstDay(); const [d] = await db()<any[]>`select day, items, counts, mailed, notified, created_at from sales_digests where tenant = ${t} and day = ${day}`; return d ?? { ...(await buildDigest(t, day)), preview: true }; }
/** #510 미리보기(GET /api/sales/digest?preview=html|text): 오늘 데이터로 지금 메일을 만들면 이렇게 — 보내지 않음. 원천 글은 모두 이스케이프, 스크립트 금지(CSP) */
export async function previewDigest(u: SessionUser, kind: 'html' | 'text') {
  await assertSpace(u, 'sales'); const t = tenantOf(u);
  const m = digestMail(fromNameOf(await prefsOf(t), await companyName(t)), await buildDigest(t), appUrl());
  return kind === 'html'
    ? new Response(m.html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:", 'cache-control': 'no-store' } })
    : new Response(m.text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
export const BID_SOURCES = BID_COLLECTORS;
