import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type Sql } from '../db';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { audit } from '../log';
import { isAdmin, isUuid } from '../access';
import { tenantOf, type SessionUser } from '../types';
import { maskPII } from './mask';
import { applyOkMark, fixFacilityStatus, settleDone, tidyCheckLine } from './facilityStatus';
import { MONTHLY_JSON_SCHEMA, MONTHLY_SYSTEM, monthRange, monthlyBodySchema, prevMonth, trackItems, usageC, verifyMonthly, weeklyDigest, type WeeklyIn } from './monthly';

/**
 * #1096 지점 주간보고 — 다짐 전용(대표 #1097: 상업화하지 않음). 설계 docs/branch-report-design.md, 대표 결정 11/21:
 *  - 기본 입력 = 지점 관리자가 금요일마다 카톡에 올리는 주간보고 글(붙여 넣기). 카톡 대화 내보내기 파일은 '근거 보강' 선택
 *  - 원본 파일은 저장하지 않고 가린 메시지만, 제출 30일 뒤 삭제 · 앱 안 강제 고지 없음(처리방침만)
 *  - AI 는 초안만(자동 제출 없음). 숫자는 붙여 넣은 글에 있는 것만 — 없으면 '확인 필요'. 항목마다 근거(D줄·대화), 근거 없는 '완료'는 '확인 필요'로 내림
 *  - 지점 = 기능 안의 별도 '보고 지점' 목록(로컬 확인 11/21: 다짐 조직 단위에는 지점이 없음 — 다짐 세팅은 바꾸지 않음)
 *    작성 담당은 자기 지점만, 검토 담당(어느 지점이든)과 대표·관리자는 전체 지점을 봄
 * 스위치 BRANCH_REPORT_TENANTS(쉼표로 회사 id) — 기본값 'default'(다짐)만. 꺼진 회사는 메뉴·주소·API 모두 404.
 */
export const branchReportOn = (tenant?: string | null) => {
  const list = (process.env.BRANCH_REPORT_TENANTS ?? 'default').split(',').map((s) => s.trim()).filter(Boolean);
  return !!tenant && list.includes(tenant);
};
function requireOn(u: SessionUser) { if (u.isDemo || !branchReportOn(tenantOf(u))) throw notFound(); }

// ---------------- 날짜: 보고일 = 금요일(11:00 기준) · 기간 = 지난 금요일 ~ 목요일 ----------------
const DAY = 86_400_000;
const kstToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
/** 그 날 또는 그 전의 가장 가까운 금요일 */
export const fridayOnOrBefore = (d: string) => addDays(d, -((weekday(d) + 2) % 7));
export const periodOf = (friday: string) => ({ start: addDays(friday, -7), end: addDays(friday, -1), day: friday });
const isFriday = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && weekday(d) === 5;

// ---------------- 권한 ----------------
type Site = { id: string; name: string; hidden: boolean; writer_user_id: string | null; writer_name: string | null; reviewer_user_id: string | null; reviewer_name: string | null };
async function sitesOf(u: SessionUser, sql: Sql): Promise<Site[]> {
  const rows = await sql<Site[]>`select s.id, s.name, s.hidden, s.writer_user_id, w.name as writer_name, s.reviewer_user_id, r.name as reviewer_name
    from branch_sites s left join users w on w.id = s.writer_user_id left join users r on r.id = s.reviewer_user_id
    where s.tenant = ${tenantOf(u)} order by s.sort, s.name`;
  const all = isAdmin(u) || rows.some((x) => x.reviewer_user_id === u.id); // 검토 담당·대표·관리자 = 전체
  return rows.filter((x) => all || x.writer_user_id === u.id);
}
/** 쓰기(초안 만들기·고치기·제출): 관리자 · 그 지점 작성 담당 · 그 지점 검토 담당 */
const canWrite = (u: SessionUser, t: Site) => isAdmin(u) || t.writer_user_id === u.id || t.reviewer_user_id === u.id;
/** 제출 취소: 관리자 · 그 지점 검토 담당 */
const canReopen = (u: SessionUser, t: Site) => isAdmin(u) || t.reviewer_user_id === u.id;
async function siteFor(u: SessionUser, siteId: string, sql: Sql) {
  if (!isUuid(siteId)) throw notFound('지점을 찾을 수 없습니다');
  const t = (await sitesOf(u, sql)).find((x) => x.id === siteId);
  if (!t) throw notFound('지점을 찾을 수 없습니다');
  return t;
}

// ---------------- 목록 ----------------
export async function branchHome(u: SessionUser, q: { siteId?: string | null }) {
  requireOn(u);
  const sql = db();
  const sites = (await sitesOf(u, sql)).filter((t) => !t.hidden || isAdmin(u));
  const id = q.siteId && sites.find((t) => t.id === q.siteId) ? q.siteId : sites.find((t) => !t.hidden)?.id ?? sites[0]?.id ?? null;
  const t = sites.find((x) => x.id === id);
  const reports = t ? await sql<any[]>`select id, report_day::text as report_day, period_start::text as period_start, period_end::text as period_end, status, updated_at, submitted_at
      from branch_reports where site_id = ${t.id} and kind = 'weekly' order by report_day desc limit 60` : []; // 월간 '이 달 주간 제출 n건'을 1년치 보여 주려고 60
  const monthly = t ? await sql<any[]>`select id, to_char(period_start, 'YYYY-MM') as month, status, updated_at, submitted_at
      from branch_reports where site_id = ${t.id} and kind = 'monthly' order by period_start desc limit 24` : [];
  const chat = t ? (await sql<{ n: number; last: string | null }[]>`select count(*)::int as n, max(at)::text as last from branch_chat_messages where site_id = ${t.id}`)[0] : null;
  return { admin: isAdmin(u), today: kstToday(), friday: fridayOnOrBefore(kstToday()), siteId: id, canWrite: t ? canWrite(u, t) : false, canReopen: t ? canReopen(u, t) : false,
    sites: sites.map((x) => ({ id: x.id, name: x.name, writer: x.writer_name, reviewer: x.reviewer_name, hidden: x.hidden })), reports, monthly, chat };
}

// ---------------- 보고 지점 목록(관리자) — 이름·숨김·작성 담당·검토 담당. 다짐 조직 단위는 건드리지 않음 ----------------
export async function branchSetup(u: SessionUser) {
  requireOn(u); if (!isAdmin(u)) throw forbidden('관리자만 정할 수 있습니다');
  const sql = db();
  const sites = await sql<any[]>`select s.id, s.name, s.hidden, s.writer_user_id, s.reviewer_user_id, (select count(*)::int from branch_reports r where r.site_id = s.id) as reports
    from branch_sites s where s.tenant = ${tenantOf(u)} order by s.sort, s.name`;
  const users = await sql<any[]>`select id, name, title, role from users where tenant = ${tenantOf(u)} and status in ('active', 'invited') and not is_demo order by name`;
  return { sites, users };
}
export const setupInput = z.object({ sites: z.array(z.object({ id: z.string().uuid().optional(), name: z.string().trim().min(1).max(60), hidden: z.boolean().default(false),
  writerUserId: z.string().uuid().nullable().optional(), reviewerUserId: z.string().uuid().nullable().optional() })).max(100) });
export async function saveBranchSetup(u: SessionUser, i: z.infer<typeof setupInput>, ip: string | null) {
  requireOn(u); if (!isAdmin(u)) throw forbidden('관리자만 정할 수 있습니다');
  const sql = db(); const tn = tenantOf(u);
  const names = i.sites.map((x) => x.name.replace(/\s+/g, ' '));
  if (new Set(names).size !== names.length) throw badRequest('같은 이름의 지점이 두 번 들어 있습니다');
  const people = [...new Set(i.sites.flatMap((x) => [x.writerUserId, x.reviewerUserId]).filter(Boolean) as string[])];
  if (people.length && (await sql`select id from users where id = any(${people}::uuid[]) and tenant = ${tn}`).length !== people.length) throw badRequest('담당은 이 회사 사람만 정할 수 있습니다');
  const cur = await sql<{ id: string; name: string; reports: number }[]>`select s.id, s.name, (select count(*)::int from branch_reports r where r.site_id = s.id) as reports from branch_sites s where s.tenant = ${tn}`;
  const keep = new Set(i.sites.map((x) => x.id).filter(Boolean));
  if (i.sites.some((x) => x.id && !cur.some((c) => c.id === x.id))) throw badRequest('없는 지점이 들어 있습니다');
  const gone = cur.filter((c) => !keep.has(c.id));
  if (gone.some((c) => c.reports > 0)) throw new HttpError(409, 'has_reports', `보고서가 있는 지점은 지울 수 없습니다 — 숨김으로 두세요(${gone.filter((c) => c.reports > 0).map((c) => c.name).join(', ')})`);
  await sql.begin(async (tx) => {
    if (gone.length) await tx`delete from branch_sites where id = any(${gone.map((c) => c.id)}::uuid[])`;
    await tx`update branch_sites set name = '~' || id::text where tenant = ${tn}`; // 이름 바꾸기·맞바꾸기에서 이름 겹침(unique) 피하기
    let n = 0;
    for (const [k, x] of i.sites.entries()) {
      const v = { name: names[k], hidden: x.hidden, sort: n++, writer_user_id: x.writerUserId ?? null, reviewer_user_id: x.reviewerUserId ?? null };
      if (x.id) await tx`update branch_sites set ${tx(v)} where id = ${x.id}`;
      else await tx`insert into branch_sites ${tx({ ...v, tenant: tn })}`;
    }
  });
  await audit(sql, u.id, 'branch_report.setup', 'tenant', null, { sites: i.sites.length, removed: gone.length }, ip);
  return branchSetup(u);
}

