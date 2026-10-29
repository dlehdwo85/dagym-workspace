import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { decrypt } from './crypto';
import { audit, logError } from './log';
import { tenantOf, type SessionUser } from './types';
import { metaGraph } from './metaGraph';
import { RISKY, capOf, guardMoneyUp, monthSpend } from './adOps';
import { DEFAULT_RULES, checkAd, qualityRules, scoreHook, type QualityRules } from './mktQuality';
import { downloadUrl, getObject } from './storage';
import { appUrl } from './mail';

/**
 * #494 메타 광고 자동 세팅('소재 넣기 → 자동 캠페인', 조사 보고서 AI_KIT_RESEARCH D-4).
 * - 세팅안(워크인에만 저장) → [Meta에 초안 만들기] = 소재 올리기(/adimages·/advideos) + 캠페인·광고 세트·광고를 모두 PAUSED 로, 캠페인에 spend_cap(총 상한) → 승인함 '광고 초안'.
 * - 승인(관리자 = 돈이 나가는 변경): 서버가 회사 월 상한·Meta 쪽 총 상한·하루 예산·기간을 다시 읽어 확인한 뒤 광고 → 광고 세트 → 캠페인 순서로 ACTIVE. 이 길은 서버에만 있고 변경 기록·감사 기록을 남긴다.
 * - 끄기·예산 내리기는 바로, 다시 켜기·예산 올리기는 관리자 + 상한 검사. 성과 기준(리드당·클릭당 비용)을 넘으면 tick 이 자동 일시정지(돈을 아끼는 쪽이라 허용).
 * - 토큰은 광고 계정 연결(secret_enc)에서만 읽고 화면·주소·오류 문구에 남기지 않는다. 1단계 = 자사 계정(앱 개발 모드).
 * - Meta 필드는 공식 문서 기준(2026-10-23 확인: 생성 상태는 ACTIVE·PAUSED 만, spend_cap 최소 약 미화 100달러, v23 부터 targeting_automation.advantage_audience 명시,
 *   리드 광고 링크 https://fb.me/ · 버튼 6종). 실계정 집행 시험 전까지는 '구조 시험'.
 */
const ID_RE = /^\d{1,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const ymd = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const abs = (u: string) => (u.startsWith('http') ? u : `${appUrl()}${u}`);
const msgOf = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 1500);
function adminOnly(u: SessionUser) { if (!isAdmin(u)) throw forbidden('광고 운영은 관리자가 합니다'); }

/** 리드 광고 버튼(Meta 문서: 이 6가지만) · 방문 광고는 예약·문의도 */
const LEAD_CTA = ['SIGN_UP', 'APPLY_NOW', 'LEARN_MORE', 'GET_QUOTE', 'SUBSCRIBE', 'DOWNLOAD'] as const;
export const META_CTA = [...LEAD_CTA, 'CONTACT_US', 'BOOK_NOW'] as const;
const LEAD_ACTIONS = new Set(['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']);
export const MIN_TOTAL_CAP = 140_000; // 캠페인 지출 한도 최소 = 약 미화 100달러(원화 환산, 넉넉히)

export const metaAutoInput = z.object({
  accountId: z.string().uuid(),
  brandId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(60),
  objective: z.enum(['leads', 'traffic']),                       // 리드(광고 안 양식) · 방문(홈페이지)
  pageAccountId: z.string().uuid(),                              // 광고를 내보낼 페이스북 페이지(연결 계정)
  creative: z.object({
    fileId: z.string().uuid(),                                   // 자료실 이미지·영상
    thumbFileId: z.string().uuid().nullable().optional(),        // 영상 표지(없으면 Meta 가 뽑은 표지)
    primary: z.string().trim().min(1).max(1000),                 // 기본 문구
    headline: z.string().trim().min(1).max(80),
    description: z.string().trim().max(80).default(''),
    cta: z.enum(META_CTA).default('LEARN_MORE'),
    link: z.string().trim().url().max(500).nullable().optional(),
  }),
  leadFormId: z.string().regex(ID_RE, '리드 양식 번호가 올바르지 않습니다').nullable().optional(),
  privacyConfirmed: z.boolean().default(false),                  // 양식의 개인정보처리방침 링크를 Meta 에서 못 읽을 때 사람이 확인
  location: z.object({ address: z.string().trim().min(4).max(120), radiusKm: z.number().min(1).max(80).default(3) }),
  ageMin: z.number().int().min(18).max(65).default(20),
  ageMax: z.number().int().min(18).max(65).default(65),
  startDate: z.string().regex(YMD), endDate: z.string().regex(YMD),
  dailyBudget: z.number().int().min(1000).max(10_000_000),       // 원(광고 세트 하루 예산)
  totalCap: z.number().int().min(10_000).max(1_000_000_000),     // 원(캠페인 spend_cap)
  guard: z.object({ maxCpl: z.number().int().min(1000).max(1_000_000).nullable().optional(), maxCpc: z.number().int().min(50).max(100_000).nullable().optional(),
    minSpend: z.number().int().min(5000).max(10_000_000).default(30_000) }).nullable().optional(),
});
type Input = z.infer<typeof metaAutoInput>;
export type MetaPlan = Omit<Input, 'accountId' | 'name' | 'brandId'>;

/** 특별 광고 카테고리로 보이는 문구(채용·주택·금융) — 나이·반경 타깃 제한이 있어 1단계에서는 만들지 않음 */
export const SPECIAL_RE: [RegExp, string][] = [
  [/채용|구인|구직|일자리|아르바이트|알바|정규직|계약직|(직원|강사|트레이너|코치)\s*(모집|채용|구함)/, '채용'],
  [/분양|임대|전세|월세|매매|부동산|입주자\s*모집/, '주택'],
  [/대출|신용\s*(대출|카드|등급|점수)|카드\s*발급|금리|보험\s*(가입|상품|료)|적금|예금|주식|코인|투자\s*(상품|수익|자문|설명회)/, '금융'],
];
const days = (p: Pick<MetaPlan, 'startDate' | 'endDate'>) => Math.round((Date.parse(`${p.endDate}T00:00:00Z`) - Date.parse(`${p.startDate}T00:00:00Z`)) / 864e5) + 1;

