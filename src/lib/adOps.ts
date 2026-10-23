import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { decrypt } from './crypto';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';
import { DEFAULT_RULES, checkAd, qualityRules, scoreHook, type QualityRules } from './mktQuality';
import { NAVER_REGION_CODES, REGION_RE } from './naverRegions';
import { PLAN_KEYWORDS_MAX, combineKeywords } from './kwCombine';

/**
 * V44 ① AI 광고 운영실 — 네이버 검색광고 '쓰기'(파워링크 먼저, 플레이스 다음).
 * 원칙(대표 10/19, 결정 전 기본값): 월 광고비 상한 필수 입력 · 초과 시 워크인이 만든 광고 자동 중지 · 이상 징후 선제 중지는 알림만.
 * - 세팅안(draft) → [승인하고 시작] = 네이버에 **꺼진 상태(userLock)** 로 생성 → [켜기](돈이 나가는 변경, 관리자 승인 = 누름 + 상한 검사).
 * - 모든 변경은 mkt_ad_changes 에 전후 값으로 기록, [되돌리기] 가능. 서버는 승인된 요청만 실행(AI 는 제안까지).
 * - 네이버 API 경로·필드는 공식 문서 기준(확인일 10/19, AI_ADS_API_SURVEY.md) — 실계정 생성 시험 전까지 '구조 시험'.
 */
const T = () => process.env.ADS_TEST_BASE?.replace(/\/$/, '');
const NAVER = () => (T() ? `${T()}/naver` : 'https://api.searchad.naver.com');
const ymKst = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(d); // YYYY-MM
function adminOnly(u: SessionUser) { if (!isAdmin(u)) throw forbidden('광고 운영은 관리자가 합니다'); }
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;