// ---------------- 대화 파일 올리기(근거 보강) ----------------
export const uploadInput = z.object({ siteId: z.string(), files: z.array(z.object({ name: z.string().max(200), text: z.string().max(6_000_000).optional(), b64: z.string().max(6_000_000).optional() })).min(1).max(5) });
export async function uploadChat(u: SessionUser, i: z.infer<typeof uploadInput>, ip: string | null) {
  requireOn(u);
  const sql = db();
  const t = await siteFor(u, i.siteId, sql);
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  const { parseKakaoExport } = await import('./kakaoParse');
  let r: ReturnType<typeof parseKakaoExport>;
  try { r = parseKakaoExport(i.files.map((f) => ({ name: f.name, data: f.b64 ? Buffer.from(f.b64, 'base64') : f.text ?? '' }))); }
  catch (e) { throw badRequest(`파일을 읽지 못했습니다 — ${String((e as Error)?.message ?? e).slice(0, 80)}`); }
  if (!r.messages.length) throw badRequest('카카오톡 대화 내보내기 파일(txt·csv·zip)에서 메시지를 찾지 못했습니다');
  const up = randomUUID(); let added = 0;
  await sql.begin(async (tx) => {
    await tx`insert into branch_chat_uploads (id, tenant, site_id, uploaded_by, from_day, to_day, skipped, duplicates) values (${up}, ${tenantOf(u)}, ${t.id}, ${u.id}, ${r.from}, ${r.to}, ${r.skipped}, ${r.duplicates})`;
    for (let k = 0; k < r.messages.length; k += 500) {
      const chunk = r.messages.slice(k, k + 500).map((m) => ({ tenant: tenantOf(u), site_id: t.id, upload_id: up, at: m.at.replace('T', ' ') + ':00', sender: maskPII(m.sender).text, text: maskPII(m.text).text.slice(0, 4000), key: m.key }));
      const ins = await tx`insert into branch_chat_messages ${tx(chunk, 'tenant', 'site_id', 'upload_id', 'at', 'sender', 'text', 'key')} on conflict (site_id, key) do nothing returning id`;
      added += ins.length;
    }
    await tx`update branch_chat_uploads set added = ${added}, duplicates = ${r.duplicates + (r.messages.length - added)} where id = ${up}`;
  });
  await audit(sql, u.id, 'branch_report.chat_upload', 'branch_site', t.id, { added, from: r.from, to: r.to, formats: r.formats }, ip);
  return { added, duplicates: r.duplicates + (r.messages.length - added), skipped: r.skipped, from: r.from, to: r.to, formats: r.formats };
}

// ---------------- 보고서 본문(양식 A: 힐스테이트푸르지오주안 커뮤니티 주간 운영 보고서 구조) ----------------
const STATE = z.enum(['완료', '진행 중', '확인 필요']);
const s200 = z.string().max(200).default('');
const lineSchema = z.object({ item: s200, status: s200, action: z.string().max(500).default(''), state: STATE.default('확인 필요'), evidence: z.array(z.string().max(20)).max(20).default([]) });
export const bodySchema = z.object({
  usage: z.array(z.object({ item: s200, count: z.string().max(40).default(''), note: z.string().max(200).default('') })).max(40).default([]),
  lockers: z.array(z.object({ name: s200, used: z.string().max(20).default(''), total: z.string().max(20).default('') })).max(20).default([]),
  facilities: z.array(z.object({ name: s200, visitors: z.string().max(40).default(''), cleaning: z.string().max(40).default(''), condition: z.string().max(40).default(''), lines: z.array(lineSchema).max(40).default([]) })).max(20).default([]),
  issues: z.array(z.object({ title: s200, details: z.array(z.string().max(500)).max(20).default([]), state: STATE.default('확인 필요'), evidence: z.array(z.string().max(20)).max(20).default([]) })).max(40).default([]),
  notes: z.string().max(2000).default(''),
  sources: z.object({ w: z.array(z.object({ ref: z.string(), taskId: z.string(), title: z.string() })).default([]) }).default({ w: [] }),
  review: z.any().nullable().default(null), // #1117 서버가 정함(그대로 두기 이유·승인)
});
export type ReportBody = z.infer<typeof bodySchema>;

/** AI 결과 다듬기: 근거 번호 확인(없는 것은 지움) · 근거 없는 '완료' → '확인 필요' · 숫자는 붙여 넣은 글에 있는 것만(없으면 '확인 필요') */
export function verifyBody(b: ReportBody, ctx: { dLines: number; msgIds: Set<string>; wRefs: Set<string>; dText: string }) {
  const okRef = (r: string) => { const m = r.match(/^([DMW])(\d+)$/); if (!m) return false; return m[1] === 'D' ? Number(m[2]) >= 1 && Number(m[2]) <= ctx.dLines : m[1] === 'M' ? ctx.msgIds.has(m[2]) : ctx.wRefs.has(r); };
  const digits = (v: string) => (v.match(/\d[\d,]*/g) ?? []).map((x) => x.replace(/,/g, ''));
  const plain = ctx.dText.replace(/,/g, '');
  const num = (v: string) => { const ds = digits(v); return !ds.length || ds.every((d) => new RegExp(`(?<!\\d)${d}(?!\\d)`).test(plain)) ? v : '확인 필요'; };
  let fixed = 0;
  const fixState = <T extends { state: string; evidence: string[] }>(x: T): T => { const ev = x.evidence.filter(okRef); const state = x.state === '완료' && !ev.length ? '확인 필요' : x.state; if (state !== x.state || ev.length !== x.evidence.length) fixed++; return { ...x, evidence: ev, state }; };
  const out: ReportBody = {
    ...b,
    usage: b.usage.map((x) => ({ ...x, count: num(x.count) })),
    facilities: b.facilities.map((f) => {
      // 로컬 11/21: 청소 상태·시설 상태는 그 시설의 '청소상태'·'시설상태' 줄에 적힌 값만(시설 상태는 등급 단어만) — 다른 칸 값을 옮겨 적으면 '확인 필요'
      //   등급 단어로 시작하면 등급만 받고 뒤 설명('청결 / 연습실 내부룸 먼지로 청소완료')은 원문에 있으면 점검 줄로(로컬 재확인 — 과잉 거부 고침)
      const { cleaning, condition, extra } = fixFacilityStatus(ctx.dText, f);
      if (cleaning !== f.cleaning) fixed++; if (condition !== f.condition) fixed++;
      return { ...f, visitors: num(f.visitors), cleaning, condition, lines: [...f.lines, ...extra].map((l) => fixState(tidyCheckLine(settleDone(ctx.dText, applyOkMark(ctx.dText, f.name, l))))) }; // #1105 '0·O·○' 하나 = 이상 없음 · 원문 '완료' 줄은 완료 · 줄 이름에서 원문 칸 이름 뗌
    }),
    issues: b.issues.map(fixState),
  };
  return { body: out, fixed };
}

const reportCols = (sql: Sql) => sql`r.id, r.site_id, s.name as unit_name, r.kind, r.period_start::text as period_start, r.period_end::text as period_end, r.report_day::text as report_day, r.status, r.source_text, r.body, r.ai_model,
  r.submitted_at, r.submitted_by, r.updated_at, r.purged_at, cb.name as created_by_name, sb.name as submitted_by_name`;
async function loadReport(u: SessionUser, id: string, sql: Sql) {
  requireOn(u);
  if (!isUuid(id)) throw notFound('보고서를 찾을 수 없습니다');
  const [r] = await sql<any[]>`select ${reportCols(sql)} from branch_reports r join branch_sites s on s.id = r.site_id
    left join users cb on cb.id = r.created_by left join users sb on sb.id = r.submitted_by where r.id = ${id} and r.tenant = ${tenantOf(u)}`;
  if (!r) throw notFound('보고서를 찾을 수 없습니다');
  const t = await siteFor(u, r.site_id, sql); // 볼 수 있는 지점(작성 담당은 자기 지점만, 검토 담당·관리자는 전체)
  return { r, t };
}
/**
 * #1116(대표 11/22 '이용인원과 금액 동선을 추적 · 민원·특이사항을 정리해 고객사에 전달'): 월간 보고에
 *  ① 최근 6개월 흐름 — 시설 이용인원 합계(하이링크 이용현황: 그 달 월간 합계, 없으면 다음 달 보고의 '전달') · 활성 이용권 · 활성 수강권 · 월 부과 합계(하이링크 회원목록 집계)
 *     저장된 집계로만(AI·추정 없음), 없는 달은 null('-'). 이용권/수강권 분류·시험 줄 제외는 이 보고서 설정 그대로
 *  ② 이번 달 민원·특이사항 — 그 달 제출된 주간보고의 특이사항을 한 표로(처리 상태 포함)
 */