/** 세팅안 검사(서버·화면 같은 규칙): issues = 만들기 막음, warnings = 알림만 */
export function metaPrecheck(p: MetaPlan, rules: QualityRules = DEFAULT_RULES, today = ymd()) {
  const issues: string[] = [], warnings: string[] = [];
  const c = p.creative; const text = `${c.headline} ${c.primary} ${c.description ?? ''}`;
  for (const [re, msg] of RISKY) if (re.test(text)) issues.push(`문구: ${msg}`);
  const special = SPECIAL_RE.filter(([re]) => re.test(text)).map(([, k]) => k);
  if (special.length) issues.push(`특별 광고 카테고리(${special.join('·')})로 보이는 문구 — Meta 규정상 나이·반경 타깃에 제한이 있어 이 화면에서는 만들지 않습니다. 문구를 바꾸거나 Meta 광고 관리자에서 직접 만들어 주세요`);
  for (const x of checkAd('meta', { primary: c.primary }, rules)) warnings.push(x.msg);
  // #499-1 광고형 기준(알림만): 본문 첫 줄(더 보기 전에 보이는 줄)·제목 어딘가에 대상 호명·제안이 2초 안에 보이는지
  const first = String(c.primary ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const hk = scoreHook(first || c.headline, rules, [], 'ad'); const hd = c.headline ? scoreHook(c.headline, rules, [], 'ad') : null;
  const miss = [...(hk.parts.callout || hd?.parts.callout ? [] : ['대상 호명(누구에게)']), ...(hk.parts.offer || hd?.parts.offer ? [] : ['제안(무료 진단·체크리스트·실제 가격 등 무엇을 주는지)'])];
  if (miss.length) warnings.push(`광고형 기준: 본문 첫 줄·제목에 ${miss.join('·')}이 없습니다 — 첫 2초 안에 보이게 넣어 주세요`);
  if ([...c.headline].length > 40) warnings.push(`제목 ${[...c.headline].length}자 — 40자 안쪽이어야 잘리지 않고 보입니다`);
  if (p.objective === 'traffic' && !c.link) issues.push('방문 광고는 연결할 주소(홈페이지·예약 페이지)가 필요합니다');
  if (p.objective === 'leads') {
    if (!p.leadFormId) issues.push('리드 양식을 골라 주세요(Meta 광고 관리자 › 양식에서 만든 것)');
    if (!(LEAD_CTA as readonly string[]).includes(c.cta)) issues.push('리드 광고 버튼은 가입하기·신청하기·더 알아보기·견적 받기·구독하기·다운로드만 됩니다');
  }
  if (p.ageMin > p.ageMax) issues.push('나이: 최소가 최대보다 큽니다');
  if (p.startDate < today) issues.push('시작일이 지났습니다 — 오늘 이후로 바꿔 주세요');
  const n = days(p);
  if (n < 2) issues.push('기간은 이틀 이상이어야 합니다(하루 예산은 24시간 넘는 기간에만 — Meta 규칙)');
  if (n > 90) issues.push('기간은 90일 이내로 잡아 주세요');
  if (p.totalCap < MIN_TOTAL_CAP) issues.push(`총 상한은 ${won(MIN_TOTAL_CAP)} 이상이어야 합니다(Meta 캠페인 지출 한도 최소 약 미화 100달러)`);
  if (p.dailyBudget > p.totalCap) issues.push('하루 예산이 총 상한보다 큽니다');
  if (n >= 2 && p.dailyBudget * n > p.totalCap) warnings.push(`하루 예산 × ${n}일 = ${won(p.dailyBudget * n)} — 총 상한 ${won(p.totalCap)}에 닿으면 그 뒤로는 멈춥니다`);
  if (!p.guard?.maxCpl && !p.guard?.maxCpc) warnings.push('자동 일시정지 기준(리드당·클릭당 비용)이 없습니다 — 총 상한까지는 계속 집행됩니다');
  return { issues, warnings };
}

// ---------------- Meta 호출(토큰은 본문으로, 오류 문구에는 경로만) ----------------
async function gm(method: 'GET' | 'POST', path: string, token: string, params: Record<string, unknown> = {}) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  form.set('access_token', token);
  const url = `${metaGraph()}/${path}`;
  const r = await fetch(method === 'GET' ? `${url}?${form}` : url, { method, signal: AbortSignal.timeout(30000),
    ...(method === 'POST' ? { body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } } : {}) });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text.replace(/"(id|campaign_id|adset_id|creative_id|video_id)"\s*:\s*(\d{15,})/g, '"$1":"$2"')); } catch { /* JSON 아님 */ }
  if (!r.ok || j?.error) {
    const e = j?.error ?? {};
    throw new HttpError(502, 'meta_upstream', `Meta 광고 API 오류 ${r.status} ${method} /${path} ${String(e.error_user_msg ?? e.message ?? '').slice(0, 600)}${e.code ? ` [code ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''}]` : ''}`.trim());
  }
  return j;
}
const idOf = (j: any, what: string) => { const id = String(j?.id ?? ''); if (!ID_RE.test(id)) throw new HttpError(502, 'meta_no_id', `Meta 가 ${what} 번호를 돌려주지 않았습니다`); return id; };