type NaverAcc = { id: string; tenant: string; external_id: string; secret_enc: string | null };
async function naverReq(a: NaverAcc, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, query = '', body?: unknown) {
  const s = a.secret_enc ? JSON.parse(decrypt(a.secret_enc)) : {};
  const ts = String(Date.now());
  const sig = createHmac('sha256', String(s.secretKey ?? '')).update(`${ts}.${method}.${path}`).digest('base64');
  const r = await fetch(`${NAVER()}${path}${query}`, { method, signal: AbortSignal.timeout(20000),
    headers: { 'X-Timestamp': ts, 'X-API-KEY': String(s.apiKey ?? ''), 'X-Customer': a.external_id, 'X-Signature': sig, 'content-type': 'application/json; charset=UTF-8' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* JSON 아님 */ }
  if (!r.ok) throw new HttpError(502, 'naver_upstream', `네이버 검색광고 API 오류 ${r.status} ${method} ${path} ${String(j?.title ?? j?.message ?? '').slice(0, 1000)}${j?.code ? ` [code ${j.code}]` : ''}${j?.detail ? ` ${String(j.detail).slice(0, 1000)}` : ''}`.trim());
  return j;
}

// ---------------- 세팅안 검사(광고 심사 위반 문구·글자 수·입찰가) ----------------
/** 업종 공통 위험 표현(네이버 검색광고 심사·표시광고법 기준 요약 — 업종별 규칙은 다음 단계에서 추가) */
export const RISKY: [RegExp, string][] = [
  [/최고|최상|최초|1위|넘버원|No\.?\s?1/i, '최상급·순위 표현은 객관적 근거가 있어야 합니다'],
  [/100\s?%|무조건|보장|확실/, '보장·단정 표현은 심사에서 반려될 수 있습니다'],
  [/완치|치료|효능|부작용\s?없/, '의료 효능 표현은 의료광고 심의 대상입니다'],
  [/원금|수익\s?보장|고수익/, '금융 수익 보장 표현은 쓸 수 없습니다'],
];
const NAVER_OK = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 .,!?%&()+\-/:'"~@#*\[\]]$/;
/**
 * #499-2 광고 설정(테크트리 EP.7 — 네이버 검색광고 공식 API 명세 ncc-heroes-ncc.json·FAQ 로 필드 확인 10/23). 값이 없으면(이전 세팅안) 네이버 기본값 그대로 만든다.
 * 기본값은 대표 결정 전 제안값 — 화면 새 세팅안이 추천값을 채워 보냄(서버 기본값 = 네이버 기본값).
 */
export const setupInput = z.object({
  tracking: z.boolean().default(false),                                   // 캠페인 trackingMode AUTO_TRACKING_MODE = 자동 추적 URL 파라미터(n_keyword_id 등 → 문의·전화의 광고 키워드, adAttrib)
  media: z.enum(['all', 'naver']).default('all'),                         // 노출 매체(MEDIA_TARGET): 전체(네이버 기본) / 네이버 매체만(검색·콘텐츠 모두 네이버, 파트너 제외)
  pcWeight: z.number().int().min(10).max(500).default(100),              // 광고그룹 pcNetworkBidWeight(%) — 입찰가 × 가중치
  mobileWeight: z.number().int().min(10).max(500).default(100),          // mobileNetworkBidWeight(%)
  rolling: z.enum(['PERFORMANCE', 'ROUND_ROBIN']).default('PERFORMANCE'), // 소재 노출 방식 adRollingType: 성과 기반 / 동일 비중(3안 테스트 중에는 늘 동일 비중)
  expSearch: z.boolean().default(true),                                   // 확장 검색 useExpSearch(네이버 기본 켬)
  expRatio: z.number().int().min(1).max(100).default(100),               // 확장 검색 예산 비율 expSearchBudgetRatio(%) — 입찰 가중치가 아님(네이버 기본 100)
  aiMax: z.boolean().default(true),                                       // ADVoost Max aiAdsOptIn(파워링크 + 확장 검색 그룹만, 미지정이면 네이버가 켬)
  negatives: z.array(z.string().trim().min(1).max(25)).max(100).default([]), // 확장 검색 제외 키워드(POST restricted-keywords, type EXP_SEARCH)
});
export type AdSetup = z.infer<typeof setupInput>;
/** 광고그룹 만들 때 더 보낼 칸: 네이버 문서 기본값(가중치 100·확장 검색 켬·비율 100·ADVoost Max 켬)과 같은 값은 보내지 않음(실계정에서 검증된 요청 모양 유지). 소재 노출 방식은 늘 보냄 */
export function groupSetup(s: AdSetup | undefined, abTest: boolean): Record<string, unknown> {
  if (!s) return {};
  const o: Record<string, unknown> = { adRollingType: abTest ? 'ROUND_ROBIN' : s.rolling }; // 3안 테스트는 같은 비중으로 노출해야 비교가 공정
  if (s.pcWeight !== 100) o.pcNetworkBidWeight = s.pcWeight;
  if (s.mobileWeight !== 100) o.mobileNetworkBidWeight = s.mobileWeight;
  if (!s.expSearch) Object.assign(o, { useExpSearch: false, aiAdsOptIn: false }); // ADVoost Max 는 확장 검색 그룹만 — 끌 때 함께 끔
  else { if (s.expRatio !== 100) o.expSearchBudgetRatio = s.expRatio; if (!s.aiMax) o.aiAdsOptIn = false; }
  return o;
}
/** 네이버 매체만: 공식 FAQ '네트워크 선택' 예시(type 2)에서 파트너 매체만 뺀 값 — 검색·콘텐츠 모두 네이버 */
const MEDIA_NAVER_ONLY = { type: 2, search: ['naver'], contents: ['naver'], black: { media: [], mediaGroup: [] }, white: { media: null, mediaGroup: null } };
export const planInput = z.object({
  accountId: z.string().uuid(),
  brandId: z.string().uuid().nullable().optional(),                   // 대표 02:30 ③ 브랜드별 세팅안 — 예산 승인 때 브랜드 몫을 이 캠페인에
  name: z.string().trim().min(1).max(60),
  dailyBudget: z.number().int().min(50).max(10_000_000),          // 원, 캠페인 하루 예산
  channelId: z.string().trim().min(1).max(60),                     // 비즈채널(웹사이트) id — 네이버에 먼저 등록된 것
  bidAmt: z.number().int().min(70).max(100_000),                   // 그룹 기본 입찰가
  keywords: z.array(z.string().trim().min(1).max(25)).min(1).max(PLAN_KEYWORDS_MAX), // #499-2 조합기 롱테일까지 300개(전에는 50)
  ads: z.array(z.object({ headline: z.string().trim().min(1), description: z.string().trim().min(1), url: z.string().url().max(500) })).min(1).max(3),
  setup: setupInput.optional(),
  // 광고 최적화 1차 ① 3안 소액 테스트: 같은 그룹의 소재 2~3개를 작은 하루 예산으로 비교 → 기간·최소 노출을 채우면 이긴 안 표시 → [이긴 안에 집중](진 안 끄기 + 예산 올리기, 승인)
  test: z.object({ on: z.boolean(), days: z.number().int().min(3).max(30).default(7), minImpressions: z.number().int().min(30).max(100_000).default(300),
    afterBudget: z.number().int().min(50).max(10_000_000).nullable().optional() }).optional(),
  // 광고 최적화 1차 ② 동네 타깃: 중심·반경(동네 이름 고르기용 — 네이버 파워링크는 반경 지정이 없음)·동네 이름·광고 지역(시·도 = 네이버 REGIONAL_TARGET, 비우면 네이버 기본 = 전국)
  local: z.object({ center: z.string().trim().max(80).default(''), radiusKm: z.number().min(0.5).max(30).default(3), areas: z.array(z.string().trim().min(1).max(20)).max(20).default([]),
    region: z.array(z.string().regex(REGION_RE)).max(17).default([]), abroad: z.boolean().default(false) }).optional(),
});
/** 글자 수 상한은 플랫폼 운영 › 글 품질 규칙(#426, 기본 제목 15·설명 45) */
export function precheck(p: z.infer<typeof planInput>, rules: QualityRules = DEFAULT_RULES) {
  const issues: string[] = [];
  p.ads.forEach((a, i) => {
    for (const x of checkAd('naver', a, rules)) issues.push(`소재 ${i + 1} ${x.msg}`);
    for (const [re, msg] of RISKY) if (re.test(`${a.headline} ${a.description}`)) issues.push(`소재 ${i + 1}: ${msg}`);
  });
  // 네이버 소재 허용 문자(운영 10/19: 가운데점 '·' 으로 400 code 1030) — 한글·영문·숫자·공백·일부 기호만
  p.ads.forEach((a, i) => { const bad = [...new Set([...`${a.headline}${a.description}`].filter((ch) => !NAVER_OK.test(ch)))];
    if (bad.length) issues.push(`소재 ${i + 1}: 네이버에서 쓸 수 없는 문자 ${bad.map((c) => `'${c}'`).join(' ')} — 빼거나 바꿔 주세요(예: · → ,)`); });
  if (p.test?.on && p.ads.length < 2) issues.push('3안 소액 테스트는 소재가 2개 이상이어야 합니다(3개 권장)');
  // 네이버 키워드는 띄어쓰기를 구분하지 않음 — '헬스장 운영'과 '헬스장운영'도 같은 키워드(#499-2 조합기로 수백 개)
  const keys = p.keywords.map(norm);
  const dup = p.keywords.filter((_, i) => keys.indexOf(keys[i]) !== i);
  if (dup.length) issues.push(`겹치는 키워드(띄어쓰기만 다른 것 포함): ${[...new Set(dup)].join(', ')}`);
  return issues;
}
/** 연결 주소가 사이트 첫 화면(경로·검색어 없음)인지 */
const isRootUrl = (u: string) => { try { const x = new URL(u); return (x.pathname === '/' || x.pathname === '') && !x.search; } catch { return false; } };
/**
 * #499-2 권고(시작을 막지 않음, 테크트리 EP.7·3장 C): 연결 주소가 첫 화면 · 광고형 문구 점수(#499-1, 제목+설명) · 질문형 제목 · 확장 검색 제외 키워드.
 * 검색광고는 검색어가 이미 대상을 말해 주므로 점수는 참고용 — 무엇을 주는지(제안)·누구에게를 문구에 넣으라는 안내.
 */
export function advice(p: z.infer<typeof planInput>, rules: QualityRules = DEFAULT_RULES) {
  const out: string[] = [];
  const roots = p.ads.map((a, i) => (isRootUrl(a.url) ? i + 1 : 0)).filter(Boolean);
  if (roots.length) out.push(`소재 ${roots.join('·')} 연결 주소가 홈페이지 첫 화면입니다 — 서비스별 페이지로 연결하세요(확장 검색은 연결 페이지 내용으로 검색어를 맞춥니다)`);
  p.ads.forEach((a, i) => {
    const h = scoreHook(`${a.headline} ${a.description}`, rules, p.keywords, 'ad');
    if (!h.pass) out.push(`소재 ${i + 1} 광고형 점수 ${h.score}점${h.notes?.length ? ` — ${h.notes.join(' · ')}` : ''}`);
  });
  if (p.ads.length >= 2 && !p.ads.some((a) => /\?/.test(a.headline))) out.push('질문형 제목(물음표) 안이 없습니다 — 소구점 + 물음표 제목을 한 안 넣어 비교해 보세요');
  if (p.setup?.expSearch && !p.setup.negatives.length) out.push('확장 검색은 엉뚱한 검색어에도 나갈 수 있습니다 — 제외 키워드(예: 구인, 채용, 알바)를 넣어 두세요');
  return out;
}

// ---------------- 상한·이번 달 광고비 ----------------
export async function monthSpend(tenant: string) {
  const [r] = await db()<{ spend: number }[]>`select coalesce(sum(s.cost_krw), 0)::float as spend from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id
    where a.tenant = ${tenant} and s.day >= ((now() at time zone 'Asia/Seoul')::date - (extract(day from (now() at time zone 'Asia/Seoul'))::int - 1))`;
  return Number(r?.spend ?? 0);
}
export async function capOf(tenant: string) {
  const [c] = await db()<{ monthly_cap: string; stopped_month: string | null }[]>`select monthly_cap, stopped_month from mkt_ad_caps where tenant = ${tenant}`;
  return c ? { monthlyCap: Number(c.monthly_cap), stoppedMonth: c.stopped_month } : null;
}
export const capInput = z.object({ monthlyCap: z.number().int().min(10_000).max(1_000_000_000) });
export async function setCap(u: SessionUser, i: z.infer<typeof capInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const prev = await capOf(tenantOf(u));
  await db()`insert into mkt_ad_caps (tenant, monthly_cap, updated_by) values (${tenantOf(u)}, ${i.monthlyCap}, ${u.id})
    on conflict (tenant) do update set monthly_cap = excluded.monthly_cap, updated_by = excluded.updated_by, updated_at = now(), stopped_month = case when excluded.monthly_cap > mkt_ad_caps.monthly_cap then null else mkt_ad_caps.stopped_month end`;
  await audit(db(), u.id, 'mkt_ads.cap', 'tenant', null, { before: prev?.monthlyCap ?? null, after: i.monthlyCap }).catch(() => {});
  return { ok: true };
}

// ---------------- 화면 데이터 ----------------
export async function adOpsOverview(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db();
  const [cap, spend, rules] = await Promise.all([capOf(t), monthSpend(t), qualityRules()]);
  const accounts = await sql`select id, label, external_id from mkt_ad_accounts where tenant = ${t} and provider = 'naver' and status <> 'disconnected' order by created_at`;
  const plans = await sql<any[]>`select p.id, p.account_id, p.brand_id, br.name as brand, p.kind, p.name, p.plan, p.status, p.external, p.error, p.created_at, p.approved_at, a.label as account_label, ab.name as approved_by_name
    from mkt_ad_plans p join mkt_ad_accounts a on a.id = p.account_id left join mkt_brands br on br.id = p.brand_id left join users ab on ab.id = p.approved_by where p.tenant = ${t} and p.provider = 'naver' and p.status <> 'archived' order by p.created_at desc limit 50`;
  const brands = await sql<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${t} order by ad_priority nulls last, name`;
  const changes = await sql<any[]>`select c.id, c.plan_id, c.kind, c.before, c.after, c.money_up, c.status, c.error, c.revert_of, c.created_at, u.name as actor_name
    from mkt_ad_changes c left join users u on u.id = c.actor_id left join mkt_ad_plans pp on pp.id = c.plan_id where c.tenant = ${t} and (pp.provider is null or pp.provider = 'naver') order by c.created_at desc limit 100`;
  const ab = await abFor(plans);
  const [bud] = await sql<any[]>`select plan, brand_plan, total from mkt_ad_budgets where tenant = ${t} and month = ${ymKst()} and status = 'approved'`;
  return { canEdit: isAdmin(u), cap, monthSpend: spend, month: ymKst(), accounts, brands, plans: plans.map((p) => ({ ...p, issues: precheck(p.plan, rules), advice: advice(p.plan, rules), ab: ab.get(p.id) ?? null })), changes,
    savings: await agencySavings(t, spend), budgetHint: bud ? naverBudgetHint(bud) : null };
}
/** #499-2 하루 예산 권장(월 ÷ 30 × 1.5)의 '월': 이번 달 승인된 광고 예산의 네이버 몫 — 브랜드별은 예산 승인 집행과 같은 비율(브랜드 월 예산 × 네이버 비중) */
function naverBudgetHint(b: { plan: any[]; brand_plan: any[] | null; total: string | number }) {
  const naver = Number((b.plan ?? []).find((p) => p?.provider === 'naver')?.monthly ?? 0);
  const share = Number(b.total) ? naver / Number(b.total) : 0;
  const brands = Object.fromEntries(((b.brand_plan ?? []) as any[]).filter((x) => x?.brandId).map((x) => [String(x.brandId), Math.round(Number(x.monthly ?? 0) * share)]));
  return naver > 0 ? { naver, brands } : null;
}

/** 비즈채널(웹사이트) 목록 — 세팅안에서 고르기 */
export async function naverChannels(u: SessionUser, accountId: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const a = await naverAcc(tenantOf(u), accountId);
  const rows: any[] = (await naverReq(a, 'GET', '/ncc/channels')) ?? [];
  // 운영 10/19: 실제 계정에서 빈 목록 — 웹사이트 비즈채널 종류 값은 'SITE'(문서·계정마다 'WEB_SITE' 표기도 있음). 웹사이트를 먼저, 없으면 모든 채널(종류 표시)
  const all = (Array.isArray(rows) ? rows : []).map((c) => ({ id: String(c.nccBusinessChannelId ?? c.id ?? ''), name: String(c.name ?? c.channelKey ?? c.nccBusinessChannelId ?? ''), url: c.channelKey ?? c.businessInfo?.site ?? null, type: String(c.channelTp ?? c.type ?? '') })).filter((c) => c.id);
  const sites = all.filter((c) => /^(SITE|WEB_SITE)$/i.test(c.type) || (!c.type && /^https?:/i.test(String(c.url ?? ''))));
  return { channels: sites.length ? sites : all, total: all.length };
}
async function naverAcc(tenant: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [a] = await db()<NaverAcc[]>`select id, tenant, external_id, secret_enc from mkt_ad_accounts where id = ${id} and tenant = ${tenant} and provider = 'naver' and status <> 'disconnected'`;
  if (!a) throw notFound('네이버 검색광고 계정을 찾을 수 없습니다');
  return a;
}
async function planOf(tenant: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [p] = await db()<any[]>`select * from mkt_ad_plans where id = ${id} and tenant = ${tenant} and provider = 'naver'`; // #494 메타 세팅안은 metaAuto
  if (!p) throw notFound('세팅안을 찾을 수 없습니다');
  return p;
}

// ---------------- 세팅안 → 생성(꺼진 상태) ----------------
export async function createPlan(u: SessionUser, i: z.infer<typeof planInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  await naverAcc(tenantOf(u), i.accountId);
  const { accountId, name, brandId, ...plan } = i;
  const [p] = await db()`insert into mkt_ad_plans (tenant, account_id, provider, kind, name, plan, created_by, brand_id) values (${tenantOf(u)}, ${accountId}, 'naver', 'powerlink', ${name}, ${db().json(plan as never)}, ${u.id}, ${brandId ?? null}) returning id`;
  const rules = await qualityRules();
  return { id: p.id, issues: precheck(i, rules), advice: advice(i, rules) };
}

/** 세팅안 고치기(만들기 전·실패 뒤) — 이미 네이버에 만든 부분(캠페인·그룹)은 그대로, 남은 단계에 새 값 사용 */
export async function updatePlan(u: SessionUser, id: string, i: z.infer<typeof planInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const p = await planOf(tenantOf(u), id);
  if (p.status !== 'draft' && p.status !== 'failed') throw new HttpError(409, 'plan_locked', '네이버에 만든 뒤에는 세팅안을 고칠 수 없습니다 — 끄기·하루 예산만 바꿀 수 있습니다');
  const { accountId: _a, name, brandId, ...plan } = i;
  await db()`update mkt_ad_plans set name = ${name}, plan = ${db().json(plan as never)}, brand_id = ${brandId === undefined ? p.brand_id : brandId}, updated_at = now() where id = ${id}`;
  const rules = await qualityRules();
  return { id, issues: precheck(i, rules), advice: advice(i, rules) };
}

/** [승인하고 시작]: 상한 필수 → 검사 통과 → 네이버에 캠페인·그룹·키워드·소재를 모두 꺼진 상태로 생성 */
export async function approvePlan(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (p.status !== 'draft' && p.status !== 'failed') throw new HttpError(409, 'plan_not_draft', '이미 만든 세팅안입니다');
  if (!(await capOf(t))) throw new HttpError(409, 'cap_required', '먼저 회사 월 광고비 상한을 정해 주세요');
  const issues = precheck(p.plan, await qualityRules());
  if (issues.length) throw new HttpError(409, 'precheck_failed', `세팅안 검사를 통과하지 못했습니다: ${issues.join(' · ')}`);
  const s: AdSetup | undefined = p.plan.setup ? setupInput.parse(p.plan.setup) : undefined; // #499-2 광고 설정(없으면 이전처럼 네이버 기본값) — 잠그기 전에 읽음
  const a = await naverAcc(t, p.account_id);
  // 같은 세팅안을 동시에 두 번 만들지 않게(운영 10/19: 한 번 눌렀는데 요청 3번) — 만드는 중으로 바꾼 요청만 진행, 나머지는 409
  const [lock] = await sql`update mkt_ad_plans set status = 'creating', updated_at = now() where id = ${id} and status in ('draft', 'failed') returning id`;
  if (!lock) throw new HttpError(409, 'plan_busy', '이미 만드는 중입니다 — 잠시 뒤 새로 고쳐 확인해 주세요');
  const ext: Record<string, unknown> = { ...(p.external ?? {}) };
  try {
    // 실패하면 거기서 멈추고, 이미 만든 id 는 external 에 남김(다시 시도하면 이어서 만듦)
    if (!ext.campaignId) ext.campaignId = String((await naverReq(a, 'POST', '/ncc/campaigns', '', { customerId: Number(a.external_id), name: p.name, campaignTp: 'WEB_SITE', dailyBudget: p.plan.dailyBudget, useDailyBudget: true, userLock: true,
      ...(s?.tracking ? { trackingMode: 'AUTO_TRACKING_MODE' } : {}) })).nccCampaignId);
    if (!ext.adgroupId) ext.adgroupId = String((await naverReq(a, 'POST', '/ncc/adgroups', '', { nccCampaignId: ext.campaignId, adgroupType: 'WEB_SITE', name: `${p.name} 그룹`, pcChannelId: p.plan.channelId, mobileChannelId: p.plan.channelId, bidAmt: p.plan.bidAmt, useDailyBudget: false, userLock: true,
      ...groupSetup(s, !!p.plan.test?.on) })).nccAdgroupId);
    if (!validIds(ext.keywordIds)) ext.keywordIds = await ensureKeywords(a, String(ext.adgroupId), p.plan.keywords, Number(p.plan.bidAmt) || undefined);
    if (!ext.adIds) {
      const ids: string[] = [];
      for (const ad of p.plan.ads) ids.push(String((await naverReq(a, 'POST', '/ncc/ads', '', { nccAdgroupId: ext.adgroupId, type: 'TEXT_45', userLock: false, ad: { headline: ad.headline, description: ad.description, pc: { final: ad.url }, mobile: { final: ad.url } } })).nccAdId));
      ext.adIds = ids;
    }
    // 광고 최적화 1차 ② 광고 지역(시·도)을 골랐으면 켜기 전(꺼진 상태)에 맞춰 둠 — 실패하면 여기서 멈추고 다시 누르면 이어서
    if (p.plan.local?.region?.length && !ext.regionSet) { await setRegion(a, String(ext.adgroupId), p.plan.local.region, !!p.plan.local.abroad); ext.regionSet = true; }
    // #499-2 노출 매체 '네이버 매체만'(파트너 제외) · 확장 검색 제외 키워드 — 같은 방식으로 꺼진 상태에서 맞추고, 실패하면 멈췄다가 다시 누르면 이어서
    if (s?.media === 'naver' && !ext.mediaSet) { await setMedia(a, String(ext.adgroupId)); ext.mediaSet = true; }
    if (s?.expSearch && s.negatives.length && !ext.negSet) { ext.negFailed = await addNegatives(a, String(ext.adgroupId), s.negatives); ext.negSet = true; }
  } catch (e: any) {
    await sql`update mkt_ad_plans set status = 'failed', external = ${sql.json(ext as never)}, error = ${String(e?.message ?? e).slice(0, 4000)}, updated_at = now() where id = ${id}`;
    await sql`insert into mkt_ad_changes (tenant, plan_id, kind, after, status, error, actor_id) values (${t}, ${id}, 'create', ${sql.json(ext as never)}, 'failed', ${String(e?.message ?? e).slice(0, 4000)}, ${u.id})`;
    throw e instanceof HttpError ? e : badRequest('네이버에 만들지 못했습니다');
  }
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set status = 'created', external = ${tx.json(ext as never)}, error = null, approved_by = ${u.id}, approved_at = now(), updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, after, money_up, actor_id) values (${t}, ${id}, 'create', ${tx.json({ ...ext, userLock: true } as never)}, false, ${u.id})`;
  });
  await audit(sql, u.id, 'mkt_ads.plan_create', 'mkt_ad_plan', id, { campaignId: ext.campaignId }).catch(() => {});
  return { ok: true, external: ext };
}