async function monthExtras(sql: Sql, tenant: string, r: { site_id: string; report_day: string; body: any }) {
  const { lastMonths, monthIssues, nextMonth, numOf, sumCol } = await import('./monthly');
  const { viewOf } = await import('./memberList');
  const month = String(r.report_day).slice(0, 7); const range = monthRange(month)!;
  const weeklies = await sql<{ id: string; day: string; body: any }[]>`select id, report_day::text as day, body from branch_reports
    where site_id = ${r.site_id} and kind = 'weekly' and status = 'submitted' and report_day between ${range.start} and ${range.end} order by report_day`;
  const months = lastMonths(month);
  const [stats, reps] = await Promise.all([
    sql<{ month: string; stats: any; stats_all: any }[]>`select month, stats, stats_all from branch_member_stats where tenant = ${tenant} and site_id = ${r.site_id} and month = any(${months})`,
    sql<{ m: string; ut: any; usage: any }[]>`select to_char(report_day, 'YYYY-MM') as m, body->'usageTotal' as ut, body->'usage' as usage from branch_reports
      where site_id = ${r.site_id} and kind = 'monthly' and report_day between ${`${months[0]}-01`} and ${monthRange(nextMonth(month))!.end}`,
  ]);
  const rep = new Map(reps.map((x) => [x.m, { ut: x.ut, usage: x.usage }])); rep.set(month, { ut: r.body?.usageTotal ?? null, usage: r.body?.usage ?? [] });
  const col = (b: { ut: any; usage: any } | undefined, k: 'cur' | 'prev') => {
    const v = b?.ut?.[k] || (Array.isArray(b?.usage) && b!.usage.length ? sumCol(b!.usage.map((x: any) => String(x?.[k] ?? ''))) : '');
    return numOf(String(v ?? ''));
  };
  const usage = months.map((m) => col(rep.get(m), 'cur') ?? col(rep.get(nextMonth(m)), 'prev'));
  const mem = r.body?.members; const exclude = mem?.exclude ?? true; const kinds = mem?.kinds;
  const st = new Map(stats.map((x) => [x.month, exclude ? x.stats : x.stats_all]));
  const view = (m: string, sel: 'all' | 'use' | 'class') => { const a = st.get(m); return a ? viewOf(a, kinds, sel) : null; };
  const flow = { months, rows: [
    { key: 'usage', label: '시설 이용인원 합계(명)', vals: usage },
    { key: 'use', label: '활성 이용권(개)', vals: months.map((m) => view(m, 'use')?.active ?? null) },
    { key: 'class', label: '활성 수강권(개)', vals: months.map((m) => view(m, 'class')?.active ?? null) },
    { key: 'billing', label: '월 부과 합계(원)', vals: months.map((m) => view(m, 'all')?.billing ?? null), money: true },
  ], notes: [`출처: 하이링크 이용현황(시설 이용인원)·하이링크 회원목록(이용권·수강권·부과) — 그 달에 올린 파일의 숫자만, 없는 달은 '-'`,
    `회원 숫자는 ${exclude ? '시험·직원 줄 제외' : '시험·직원 줄 포함'}, 이용권/수강권 분류는 이 보고서 기준`] };
  return { flow, issuesMonth: monthIssues(weeklies.map((w) => ({ id: w.id, day: w.day, body: w.body ?? {} }))) };
}
/** 화면에 보이는 본문 — 월간 초안은 #1115 회사 분류 지금 값 · #1116 흐름·민원 모음을 볼 때 계산(제출본은 굳은 값) */
async function viewBody(sql: Sql, u: SessionUser, r: any) {
  let b = r.body ?? {};
  if (r.kind !== 'monthly') return b;
  if (r.status === 'draft' && b.members) b = { ...b, members: await withKinds(sql, tenantOf(u), b.members) };
  if (r.status === 'draft' || !b.flow) b = { ...b, ...(await monthExtras(sql, tenantOf(u), { ...r, body: b })) };
  return b;
}
export async function getReport(u: SessionUser, id: string) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  r.body = await viewBody(sql, u, r);
  return { report: r, canWrite: canWrite(u, t) && r.status === 'draft', canReopen: canReopen(u, t) && r.status === 'submitted' && !r.purged_at, admin: isAdmin(u), review: await reviewOf(u, t, r) };
}

// ---------------- 초안 만들기(AI) ----------------
export const draftInput = z.object({ siteId: z.string(), day: z.string(), text: z.string().max(20000).default(''), useChat: z.boolean().default(true) });
const SYSTEM = `다짐 커뮤니티(아파트 단지 커뮤니티 시설 위탁 운영) 지점의 '커뮤니티 주간 운영 보고서' 초안을 만듭니다. 한국어, JSON 만.
자료: [D] 지점 관리자가 쓴 주간보고 글(줄 번호 D1…) · [M] 지점 단체방 대화(번호 M…, 선택). 개인정보는 [전화]·[호수] 등으로 가려져 있습니다 — 되살리지 마세요.
양식(이 순서):
1. usage(이용 인원 현황): 시설·이용권별 인원 — D 의 <이용인원> 등에 있는 숫자만. 항목 이름은 D 그대로.
2. lockers(락커 사용 현황): D 에 있으면만, 없으면 빈 목록(담당이 손으로 넣음).
3. facilities(시설 점검): 시설별(헬스장·골프장·사우나·카페&키즈룸·도서관/독서실 등 D 에 나온 것) visitors(총 이용인원) · cleaning(청소 상태 — D 의 그 시설 '청소상태' 값 그대로) · condition(시설 상태 — D 의 그 시설 '시설상태'에 적힌 등급 단어(청결/양호/부분양호/미흡 등)만. 시설상태가 등급이 아닌 설명(예: 런닝머신 인버터 청소완료)이거나 줄이 없으면 '확인 필요', 그 설명은 lines 의 점검 줄로. 청소 상태 값을 옮겨 적지 않음). cleaning·condition 칸에는 등급 단어만 — 등급 뒤에 붙은 설명(예: '청결 / 연습실 내부룸 먼지로 청소완료'의 뒤쪽)은 lines 의 점검 줄로. 점검 줄 item 은 내용 이름만(예: '연습실 내부룸 청소') — '청소상태'·'시설상태' 같은 원문 칸 이름을 붙이지 않음. 원문에 '완료'가 있으면 status '완료'·state '완료' · lines(점검 항목: item · status(이상무/완료/상태) · action(조치, 예정이면 날짜 포함) · state · evidence). 점검 줄 값이 0·O·○ 하나뿐이면 지점 관리자가 '이상 없음'으로 쓴 것 — status '이상 없음', state '완료', evidence 에 그 D 줄. '진행0'처럼 다른 글자와 붙은 0 은 원문 그대로 두고 '확인 필요'.
4. issues(특이사항·건의사항·민원): 제목 + details(진행 현황·인원·금액·날짜) + state + evidence. 같은 일을 여러 번 말한 것은 하나로 합침.
5. notes: 짧은 메모(없으면 빈 글).
규칙: 숫자·날짜·금액은 자료에 있는 것만 — 지어내지 않습니다. 모르면 '확인 필요'. state 는 완료/진행 중/확인 필요 중 하나 — 끝났다는 근거가 분명할 때만 '완료'. evidence 에는 근거가 된 번호(D3, M120)를 넣습니다.`;
const JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['usage', 'lockers', 'facilities', 'issues', 'notes'],
  properties: {
    usage: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'count'], properties: { item: { type: 'string' }, count: { type: 'string' }, note: { type: 'string' } } } },
    lockers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'used', 'total'], properties: { name: { type: 'string' }, used: { type: 'string' }, total: { type: 'string' } } } },
    facilities: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'visitors', 'cleaning', 'condition', 'lines'], properties: { name: { type: 'string' }, visitors: { type: 'string' }, cleaning: { type: 'string' }, condition: { type: 'string' },
      lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'status', 'action', 'state', 'evidence'], properties: { item: { type: 'string' }, status: { type: 'string' }, action: { type: 'string' }, state: { type: 'string', enum: ['완료', '진행 중', '확인 필요'] }, evidence: { type: 'array', items: { type: 'string' } } } } } } } },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'details', 'state', 'evidence'], properties: { title: { type: 'string' }, details: { type: 'array', items: { type: 'string' } }, state: { type: 'string', enum: ['완료', '진행 중', '확인 필요'] }, evidence: { type: 'array', items: { type: 'string' } } } } },
    notes: { type: 'string' },
  },
};