type Acc = { id: string; tenant: string; external_id: string; secret_enc: string | null; label: string };
async function adAccount(t: string, id: string) {
  if (!UUID.test(id)) throw notFound();
  const [a] = await db()<Acc[]>`select id, tenant, external_id, secret_enc, label from mkt_ad_accounts where id = ${id} and tenant = ${t} and provider = 'meta' and status <> 'disconnected'`;
  if (!a) throw notFound('Meta 광고 계정을 찾을 수 없습니다');
  return a;
}
const tokenOf = (a: Acc) => {
  const s = a.secret_enc ? JSON.parse(decrypt(a.secret_enc)) : {};
  if (!s.token) throw new HttpError(409, 'meta_token', 'Meta 광고 계정 토큰이 없습니다 — 광고 › 연결에서 다시 연결해 주세요');
  return String(s.token);
};
type Page = { id: string; external_id: string; label: string; token_enc: string | null; brand_id: string | null; shared: boolean };
async function pageAccount(t: string, id: string) {
  if (!UUID.test(id)) throw notFound();
  const [p] = await db()<Page[]>`select id, external_id, label, token_enc, brand_id, shared from mkt_publish_accounts where id = ${id} and tenant = ${t} and provider = 'meta_fb' and status <> 'disconnected'`;
  if (!p) throw notFound('페이스북 페이지 연결을 찾을 수 없습니다 — 마케팅 › 연결 계정에서 먼저 연결해 주세요');
  return p;
}
async function planOf(t: string, id: string) {
  if (!UUID.test(id)) throw notFound();
  const [p] = await db()<any[]>`select * from mkt_ad_plans where id = ${id} and tenant = ${t} and provider = 'meta'`;
  if (!p) throw notFound('메타 광고 세팅안을 찾을 수 없습니다');
  return p;
}
/** 자료실 소재: 볼 수 있는 자료만(공간·폴더·등급), 기밀은 외부(Meta)로 안 보냄 */
async function creativeFile(u: SessionUser, fileId: string) {
  const { loadLibraryFile } = await import('./library');
  const f = await loadLibraryFile(u, fileId, 'meta');
  if (f.effective_security === 'confidential') throw new HttpError(409, 'confidential', '기밀 자료는 광고 소재로 보낼 수 없습니다');
  const mime = String(f.mime_type ?? '');
  if (!mime.startsWith('image/') && !mime.startsWith('video/')) throw badRequest('소재는 이미지나 영상 파일이어야 합니다');
  if (!f.storage_key) throw badRequest('파일이 아직 올라가지 않았습니다');
  return f as { id: string; file_name: string; mime_type: string; storage_key: string };
}

// ---------------- 화면 ----------------
export async function metaAutoOverview(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db();
  const [cap, spend, rules] = await Promise.all([capOf(t), monthSpend(t), qualityRules()]);
  const accounts = await sql`select id, label, external_id from mkt_ad_accounts where tenant = ${t} and provider = 'meta' and status <> 'disconnected' order by created_at`;
  const pages = await sql`select a.id, a.label, a.external_id, a.brand_id, a.shared, b.name as brand, exists (select 1 from mkt_lead_pages lp where lp.account_id = a.id and lp.enabled) as leads
    from mkt_publish_accounts a left join mkt_brands b on b.id = a.brand_id where a.tenant = ${t} and a.provider = 'meta_fb' and a.status <> 'disconnected' order by a.label`;
  const brands = await sql`select id, name from mkt_brands where tenant = ${t} order by ad_priority nulls last, name`;
  const plans = await sql<any[]>`select p.id, p.account_id, p.brand_id, br.name as brand, p.name, p.plan, p.status, p.external, p.error, p.created_at, p.approved_at, a.label as account_label,
      ab.name as approved_by_name, cb.name as created_by_name, pa.label as page_label, lf.mime_type as creative_mime
    from mkt_ad_plans p join mkt_ad_accounts a on a.id = p.account_id left join mkt_brands br on br.id = p.brand_id left join users ab on ab.id = p.approved_by left join users cb on cb.id = p.created_by
      left join mkt_publish_accounts pa on pa.id::text = p.plan->>'pageAccountId' and pa.tenant = p.tenant
      left join library_files lf on lf.id::text = p.plan->'creative'->>'fileId' and lf.tenant = p.tenant
    where p.tenant = ${t} and p.provider = 'meta' order by (p.status = 'archived'), p.created_at desc limit 50`;
  const ids = plans.map((p) => p.id);
  const changes = ids.length ? await sql`select c.id, c.plan_id, c.kind, c.before, c.after, c.money_up, c.status, c.error, c.revert_of, c.created_at, u.name as actor_name
    from mkt_ad_changes c left join users u on u.id = c.actor_id where c.tenant = ${t} and c.plan_id = any(${ids}::uuid[]) order by c.created_at desc limit 100` : [];
  const checkOf = (p: any) => { const c = metaPrecheck(p.plan, rules); return { issues: c.issues, warnings: [...c.warnings, ...capWarnings(p.plan, cap, spend)], later: draftTimeChecks(p.plan, p.creative_mime) }; };
  return { canEdit: isAdmin(u), cap, monthSpend: spend, today: ymd(), minTotalCap: MIN_TOTAL_CAP, cta: META_CTA, leadCta: LEAD_CTA, accounts, pages, brands, changes,
    plans: plans.map((p) => ({ ...p, check: p.status === 'draft' || p.status === 'failed' ? checkOf(p) : { issues: [], warnings: (p.external?.checks?.warnings ?? []) as string[] } })) };
}

/** 리드 양식 목록(페이지 토큰) — 고르기용 */
export async function metaLeadForms(u: SessionUser, pageAccountId: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const { leadForms } = await import('./metaLeads');
  return leadForms(u, (await pageAccount(tenantOf(u), pageAccountId)).id);
}

// ---------------- 세팅안(워크인에만) ----------------
async function validateRefs(u: SessionUser, i: Input) {
  const t = tenantOf(u);
  await adAccount(t, i.accountId); await pageAccount(t, i.pageAccountId);
  await creativeFile(u, i.creative.fileId);
  if (i.creative.thumbFileId) { const th = await creativeFile(u, i.creative.thumbFileId); if (!th.mime_type.startsWith('image/')) throw badRequest('영상 표지는 이미지여야 합니다'); }
}
export async function createMetaPlan(u: SessionUser, i: Input) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  await validateRefs(u, i);
  const { accountId, name, brandId, ...plan } = i;
  const [p] = await db()`insert into mkt_ad_plans (tenant, account_id, provider, kind, name, plan, created_by, brand_id) values (${tenantOf(u)}, ${accountId}, 'meta', 'meta_auto', ${name}, ${db().json(plan as never)}, ${u.id}, ${brandId ?? null}) returning id`;
  return { id: p.id, ...(await savedCheck(tenantOf(u), plan)) };
}
export async function updateMetaPlan(u: SessionUser, id: string, i: Input) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const p = await planOf(tenantOf(u), id);
  if (p.status !== 'draft' && p.status !== 'failed') throw new HttpError(409, 'plan_locked', 'Meta 에 초안을 만든 뒤에는 고칠 수 없습니다 — 끄기·하루 예산만 바꿀 수 있습니다(반려하고 새로 만들기)');
  await validateRefs(u, i);
  const { accountId, name, brandId, ...plan } = i;
  // Meta 에 일부 만든 뒤 실패한 세팅안을 고치면 이미 만든 것(캠페인 등)은 그대로 두고 남은 단계만 새 값으로 — 계정·소재가 바뀌면 처음부터
  const ext = p.external ?? {};
  const restart = accountId !== p.account_id || plan.creative.fileId !== p.plan?.creative?.fileId;
  await db()`update mkt_ad_plans set account_id = ${accountId}, name = ${name}, plan = ${db().json(plan as never)}, brand_id = ${brandId === undefined ? p.brand_id : brandId},
    external = ${db().json((restart ? {} : ext) as never)}, error = null, updated_at = now() where id = ${id}`;
  return { id, ...(await savedCheck(tenantOf(u), plan)) };
}
/** 저장 직후 검사 = 세팅안 검사 + 회사 월 상한 경고(4cde86d a) */
async function savedCheck(t: string, plan: MetaPlan) {
  const [rules, cap, spent] = await Promise.all([qualityRules(), capOf(t), monthSpend(t)]);
  const c = metaPrecheck(plan, rules);
  return { issues: c.issues, warnings: [...c.warnings, ...capWarnings(plan, cap, spent)] };
}