/** 운영 10/19: 키워드 생성 응답에서 id 를 못 읽어 'undefined' 로 저장된 일 — id 는 문자열 배열이고 'undefined'·빈 값이 없어야 함 */
const validIds = (x: unknown): x is string[] => Array.isArray(x) && x.length > 0 && x.every((v) => typeof v === 'string' && v && v !== 'undefined' && v !== 'null');
const kwId = (k: any) => String(k?.nccKeywordId ?? k?.nccKeywordID ?? k?.id ?? '');
const norm = (k: string) => k.replace(/\s+/g, '').toLowerCase();
const KW_CHUNK = 100; // 키워드 만들기 한 번에 보내는 수(네이버 화면 붙여넣기 단위)
const KW_RETRY = 30;  // 안 생긴 키워드를 하나씩 다시 보내는 수(한 번 누름에)
/** 키워드 멱등 생성: 그룹에 이미 있는 키워드는 id 만 읽고, 없는 것만 만든 뒤 다시 읽어 세팅안 순서대로 id 를 돌려줌 */
async function ensureKeywords(a: NaverAcc, adgroupId: string, keywords: string[], bidAmt?: number): Promise<string[]> {
  const q = `?nccAdgroupId=${encodeURIComponent(adgroupId)}`;
  const list = async () => { const r = await naverReq(a, 'GET', '/ncc/keywords', q); return (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []) as any[]; };
  const byKw = new Map<string, string>();
  for (const k of await list()) if (kwId(k)) byKw.set(norm(String(k.keyword ?? '')), kwId(k));
  const missing = keywords.filter((k) => !byKw.has(norm(k)));
  // 운영 10/19: 200 응답인데 키워드가 하나도 안 생김 → 응답을 그대로 믿지 않고, 만든 뒤 그룹 목록으로 확인. 안 생긴 키워드는 하나씩 다시 보내 이유를 받음
  // 네이버 키워드는 띄어쓰기를 구분하지 않음 → 보낼 때는 띄어 쓴 그대로 대신 붙여 씀(목록 비교도 띄어쓰기 무시)
  // 운영 10/19 실계정 3916 "No value is entered in the default bid or bid amount field" — 그룹 기본 입찰가가 비어 있어 useGroupBidAmt 가 실패 → 키워드마다 세팅안 입찰가를 직접 넣음
  const body = (ks: string[]) => ks.map((k) => ({ nccAdgroupId: adgroupId, keyword: k.replace(/\s+/g, ''), ...(bidAmt ? { useGroupBidAmt: false, bidAmt } : { useGroupBidAmt: true }), userLock: false }));
  // 운영 10/19: 네이버가 항목마다 resultStatus {code, message} 로 거절(3916 등) — 사유 문구를 자르지 않고 그대로 모음
  const statusOf = (r: any) => (Array.isArray(r) ? r : [r]).map((k: any) => k?.resultStatus ?? k?.status).filter((x: any) => x && (x.code || x.message))
    .map((x: any) => `[code ${x.code ?? '?'}] ${x.message ?? x.title ?? ''}`.trim());
  const take = (r: any) => { for (const k of (Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : [r])) if (kwId(k) && k?.keyword) byKw.set(norm(String(k.keyword)), kwId(k)); };
  const why: string[] = [];
  if (missing.length) {
    // #499-2 조합기로 300개까지 — 한 번에 100개씩(네이버 화면 붙여넣기 단위)
    for (let i = 0; i < missing.length; i += KW_CHUNK) {
      try { const r = await naverReq(a, 'POST', '/ncc/keywords', q, body(missing.slice(i, i + KW_CHUNK))); take(r); why.push(...statusOf(r)); } catch (e: any) { why.push(String(e?.message ?? e)); }
    }
    for (const k of await list()) if (kwId(k)) byKw.set(norm(String(k.keyword ?? '')), kwId(k));
    // 안 생긴 키워드는 하나씩 다시 보내 이유를 받음 — 한 번 누름에 KW_RETRY 개까지(시간 제한), 나머지는 다시 누르면 이어서
    const left = missing.filter((x) => !byKw.has(norm(x)));
    for (const k of left.slice(0, KW_RETRY)) {
      try { const r = await naverReq(a, 'POST', '/ncc/keywords', q, body([k])); take(r); if (!byKw.has(norm(k))) { const st = statusOf(r); why.push(`${k}: ${st.length ? st.join(' ') : `응답에 키워드 id 없음 ${JSON.stringify(r).slice(0, 1000)}`}`); } }
      catch (e: any) { why.push(`${k}: ${String(e?.message ?? e)}`); }
    }
    if (left.length > KW_RETRY) why.push(`나머지 ${left.length - KW_RETRY}개는 하나씩 다시 보내지 않았습니다 — 다시 누르면 이어서 만듭니다`);
    if (missing.some((k) => !byKw.has(norm(k)))) for (const k of await list()) if (kwId(k)) byKw.set(norm(String(k.keyword ?? '')), kwId(k));
  }
  const ids = keywords.map((k) => byKw.get(norm(k)) ?? '');
  if (!validIds(ids)) {
    const failed = keywords.filter((_, i) => !ids[i]);
    const shown = failed.slice(0, 20); const more = failed.length > shown.length ? ` 외 ${failed.length - shown.length}개` : '';
    // 검색량·연관 키워드(네이버 키워드 도구 /keywordstool, 공식 RelKwdStat) — 사유를 사람이 판단하고 바꿀 키워드를 고르게
    const vol = await keywordVolumes(a, shown).catch(() => null);
    const volText = vol ? ` · 월 검색량(PC/모바일): ${shown.map((k) => { const v = vol.get(norm(k)); return `${k} ${v ? `${v.pc}/${v.mobile}` : '자료 없음'}`; }).join(', ')}${more}` + (vol.related.length ? ` · 검색량 있는 연관 키워드: ${vol.related.slice(0, 8).map((r) => `${r.keyword}(${r.total})`).join(', ')}` : '') : '';
    throw new HttpError(502, 'naver_keywords', `네이버에 키워드를 만들지 못했습니다(${shown.join(', ')}${more})${why.length ? ` — ${[...new Set(why)].join(' / ')}` : ''}${volText}`, { why: [...new Set(why)], volumes: vol ? Object.fromEntries(vol) : null, related: vol?.related ?? [] });
  }
  return ids;
}
/** 네이버 키워드 도구(RelKwdStat): 힌트 키워드(띄어쓰기 없이, 한 번에 5개)의 월 검색량과 연관 키워드. '< 10' 은 5 로 셈.
 * tolerant(#499-2 조합 300개): 한 묶음이 실패해도 나머지는 계속 — 실패한 키워드 수는 failed */