export async function generateDraft(u: SessionUser, i: z.infer<typeof draftInput>, ip: string | null) {
  requireOn(u);
  if (!isFriday(i.day)) throw badRequest('보고일은 금요일이어야 합니다');
  const sql = db();
  const t = await siteFor(u, i.siteId, sql);
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  const p = periodOf(i.day);
  const [ex] = await sql<{ id: string; status: string }[]>`select id, status from branch_reports where site_id = ${t.id} and kind = 'weekly' and report_day = ${p.day}`;
  if (ex?.status === 'submitted') throw new HttpError(409, 'submitted', '이미 제출한 보고서입니다 — 고치려면 관리자에게 [제출 취소]를 요청하세요');
  const dText = maskPII(i.text.trim()).text;
  const dLines = dText ? dText.split(/\r?\n/) : [];
  const msgs = i.useChat ? await sql<{ id: string; at: string; sender: string; text: string }[]>`select id::text as id, to_char(at, 'MM-DD HH24:MI') as at, sender, text from branch_chat_messages
      where site_id = ${t.id} and at >= ${p.start}::date and at < ${p.day}::date + interval '11 hours' order by at limit 600` : [];
  if (!dLines.length && !msgs.length) throw badRequest(i.useChat ? '이번 주 주간보고 글을 붙여 넣거나, 이 주 대화 파일을 올리세요' : '이번 주 주간보고 글을 붙여 넣으세요');
  const { aiEnabled, anthropicProvider, costUsd } = await import('../ai/provider');
  if (!aiEnabled()) throw new HttpError(503, 'ai_off', 'AI 가 설정되지 않았습니다');
  await (await import('../plans')).assertAiRequest(u);
  await (await import('../ai/guard')).assertAiCredit();
  // 대화는 3만 자까지(최근 것 우선)
  let budget = 30_000; const chatLines: string[] = [];
  for (const m of [...msgs].reverse()) { const l = `M${m.id} ${m.at} ${m.sender}: ${m.text.replace(/\n/g, ' / ')}`; if ((budget -= l.length) < 0) break; chatLines.unshift(l); }
  const content = [`[지점] ${t.name} · 기간 ${p.start} ~ ${p.end} · 보고일 ${p.day}(금) 11:00 기준`,
    dLines.length ? `[D] 지점 관리자 주간보고 글\n${dLines.map((l, k) => `D${k + 1} ${l}`).join('\n')}` : '[D] (없음)',
    chatLines.length ? `[M] 단체방 대화(가린 글)\n${chatLines.join('\n')}` : ''].filter(Boolean).join('\n\n');
  const prov = anthropicProvider({ maxTokens: 6000 });
  const r = await prov.chat({ system: SYSTEM, tools: [], messages: [{ role: 'user', content }], format: JSON_SCHEMA });
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenantOf(u)}, ${u.id}, ${randomUUID()}, 'anthropic', ${r.model ?? prov.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${costUsd(r.model ?? prov.model, r.usage)}, 'branch_report')`;
  let raw: unknown; try { raw = JSON.parse((r.content as any[]).find((b) => b.type === 'text')?.text ?? '{}'); } catch { throw new HttpError(502, 'ai_format', 'AI 답을 읽지 못했습니다 — 다시 눌러 주세요'); }
  const parsed = bodySchema.safeParse({ ...(raw as object), sources: { w: [] } });
  if (!parsed.success) throw new HttpError(502, 'ai_format', 'AI 답의 모양이 양식과 달랐습니다 — 다시 눌러 주세요');
  const { body, fixed } = verifyBody(parsed.data, { dLines: dLines.length, msgIds: new Set(msgs.map((m) => m.id)), wRefs: new Set<string>(), dText });
  const [row] = await sql<{ id: string }[]>`insert into branch_reports (tenant, site_id, kind, period_start, period_end, report_day, status, source_text, body, ai_model, created_by, updated_by)
    values (${tenantOf(u)}, ${t.id}, 'weekly', ${p.start}, ${p.end}, ${p.day}, 'draft', ${dText || null}, ${sql.json(body as never)}, ${r.model ?? prov.model}, ${u.id}, ${u.id})
    on conflict (site_id, kind, report_day) do update set source_text = excluded.source_text, body = excluded.body, ai_model = excluded.ai_model, updated_by = excluded.updated_by, updated_at = now()
    returning id`;
  await audit(sql, u.id, 'branch_report.draft', 'branch_report', row.id, { site: t.id, day: p.day, chat: msgs.length, fixed }, ip);
  return { ...(await getReport(u, row.id)), fixed, used: { dLines: dLines.length, chat: chatLines.length } };
}

// ---------------- 월간 초안(양식 B·C, 2단계) ----------------
export const monthlyInput = z.object({ siteId: z.string(), month: z.string() });
export async function generateMonthly(u: SessionUser, i: z.infer<typeof monthlyInput>, ip: string | null) {
  requireOn(u);
  const range = monthRange(i.month);
  if (!range) throw badRequest('달은 YYYY-MM 모양이어야 합니다');
  const sql = db();
  const t = await siteFor(u, i.siteId, sql);
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  const [ex] = await sql<{ status: string; body: any }[]>`select status, body from branch_reports where site_id = ${t.id} and kind = 'monthly' and report_day = ${range.end}`;
  if (ex?.status === 'submitted') throw new HttpError(409, 'submitted', '이미 제출한 월간 보고서입니다 — 고치려면 [제출 취소]를 요청하세요');
  const rows = await sql<{ id: string; day: string; body: any }[]>`select id, report_day::text as day, body from branch_reports
    where site_id = ${t.id} and kind = 'weekly' and status = 'submitted' and report_day between ${range.start} and ${range.end} order by report_day`;
  if (!rows.length) throw badRequest('이 달에 제출된 주간보고가 없습니다 — 주간보고를 먼저 제출하세요');
  const prevRange = monthRange(prevMonth(i.month))!;
  const [prev] = await sql<{ id: string; day: string; body: any }[]>`select id, report_day::text as day, body from branch_reports
    where site_id = ${t.id} and kind = 'weekly' and status = 'submitted' and report_day between ${prevRange.start} and ${prevRange.end} order by report_day desc limit 1`;
  const weeklies: WeeklyIn[] = rows.map((x) => ({ id: x.id, day: x.day, body: x.body ?? {} }));
  const track = trackItems(weeklies);
  const digest = weeklyDigest(weeklies);
  const { aiEnabled, anthropicProvider, costUsd } = await import('../ai/provider');
  if (!aiEnabled()) throw new HttpError(503, 'ai_off', 'AI 가 설정되지 않았습니다');
  await (await import('../plans')).assertAiRequest(u);
  await (await import('../ai/guard')).assertAiCredit();
  const content = [`[지점] ${t.name} · 기간 ${range.start} ~ ${range.end}(월간)`, `[주간보고 ${weeklies.length}건]\n${digest.text}`,
    `[미완료(프로그램 정리)]\n${track.unfinished.map((x) => `- ${x.title} (${x.state}, ${x.since}부터)`).join('\n') || '(없음)'}`,
    `[이 달 안에 완료로 바뀐 것]\n${track.resolved.map((x) => `- ${x.title} (${x.doneWeek} 완료)`).join('\n') || '(없음)'}`].join('\n\n');
  const prov = anthropicProvider({ maxTokens: 6000 });
  const r = await prov.chat({ system: MONTHLY_SYSTEM, tools: [], messages: [{ role: 'user', content }], format: MONTHLY_JSON_SCHEMA });
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${tenantOf(u)}, ${u.id}, ${randomUUID()}, 'anthropic', ${r.model ?? prov.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${costUsd(r.model ?? prov.model, r.usage)}, 'branch_report')`;
  let raw: unknown; try { raw = JSON.parse((r.content as any[]).find((b) => b.type === 'text')?.text ?? '{}'); } catch { throw new HttpError(502, 'ai_format', 'AI 답을 읽지 못했습니다 — 다시 눌러 주세요'); }
  // #1106(대표 11/21): C 는 하이링크 이용현황 파일에서 — 주간 글로 계산한 값은 제안(usageWeekly)으로만. 다시 만들어도 올린 하이링크 값·파일은 그대로
  const keep = { ...(ex?.body?.usageFile ? { usage: ex.body.usage ?? [], usageTotal: ex.body.usageTotal ?? null, usageFile: ex.body.usageFile } : { usage: [], usageTotal: null, usageFile: null }), members: ex?.body?.members ?? null };
  const parsed = monthlyBodySchema.safeParse({ ...(raw as object), ...keep, usageWeekly: usageC(weeklies, prev ? { id: prev.id, day: prev.day, body: prev.body ?? {} } : null), unfinished: track.unfinished, resolved: track.resolved, sources: { w: digest.sources } });
  if (!parsed.success) throw new HttpError(502, 'ai_format', 'AI 답의 모양이 양식과 달랐습니다 — 다시 눌러 주세요');
  const { body, fixed } = verifyMonthly(parsed.data, { refs: new Set(digest.sources.map((x) => x.ref)), text: digest.text });
  const [row] = await sql<{ id: string }[]>`insert into branch_reports (tenant, site_id, kind, period_start, period_end, report_day, status, source_text, body, ai_model, created_by, updated_by)
    values (${tenantOf(u)}, ${t.id}, 'monthly', ${range.start}, ${range.end}, ${range.end}, 'draft', null, ${sql.json(body as never)}, ${r.model ?? prov.model}, ${u.id}, ${u.id})
    on conflict (site_id, kind, report_day) do update set body = excluded.body, ai_model = excluded.ai_model, updated_by = excluded.updated_by, updated_at = now()
    returning id`;
  await audit(sql, u.id, 'branch_report.monthly_draft', 'branch_report', row.id, { site: t.id, month: i.month, weeks: weeklies.length, fixed }, ip);
  return { ...(await getReport(u, row.id)), fixed, weeks: weeklies.length };
}