// ---------------- 이미지 속 글자(경고만) ----------------
/** 이미지에서 글자가 차지하는 비율 — Meta 는 글자가 적은 이미지를 권장(20% 규칙은 폐지, 노출에는 영향). AI 가 꺼졌거나 한도면 '확인 못함' */
async function imageTextCheck(tenant: string, actorId: string | null, buf: Buffer, mime: string): Promise<{ checked: boolean; ratio: number | null; note: string }> {
  try {
    const P = await import('./ai/provider');
    if (!P.aiEnabled()) return { checked: false, ratio: null, note: '이미지 속 글자: AI 가 꺼져 있어 확인 못함(직접 확인)' };
    const { assertMktAi } = await import('./mktAuto'); await assertMktAi(tenant);
    if (!/^image\/(jpeg|png|gif|webp)$/.test(mime) || buf.length > 4.5 * 1024 * 1024) return { checked: false, ratio: null, note: '이미지 속 글자: 형식·크기 때문에 자동 확인 못함(직접 확인)' };
    const SCHEMA = { type: 'object', additionalProperties: false, required: ['ratio', 'text'], properties: { ratio: { type: 'integer' }, text: { type: 'string' } } };
    const p = P.anthropicProvider({ tier: 'fast' });
    const r = await p.chat({ system: '당신은 광고 소재 검수자입니다. 보이는 것만 근거로 답합니다.', tools: [], format: SCHEMA,
      messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } },
        { type: 'text', text: '이 광고 이미지에서 글자(문구·로고 글자·숫자)가 차지하는 넓이 비율을 0~100 정수로 어림하고(ratio), 보이는 글자를 그대로 짧게 적으세요(text, 없으면 빈 문자열). JSON 으로만.' }] }] } as any);
    await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
      values (${tenant}, ${actorId}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_studio')`;
    const j = JSON.parse((r.content as any[]).filter((x) => x.type === 'text').map((x) => x.text).join(''));
    const ratio = Math.max(0, Math.min(100, Math.round(Number(j?.ratio) || 0)));
    return { checked: true, ratio, note: ratio > 20 ? `이미지 속 글자가 많습니다(약 ${ratio}%) — 글자가 적을수록 노출에 유리(Meta 권장)` : `이미지 속 글자 약 ${ratio}%` };
  } catch (e) { return { checked: false, ratio: null, note: `이미지 속 글자: 확인 못함(${msgOf(e).slice(0, 80)}) — 직접 확인` }; }
}

// ---------------- [Meta에 초안 만들기]: 모두 PAUSED + spend_cap ----------------
const OBJECTIVE = { leads: 'OUTCOME_LEADS', traffic: 'OUTCOME_TRAFFIC' } as const;
function adsetSpec(name: string, pl: MetaPlan, campaignId: string, pageId: string, today = ymd()) {
  const leads = pl.objective === 'leads';
  return {
    name: `${name} 광고 세트`, campaign_id: campaignId, daily_budget: pl.dailyBudget, billing_event: 'IMPRESSIONS',
    optimization_goal: leads ? 'LEAD_GENERATION' : 'LINK_CLICKS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    destination_type: leads ? 'ON_AD' : 'WEBSITE', ...(leads ? { promoted_object: { page_id: pageId } } : {}),
    targeting: { geo_locations: { custom_locations: [{ address_string: pl.location.address, radius: pl.location.radiusKm, distance_unit: 'kilometer' }], location_types: ['home', 'recent'] },
      age_min: pl.ageMin, age_max: pl.ageMax, targeting_automation: { advantage_audience: 0 } }, // 반경·나이를 그대로(넓히지 않음)
    ...(pl.startDate > today ? { start_time: `${pl.startDate}T00:00:00+0900` } : {}), // 오늘 시작이면 켜는 때부터
    end_time: `${pl.endDate}T23:59:59+0900`, status: 'PAUSED',
  };
}
function storySpec(pl: MetaPlan, pageId: string, ext: Record<string, any>) {
  const c = pl.creative; const leads = pl.objective === 'leads';
  const cta = { type: c.cta, value: leads ? { lead_gen_form_id: pl.leadFormId } : { link: c.link } };
  if (ext.videoId) return { page_id: pageId, video_data: { video_id: ext.videoId, ...(ext.thumbHash ? { image_hash: ext.thumbHash } : ext.videoPicture ? { image_url: ext.videoPicture } : {}),
    message: c.primary, title: c.headline, ...(c.description ? { link_description: c.description } : {}), call_to_action: cta } };
  return { page_id: pageId, link_data: { image_hash: ext.imageHash, link: leads ? 'https://fb.me/' : c.link, message: c.primary, name: c.headline, ...(c.description ? { description: c.description } : {}), call_to_action: cta } };
}
async function uploadImage(actId: string, token: string, buf: Buffer) {
  if (buf.length > 30 * 1024 * 1024) throw badRequest('이미지가 30MB 를 넘습니다');
  const r = await gm('POST', `act_${actId}/adimages`, token, { bytes: buf.toString('base64') });
  const first: any = Object.values(r?.images ?? {})[0];
  if (!first?.hash) throw new HttpError(502, 'meta_image', 'Meta 가 이미지 번호(hash)를 돌려주지 않았습니다');
  return String(first.hash);
}