export async function keywordVolumes(a: NaverAcc, keywords: string[], o: { tolerant?: boolean } = {}) {
  const num = (v: unknown) => (typeof v === 'number' ? v : /</.test(String(v)) ? 5 : Number(v) || 0);
  const out = new Map<string, { pc: number; mobile: number }>() as Map<string, { pc: number; mobile: number }> & { related: { keyword: string; total: number }[]; failed: number };
  out.related = []; out.failed = 0;
  const asked = new Set(keywords.map(norm));
  for (let i = 0; i < keywords.length; i += 5) {
    const hint = keywords.slice(i, i + 5).map((k) => k.replace(/\s+/g, '')).join(',');
    let r: any;
    try { r = await naverReq(a, 'GET', '/keywordstool', `?hintKeywords=${encodeURIComponent(hint)}&showDetail=1`); }
    catch (e) { if (!o.tolerant) throw e; out.failed += keywords.slice(i, i + 5).length; continue; }
    for (const k of (r?.keywordList ?? []) as any[]) {
      const key = norm(String(k.relKeyword ?? '')); const v = { pc: num(k.monthlyPcQcCnt), mobile: num(k.monthlyMobileQcCnt) };
      if (asked.has(key)) out.set(key, v); else if (v.pc + v.mobile >= 30 && !out.related.some((r) => norm(r.keyword) === key)) out.related.push({ keyword: String(k.relKeyword), total: v.pc + v.mobile }); // 5개씩 물으면 연관 키워드가 겹쳐 옴
    }
  }
  out.related.sort((x, y) => y.total - x.total);
  return out;
}
/** [키워드 다시 읽기]: 만든 뒤 키워드 id 가 비었으면 네이버에서 다시 읽어 저장(없으면 만듦) — 켜기·예산은 바꾸지 않음 */
export async function syncPlanKeywords(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (!['created', 'active', 'paused'].includes(p.status) || !p.external?.adgroupId) throw new HttpError(409, 'plan_not_created', '네이버에 만든 뒤에 다시 읽을 수 있습니다');
  const a = await naverAcc(t, p.account_id);
  const before = p.external.keywordIds ?? null;
  // 한 번 누름에 요청 2번(운영 10/19) — 2분 안에 진행 중인 다시 읽기가 있으면 409
  const [lock] = await sql`update mkt_ad_plans set external = external || ${sql.json({ syncingAt: new Date().toISOString() } as never)}
    where id = ${id} and coalesce((external->>'syncingAt')::timestamptz, 'epoch') < now() - interval '2 minutes' returning id`;
  if (!lock) throw new HttpError(409, 'plan_busy', '이미 다시 읽는 중입니다 — 잠시 뒤 새로 고쳐 확인해 주세요');
  let keywordIds: string[];
  try { keywordIds = await ensureKeywords(a, String(p.external.adgroupId), p.plan.keywords, Number(p.plan.bidAmt) || undefined); }
  catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 4000);
    await sql`update mkt_ad_plans set external = external - 'syncingAt', error = ${msg}, updated_at = now() where id = ${id}`;
    await sql`insert into mkt_ad_changes (tenant, plan_id, kind, before, status, error, actor_id) values (${t}, ${id}, 'sync', ${sql.json({ keywordIds: before } as never)}, 'failed', ${msg}, ${u.id})`;
    throw e;
  }
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set external = ${tx.json({ ...p.external, keywordIds, syncingAt: undefined } as never)}, error = null, updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id) values (${t}, ${id}, 'sync', ${tx.json({ keywordIds: before } as never)}, ${tx.json({ keywordIds } as never)}, false, ${u.id})`;
  });
  return { ok: true, keywordIds };
}

// ---------------- 켜기·끄기·예산 + 되돌리기 ----------------
async function setLock(a: NaverAcc, campaignId: string, lock: boolean) {
  await naverReq(a, 'PUT', `/ncc/campaigns/${campaignId}`, '?fields=userLock', { nccCampaignId: campaignId, userLock: lock });
}
export async function guardMoneyUp(t: string, addDaily = 0) {
  const cap = await capOf(t);
  if (!cap) throw new HttpError(409, 'cap_required', '먼저 회사 월 광고비 상한을 정해 주세요');
  const spend = await monthSpend(t);
  if (spend >= cap.monthlyCap) throw new HttpError(409, 'cap_reached', `이번 달 광고비 ${won(spend)} 가 상한 ${won(cap.monthlyCap)} 에 닿아 켤 수 없습니다 — 상한을 올리거나 다음 달에 켜 주세요`);
  return { cap: cap.monthlyCap, spend, addDaily };
}
export const planAction = z.object({ action: z.enum(['enable', 'pause', 'budget', 'sync', 'ad_pause', 'ad_resume', 'ab_apply', 'region', 'keywords_add', 'kw_pause', 'kw_resume']), dailyBudget: z.number().int().min(50).max(10_000_000).optional(),
  keywordIds: z.array(z.string().trim().min(1).max(60)).min(1).max(50).optional(),
  adIds: z.array(z.string().trim().min(1).max(60)).min(1).max(3).optional(),
  region: z.array(z.string().regex(REGION_RE)).max(17).optional(), abroad: z.boolean().optional(), keywords: z.array(z.string().trim().min(1).max(25)).min(1).max(30).optional(),
  local: z.object({ center: z.string().trim().max(80), radiusKm: z.number().min(0.5).max(30), areas: z.array(z.string().trim().min(1).max(20)).max(20) }).partial().optional() });
export async function actPlan(u: SessionUser, id: string, i: z.infer<typeof planAction>, revertOf: string | null = null): Promise<Record<string, unknown>> {
  if (/^[0-9a-f-]{36}$/i.test(id)) { // #494 메타 자동 세팅안: 끄기·다시 켜기·하루 예산은 metaAuto(상한 검사·기록 같은 규칙)
    const [pv] = await db()<{ provider: string }[]>`select provider from mkt_ad_plans where id = ${id} and tenant = ${tenantOf(u)}`;
    if (pv?.provider === 'meta') return (await import('./metaAuto')).actMetaPlan(u, id, i, revertOf);
  }
  if (i.action === 'sync') return syncPlanKeywords(u, id);
  if (i.action === 'ad_pause' || i.action === 'ad_resume' || i.action === 'ab_apply') return actAds(u, id, i, revertOf);
  if (i.action === 'region' || i.action === 'keywords_add') return actLocal(u, id, i, revertOf);
  if (i.action === 'kw_pause' || i.action === 'kw_resume') return actKeywords(u, id, i, revertOf);
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (!['created', 'active', 'paused'].includes(p.status) || !p.external?.campaignId) throw new HttpError(409, 'plan_not_created', '네이버에 만든 뒤에 바꿀 수 있습니다');
  const a = await naverAcc(t, p.account_id);
  const cid = String(p.external.campaignId);
  let before: any, after: any, moneyUp = false, status = p.status;
  if (i.action === 'enable') {
    await guardMoneyUp(t, p.plan.dailyBudget); // 돈이 나가는 변경 — 관리자가 누름 = 승인, 상한 검사
    await setLock(a, cid, false); before = { userLock: true }; after = { userLock: false }; moneyUp = true; status = 'active';
  } else if (i.action === 'pause') {
    await setLock(a, cid, true); before = { userLock: false }; after = { userLock: true }; status = 'paused';
  } else {
    if (!i.dailyBudget) throw badRequest('하루 예산을 넣어 주세요');
    moneyUp = i.dailyBudget > Number(p.plan.dailyBudget);
    if (moneyUp && p.status === 'active') await guardMoneyUp(t, i.dailyBudget - Number(p.plan.dailyBudget));
    await naverReq(a, 'PUT', `/ncc/campaigns/${cid}`, '?fields=budget', { nccCampaignId: cid, dailyBudget: i.dailyBudget, useDailyBudget: true });
    before = { dailyBudget: p.plan.dailyBudget }; after = { dailyBudget: i.dailyBudget };
  }
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set status = ${status}, plan = ${i.action === 'budget' ? tx.json({ ...p.plan, dailyBudget: i.dailyBudget } as never) : tx.json(p.plan as never)}, updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, revert_of) values (${t}, ${id}, ${i.action}, ${tx.json(before)}, ${tx.json(after)}, ${moneyUp}, ${u.id}, ${revertOf})`;
  });
  await audit(sql, u.id, `mkt_ads.${i.action}`, 'mkt_ad_plan', id, { before, after }).catch(() => {});
  return { ok: true, status };
}
/** 되돌리기: 기록의 전 값으로 다시 바꿈(돈이 늘면 같은 상한 검사) */
export async function revertChange(u: SessionUser, changeId: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(changeId)) throw notFound();
  const [c] = await db()<any[]>`select id, plan_id, kind, before, after, status from mkt_ad_changes where id = ${changeId} and tenant = ${tenantOf(u)}`;
  if (!c || !c.plan_id) throw notFound('변경 기록을 찾을 수 없습니다');
  if (c.status !== 'applied' || !['enable', 'pause', 'budget', 'auto_pause', 'ad_pause', 'ad_resume', 'region', 'keywords_add', 'kw_pause', 'kw_resume'].includes(c.kind)) throw new HttpError(409, 'not_revertible', '이 기록은 되돌릴 수 없습니다');
  if (c.kind === 'kw_pause' || c.kind === 'kw_resume') return actKeywords(u, c.plan_id, { action: c.kind === 'kw_pause' ? 'kw_resume' : 'kw_pause', keywordIds: c.before?.keywordIds ?? [] }, c.id);
  // 지역: 전 값으로(전에 타겟이 없었으면 = 전국 + 해외). 키워드 추가: 그때 새로 만든 키워드만 네이버에서 지우고 세팅안에서 뺌
  if (c.kind === 'region') return actLocal(u, c.plan_id, { action: 'region', region: c.before?.KR ?? [], abroad: c.before?.OTHERS == null || c.before.OTHERS.includes('00') }, c.id);
  if (c.kind === 'keywords_add') return removeKeywords(u, c.plan_id, c);
  if (c.kind === 'ad_pause' || c.kind === 'ad_resume') return actAds(u, c.plan_id, { action: c.kind === 'ad_pause' ? 'ad_resume' : 'ad_pause', adIds: c.before?.adIds ?? [] }, c.id);
  const action = c.kind === 'budget' ? { action: 'budget' as const, dailyBudget: Number(c.before?.dailyBudget) } : { action: ((c.before?.userLock ?? c.before?.paused) ? 'pause' : 'enable') as 'pause' | 'enable' }; // 메타 = paused
  return actPlan(u, c.plan_id, action, c.id);
}