// ---------------- 고치기·제출 ----------------
export async function saveReport(u: SessionUser, id: string, b: unknown, ip: string | null) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  if (r.status === 'submitted') throw new HttpError(409, 'submitted', '제출한 보고서는 고칠 수 없습니다 — 관리자에게 [제출 취소]를 요청하세요');
  const schema = r.kind === 'monthly' ? monthlyBodySchema : bodySchema;
  // 서버가 정하는 칸(근거 목록·올린 하이링크 파일 표시·주간 값 제안)은 화면에서 온 값으로 바꾸지 않음
  const fixedKeys = r.kind === 'monthly' ? { usageFile: r.body?.usageFile ?? null, usageWeekly: r.body?.usageWeekly ?? [], members: r.body?.members ?? null, flow: r.body?.flow ?? null, issuesMonth: r.body?.issuesMonth ?? null, review: r.body?.review ?? null } : { review: r.body?.review ?? null };
  const body = schema.parse({ ...(b as object), ...fixedKeys, sources: r.body?.sources ?? { w: [] } });
  await sql`update branch_reports set body = ${sql.json(body as never)}, updated_by = ${u.id}, updated_at = now() where id = ${id}`;
  await audit(sql, u.id, 'branch_report.edit', 'branch_report', id, {}, ip);
  return getReport(u, id);
}
export async function submitReport(u: SessionUser, id: string, ip: string | null) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  if (r.status === 'submitted') throw new HttpError(409, 'submitted', '이미 제출했습니다');
  let body = r.body ?? {};
  if (r.kind === 'monthly') { // #1115 분류 · #1116 6개월 흐름·민원 모음을 제출 때 값으로 굳힘(고객사에 낸 그대로)
    body = { ...body, ...(body.members ? { members: await withKinds(sql, tenantOf(u), body.members) } : {}) };
    body = { ...body, ...(await monthExtras(sql, tenantOf(u), { ...r, body })) };
  }
  // #1117 민감 내용 검사: 고치지도 '그대로 두기'도 안 한 곳이 있으면 제출 막음 · 그대로 둔 것이 있으면 본사 승인 대기 · 없으면 바로 고객사 제출용
  const flags = await scanOf({ ...r, body }); const kept = body.review?.kept ?? {};
  const open = flags.filter((f) => !kept[f.key]);
  if (open.length) throw new HttpError(409, 'sensitive', `민감 내용 ${open.length}곳 — [가리기]로 고치거나 '그대로 두기' 이유를 적은 뒤 제출하세요(${open.slice(0, 3).map((f) => f.label).join(', ')}${open.length > 3 ? ' …' : ''})`);
  const state = flags.length ? 'pending' : 'clean';
  body = { ...body, review: { kept, state, checkedAt: new Date().toISOString(), flags: flags.length } };
  await sql`update branch_reports set body = ${sql.json(body as never)}, status = 'submitted', submitted_by = ${u.id}, submitted_at = now(), updated_at = now() where id = ${id}`;
  await audit(sql, u.id, 'branch_report.submit', 'branch_report', id, { site: t.id, day: r.report_day, review: state, kept: flags.map((f) => ({ label: f.label, kind: f.kind, reason: kept[f.key]?.reason })) }, ip);
  if (state === 'pending') {
    const { notify } = await import('../notifications');
    const title = `${t.name} ${r.kind === 'monthly' ? `${Number(String(r.period_start).slice(5, 7))}월 월간 보고` : `${String(r.report_day).slice(5).replace('-', '/')} 주간보고`}`;
    await notify(sql, { userIds: await approversOf(sql, tenantOf(u), t), type: 'branch_report', title: `${title} — 고객사 제출 승인 필요`, body: `민감 내용 ${flags.length}곳을 '그대로 두기'로 제출했습니다. 확인 뒤 [승인]·[반려] 해 주세요`, link: '/branch-reports', entityType: 'branch_report', entityId: id, actorId: u.id, push: true, space: 'work', dedupeKey: `branch-review:pending:${id}:${Date.now()}` } as never).catch(() => {});
  }
  return getReport(u, id);
}
export async function unsubmitReport(u: SessionUser, id: string, ip: string | null) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  if (!canReopen(u, t)) throw forbidden('제출 취소는 관리자·검토 담당만 할 수 있습니다');
  if (r.status !== 'submitted') throw new HttpError(409, 'not_submitted', '제출하지 않은 보고서입니다');
  if (r.purged_at) throw new HttpError(409, 'purged', '제출 30일이 지나 근거 글을 지운 보고서는 제출 취소할 수 없습니다');
  await sql`update branch_reports set status = 'draft', submitted_by = null, submitted_at = null, updated_at = now(), body = ${sql.json({ ...(r.body ?? {}), review: { kept: r.body?.review?.kept ?? {} } } as never)} where id = ${id}`; // #1117 다시 검사·승인
  await audit(sql, u.id, 'branch_report.unsubmit', 'branch_report', id, {}, ip);
  return getReport(u, id);
}

/** 근거 보기: D줄(붙여 넣은 글, 가린 뒤) · M(대화, 가린 글) */
export async function reportEvidence(u: SessionUser, id: string, refs: string[]) {
  const sql = db(); const { r } = await loadReport(u, id, sql);
  const d = String(r.source_text ?? '').split(/\r?\n/);
  const want = refs.filter((x) => /^[DMW]\d{1,9}$/.test(x)).slice(0, 30);
  const mIds = want.filter((x) => x[0] === 'M').map((x) => x.slice(1));
  const msgs = mIds.length ? await sql<{ id: string; at: string; sender: string; text: string }[]>`select id::text as id, to_char(at, 'YYYY-MM-DD HH24:MI') as at, sender, text from branch_chat_messages where site_id = ${r.site_id} and id = any(${mIds.map(Number)}::bigint[])` : [];
  return { items: want.map((ref) => {
    if (ref[0] === 'D') { const line = d[Number(ref.slice(1)) - 1]; return { ref, kind: '주간보고 글', text: line ?? (r.purged_at ? '(30일이 지나 지웠습니다)' : '(없음)') }; }
    if (ref[0] === 'M') { const m = msgs.find((x) => x.id === ref.slice(1)); return { ref, kind: '단체방 대화', at: m?.at ?? null, sender: m?.sender ?? null, text: m?.text ?? '(지웠거나 없는 메시지)' }; }
    const s = (r.body?.sources?.w ?? []).find((x: any) => x.ref === ref);
    if (r.kind === 'monthly') return { ref, kind: '주간보고', text: s ? `${Number(s.day.slice(5, 7))}/${Number(s.day.slice(8, 10))}(금) 주간보고` : '(없음)', reportId: s?.reportId ?? null };
    return { ref, kind: '워크인 업무', text: s?.title ?? '(없음)', taskId: s?.taskId ?? null };
  }) };
}

// ---------------- #1106 하이링크 이용현황 파일(월간 C) — 올리기·내려받기·빼기 ----------------
export const usageFileInput = z.object({ name: z.string().trim().min(1).max(200), b64: z.string().min(1).max(5_600_000) });
const USAGE_EXT: Record<string, string> = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'text/csv' };
export async function uploadUsageFile(u: SessionUser, id: string, i: z.infer<typeof usageFileInput>, ip: string | null) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  if (r.kind !== 'monthly') throw badRequest('월간 보고서에만 올릴 수 있습니다');
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  if (r.status === 'submitted') throw new HttpError(409, 'submitted', '제출한 보고서는 고칠 수 없습니다 — [제출 취소] 뒤에 올리세요');
  const ext = i.name.toLowerCase().split('.').pop() ?? '';
  const mime = USAGE_EXT[ext];
  if (!mime) throw badRequest('PDF·엑셀(xlsx)·CSV 파일만 올릴 수 있습니다');
  const buf = Buffer.from(i.b64, 'base64');
  if (!buf.length || buf.length > 4_000_000) throw badRequest('파일이 비었거나 4MB 를 넘습니다');
  // 표 읽기: PDF 는 글자 추출(스캔 PDF 는 못 읽음 → 첨부만), 엑셀·CSV 는 칸을 띄어 이어 붙인 글
  let text = '';
  try {
    if (ext === 'pdf') text = (await (await import('../pdfText')).pdfText(buf)) ?? '';
    else { const ti = await import('../taskImport'); text = (ext === 'xlsx' ? ti.parseXlsx(buf) : ti.parseCsv(buf)).map((row) => row.join(' ')).join('\n'); }
  } catch { text = ''; }
  const { parseHilinkUsage } = await import('./hilinkUsage');
  const got = parseHilinkUsage(text);
  await sql`insert into branch_report_files (tenant, report_id, kind, name, mime, size, data, created_by) values (${tenantOf(u)}, ${id}, 'hilink_usage', ${i.name}, ${mime}, ${buf.length}, ${buf}, ${u.id})
    on conflict (report_id, kind) do update set name = excluded.name, mime = excluded.mime, size = excluded.size, data = excluded.data, created_by = excluded.created_by, created_at = now()`;
  const usageFile = { name: i.name, size: buf.length, parsed: got.rows.length > 0, rows: got.rows.length, at: new Date().toISOString() };
  const body = { ...(r.body ?? {}), usageFile, ...(got.rows.length ? { usage: got.rows, usageTotal: got.total } : {}) };
  await sql`update branch_reports set body = ${sql.json(body as never)}, updated_by = ${u.id}, updated_at = now() where id = ${id}`;
  await audit(sql, u.id, 'branch_report.usage_file', 'branch_report', id, { rows: got.rows.length, total: !!got.total, ext }, ip);
  return { ...(await getReport(u, id)), parsed: got.rows.length, total: !!got.total };
}
export async function getUsageFile(u: SessionUser, id: string) {
  const sql = db(); await loadReport(u, id, sql);
  const [f] = await sql<{ name: string; mime: string; data: Buffer }[]>`select name, mime, data from branch_report_files where report_id = ${id} and kind = 'hilink_usage'`;
  if (!f) throw notFound('올린 하이링크 이용현황 파일이 없습니다');
  return f;
}
export async function removeUsageFile(u: SessionUser, id: string, ip: string | null) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  if (r.status === 'submitted') throw new HttpError(409, 'submitted', '제출한 보고서는 고칠 수 없습니다');
  await sql`delete from branch_report_files where report_id = ${id} and kind = 'hilink_usage'`;
  await sql`update branch_reports set body = ${sql.json({ ...(r.body ?? {}), usageFile: null } as never)}, updated_by = ${u.id}, updated_at = now() where id = ${id}`;
  await audit(sql, u.id, 'branch_report.usage_file_remove', 'branch_report', id, {}, ip);
  return getReport(u, id);
}