export async function buildMetaDraft(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (p.status !== 'draft' && p.status !== 'failed') throw new HttpError(409, 'plan_not_draft', '이미 Meta 에 만든 초안입니다');
  const pl = p.plan as MetaPlan;
  const pre = metaPrecheck(pl, await qualityRules());
  if (pre.issues.length) throw new HttpError(409, 'precheck_failed', `세팅안 검사를 통과하지 못했습니다: ${pre.issues.join(' · ')}`);
  const cap = await capOf(t);
  if (!cap) throw new HttpError(409, 'cap_required', '먼저 회사 월 광고비 상한을 정해 주세요(광고 운영 맨 위)');
  const a = await adAccount(t, p.account_id); const token = tokenOf(a);
  const page = await pageAccount(t, pl.pageAccountId);
  const file = await creativeFile(u, pl.creative.fileId);
  const video = file.mime_type.startsWith('video/');
  // 같은 세팅안을 동시에 두 번 만들지 않게 — 만드는 중으로 바꾼 요청만 진행
  const [lock] = await sql`update mkt_ad_plans set status = 'creating', updated_at = now() where id = ${id} and status in ('draft', 'failed') returning id`;
  if (!lock) throw new HttpError(409, 'plan_busy', '이미 만드는 중입니다 — 잠시 뒤 새로 고쳐 확인해 주세요');
  const ext: Record<string, any> = { ...(p.external ?? {}) };
  const warnings = [...pre.warnings, ...capWarnings(pl, cap, await monthSpend(t))]; // 승인함 카드에도 회사 월 상한 경고
  const save = (status: string, error: string | null) => sql`update mkt_ad_plans set status = ${status}, external = ${sql.json(ext as never)}, error = ${error}, updated_at = now() where id = ${id}`;
  try {
    // 1) 계정: 광고 만들기 권한·원화·활성
    const perms = await gm('GET', 'me/permissions', token);
    const granted = new Set((perms?.data ?? []).filter((x: any) => x.status === 'granted').map((x: any) => String(x.permission)));
    if (!granted.has('ads_management')) throw new HttpError(409, 'meta_scope', '광고 만들기 권한(ads_management)이 없습니다 — 광고 › 연결의 Meta 줄에서 [광고 만들기 권한으로 다시 연결]을 눌러 모두 허용해 주세요');
    const acc = await gm('GET', `act_${a.external_id}`, token, { fields: 'currency,account_status' });
    if (String(acc?.currency ?? '') !== 'KRW') throw new HttpError(409, 'meta_currency', `광고 계정 통화가 원(KRW)이 아닙니다(${String(acc?.currency ?? '?')}) — 지금은 원화 계정만 만듭니다`);
    if (Number(acc?.account_status) !== 1) throw new HttpError(409, 'meta_account', `광고 계정이 활성 상태가 아닙니다(상태 ${String(acc?.account_status ?? '?')}) — Meta 광고 관리자에서 확인해 주세요`);
    // 2) 리드 양식: 활성 + 개인정보처리방침 링크(못 읽으면 사람이 확인한 경우만)
    if (pl.objective === 'leads' && !ext.formChecked) {
      if (!page.token_enc) throw new HttpError(409, 'no_page_token', '페이지 토큰이 없습니다 — 연결 계정에서 페이지를 다시 연결해 주세요');
      const ptk = decrypt(page.token_enc);
      let form: any; let readPrivacy = true;
      try { form = await gm('GET', String(pl.leadFormId), ptk, { fields: 'id,name,status,privacy_policy_url' }); }
      catch { readPrivacy = false; form = await gm('GET', String(pl.leadFormId), ptk, { fields: 'id,name,status' }); }
      if (form?.status && String(form.status) !== 'ACTIVE') throw new HttpError(409, 'lead_form', `리드 양식이 활성 상태가 아닙니다(${String(form.status)}) — 다른 양식을 골라 주세요`);
      if (readPrivacy && !form?.privacy_policy_url) throw new HttpError(409, 'lead_privacy', '리드 양식에 개인정보처리방침 링크가 없습니다 — Meta 광고 관리자 › 양식에서 넣은 뒤 다시 눌러 주세요');
      if (!readPrivacy && !pl.privacyConfirmed) throw new HttpError(409, 'lead_privacy', "리드 양식의 개인정보처리방침 링크를 Meta 에서 읽지 못했습니다 — 양식에 링크가 있는지 확인하고 세팅안의 '확인했습니다'를 체크해 주세요");
      ext.formChecked = true; ext.formName = form?.name ? String(form.name).slice(0, 200) : null; ext.privacyUrl = form?.privacy_policy_url ?? null;
    }
    // 3) 소재 올리기(이미지 = bytes, 영상 = 서명 주소 1시간 → Meta 처리 끝나야 소재에 씀)
    if (!video && !ext.imageHash) {
      const buf = await getObject(file.storage_key);
      ext.imageText = await imageTextCheck(t, u.id, buf, file.mime_type);
      ext.imageHash = await uploadImage(a.external_id, token, buf);
    }
    if (video) {
      if (!ext.videoId) ext.videoId = idOf(await gm('POST', `act_${a.external_id}/advideos`, token, { file_url: abs(await downloadUrl(file.storage_key, file.file_name, true, 3600)), name: `${p.name} 소재` }), '영상');
      if (!ext.videoReady) {
        const v = await gm('GET', ext.videoId, token, { fields: 'status,picture' });
        const st = String(v?.status?.video_status ?? '');
        if (st === 'error') { delete ext.videoId; throw new HttpError(502, 'meta_video', 'Meta 가 영상을 처리하지 못했습니다 — 다른 파일로 바꿔 주세요'); }
        if (st !== 'ready') {
          await save('draft', '영상 처리 중 — 1~2분 뒤 [Meta에 초안 만들기]를 다시 누르면 이어서 만듭니다');
          return { ok: true, pending: true, message: 'Meta 가 영상을 처리하는 중입니다 — 1~2분 뒤 다시 눌러 주세요' };
        }
        ext.videoReady = true; ext.videoPicture = typeof v?.picture === 'string' ? v.picture : null;
      }
      if (pl.creative.thumbFileId && !ext.thumbHash) {
        const th = await creativeFile(u, pl.creative.thumbFileId);
        const buf = await getObject(th.storage_key);
        ext.imageText = await imageTextCheck(t, u.id, buf, th.mime_type);
        ext.thumbHash = await uploadImage(a.external_id, token, buf);
      }
    }
    if (ext.imageText?.note && (!ext.imageText.checked || ext.imageText.ratio > 20)) warnings.push(String(ext.imageText.note));
    // 4) 캠페인(PAUSED · 총 상한) → 광고 세트(PAUSED · 하루 예산·반경·나이·기간) → 소재 → 광고(PAUSED). 실패하면 이미 만든 번호는 남기고 다시 누르면 이어서
    if (!ext.campaignId) ext.campaignId = idOf(await gm('POST', `act_${a.external_id}/campaigns`, token, { name: p.name, objective: OBJECTIVE[pl.objective], status: 'PAUSED',
      special_ad_categories: [], spend_cap: pl.totalCap, buying_type: 'AUCTION', is_adset_budget_sharing_enabled: false }), '캠페인');
    if (!ext.adsetId) ext.adsetId = idOf(await gm('POST', `act_${a.external_id}/adsets`, token, adsetSpec(p.name, pl, ext.campaignId, page.external_id)), '광고 세트');
    if (!ext.creativeId) ext.creativeId = idOf(await gm('POST', `act_${a.external_id}/adcreatives`, token, { name: `${p.name} 소재`, object_story_spec: storySpec(pl, page.external_id, ext) }), '소재');
    if (!ext.adId) ext.adId = idOf(await gm('POST', `act_${a.external_id}/ads`, token, { name: `${p.name} 광고`, adset_id: ext.adsetId, creative: { creative_id: ext.creativeId }, status: 'PAUSED' }), '광고');
  } catch (e) {
    const msg = msgOf(e);
    await save('failed', msg);
    await sql`insert into mkt_ad_changes (tenant, plan_id, kind, after, status, error, actor_id) values (${t}, ${id}, 'create', ${sql.json({ ...ids(ext), paused: true } as never)}, 'failed', ${msg}, ${u.id})`;
    if (!(e instanceof HttpError)) await logError('meta-ads-draft', e, { planId: id }).catch(() => {});
    throw e instanceof HttpError ? e : badRequest('Meta 에 초안을 만들지 못했습니다');
  }
  ext.checks = { at: new Date().toISOString(), warnings };
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set status = 'created', external = ${tx.json(ext as never)}, error = null, updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, after, money_up, actor_id) values (${t}, ${id}, 'create', ${tx.json({ ...ids(ext), paused: true, dailyBudget: pl.dailyBudget, totalCap: pl.totalCap } as never)}, false, ${u.id})`;
  });
  await audit(sql, u.id, 'mkt_ads.meta_draft', 'mkt_ad_plan', id, ids(ext)).catch(() => {});
  await (await import('./spaceNotify')).notifySpace(sql, { tenant: t, space: 'marketing', approval: true, type: 'review_requested', role: p.brand_id ? { kind: 'marketing_brand', ref: p.brand_id } : null,
    title: `메타 광고 초안 승인 요청 (하루 ${won(pl.dailyBudget)} · 총 상한 ${won(pl.totalCap)})`, body: `${p.name} · ${pl.startDate} ~ ${pl.endDate} · ${pl.location.address} 반경 ${pl.location.radiusKm}km`,
    link: '/s/marketing/approvals?tab=ads', entityType: 'mkt_ad_plan', entityId: id, dedupeKey: `metaads:${id}`, push: true }).catch(() => {});
  return { ok: true, status: 'created', external: ids(ext), warnings };
}
/** 회사 월 광고비 상한과 견주기(로컬 10/23 4cde86d a — 저장·목록에서도 미리 알림): 초안은 꺼진 채라 막지 않음.
 * 켤 때(승인·다시 켜기)는 guardMoneyUp 이 다시 막고, 켜진 뒤 상한에 닿으면 adCapGuard 가 끔 */
export function capWarnings(p: Pick<MetaPlan, 'startDate' | 'endDate' | 'dailyBudget' | 'totalCap'>, cap: { monthlyCap: number } | null, spent: number, today = ymd()) {
  if (!cap) return ['회사 월 광고비 상한이 아직 없습니다 — 광고 운영 맨 위에서 정해야 Meta 에 초안을 만들 수 있습니다'];
  const w: string[] = []; const left = Math.max(0, cap.monthlyCap - spent);
  if (MIN_TOTAL_CAP > cap.monthlyCap) w.push(`메타 총 상한은 최소 ${won(MIN_TOTAL_CAP)}인데 회사 월 상한은 ${won(cap.monthlyCap)}입니다 — 이 광고는 회사 월 상한에 먼저 닿아 꺼집니다(총 상한까지 쓰려면 회사 월 상한을 올려 주세요)`);
  const [y, m] = today.split('-').map(Number); const monthEnd = `${today.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
  const from = p.startDate > today ? p.startDate : today; const to = p.endDate < monthEnd ? p.endDate : monthEnd;
  const inMonth = from <= to ? Math.min(p.totalCap, p.dailyBudget * days({ startDate: from, endDate: to })) : 0;
  if (inMonth > left) w.push(`이번 달 회사 월 상한 ${won(cap.monthlyCap)} 중 ${won(spent)}을 써서 남은 금액은 ${won(left)}입니다 — 이 광고는 이번 달 최대 ${won(inMonth)}까지 쓸 수 있어 상한에 닿으면 워크인이 끕니다${left <= 0 ? '(지금은 켤 수 없음)' : ''}`);
  return w;
}
/** 4cde86d b: [Meta에 초안 만들기] 때 Meta 에 물어봐야 하는 검사(세팅안 카드에 미리 표시 — 결과는 초안 뒤 카드·승인함에) */
export function draftTimeChecks(p: Pick<MetaPlan, 'objective' | 'creative'>, mime: string | null) {
  return ['광고 계정 권한·원화·활성 상태', ...(p.objective === 'leads' ? ['리드 양식 상태·개인정보처리방침 링크'] : []),
    ...(!String(mime ?? '').startsWith('video/') || p.creative.thumbFileId ? ['이미지 속 글자 비율'] : [])];
}
const ids = (ext: Record<string, any>) => ({ campaignId: ext.campaignId ?? null, adsetId: ext.adsetId ?? null, creativeId: ext.creativeId ?? null, adId: ext.adId ?? null });