// ---------------- tick: 월 상한 넘으면 워크인이 켠 광고 자동 중지 ----------------
export async function adCapGuard() {
  const sql = db(); const month = ymKst(); let stopped = 0;
  const caps = await sql<{ tenant: string; monthly_cap: string; stopped_month: string | null }[]>`select tenant, monthly_cap, stopped_month from mkt_ad_caps`;
  for (const c of caps) {
    const spend = await monthSpend(c.tenant);
    if (spend < Number(c.monthly_cap)) continue;
    const active = await sql<any[]>`select id, account_id, external, provider from mkt_ad_plans where tenant = ${c.tenant} and status = 'active'`;
    for (const p of active) {
      try {
        const meta = p.provider === 'meta'; // #494 메타 자동 세팅안도 같은 상한으로 끔
        if (meta) await (await import('./metaAuto')).pauseMetaCampaign(c.tenant, p);
        else { const a = await naverAcc(c.tenant, p.account_id); await setLock(a, String(p.external.campaignId), true); }
        await sql`update mkt_ad_plans set status = 'paused', updated_at = now() where id = ${p.id}`;
        await sql`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up) values (${c.tenant}, ${p.id}, 'auto_pause', ${sql.json(meta ? { paused: false } : { userLock: false })}, ${sql.json({ ...(meta ? { paused: true } : { userLock: true }), reason: 'monthly_cap', spend, cap: Number(c.monthly_cap) } as never)}, false)`;
        stopped++;
      } catch (e: any) {
        await sql`insert into mkt_ad_changes (tenant, plan_id, kind, status, error) values (${c.tenant}, ${p.id}, 'auto_pause', 'failed', ${String(e?.message ?? e).slice(0, 300)})`;
      }
    }
    if (c.stopped_month !== month && active.length) {
      await sql`update mkt_ad_caps set stopped_month = ${month} where tenant = ${c.tenant}`;
      await (await import('./spaceNotify')).notifySpace(sql, { tenant: c.tenant, space: 'marketing', approval: true, type: 'usage_alert', title: `월 광고비 상한 도달 — 워크인 광고 ${active.length}개 중지`, body: `이번 달 ${won(spend)} / 상한 ${won(Number(c.monthly_cap))}`, link: '/s/marketing/ad-ops', dedupeKey: `adcap:${c.tenant}:${month}` });
    }
  }
  return { stopped };
}

// ---------------- 광고 최적화 1차 ① 3안 소액 테스트(소재 비교) ----------------
export type AbAd = { adId: string; label: string; headline: string; impressions: number; clicks: number; cost: number; conversions: number; paused: boolean };
const Z95 = 1.645; // 한쪽 95% — '확실히 낫다'의 기준
const r2 = (x: number) => Math.round(x * 100) / 100;
/**
 * 소재 비교 판정(서버 계산, 숫자는 화면에 그대로): 기간(days)이 지나고 모든 안이 최소 노출을 채워야 판정.
 * 기준 = 전환이 10건 이상이면 전환율(전환÷클릭), 아니면 클릭률(클릭÷노출). 1등 안이 다른 안보다 두 비율 z 검정에서 z ≥ 1.645(한쪽 95%)이면 '확실히 낫다'.
 * 1등이 나머지 모두를 이기면 winner, 일부만 이기면 partial(진 안만), 아무도 못 이기면 tie. 1등의 성공(클릭·전환)이 5건 미만이면 판정하지 않음.
 */