// ---------------- #1112 하이링크 회원목록(엑셀) → 회원(이용권) 현황 — 집계만 저장 ----------------
export const memberFileInput = z.object({ name: z.string().trim().min(1).max(200), b64: z.string().min(1).max(4_300_000) }); // 운영 요청 크기 한도(약 4.5MB) 안 — 파일 3MB 까지
export async function uploadMemberFile(u: SessionUser, id: string, i: z.infer<typeof memberFileInput>, ip: string | null) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  if (r.kind !== 'monthly') throw badRequest('월간 보고서에만 올릴 수 있습니다');
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  if (r.status === 'submitted') throw new HttpError(409, 'submitted', '제출한 보고서는 고칠 수 없습니다 — [제출 취소] 뒤에 올리세요');
  if (!/\.xlsx$/i.test(i.name)) throw badRequest('하이링크에서 내려받은 회원목록 엑셀(.xlsx)만 올릴 수 있습니다');
  const buf = Buffer.from(i.b64, 'base64');
  if (!buf.length || buf.length > 3_200_000) throw badRequest('파일이 비었거나 3MB 를 넘습니다');
  const { readXlsx } = await import('../sales/collectors/xlsx');
  let rows: string[][];
  try {
    const wb = readXlsx(new Uint8Array(buf));
    const sheet = wb.sheetNames.find((n) => n.replace(/\s+/g, '') === '전체') ?? wb.sheetNames[0]; // '전체' 시트만(동별 시트는 같은 내용 중복)
    rows = wb.rows(sheet);
  } catch { throw badRequest('엑셀 파일을 열지 못했습니다 — 하이링크 회원목록 엑셀인지 확인해 주세요'); }
  const hi = rows.findIndex((row) => row.some((c) => /이용권명/.test(String(c))));
  if (hi < 0) throw badRequest("'이용권명' 머리줄을 찾지 못했습니다 — 하이링크 회원목록 엑셀인지 확인해 주세요");
  const month = String(r.period_start).slice(0, 7);
  const { aggregateMembers } = await import('./memberList');
  const got = aggregateMembers(rows[hi], rows.slice(hi + 1), month);
  rows = []; // 이름·연락처가 든 행은 여기서 버림(집계만 남김)
  if (!got.ok) throw badRequest(`필요한 칸을 찾지 못했습니다: ${got.missing.join(', ')}`);
  await sql`insert into branch_member_stats (site_id, month, tenant, stats, stats_all, excluded, file_name, uploaded_by)
    values (${t.id}, ${month}, ${tenantOf(u)}, ${sql.json(got.stats as never)}, ${sql.json(got.statsAll as never)}, ${got.excluded}, ${i.name}, ${u.id})
    on conflict (site_id, month) do update set stats = excluded.stats, stats_all = excluded.stats_all, excluded = excluded.excluded, file_name = excluded.file_name, uploaded_by = excluded.uploaded_by, updated_at = now()`;
  const { prevMonth } = await import('./monthly');
  const { isV2, defaultKind, viewOf } = await import('./memberList');
  const pm = prevMonth(month);
  const [p] = await sql<{ stats: any; stats_all: any }[]>`select stats, stats_all from branch_member_stats where site_id = ${t.id} and month = ${pm}`;
  // #1115 이용권/수강권: 처음 보는 이용권명은 기본 규칙으로 회사 목록에 넣고(분류 확인 표시), 이 보고서에는 그때의 분류를 함께 둠
  const names = new Map<string, string>();
  for (const a of [got.statsAll, isV2(p?.stats_all) ? p.stats_all : null]) if (a) for (const [k, n] of Object.entries(a.names)) if (!names.has(k)) names.set(k, n.name);
  if (names.size) await sql`insert into branch_pass_kinds ${sql([...names].map(([k, n]) => ({ tenant: tenantOf(u), name_key: k, name: n, kind: defaultKind(n) })), 'tenant', 'name_key', 'name', 'kind')} on conflict (tenant, name_key) do nothing`;
  const members = await withKinds(sql, tenantOf(u), { v: 2, month, fileName: i.name, at: new Date().toISOString(), excluded: got.excluded, exclude: r.body?.members?.exclude ?? true, stats: got.stats, statsAll: got.statsAll, prev: p ? { month: pm, stats: p.stats, statsAll: p.stats_all } : null, kinds: {}, unconfirmed: [] });
  await sql`update branch_reports set body = ${sql.json({ ...(r.body ?? {}), members } as never)}, updated_by = ${u.id}, updated_at = now() where id = ${id}`;
  const active = viewOf(got.stats, members.kinds, 'all')!.active;
  await audit(sql, u.id, 'branch_report.member_file', 'branch_report', id, { month, active, excluded: got.excluded }, ip); // 숫자만(이름·연락처 없음)
  return { ...(await getReport(u, id)), active, excluded: got.excluded, prev: !!p };
}
/** #1115 보고서에 둔 분류를 회사 목록(지금 값)으로 맞춤 — 이 보고서 파일·전달 파일에 나온 이름만 */
async function withKinds(sql: Sql, tenant: string, m: any) {
  if (!m) return m;
  const keys = new Set<string>([...Object.keys(m.statsAll?.names ?? {}), ...Object.keys(m.prev?.statsAll?.names ?? {})]);
  if (!keys.size) return m;
  const rows = await sql<{ name_key: string; kind: 'use' | 'class'; confirmed: boolean }[]>`select name_key, kind, confirmed from branch_pass_kinds where tenant = ${tenant} and name_key = any(${[...keys]}::text[])`;
  return { ...m, kinds: { ...(m.kinds ?? {}), ...Object.fromEntries(rows.map((x) => [x.name_key, x.kind])) }, unconfirmed: rows.filter((x) => !x.confirmed).map((x) => x.name_key).sort() };
}
/** 제외 켜기/끄기 · #1115 이용권명 하나의 분류 바꾸기(회사 전체 기억) */
export const memberPatchInput = z.object({ exclude: z.boolean().optional(), pass: z.object({ key: z.string().min(1).max(200), kind: z.enum(['use', 'class']) }).optional() })
  .refine((x) => x.exclude !== undefined || x.pass !== undefined, { message: '바꿀 것이 없습니다' });
export async function patchMembers(u: SessionUser, id: string, i: z.infer<typeof memberPatchInput>, ip: string | null) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  if (r.status === 'submitted') throw new HttpError(409, 'submitted', '제출한 보고서는 고칠 수 없습니다');
  let m = r.body?.members;
  if (!m) throw badRequest('먼저 회원목록을 올려 주세요');
  if (i.pass) {
    const name = m.statsAll?.names?.[i.pass.key]?.name ?? m.prev?.statsAll?.names?.[i.pass.key]?.name;
    if (!name) throw badRequest('이 보고서의 회원목록에 없는 이용권명입니다');
    await sql`insert into branch_pass_kinds (tenant, name_key, name, kind, confirmed, updated_by) values (${tenantOf(u)}, ${i.pass.key}, ${name}, ${i.pass.kind}, true, ${u.id})
      on conflict (tenant, name_key) do update set kind = excluded.kind, confirmed = true, updated_by = excluded.updated_by, updated_at = now()`;
    m = await withKinds(sql, tenantOf(u), m);
    await audit(sql, u.id, 'branch_report.pass_kind', 'branch_report', id, { kind: i.pass.kind }, ip);
  }
  if (i.exclude !== undefined) {
    m = { ...m, exclude: i.exclude };
    await audit(sql, u.id, 'branch_report.member_exclude', 'branch_report', id, { exclude: i.exclude }, ip);
  }
  await sql`update branch_reports set body = ${sql.json({ ...r.body, members: m } as never)}, updated_by = ${u.id}, updated_at = now() where id = ${id}`;
  return getReport(u, id);
}