// ---------------- 승인·집행(서버만) ----------------
/** 켜기 전에 다시 확인: 회사 월 상한(없거나 닿았으면 409) · Meta 쪽 총 상한·하루 예산이 승인할 값 이하 · 기간이 남음 → 광고 → 세트 → 캠페인 ACTIVE(중간 실패면 되돌림) */
async function activate(u: SessionUser, p: any, how: 'approve' | 'enable', revertOf: string | null = null) {
  const t = tenantOf(u); const sql = db(); const ext = p.external ?? {}; const pl = p.plan as MetaPlan;
  if (!ext.campaignId || !ext.adsetId || !ext.adId) throw new HttpError(409, 'plan_not_created', 'Meta 에 만든 초안이 없습니다');
  if (pl.endDate < ymd()) throw new HttpError(409, 'ended', '광고 기간이 끝났습니다 — 기간을 바꿔 새 초안을 만들어 주세요');
  await guardMoneyUp(t, pl.dailyBudget);
  const a = await adAccount(t, p.account_id); const token = tokenOf(a);
  const camp = await gm('GET', ext.campaignId, token, { fields: 'spend_cap,status' });
  const set = await gm('GET', ext.adsetId, token, { fields: 'daily_budget,status' });
  const cap = Number(camp?.spend_cap ?? 0), daily = Number(set?.daily_budget ?? 0);
  if (!cap || cap > pl.totalCap) throw new HttpError(409, 'cap_mismatch', `Meta 쪽 총 상한(${cap ? won(cap) : '없음'})이 승인할 값 ${won(pl.totalCap)}과 다릅니다 — 켜지 않았습니다`);
  if (!daily || daily > pl.dailyBudget) throw new HttpError(409, 'budget_mismatch', `Meta 쪽 하루 예산(${daily ? won(daily) : '없음'})이 승인할 값 ${won(pl.dailyBudget)}보다 큽니다 — 켜지 않았습니다`);
  const done: string[] = [];
  try {
    for (const oid of [ext.adId, ext.adsetId, ext.campaignId]) { await gm('POST', oid, token, { status: 'ACTIVE' }); done.push(oid); }
  } catch (e) {
    for (const oid of done.reverse()) await gm('POST', oid, token, { status: 'PAUSED' }).catch(() => {});
    await sql`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, status, error, actor_id, revert_of) values (${t}, ${p.id}, 'enable', ${sql.json({ paused: true })}, ${sql.json({ paused: false })}, true, 'failed', ${msgOf(e)}, ${u.id}, ${revertOf})`;
    throw e;
  }
  const after = { paused: false, dailyBudget: pl.dailyBudget, totalCap: pl.totalCap, metaCap: cap, ...(how === 'approve' ? { approved: true } : {}) };
  await sql.begin(async (tx) => {
    if (how === 'approve') await tx`update mkt_ad_plans set status = 'active', approved_by = ${u.id}, approved_at = now(), error = null, updated_at = now() where id = ${p.id}`;
    else await tx`update mkt_ad_plans set status = 'active', error = null, updated_at = now() where id = ${p.id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, revert_of) values (${t}, ${p.id}, 'enable', ${tx.json({ paused: true })}, ${tx.json(after as never)}, true, ${u.id}, ${revertOf})`;
  });
  await audit(sql, u.id, how === 'approve' ? 'mkt_ads.meta_approve' : 'mkt_ads.enable', 'mkt_ad_plan', p.id, { ...ids(ext), dailyBudget: pl.dailyBudget, totalCap: pl.totalCap }).catch(() => {});
  return { ok: true, status: 'active' };
}
/** 승인함 [승인하고 집행] — 관리자(돈이 나가는 변경) */
export async function approveMetaDraft(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const p = await planOf(tenantOf(u), id);
  if (p.status !== 'created') throw new HttpError(409, 'not_draft', '승인할 광고 초안이 아닙니다');
  return activate(u, p, 'approve');
}
export const rejectInput = z.object({ reason: z.string().trim().min(1, '반려 사유를 적어 주세요').max(500) });
/** 반려: 세팅안은 보관(반려 사유), Meta 에는 꺼진 채로 남음(돈 안 나감) */
export async function rejectMetaDraft(u: SessionUser, id: string, i: z.infer<typeof rejectInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id);
  if (!['created', 'draft', 'failed'].includes(p.status)) throw new HttpError(409, 'not_draft', '켜졌거나 이미 정리된 세팅안은 반려할 수 없습니다 — 끄기를 써 주세요');
  await sql.begin(async (tx) => {
    await tx`update mkt_ad_plans set status = 'archived', error = ${`반려: ${i.reason}`}, updated_at = now() where id = ${id}`;
    await tx`insert into mkt_ad_changes (tenant, plan_id, kind, after, status, actor_id) values (${t}, ${id}, 'approve', ${tx.json({ reason: i.reason, wasStatus: p.status })}, 'rejected', ${u.id})`;
  });
  await audit(sql, u.id, 'mkt_ads.meta_reject', 'mkt_ad_plan', id, { reason: i.reason }).catch(() => {});
  return { ok: true, status: 'archived' };
}