export function abVerdict(ads: AbAd[], o: { days: number; minImpressions: number; elapsedDays: number | null }) {
  const conv = ads.reduce((a, x) => a + x.conversions, 0);
  const metric: 'ctr' | 'cvr' = conv >= 10 ? 'cvr' : 'ctr';
  const succ = (x: AbAd) => (metric === 'ctr' ? x.clicks : x.conversions);
  const trials = (x: AbAd) => (metric === 'ctr' ? x.impressions : x.clicks);
  const rate = (x: AbAd) => (trials(x) ? succ(x) / trials(x) : 0);
  const z = (a: AbAd, b: AbAd) => {
    const n1 = trials(a), n2 = trials(b); if (!n1 || !n2) return 0;
    const p = (succ(a) + succ(b)) / (n1 + n2); const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
    return se ? (rate(a) - rate(b)) / se : 0;
  };
  const sorted = [...ads].sort((a, b) => rate(b) - rate(a) || succ(b) - succ(a));
  const leader = sorted[0];
  const minImpr = ads.length ? Math.min(...ads.map((x) => x.impressions)) : 0;
  const ready = o.elapsedDays !== null && o.elapsedDays >= o.days && minImpr >= o.minImpressions;
  const losers = ready && leader && succ(leader) >= 5 ? sorted.slice(1).filter((b) => z(leader, b) >= Z95).map((b) => b.adId) : [];
  const status = o.elapsedDays === null ? 'not_started' : !ready ? 'running' : losers.length && losers.length === ads.length - 1 ? 'winner' : losers.length ? 'partial' : 'tie';
  const name = (id: string) => ads.find((x) => x.adId === id)?.label ?? id;
  const unit = metric === 'ctr' ? '클릭률' : '전환율';
  const pct = (x: AbAd) => `${r2(rate(x) * 100)}%`;
  const message = status === 'not_started' ? `광고를 켜면 ${o.days}일 동안 소재 ${ads.length}개를 같은 예산으로 비교합니다(안마다 노출 ${o.minImpressions}회 이상).`
    : status === 'running' ? `비교 중 ${Math.min(o.elapsedDays ?? 0, o.days)}/${o.days}일 · 노출이 가장 적은 안 ${minImpr.toLocaleString('ko-KR')}/${o.minImpressions.toLocaleString('ko-KR')}회 — 기간과 최소 노출을 채우면 판정합니다.`
    : status === 'winner' ? `${leader.label} ${unit} ${pct(leader)} — 나머지 안(${sorted.slice(1).map((b) => `${b.label} ${pct(b)}`).join(', ')})보다 확실히 높습니다(한쪽 95%). 진 안을 끄고 예산을 이 안에 모으세요.`
    : status === 'partial' ? `1등 ${leader.label}(${unit} ${pct(leader)}) — ${losers.map(name).join(', ')}보다는 확실히 낫지만 ${sorted.slice(1).filter((b) => !losers.includes(b.adId)).map((b) => b.label).join(', ')}와는 차이가 뚜렷하지 않습니다 — 진 안만 끄고 나머지는 더 지켜보세요.`
    : `안 사이 ${unit} 차이가 뚜렷하지 않습니다(${sorted.map((b) => `${b.label} ${pct(b)}`).join(', ')}) — 그대로 더 두거나 새 문구로 바꿔 다시 비교하세요.`;
  return { status, metric, days: o.days, minImpressions: o.minImpressions, elapsedDays: o.elapsedDays, leader: ready ? leader?.adId ?? null : null, losers, message,
    ads: ads.map((x) => ({ ...x, ctr: x.impressions ? r2((x.clicks / x.impressions) * 100) : null, cvr: x.clicks ? r2((x.conversions / x.clicks) * 100) : null,
      cpc: x.clicks ? Math.round(x.cost / x.clicks) : null, z: leader && x.adId !== leader.adId ? r2(z(leader, x)) : null })) };
}
const kstDay = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(d));
/** 세팅안마다 소재별 누적 성과(mkt_ad_items, 하루 한 번 읽음) + 처음 켠 날부터 지난 날 수 → 판정 */
async function abFor(plans: any[]) {
  const out = new Map<string, ReturnType<typeof abVerdict>>();
  const live = plans.filter((p) => ['created', 'active', 'paused'].includes(p.status) && validIds(p.external?.adIds) && p.external.adIds.length >= 2);
  if (!live.length) return out;
  const sql = db();
  const [starts, items] = await Promise.all([
    sql<{ plan_id: string; at: string }[]>`select plan_id, min(created_at) as at from mkt_ad_changes where plan_id = any(${live.map((p) => p.id)}::uuid[]) and kind = 'enable' and status = 'applied' group by plan_id`,
    sql<any[]>`select account_id, item_id, sum(impressions)::float8 impressions, sum(clicks)::float8 clicks, sum(cost_krw)::float8 cost, sum(conversions)::float8 conversions
      from mkt_ad_items where kind = 'ad' and account_id = any(${[...new Set(live.map((p) => p.account_id))]}::uuid[]) and item_id = any(${live.flatMap((p) => p.external.adIds)}) group by account_id, item_id`,
  ]);
  const today = Date.parse(`${kstDay(new Date())}T00:00:00Z`);
  for (const p of live) {
    const st = starts.find((s) => s.plan_id === p.id);
    const elapsed = st ? Math.round((today - Date.parse(`${kstDay(st.at)}T00:00:00Z`)) / 864e5) : null;
    const t = { days: Number(p.plan.test?.days) || 7, minImpressions: Number(p.plan.test?.minImpressions) || 300 };
    const ads: AbAd[] = (p.external.adIds as string[]).map((adId, k) => {
      const it = items.find((r) => r.account_id === p.account_id && r.item_id === adId);
      return { adId, label: `안 ${'ABC'[k] ?? k + 1}`, headline: String(p.plan.ads?.[k]?.headline ?? ''), impressions: it?.impressions ?? 0, clicks: it?.clicks ?? 0, cost: it?.cost ?? 0,
        conversions: it?.conversions ?? 0, paused: !!p.external.adLocks?.[adId] };
    });
    out.set(p.id, { ...abVerdict(ads, { ...t, elapsedDays: elapsed }), afterBudget: p.plan.test?.afterBudget ?? null, on: !!p.plan.test?.on } as never);
  }
  return out;
}