// ---------------- 내려받기(엑셀, 2단계) — 주간·월간 ----------------
// ---------------- #1117 민감 내용 검사 → 그대로 두면 본사 승인 → 승인 뒤에만 '고객사 제출용' ----------------
/** 월간: 전달 대비 30% 넘게 바뀐 숫자(시설별 이용 현황·회원 현황) — 메모에 그 이름을 적어 설명했으면 뺌 */
async function monthChanges(b: any) {
  const { numOf } = await import('./monthly');
  const out: { path: string; label: string; text: string }[] = [];
  const said = (name: string) => !!b?.notes && String(b.notes).replace(/\s+/g, '').includes(String(name).replace(/\s+/g, ''));
  const rows: [string, any][] = [...(b?.usage ?? []).map((x: any, i: number) => [`usage.${i}`, x] as [string, any]), ...(b?.usageTotal ? [['usageTotal', b.usageTotal] as [string, any]] : [])];
  for (const [path, x] of rows) {
    const a = numOf(String(x?.prev ?? '')), c = numOf(String(x?.cur ?? ''));
    if (a === null || c === null || !a || Math.abs((c - a) / a) <= 0.3 || said(x.item)) continue;
    out.push({ path, label: `시설별 이용 현황 · ${x.item || '합계'}`, text: `${x.prev} → ${x.cur}(${c > a ? '▲' : '▼'}${Math.abs(Math.round(((c - a) / a) * 1000) / 10)}%)` });
  }
  if (b?.members) {
    const { memberTables } = await import('./memberList');
    for (const tb of memberTables(b.members)) for (const x of tb.rows) {
      if (x.rate === null || Math.abs(x.rate) <= 30 || said(x.label.replace(/^·\s*/, ''))) continue;
      out.push({ path: `members.${tb.key}.${x.label}`, label: `${tb.title} · ${x.label.replace(/^·\s*/, '')}`, text: `${(x.prev ?? 0).toLocaleString('ko-KR')} → ${x.cur.toLocaleString('ko-KR')}(${x.rate > 0 ? '▲' : '▼'}${Math.abs(x.rate)}%)` });
    }
  }
  return out;
}
type ReviewState = 'draft' | 'rejected' | 'clean' | 'pending' | 'approved' | 'unchecked';
async function scanOf(r: any) {
  const { scanReport } = await import('./mask');
  return scanReport(r.kind, r.body ?? {}, r.kind === 'monthly' ? { changes: await monthChanges(r.body) } : {});
}
/** 화면·인쇄·엑셀이 같이 보는 검사 결과 — final = 고객사에 낼 수 있음 */
async function reviewOf(u: SessionUser, t: Site, r: any) {
  const flags = await scanOf(r); const rv = r.body?.review ?? {}; const kept: Record<string, { reason: string; byName?: string; at?: string }> = rv.kept ?? {};
  const state: ReviewState = r.status !== 'submitted' ? (rv.state === 'rejected' ? 'rejected' : 'draft') : (rv.state ?? (flags.length ? 'unchecked' : 'clean'));
  const list = flags.map((f) => ({ ...f, kept: kept[f.key] ?? null }));
  return { state, final: r.status === 'submitted' && (state === 'clean' || state === 'approved'), flags: list, open: list.filter((f) => !f.kept).length,
    approvedByName: rv.approvedByName ?? null, approvedAt: rv.approvedAt ?? null, rejectReason: rv.rejectReason ?? null, rejectedByName: rv.rejectedByName ?? null,
    canApprove: r.status === 'submitted' && state === 'pending' && canReopen(u, t) && (isAdmin(u) || r.submitted_by !== u.id) };
}
export { REVIEW_MARK as MARK } from './mask';
async function approversOf(sql: Sql, tenant: string, t: Site) {
  const rows = await sql<{ id: string }[]>`select id from users where tenant = ${tenant} and status = 'active' and role in ('owner', 'admin')`;
  return [...new Set([...rows.map((x) => x.id), ...(t.reviewer_user_id ? [t.reviewer_user_id] : [])])];
}
export const reviewInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('mask'), key: z.string().min(1).max(600) }),
  z.object({ action: z.literal('maskAll') }),
  z.object({ action: z.literal('keep'), key: z.string().min(1).max(600), reason: z.string().trim().min(2, '그대로 두는 이유를 적어 주세요').max(300) }),
  z.object({ action: z.literal('unkeep'), key: z.string().min(1).max(600) }),
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().trim().min(2, '반려 사유를 적어 주세요').max(500) }),
]);
export async function reviewAction(u: SessionUser, id: string, i: z.infer<typeof reviewInput>, ip: string | null) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  const { applyMask } = await import('./mask');
  const { notify } = await import('../notifications');
  const title = `${r.unit_name} ${r.kind === 'monthly' ? `${Number(String(r.period_start).slice(5, 7))}월 월간 보고` : `${String(r.report_day).slice(5).replace('-', '/')} 주간보고`}`;
  const view = { ...r, body: await viewBody(sql, u, r) }; // 화면과 같은 본문으로 검사(가리기·그대로 두기는 저장된 본문에)
  if (i.action === 'approve' || i.action === 'reject') {
    const rv = await reviewOf(u, t, view);
    if (!rv.canApprove) throw r.status === 'submitted' && rv.state === 'pending' ? forbidden(r.submitted_by === u.id ? '내가 제출한 보고는 다른 승인자가 승인해야 합니다' : '승인은 대표·관리자·그 지점 검토 담당만 할 수 있습니다') : new HttpError(409, 'not_pending', '승인 대기 중인 보고서가 아닙니다');
    const writers = [r.submitted_by, t.writer_user_id].filter(Boolean) as string[];
    if (i.action === 'approve') {
      await sql`update branch_reports set body = ${sql.json({ ...r.body, review: { ...(r.body?.review ?? {}), state: 'approved', approvedBy: u.id, approvedByName: u.name, approvedAt: new Date().toISOString() } } as never)}, updated_at = now() where id = ${id}`;
      await audit(sql, u.id, 'branch_report.approve', 'branch_report', id, { kept: rv.flags.filter((f) => f.kept).map((f) => ({ label: f.label, reason: f.kept!.reason })) }, ip);
      await notify(sql, { userIds: writers, type: 'branch_report', title: `${title} 승인됨`, body: `${u.name}님이 승인했습니다 — '고객사 제출용' 파일을 내려받을 수 있습니다`, link: '/branch-reports', entityType: 'branch_report', entityId: id, actorId: u.id, space: 'work', dedupeKey: `branch-review:approved:${id}:${Date.now()}` } as never).catch(() => {});
    } else {
      await sql`update branch_reports set status = 'draft', submitted_by = null, submitted_at = null, updated_at = now(),
        body = ${sql.json({ ...r.body, review: { ...(r.body?.review ?? {}), state: 'rejected', rejectReason: i.reason, rejectedByName: u.name, rejectedAt: new Date().toISOString() } } as never)} where id = ${id}`;
      await audit(sql, u.id, 'branch_report.reject', 'branch_report', id, { reason: i.reason }, ip);
      await notify(sql, { userIds: writers, type: 'branch_report', title: `${title} 반려됨`, body: `${u.name}: ${i.reason.slice(0, 120)} — 고친 뒤 다시 제출해 주세요`, link: '/branch-reports', entityType: 'branch_report', entityId: id, actorId: u.id, push: true, space: 'work', dedupeKey: `branch-review:rejected:${id}:${Date.now()}` } as never).catch(() => {});
    }
    return getReport(u, id);
  }
  if (!canWrite(u, t)) throw forbidden('이 지점 보고를 쓸 권한이 없습니다');
  if (r.status === 'submitted') throw new HttpError(409, 'submitted', '제출한 보고서는 고칠 수 없습니다 — [제출 취소] 뒤에 고치세요');
  const flags = await scanOf(view);
  const f = 'key' in i ? flags.find((x) => x.key === i.key) : null;
  if ('key' in i && !f && i.action !== 'unkeep') throw new HttpError(409, 'stale', '내용이 바뀌었습니다 — 화면을 새로 고친 뒤 다시 해 주세요');
  let body = r.body ?? {};
  if (i.action === 'mask' || i.action === 'maskAll') {
    let n = 0;
    for (const x of i.action === 'mask' ? [f!] : flags.filter((y) => y.mask && !y.fixIn)) { const nb = applyMask(body, x); if (nb) { body = nb; n++; } }
    if (!n) throw badRequest(i.action === 'mask' ? '이 말은 가릴 수 없습니다 — 글을 고치거나 그대로 두기 이유를 적어 주세요' : '가릴 수 있는 곳이 없습니다');
    await audit(sql, u.id, 'branch_report.mask', 'branch_report', id, { n, kinds: i.action === 'mask' ? [f!.kind] : undefined }, ip);
  } else {
    const kept = { ...(body.review?.kept ?? {}) };
    if (i.action === 'keep') kept[i.key] = { reason: i.reason, by: u.id, byName: u.name, at: new Date().toISOString(), label: f!.label, match: f!.match };
    else delete kept[i.key];
    body = { ...body, review: { ...(body.review ?? {}), kept } };
    await audit(sql, u.id, `branch_report.${i.action}`, 'branch_report', id, { label: f?.label ?? null, kind: f?.kind ?? null, reason: i.action === 'keep' ? i.reason : undefined }, ip);
  }
  await sql`update branch_reports set body = ${sql.json(body as never)}, updated_by = ${u.id}, updated_at = now() where id = ${id}`;
  return getReport(u, id);
}