/** 광고 운영 [끄기]·[다시 켜기]·[하루 예산] — 끄기·내리기는 바로, 켜기·올리기는 관리자 + 상한 검사(adOps.actPlan 이 메타 세팅안이면 여기로) */
export async function actMetaPlan(u: SessionUser, id: string, i: { action: string; dailyBudget?: number }, revertOf: string | null = null): Promise<Record<string, unknown>> {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const p = await planOf(t, id); const ext = p.external ?? {}; const pl = p.plan as MetaPlan;
  if (i.action === 'enable') {
    if (p.status !== 'paused') throw new HttpError(409, 'not_paused', p.status === 'created' ? '광고 초안은 승인함에서 [승인하고 집행]으로 켭니다' : '꺼진 광고만 다시 켤 수 있습니다');
    return activate(u, p, 'enable', revertOf);
  }
  if (!['created', 'active', 'paused'].includes(p.status) || !ext.campaignId) throw new HttpError(409, 'plan_not_created', 'Meta 에 만든 뒤에 바꿀 수 있습니다');
  const a = await adAccount(t, p.account_id); const token = tokenOf(a);
  if (i.action === 'pause') {
    if (p.status !== 'active') throw new HttpError(409, 'not_active', '켜진 광고만 끌 수 있습니다');
    await gm('POST', ext.campaignId, token, { status: 'PAUSED' });
    await sql.begin(async (tx) => {
      await tx`update mkt_ad_plans set status = 'paused', updated_at = now() where id = ${id}`;
      await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, revert_of) values (${t}, ${id}, 'pause', ${tx.json({ paused: false })}, ${tx.json({ paused: true })}, false, ${u.id}, ${revertOf})`;
    });
    await audit(sql, u.id, 'mkt_ads.pause', 'mkt_ad_plan', id, ids(ext)).catch(() => {});
    return { ok: true, status: 'paused' };
  }
  if (i.action === 'budget') {
    const nb = Number(i.dailyBudget); if (!nb) throw badRequest('하루 예산을 넣어 주세요');
    if (nb > pl.totalCap) throw badRequest('하루 예산이 총 상한보다 클 수 없습니다');
    const moneyUp = nb > pl.dailyBudget;
    if (moneyUp && p.status === 'active') await guardMoneyUp(t, nb - pl.dailyBudget); // 증액 = 관리자 누름 + 상한 검사
    await gm('POST', ext.adsetId, token, { daily_budget: nb });
    await sql.begin(async (tx) => {
      await tx`update mkt_ad_plans set plan = ${tx.json({ ...pl, dailyBudget: nb } as never)}, updated_at = now() where id = ${id}`;
      await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, revert_of) values (${t}, ${id}, 'budget', ${tx.json({ dailyBudget: pl.dailyBudget })}, ${tx.json({ dailyBudget: nb })}, ${moneyUp}, ${u.id}, ${revertOf})`;
    });
    await audit(sql, u.id, 'mkt_ads.budget', 'mkt_ad_plan', id, { before: pl.dailyBudget, after: nb }).catch(() => {});
    return { ok: true, status: p.status };
  }
  throw new HttpError(409, 'meta_action', '메타 광고에서는 끄기·다시 켜기·하루 예산만 바꿀 수 있습니다');
}