/** 소재 하나씩 켜기·끄기(네이버 소재 userLock). 진 안 끄기는 돈이 줄어드는 변경 — 관리자 누름 = 승인. 소재를 모두 끌 수는 없음(광고 전체는 [끄기]) */
async function actAds(u: SessionUser, id: string, i: z.infer<typeof planAction>, revertOf: string | null): Promise<Record<string, unknown>> {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (!['created', 'active', 'paused'].includes(p.status) || !validIds(p.external?.adIds)) throw new HttpError(409, 'plan_not_created', '네이버에 만든 뒤에 바꿀 수 있습니다');
  const all: string[] = p.external.adIds;
  const ids = [...new Set(i.adIds ?? [])];
  if (!ids.length || ids.some((x) => !all.includes(x))) throw badRequest('이 세팅안의 소재를 골라 주세요');
  const lock = i.action !== 'ad_resume';
  const locks: Record<string, boolean> = { ...(p.external.adLocks ?? {}) };
  if (lock && !all.some((x) => !locks[x] && !ids.includes(x))) throw new HttpError(409, 'last_ad', '소재를 모두 끌 수는 없습니다 — 하나는 켜 두세요(광고 전체를 끄려면 [끄기])');
  const a = await naverAcc(t, p.account_id);
  const done: string[] = [];
  try {
    for (const x of ids) { await naverReq(a, 'PUT', `/ncc/ads/${x}`, '?fields=userLock', { nccAdId: x, userLock: lock }); locks[x] = lock; done.push(x); }
  } catch (e: any) {
    // 일부만 바뀌었으면 바뀐 것까지 저장(화면이 실제와 같게) + 실패 기록
    await sql`update mkt_ad_plans set external = ${sql.json({ ...p.external, adLocks: locks } as never)}, updated_at = now() where id = ${id}`;
    await sql`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, status, error, actor_id) values (${t}, ${id}, ${lock ? 'ad_pause' : 'ad_resume'},
      ${sql.json({ adIds: ids, userLock: !lock } as never)}, ${sql.json({ adIds: ids, userLock: lock, done } as never)}, 'failed', ${String(e?.message ?? e).slice(0, 4000)}, ${u.id})`;
    throw e;
  }
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set external = ${tx.json({ ...p.external, adLocks: locks } as never)}, updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, revert_of) values (${t}, ${id}, ${lock ? 'ad_pause' : 'ad_resume'},
      ${tx.json({ adIds: ids, userLock: !lock } as never)}, ${tx.json({ adIds: ids, userLock: lock, ...(i.action === 'ab_apply' ? { ab: true } : {}) } as never)}, false, ${u.id}, ${revertOf})`;
  });
  await audit(sql, u.id, `mkt_ads.${lock ? 'ad_pause' : 'ad_resume'}`, 'mkt_ad_plan', id, { adIds: ids, ab: i.action === 'ab_apply' }).catch(() => {});
  // [이긴 안에 집중]: 진 안을 끈 뒤 하루 예산도 바꿈 — 올리면 돈이 나가는 변경(켜져 있으면 월 상한 검사). 예산이 막혀도 소재 끄기는 그대로
  if (i.action === 'ab_apply' && i.dailyBudget && i.dailyBudget !== Number(p.plan.dailyBudget)) {
    try { await actPlan(u, id, { action: 'budget', dailyBudget: i.dailyBudget }); }
    catch (e: any) { return { ok: true, adLocks: locks, budgetError: String(e?.message ?? e) }; }
    return { ok: true, adLocks: locks, dailyBudget: i.dailyBudget };
  }
  return { ok: true, adLocks: locks };
}

// ---------------- 광고 최적화 1차 ④ 대행사 대비 절감액(추정) ----------------
export const DEFAULT_AGENCY_FEE = 15; // 대행 수수료 통상 광고비의 15~20% — 낮은 쪽(과장하지 않게)
/** 광고비 × 기준 수수료율. 직접 운영해서 아낀 '추정' 금액 — 화면에는 기준(수수료율)과 함께 */
export async function agencySavings(tenant: string, spend: number) {
  const [s] = await db()<{ agency_fee_pct: string | null }[]>`select agency_fee_pct from mkt_settings where tenant = ${tenant}`;
  const pct = s?.agency_fee_pct == null ? DEFAULT_AGENCY_FEE : Number(s.agency_fee_pct);
  return { pct, spend: Math.round(spend), amount: Math.round((spend * pct) / 100), custom: s?.agency_fee_pct != null };
}
export const feeInput = z.object({ pct: z.number().min(0).max(50).nullable() });
export async function setAgencyFee(u: SessionUser, i: z.infer<typeof feeInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u);
  const pct = i.pct === null ? null : Math.round(i.pct * 10) / 10;
  await db()`insert into mkt_settings (tenant, agency_fee_pct) values (${t}, ${pct}) on conflict (tenant) do update set agency_fee_pct = excluded.agency_fee_pct`;
  await audit(db(), u.id, 'mkt_ads.agency_fee', 'tenant', null, { pct }).catch(() => {});
  return { ok: true, savings: await agencySavings(t, await monthSpend(t)) };
}

// ---------------- 광고 최적화 1차 ② 동네 타깃 ----------------
// 네이버 파워링크는 반경 타겟팅이 없다 → ① 광고 지역(시·도, 공식 문서의 REGIONAL_TARGET) ② 반경 안 동네 이름 키워드(실제 월 검색량으로 고름)로 맞춘다.
// 반경 값은 동네 이름을 고를 때 쓰고 세팅안에 남겨 둔다(구글·메타 광고 연결 때 그대로).
/** 광고그룹의 타겟팅 하나(GET /ncc/targets?ownerId&types) — target 이 문자열(JSON)로 오기도 함 */
async function targetOf(a: NaverAcc, adgroupId: string, type: 'REGIONAL_TARGET' | 'MEDIA_TARGET') {
  const r = await naverReq(a, 'GET', '/ncc/targets', `?ownerId=${encodeURIComponent(adgroupId)}&types=${type}`);
  const t = ((Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []) as any[]).find((x) => x?.targetTp === type);
  if (!t?.nccTargetId) throw new HttpError(502, 'naver_target', `네이버 광고그룹(${adgroupId})의 ${type === 'MEDIA_TARGET' ? '매체' : '지역'} 타겟팅을 찾지 못했습니다`);
  let v = t.target; if (typeof v === 'string') { try { v = JSON.parse(v); } catch { v = null; } }
  return { id: String(t.nccTargetId), value: v };
}
async function regionTarget(a: NaverAcc, adgroupId: string) {
  const { id, value: v } = await targetOf(a, adgroupId, 'REGIONAL_TARGET');
  const list = (x: unknown) => (Array.isArray(x) ? x.map(String) : null);
  return { id, kr: list(v?.location?.KR), others: list(v?.location?.OTHERS) }; // kr null = 타겟 없음(전국 + 해외)
}
/** #499-2 노출 매체를 '네이버 매체만'으로(MEDIA_TARGET, 꺼진 상태에서) */
async function setMedia(a: NaverAcc, adgroupId: string) {
  const cur = await targetOf(a, adgroupId, 'MEDIA_TARGET');
  await naverReq(a, 'PUT', `/ncc/targets/${cur.id}`, '', { nccTargetId: cur.id, ownerId: adgroupId, targetTp: 'MEDIA_TARGET', target: MEDIA_NAVER_ONLY });
}
/** #499-2 확장 검색 제외 키워드(공식: POST /ncc/adgroups/{id}/restricted-keywords, type EXP_SEARCH — 파워링크 그룹만). 항목별로 거절된 것은 이유와 함께 돌려줌(나머지는 그대로) */
async function addNegatives(a: NaverAcc, adgroupId: string, negatives: string[]) {
  const ks = [...new Map(negatives.map((k) => [norm(k), k.replace(/\s+/g, '')] as [string, string])).values()];
  const r = await naverReq(a, 'POST', `/ncc/adgroups/${adgroupId}/restricted-keywords`, '', ks.map((keyword) => ({ nccAdgroupId: adgroupId, keyword, type: 'EXP_SEARCH' })));
  return ((Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []) as any[]).filter((x) => !x?.nccAdgroupRestrictKwdId && (x?.resultStatus?.code || x?.resultStatus?.message))
    .map((x) => `${String(x.keyword ?? '')} [code ${x.resultStatus.code ?? '?'}] ${String(x.resultStatus.message ?? '').slice(0, 300)}`.trim());
}
/** 광고 지역을 시·도로(국내 그 지역만, abroad = 해외도). 빈 배열 = 네이버 기본(전국·해외). 네이버 화면에서 시·군·구·동까지 정한 광고그룹은 덮어쓰지 않음(409) */
async function setRegion(a: NaverAcc, adgroupId: string, region: string[], abroad: boolean) {
  const cur = await regionTarget(a, adgroupId);
  if (cur.kr?.some((c) => !NAVER_REGION_CODES.includes(c))) throw new HttpError(409, 'region_custom', '네이버 광고 시스템에서 세부 지역(시·군·구·동)이 정해져 있어 워크인에서는 바꾸지 않습니다 — 네이버 화면에서 확인해 주세요');
  const location = region.length ? { KR: [...new Set(region)], OTHERS: abroad ? ['00'] : [] } : { KR: [...NAVER_REGION_CODES], OTHERS: ['00'] };
  await naverReq(a, 'PUT', `/ncc/targets/${cur.id}`, '', { nccTargetId: cur.id, ownerId: adgroupId, targetTp: 'REGIONAL_TARGET', target: { location } });
  return { before: { KR: cur.kr, OTHERS: cur.others }, after: location };
}
/** 만든 세팅안의 광고 지역 바꾸기 · 동네 키워드 추가(그룹 입찰가 그대로). 하루 예산은 그대로라 상한 검사 없음, 두 번 눌림은 409 */
async function actLocal(u: SessionUser, id: string, i: z.infer<typeof planAction>, revertOf: string | null): Promise<Record<string, unknown>> {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (!['created', 'active', 'paused'].includes(p.status) || !p.external?.adgroupId) throw new HttpError(409, 'plan_not_created', '네이버에 만든 뒤에 바꿀 수 있습니다');
  if (i.action === 'keywords_add' && !validIds(p.external.keywordIds)) throw new HttpError(409, 'keywords_unsynced', '먼저 [키워드 다시 읽기]로 키워드 id 를 맞춰 주세요');
  const a = await naverAcc(t, p.account_id); const gid = String(p.external.adgroupId);
  let add: string[] = [];
  if (i.action === 'keywords_add') {
    const have = new Set((p.plan.keywords as string[]).map(norm));
    add = [...new Map((i.keywords ?? []).map((k) => [norm(k), k.trim()] as [string, string])).values()].filter((k) => !have.has(norm(k)));
    if (!add.length) throw badRequest('고른 키워드가 이미 세팅안에 있습니다');
    if (p.plan.keywords.length + add.length > PLAN_KEYWORDS_MAX) throw badRequest(`키워드는 세팅안마다 ${PLAN_KEYWORDS_MAX}개까지입니다(지금 ${p.plan.keywords.length}개)`);
  }
  const [lock] = await sql`update mkt_ad_plans set external = external || ${sql.json({ localAt: new Date().toISOString() } as never)}
    where id = ${id} and coalesce((external->>'localAt')::timestamptz, 'epoch') < now() - interval '2 minutes' returning id`;
  if (!lock) throw new HttpError(409, 'plan_busy', '이미 바꾸는 중입니다 — 잠시 뒤 새로 고쳐 확인해 주세요');
  let before: any, after: any, plan: any, external: any = { ...p.external };
  try {
    if (i.action === 'region') {
      ({ before, after } = await setRegion(a, gid, i.region ?? [], !!i.abroad));
      plan = { ...p.plan, local: { center: '', radiusKm: 3, areas: [], ...(p.plan.local ?? {}), region: i.region ?? [], abroad: !!i.abroad && !!i.region?.length } };
    } else {
      const r = await naverReq(a, 'GET', '/ncc/keywords', `?nccAdgroupId=${encodeURIComponent(gid)}`);
      const existing = new Set(((Array.isArray(r) ? r : Array.isArray(r?.data) ? r.data : []) as any[]).map(kwId).filter(Boolean));
      const ids = await ensureKeywords(a, gid, add, Number(p.plan.bidAmt) || undefined);
      before = { count: p.plan.keywords.length }; after = { keywords: add, keywordIds: ids, createdIds: ids.filter((x) => !existing.has(x)) };
      plan = { ...p.plan, keywords: [...p.plan.keywords, ...add], ...(i.local ? { local: { center: '', radiusKm: 3, areas: [], region: [], abroad: false, ...(p.plan.local ?? {}), ...i.local } } : {}) };
      external = { ...p.external, keywordIds: [...p.external.keywordIds, ...ids] };
    }
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 4000);
    await sql`update mkt_ad_plans set external = external - 'localAt', updated_at = now() where id = ${id}`;
    await sql`insert into mkt_ad_changes (tenant, plan_id, kind, after, status, error, actor_id, revert_of) values (${t}, ${id}, ${i.action},
      ${sql.json((i.action === 'region' ? { KR: i.region ?? [], abroad: !!i.abroad } : { keywords: add }) as never)}, 'failed', ${msg}, ${u.id}, ${revertOf})`;
    throw e;
  }
  delete external.localAt;
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set plan = ${tx.json(plan as never)}, external = ${tx.json(external as never)}, updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, revert_of) values (${t}, ${id}, ${i.action}, ${tx.json(before)}, ${tx.json(after)}, false, ${u.id}, ${revertOf})`;
  });
  await audit(sql, u.id, `mkt_ads.${i.action}`, 'mkt_ad_plan', id, { before, after }).catch(() => {});
  return i.action === 'region' ? { ok: true, region: after } : { ok: true, keywords: add, keywordIds: after.keywordIds };
}
/** [되돌리기] 키워드 추가 → 그때 새로 만든 키워드만 네이버에서 지움(원래 있던 것은 그대로) + 세팅안에서 뺌. 중간 실패는 지운 것까지 반영 + 실패 기록 */
async function removeKeywords(u: SessionUser, planId: string, c: any): Promise<Record<string, unknown>> {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, planId);
  const a = await naverAcc(t, p.account_id);
  const created: string[] = c.after?.createdIds ?? [];
  const done: string[] = [];
  let err: any = null;
  for (const k of created) { try { await naverReq(a, 'DELETE', `/ncc/keywords/${k}`); done.push(k); } catch (e) { err = e; break; } }
  // 빼는 키워드: 성공이면 그때 넣은 것 전부, 실패면 지운 것만(id 로 짝지음)
  const addedKw: string[] = c.after?.keywords ?? []; const addedIds: string[] = c.after?.keywordIds ?? [];
  const dropKw = new Set((err ? addedKw.filter((_, j) => done.includes(addedIds[j])) : addedKw).map(norm));
  const ids: string[] = p.external?.keywordIds ?? [];
  const keep = (p.plan.keywords as string[]).map((k, j) => [k, ids[j]] as [string, string]).filter(([k]) => !dropKw.has(norm(k)));
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set plan = ${tx.json({ ...p.plan, keywords: keep.map((x) => x[0]) } as never)}, external = ${tx.json({ ...p.external, keywordIds: keep.map((x) => x[1]) } as never)}, updated_at = now() where id = ${planId}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, status, error, actor_id, revert_of) values (${t}, ${planId}, 'keywords_remove',
      ${tx.json({ keywords: addedKw } as never)}, ${tx.json({ deletedIds: done } as never)}, false, ${err ? 'failed' : 'applied'}, ${err ? String(err?.message ?? err).slice(0, 4000) : null}, ${u.id}, ${err ? null : c.id})`;
  });
  if (err) throw err;
  await audit(sql, u.id, 'mkt_ads.keywords_remove', 'mkt_ad_plan', planId, { deletedIds: done }).catch(() => {});
  return { ok: true, removed: [...dropKw].length };
}

export const areasInput = z.object({ center: z.string().trim().min(2).max(80), radiusKm: z.number().min(0.5).max(30).default(3), services: z.array(z.string().trim().min(1).max(20)).max(5).default([]) });
const AREA_RE = /^[가-힣A-Za-z0-9]{2,15}$/;
/** 기준 위치 반경 안 동네 이름(동·역·생활권) — AI 추정. 진짜인지는 [검색량 확인]의 실제 검색량으로 거름 */
export async function localAreas(u: SessionUser, i: z.infer<typeof areasInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const { aiJson } = await import('./mktOps');
  let o: any = null;
  try {
    o = await aiJson(tenantOf(u), u.id, `당신은 한국 동네 상권을 잘 아는 검색광고 담당자입니다. 기준 위치에서 반경 안에 있는 동네 이름을 JSON 으로만 답합니다.