export async function exportReport(u: SessionUser, id: string) {
  const sql = db(); const { r, t } = await loadReport(u, id, sql);
  const { writeXlsx } = await import('../xlsx');
  const { delta, numOf, sumCol } = await import('./monthly');
  const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
  const b = r.body ?? {};
  const author = r.submitted_by_name ?? r.created_by_name ?? '';
  const rv = await reviewOf(u, t, { ...r, body: await viewBody(sql, u, r) }); const mark = (await import('./mask')).REVIEW_MARK[rv.state as ReviewState]; const filePre = rv.final ? '고객사제출용' : '초안'; // #1116 표지·파일 이름 · #1117 승인 뒤에만 고객사 제출용
  if (r.kind === 'monthly') {
    // #1116 6개월 흐름·민원 모음 — 초안은 지금 계산(분류도 지금 값), 제출한 것은 굳힌 값
    const ex = r.status === 'draft' || !b.flow ? await monthExtras(sql, tenantOf(u), { ...r, body: r.status === 'draft' && b.members ? { ...b, members: await withKinds(sql, tenantOf(u), b.members) } : b }) : { flow: b.flow, issuesMonth: b.issuesMonth };
    const usage: { item: string; prev: string; cur: string; diff?: string; rate?: string }[] = b.usage ?? [];
    const st = b.usageTotal as { item: string; prev: string; cur: string; diff: string; rate: string } | null;
    const tot = st ?? { item: '전 시설 합계', prev: sumCol(usage.map((x) => x.prev)), cur: sumCol(usage.map((x) => x.cur)), diff: '', rate: '' };
    const main = [
      [`${mark} · 월간 업무 보고서`, r.unit_name], ['작성자', author], ['소속', '주식회사 다짐 운영팀'], ['기간', `${r.period_start} ~ ${r.period_end}`], ['보고일', r.submitted_at ? new Date(r.submitted_at).toISOString().slice(0, 10) : '(초안)'], [],
      ['■ 당월 중요업무 내역'], ['번호', '업무내용', '결과/산출물'], ...(b.important ?? []).map((x: any, k: number) => [k + 1, x.work, x.result]), [],
      ['■ 업무 진행사항'], ['주차', '실천업무', '중점 확인사항', '결과', '비고'], ...(b.progress ?? []).map((x: any) => [x.week, x.task, x.focus, x.result, x.note]), [],
      ['■ 차월 업무목표 및 실천사항'], ['업무목표', '실천사항'], ...(b.next ?? []).map((x: any) => [x.goal, x.actions]), [],
      ['■ 이번 달 민원·특이사항(처리 결과 포함)'], ['번호', '내용', '처음 보고', '처리 결과', '세부'],
      ...(ex.issuesMonth ?? []).map((x: any, k: number) => [k + 1, x.title, x.first, `${x.state}${x.last !== x.first ? ` (${x.last} 기준)` : ''}`, (x.details ?? []).join('\n')]), ...(ex.issuesMonth?.length ? [] : [['', '이번 달 주간보고에 적힌 민원·특이사항 없음']]), [],
      ['■ 미완료(다음 달 확인)'], ['항목', '상태', '처음', '마지막 주'], ...(b.unfinished ?? []).map((x: any) => [x.title, x.state, x.since, x.lastWeek]),
      ...(b.notes ? [[], ['메모', b.notes]] : []),
    ];
    const fileNote = b.usageFile ? [[], [`하이링크 이용현황 첨부: ${b.usageFile.name}${b.usageFile.parsed ? '' : ' (표를 읽지 못해 원본을 첨부함)'}`]] : usage.length ? [] : [[], ['하이링크 이용현황 미첨부']];
    const c = [['시설', '전달 인원', '이번달 인원', '증감', '증감률'], ...usage.map((x) => { const d = delta(x.prev, x.cur); return [x.item, x.prev, x.cur, x.diff || d.diff, x.rate || d.rate]; }),
      ...(usage.length || st ? [(() => { const d = delta(tot.prev, tot.cur); return [tot.item || '전 시설 합계', tot.prev, tot.cur, tot.diff || d.diff, tot.rate || d.rate]; })()] : []), ...fileNote];
    // #1112 회원(이용권) 현황 시트(있을 때만) — 숫자만
    const fl = ex.flow as { months: string[]; rows: { label: string; vals: (number | null)[] }[]; notes: string[] } | null;
    const flowRows = fl ? [['구분', ...fl.months.map((x) => `${x.slice(0, 4)}.${x.slice(5)}`)], ...fl.rows.map((x) => [x.label, ...x.vals.map((v) => (v === null ? '-' : v))]), [], ...fl.notes.map((x) => [x])] : [];
    const m = b.members as any; const sheets = [{ name: '월간 업무 보고서', rows: main }, { name: '시설별 이용 현황', rows: c }, ...(fl ? [{ name: '최근 6개월 흐름', rows: flowRows }] : [])];
    if (m) {
      const { memberTables } = await import('./memberList');
      sheets.push({ name: '회원 현황', rows: memberTables(r.status === 'draft' ? await withKinds(sql, tenantOf(u), m) : m).flatMap((tb) => [[`■ ${tb.title}`], ['구분', '전달', '이번달', '증감', '증감률'],
        ...tb.rows.map((x) => [x.label, x.prev ?? '-', x.cur, x.diff ?? '-', x.rate === null ? '-' : `${x.rate}%${x.drop ? ' (30% 넘게 줄어듦)' : ''}`]), ...tb.notes.map((x) => [x]), []]) });
    }
    return { fileName: `${filePre}_${r.unit_name}_월간보고_${r.period_start.slice(0, 7)}.xlsx`, data: writeXlsx(sheets) };
  }
  const rows = [
    [`${mark} · 커뮤니티 주간 운영 보고서`, r.unit_name], ['기준일시', `${md(r.report_day)}(금) 11:00`], ['기간', `${md(r.period_start)} ~ ${md(r.period_end)}`], ['작성', '주식회사 다짐 (DAGYM)'], [],
    ['1. 이용 인원 현황'], ['항목', '인원'], ...(b.usage ?? []).map((x: any) => [x.item, x.count]),
    ...((b.lockers ?? []).length ? [[], ['락커 구분', '사용', '전체', '사용률'], ...b.lockers.map((x: any) => { const u = numOf(x.used), t = numOf(x.total); return [x.name, x.used, x.total, u !== null && t ? `${Math.round((u / t) * 100)}%` : '']; })] : []), [],
    ['2. 시설 점검 보고'], ['시설', '총 이용인원', '청소 상태', '시설 상태'],
    ...(b.facilities ?? []).flatMap((f: any) => [[f.name, f.visitors, f.cleaning, f.condition], ...(f.lines ?? []).map((l: any) => [`  · ${l.item}`, l.status, l.action, l.state])]), [],
    ['3. 특이사항 · 건의사항 · 민원'], ['제목', '처리', '세부'], ...(b.issues ?? []).map((x: any) => [x.title, x.state, (x.details ?? []).join('\n')]),
    ...(b.notes ? [[], ['메모', b.notes]] : []),
  ];
  return { fileName: `${filePre}_${r.unit_name}_주간보고_${r.report_day}.xlsx`, data: writeXlsx([{ name: '주간 운영 보고서', rows }]) };
}

// ---------------- 정기 작업: 제출 30일 뒤 근거 지우기 · 금요일 11시 작성 알림 ----------------
export async function branchReportTick(sql: Sql = db()) {
  const purged = await sql`delete from branch_chat_messages m using branch_reports r
    where r.site_id = m.site_id and r.kind = 'weekly' and r.status = 'submitted' and r.submitted_at < now() - interval '30 days'
      and m.at >= r.period_start and m.at < r.report_day + interval '11 hours' returning m.id`;
  const cleared = await sql`update branch_reports set source_text = null, purged_at = now() where kind = 'weekly' and status = 'submitted' and submitted_at < now() - interval '30 days' and purged_at is null returning id`; // 월간은 붙여 넣은 글이 없음
  const stale = await sql`delete from branch_chat_messages where created_at < now() - interval '120 days' returning id`; // 보고서에 쓰이지 않은 채 남은 대화도 4개월 뒤 지움
  // 금요일 11시(서울) 뒤 첫 실행: 그 주 보고서가 없는 지점의 작성자에게 알림(한 번)
  const now = new Date(); const day = kstToday();
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(now));
  let reminded = 0;
  if (weekday(day) === 5 && hour >= 11) {
    const rows = await sql<{ id: string; tenant: string; writer_user_id: string; name: string }[]>`select s.id, s.tenant, s.writer_user_id, s.name from branch_sites s
      where not s.hidden and s.writer_user_id is not null and not exists (select 1 from branch_reports r where r.site_id = s.id and r.kind = 'weekly' and r.report_day = ${day})`;
    const { notify } = await import('../notifications');
    for (const x of rows.filter((r) => branchReportOn(r.tenant))) {
      const ids = await notify(sql, { userIds: [x.writer_user_id], type: 'branch_report', title: `${x.name} 주간보고를 쓸 차례입니다`, body: '이번 주 주간보고 글을 붙여 넣으면 초안을 만들어 드립니다.', link: `/branch-reports?site=${x.id}`, dedupeKey: `branch-remind:${x.id}:${day}`, space: 'work' });
      reminded += ids.length;
    }
  }
  return { purged: purged.length, cleared: cleared.length, stale: stale.length, reminded };
}

/** 메뉴에 보일지(레이아웃): 켜진 회사 + 관리자이거나 볼 수 있는(숨기지 않은) 지점이 있음 — 지점 관리자(직원)는 자기 지점이 정해지면 보임 */
export async function branchReportVisible(u: SessionUser) {
  if (u.isDemo || !branchReportOn(tenantOf(u))) return false;
  if (isAdmin(u)) return true;
  return (await sitesOf(u, db()).catch(() => [])).some((t) => !t.hidden);
}
/** #1119 보고 메뉴 하나: 회사가 지점 보고를 쓰는지(이름 나눔) · 이 사람이 지점 작성 담당인지(처음 여는 탭 = 고객사 보고) */
export async function branchReportAccess(u: SessionUser) {
  const company = !u.isDemo && branchReportOn(tenantOf(u));
  if (!company) return { company: false, visible: false, writer: false };
  const sites = await sitesOf(u, db()).catch(() => [] as Site[]);
  return { company, visible: isAdmin(u) || sites.some((t) => !t.hidden), writer: sites.some((t) => !t.hidden && t.writer_user_id === u.id) };
}