// ---------------- tick: 성과 기준·월 상한 자동 일시정지 ----------------
/** 월 상한 도달(adOps.adCapGuard) — 메타 세팅안 캠페인 끄기. 돌려주는 값 = 끈 뒤 기록용 */
export async function pauseMetaCampaign(tenant: string, p: { id: string; account_id: string; external: any }) {
  const a = await adAccount(tenant, p.account_id);
  await gm('POST', String(p.external?.campaignId), tokenOf(a), { status: 'PAUSED' });
}
/** 켜진 메타 세팅안마다 2시간에 한 번 캠페인 누적 성과 → 리드당·클릭당 비용 기준을 넘으면(리드·클릭이 0이면 기준만큼 쓴 뒤) 끄기 + 기록·알림 */
export async function metaAutoTick(now = new Date()) {
  const sql = db(); let checked = 0, paused = 0;
  const plans = await sql<any[]>`select id, tenant, name, plan, external, account_id from mkt_ad_plans where provider = 'meta' and status = 'active' and jsonb_typeof(plan->'guard') = 'object' limit 100`;
  for (const p of plans) {
    const g = p.plan?.guard ?? {}; const pl = p.plan as MetaPlan;
    if (!g.maxCpl && !g.maxCpc) continue;
    const last = Date.parse(String(p.external?.guardAt ?? '')); if (!Number.isNaN(last) && now.getTime() - last < 2 * 3600e3) continue;
    try {
      const a = await adAccount(p.tenant, p.account_id); const token = tokenOf(a);
      const r = await gm('GET', `${p.external.campaignId}/insights`, token, { fields: 'spend,clicks,actions', date_preset: 'maximum' });
      const d = r?.data?.[0] ?? {};
      const spend = Number(d.spend ?? 0), clicks = Number(d.clicks ?? 0);
      const leads = (Array.isArray(d.actions) ? d.actions : []).filter((x: any) => LEAD_ACTIONS.has(String(x?.action_type))).reduce((s: number, x: any) => s + Number(x?.value ?? 0), 0);
      checked++;
      await sql`update mkt_ad_plans set external = external || ${sql.json({ guardAt: now.toISOString(), stats: { spend, clicks, leads, at: now.toISOString() }, guardError: null } as never)}::jsonb where id = ${p.id}`;
      if (spend < Number(g.minSpend ?? 30000)) continue;
      const over = (limit: number, n: number) => (n ? spend / n > limit : spend >= limit);
      const why = pl.objective === 'leads' && g.maxCpl && over(g.maxCpl, leads) ? { reason: 'cpl', value: leads ? Math.round(spend / leads) : null, limit: g.maxCpl }
        : g.maxCpc && over(g.maxCpc, clicks) ? { reason: 'cpc', value: clicks ? Math.round(spend / clicks) : null, limit: g.maxCpc } : null;
      if (!why) continue;
      await gm('POST', String(p.external.campaignId), token, { status: 'PAUSED' });
      await sql.begin(async (tx) => {
        await tx`update mkt_ad_plans set status = 'paused', updated_at = now() where id = ${p.id}`;
        await tx`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up) values (${p.tenant}, ${p.id}, 'auto_pause', ${tx.json({ paused: false })}, ${tx.json({ paused: true, ...why, spend, leads, clicks } as never)}, false)`;
      });
      const label = why.reason === 'cpl' ? '리드당 비용' : '클릭당 비용';
      await (await import('./spaceNotify')).notifySpace(sql, { tenant: p.tenant, space: 'marketing', approval: true, type: 'usage_alert',
        title: `메타 광고 자동 일시정지 — ${p.name}`, body: `${label} ${why.value != null ? won(why.value) : `(아직 ${why.reason === 'cpl' ? '리드' : '클릭'} 0)`} · 기준 ${won(why.limit)} · 쓴 돈 ${won(spend)}. 다시 켜려면 광고 운영에서 [다시 켜기]`,
        link: '/s/marketing/ad-ops', entityType: 'mkt_ad_plan', entityId: p.id, dedupeKey: `metaguard:${p.id}:${ymd(now)}` }).catch(() => {});
      paused++;
    } catch (e) {
      await sql`update mkt_ad_plans set external = external || ${sql.json({ guardAt: now.toISOString(), guardError: msgOf(e).slice(0, 300) } as never)}::jsonb where id = ${p.id}`.catch(() => {});
    }
  }
  return { checked, paused };
}