- 행정동·법정동(예: 두정동), 지하철·기차역(예: 두정역), 사람들이 검색에 쓰는 생활권 이름(예: 천안터미널)만. '시'·'구'처럼 넓은 이름은 반경 5km 이상일 때만.
- 실제로 있는 이름만 씁니다. 확실하지 않으면 넣지 않습니다. 띄어쓰기 없이 씁니다.
- km 는 기준 위치에서의 대략 거리(추정)입니다. 가까운 순서로 최대 15개.`,
      `기준 위치: ${i.center}\n반경: ${i.radiusKm}km${i.services.length ? `\n업종·서비스: ${i.services.join(', ')}` : ''}`,
      { type: 'object', additionalProperties: false, required: ['areas'], properties: { areas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'kind', 'km'],
        properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['동', '역', '생활권', '기타'] }, km: { type: 'number' } } } } } }, 'marketing_ads_local');
  } catch (e) { if (e instanceof HttpError) throw e; o = null; } // 한도 초과 등은 그대로 알림, 응답 형식 오류는 '직접 적기' 안내
  if (!o) return { areas: [], note: 'AI 추천을 받지 못했습니다 — 동네 이름을 직접 적어 주세요' };
  const seen = new Set<string>();
  const areas = ((o.areas ?? []) as any[]).map((x) => ({ name: String(x?.name ?? '').replace(/\s+/g, ''), kind: ['동', '역', '생활권', '기타'].includes(x?.kind) ? String(x.kind) : '기타', km: Math.round(Number(x?.km) * 10) / 10 }))
    .filter((x) => AREA_RE.test(x.name) && Number.isFinite(x.km) && x.km >= 0 && x.km <= i.radiusKm * 1.5 && !seen.has(x.name) && !!seen.add(x.name)).slice(0, 15);
  return { areas, note: 'AI 가 추정한 동네 이름·거리입니다 — [검색량 확인]으로 실제 검색이 있는 것만 고르세요' };
}
export const localKwInput = z.object({ accountId: z.string().uuid(), areas: z.array(z.string().trim().min(1).max(20)).min(1).max(20), services: z.array(z.string().trim().min(1).max(20)).min(1).max(5) });
/** 동네 × 서비스 조합(최대 50개)의 네이버 월 검색량(PC·모바일, 키워드 도구) + 검색량 있는 연관 동네 키워드. 고르는 것은 사람 */
export async function localKeywords(u: SessionUser, i: z.infer<typeof localKwInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const a = await naverAcc(tenantOf(u), i.accountId);
  const areas = [...new Set(i.areas.map((x) => x.replace(/\s+/g, '')))].filter((x) => x.length >= 2);
  const services = [...new Set(i.services.map((x) => x.trim()))];
  const combos: { keyword: string; area: string; service: string }[] = [];
  for (const ar of areas) for (const s of services) { const k = `${ar} ${s}`; if ([...k].length <= 25 && combos.length < 50) combos.push({ keyword: k, area: ar, service: s }); }
  if (!combos.length) throw badRequest('동네 이름과 서비스 단어를 넣어 주세요');
  const vol = await keywordVolumes(a, combos.map((c) => c.keyword));
  const rows = combos.map((c) => { const v = vol.get(norm(c.keyword)); const total = v ? v.pc + v.mobile : 0; return { ...c, pc: v?.pc ?? null, mobile: v?.mobile ?? null, total, low: total < 20 }; })
    .sort((x, y) => y.total - x.total);
  const asked = new Set(combos.map((c) => norm(c.keyword)));
  const related = vol.related.filter((r) => !asked.has(norm(r.keyword)) && areas.some((ar) => norm(r.keyword).includes(norm(ar)))).slice(0, 10);
  return { rows, related };
}

export const combineInput = z.object({ accountId: z.string().uuid(),
  groups: z.array(z.object({ words: z.array(z.string().trim().min(1).max(20)).min(1).max(20), optional: z.boolean().default(false) })).min(2).max(4) });
/**
 * #499-2 키워드 N단 조합기(테크트리 EP.7): 단어 그룹 2~4개 조합(최대 300개) + 네이버 월 검색량(키워드 도구). 고르는 것은 사람 —
 * 영상은 검색량 0인 조합도 등록하지만 기본은 검색량 있는 것만 고르고, 화면 '검색량 낮음도 함께 넣기'로 모두 고를 수 있음.
 */
export async function combineVolumes(u: SessionUser, i: z.infer<typeof combineInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const a = await naverAcc(tenantOf(u), i.accountId);
  const { keywords, truncated } = combineKeywords(i.groups);
  if (!keywords.length) throw badRequest('만들 조합이 없습니다 — 그룹마다 단어를 넣어 주세요(조합은 25자 이내)');
  const vol = await keywordVolumes(a, keywords, { tolerant: true });
  const rows = keywords.map((k) => { const v = vol.get(norm(k)); const total = v ? v.pc + v.mobile : 0; return { keyword: k, pc: v?.pc ?? null, mobile: v?.mobile ?? null, total, low: total < 20 }; })
    .sort((x, y) => y.total - x.total);
  const asked = new Set(keywords.map(norm));
  return { rows, truncated, failed: vol.failed, related: vol.related.filter((r) => !asked.has(norm(r.keyword))).slice(0, 10) };
}

// ---------------- 광고 최적화 1차 ③ 통화 기반 최적화: 키워드 끄기·켜기 ----------------
/** 워크인이 만든 세팅안의 키워드만 네이버 userLock(PUT /ncc/keywords/{id}?fields=userLock). 끄기는 돈이 줄어드는 변경 — 관리자 누름 = 승인. 중간 실패는 된 것까지 저장 + 실패 기록 */
async function actKeywords(u: SessionUser, id: string, i: z.infer<typeof planAction>, revertOf: string | null): Promise<Record<string, unknown>> {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (!['created', 'active', 'paused'].includes(p.status) || !validIds(p.external?.keywordIds)) throw new HttpError(409, 'plan_not_created', '네이버에 만든 뒤에 바꿀 수 있습니다');
  const all: string[] = p.external.keywordIds;
  const ids = [...new Set(i.keywordIds ?? [])];
  if (!ids.length || ids.some((x) => !all.includes(x))) throw badRequest('이 세팅안의 키워드를 골라 주세요');
  const lock = i.action === 'kw_pause';
  const names = ids.map((x) => String(p.plan.keywords?.[all.indexOf(x)] ?? x));
  const locks: Record<string, boolean> = { ...(p.external.kwLocks ?? {}) };
  const a = await naverAcc(t, p.account_id);
  const done: string[] = [];
  try {
    for (const x of ids) { await naverReq(a, 'PUT', `/ncc/keywords/${x}`, '?fields=userLock', { nccKeywordId: x, userLock: lock }); locks[x] = lock; done.push(x); }
  } catch (e: any) {
    await sql`update mkt_ad_plans set external = ${sql.json({ ...p.external, kwLocks: locks } as never)}, updated_at = now() where id = ${id}`;
    await sql`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, status, error, actor_id) values (${t}, ${id}, ${i.action},
      ${sql.json({ keywordIds: ids, userLock: !lock } as never)}, ${sql.json({ keywordIds: ids, keywords: names, userLock: lock, done } as never)}, 'failed', ${String(e?.message ?? e).slice(0, 4000)}, ${u.id})`;
    throw e;
  }
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set external = ${tx.json({ ...p.external, kwLocks: locks } as never)}, updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, revert_of) values (${t}, ${id}, ${i.action},
      ${tx.json({ keywordIds: ids, userLock: !lock } as never)}, ${tx.json({ keywordIds: ids, keywords: names, userLock: lock } as never)}, false, ${u.id}, ${revertOf})`;
  });
  await audit(sql, u.id, `mkt_ads.${i.action}`, 'mkt_ad_plan', id, { keywordIds: ids }).catch(() => {});
  return { ok: true, kwLocks: locks };
}
