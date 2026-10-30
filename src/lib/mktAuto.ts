import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { zUuid } from './api';
import { layoutBody, layoutCaption, placePhotos } from './mktText';
import { JSON_LIKE, avoidOf, voiceInput, factsInput, otherBrands, otherBrandNames, otherBrandLabels, activeNews, newsText, dayAdd, todayKst, factsOf,
  exampleInput, examplesOf, exampleKindOf, examplesPrompt, EXAMPLE_KINDS, EXAMPLE_PER_KIND } from './mktQuality';
import { FEED_STYLES, FEED_TEMPLATES, NEED_LABEL, TEMPLATE_IDS, feedInput, normalizeFeed } from './mktFeedTemplates';
import { tenantOf, type SessionUser } from './types';
import { customerText, seesInternals } from './customerScope';

/**
 * V41 4-3 + V43 마케팅 자동 제작(대표 방향 10/18): 브랜드·채널별 주간 규칙 → (게시 D-n 제작 시각) Claude 원고 + 이미지/영상 '제작 요청 카드'
 * → 자동 품질 검사 → 통과본만 승인함 → 알림(제작 완료 즉시 + 마감 N시간 전, 야간 무알림이면 직전 저녁) → 마감 지난 자동 시안은 정리.
 * 상업화(V43): 회사 요금제(금액 칸은 대표 결정 전 빈칸)·월/주 크레딧·생성 영상 편수·재생성 횟수, 고객·게시물·버전별 크레딧 원장, 수정 요청 분류(글자·배치 0 / 이미지·영상 재생성).
 * 이미지·영상 생성 엔진(Higgsfield API)은 계약(대표 결정) 뒤 — 지금은 카드에 실제 사용 크레딧을 기록하며 사람이 제작해 붙임.
 */
export const KIND_LABEL = { feed: '피드', blog: '블로그', reels: '릴스', video: '생성 영상', shorts: '쇼츠', story: '스토리', photo: '사진 게시물' } as const; // 대표 10/20 6): 쇼츠(유튜브 세로 영상)·스토리(세로 1080×1920·24시간) 추가 · 요청 C §3-1: 피드 = 카드뉴스 3~5장, 사진 1장짜리는 '사진 게시물'
/** 대표 10/20 6) 기본 묶음 — 2~3일에 한 번: 유튜브 쇼츠 · 인스타 릴스 · 블로그 · 인스타+페이스북 게시물(같은 글) · 인스타+페이스북 스토리 */
export const BUNDLE: { channel: string; kind: Kind; postTime: string; cross: string[] }[] = [
  { channel: 'instagram', kind: 'feed', postTime: '10:00', cross: ['facebook'] }, { channel: 'youtube', kind: 'shorts', postTime: '11:00', cross: [] }, { channel: 'instagram', kind: 'reels', postTime: '12:00', cross: [] },
  { channel: 'blog', kind: 'blog', postTime: '13:00', cross: [] }, { channel: 'instagram', kind: 'story', postTime: '18:00', cross: ['facebook'] }];
type Kind = keyof typeof KIND_LABEL;
/** 요금제(V43 3 안). price 는 대표 결정 전이라 null — 화면에 '결정 전' */
export const MKT_PLANS = {
  basic: { label: '베이직', weekly: { feed: 2, blog: 1 }, monthlyCredits: 30, videoMonthly: 0, regenMonthly: 2, aiMonthlyUsd: 3, price: null },
  standard: { label: '스탠다드', weekly: { feed: 3, blog: 1, reels: 1 }, monthlyCredits: 80, videoMonthly: 0, regenMonthly: 6, aiMonthlyUsd: 6, price: null },
  pro: { label: '프로', weekly: { feed: 5, blog: 2, reels: 2 }, monthlyCredits: 250, videoMonthly: 2, regenMonthly: 10, aiMonthlyUsd: 15, price: null },
} as const;
/** 제작 요청 카드 예상 크레딧(V43 1 실측): 실사 + 글자 렌더 0, 실사 릴스 0.5~3, 생성 영상 약 80, 재생성 이미지 6.5·영상 컷 7~22.5 */
const EST = { image: 0, video_reels: 3, video: 80, regen_image: 6.5, regen_video: 15 };

const DAY = 864e5;
const CROSS_LABEL: Record<string, string> = { facebook: '페이스북', instagram: '인스타그램', threads: '스레드' };
const CH_NAME: Record<string, string> = { ...CROSS_LABEL, blog: '블로그', youtube: '유튜브', naver_place: '네이버 플레이스' };
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const kst = (date: string, hhmm: string) => new Date(`${date}T${hhmm.length === 5 ? hhmm : hhmm.padStart(2, '0') + ':00'}:00+09:00`);
/** 서울 'HH:mm' */
const hm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const hourKst = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(d)) % 24;
const pad = (n: number) => String(n).padStart(2, '0');

/** 대표 10/20 15:40 (#103): 요금제 표는 DB(mkt_plan_limits, 플랫폼 운영에서 편집) — 없으면 코드 기본값 */
export type PlanRow = { code: string; label: string; price: number | null; weekly: Record<string, number>; monthlyCredits: number; videoMonthly: number; regenMonthly: number; aiMonthlyUsd: number | null; extraCreditKrw: number | null; writeTier: WriteTier | null };
export async function planTable(): Promise<Record<string, PlanRow>> {
  const rows = await db()<any[]>`select code, label, price_krw, monthly_credits::float8 monthly_credits, weekly, video_monthly, regen_monthly, ai_monthly_usd::float8 ai_monthly_usd, extra_credit_krw, write_tier from mkt_plan_limits`.catch(() => [] as any[]);
  const out: Record<string, PlanRow> = {};
  for (const [k, p] of Object.entries(MKT_PLANS)) { const r = rows.find((x) => x.code === k);
    out[k] = r ? { code: k, label: r.label, price: r.price_krw ?? null, weekly: r.weekly ?? {}, monthlyCredits: Number(r.monthly_credits), videoMonthly: r.video_monthly, regenMonthly: r.regen_monthly, aiMonthlyUsd: r.ai_monthly_usd ?? null, extraCreditKrw: r.extra_credit_krw ?? null, writeTier: r.write_tier ?? null }
      : { code: k, label: p.label, price: p.price, weekly: { ...p.weekly }, monthlyCredits: p.monthlyCredits, videoMonthly: p.videoMonthly, regenMonthly: p.regenMonthly, aiMonthlyUsd: p.aiMonthlyUsd, extraCreditKrw: null, writeTier: null }; }
  return out;
}
export type CreditCost = { imageCredits: number; videoCredits: number; krwPerCreditMin: number; krwPerCreditMax: number };
export async function creditCost(): Promise<CreditCost> {
  const [r] = await db()<{ value: Partial<CreditCost> }[]>`select value from app_settings where key = 'mkt_credit_cost'`.catch(() => [] as any[]);
  return { imageCredits: 6.5, videoCredits: 80, krwPerCreditMin: 43, krwPerCreditMax: 70, ...(r?.value ?? {}) };
}
export type MktSettings = { plan?: PlanRow | null; plan_code: keyof typeof MKT_PLANS | null; monthly_credits: number | null; weekly_credits: number | null; video_monthly: number | null; regen_monthly: number | null;
  approval_hour: number; lead_days: number; lead_hour: number; remind_hours: number; quiet_start: number; quiet_end: number; allow_generated_people: boolean; allow_slideshow: boolean; ai_label: string; notify_user_ids: string[] | null; ai_monthly_usd: number | null; auto_publish: boolean; auto_hold: boolean; write_tier: WriteTier | null;
  /** 대표 10/25 22:20(15-16): 전면 디벨롭 동안 자동 생성(정기 칸·제작·밤사이·주간 계획·운영 제안) 멈춤 — 203 마이그레이션으로 규칙 있는 회사는 켬 */ auto_pause: boolean;
  /** 요청 C §3-1(대표 10/25 22:20): 릴스·쇼츠·생성 영상 자동 제작 중단(영상 제작 방식 결정 #580 전까지) — 정기 칸·제작에서 영상 종류를 건너뜀, 사람이 누르는 제작은 그대로 */ video_pause: boolean;
  /** 189차(대표 #685): 사진이 모자라면 실사 참고로 생성(크레딧 사용) — 기본 꺼짐, 관리자가 켬(209 마이그레이션) */ photo_gen: boolean;
  /** 267차(대표 #795 '두서없이 올리지 말고 수정·보완 시간까지 고려해서'): 승인 올리는 방식 — weekly = 주 단위 묶음(batch_dow 요일 batch_hour 시에 다음 주 월~일 게시분을 한 번에) ·
   *  lead = 게시 lead_days 일 전 lead_hour 시에 한 건씩(예전 방식). 224 마이그레이션으로 쓰던 회사는 weekly */ approval_mode: 'weekly' | 'lead'; batch_dow: number; batch_hour: number;
  /** 270차 #809: 우리 회사(내부) 이미지·영상 생성 월 실제 비용 한도(원) — 값이 있으면 요금제 숫자 대신 이것으로만 막음(null = 요금제 숫자) */ cost_cap_krw: number | null; internal?: boolean;
  /** 267차: 승인 마감 = 게시 deadline_days 일 전 approval_hour:00(0 = 게시 당일 — 예전 방식) */ deadline_days: number };
const DEFAULTS: MktSettings = { plan_code: null, monthly_credits: null, weekly_credits: null, video_monthly: null, regen_monthly: null, approval_hour: 9, lead_days: 3, lead_hour: 13,
  remind_hours: 6, quiet_start: 22, quiet_end: 8, allow_generated_people: false, allow_slideshow: false, ai_label: 'AI 도움을 받아 제작했습니다', notify_user_ids: null, ai_monthly_usd: null, auto_publish: false, auto_hold: false, write_tier: null, auto_pause: false, video_pause: true, photo_gen: false,
  approval_mode: 'lead', batch_dow: 4, batch_hour: 10, deadline_days: 0, cost_cap_krw: null };
/** 270차 #809: 우리 회사(내부, 'default') — plans.ts 와 같은 기준 */
export const INTERNAL_TENANT = 'default';
/** 자동 생성 일시정지 중인가(정기 실행·목표/운영 제안 tick 이 먼저 본다) */
export const autoPaused = async (tenant: string) => !!(await settingsOf(tenant)).auto_pause;
export async function settingsOf(tenant: string): Promise<MktSettings> {
  const [s] = await db()<any[]>`select * from mkt_settings where tenant = ${tenant}`;
  const internal = tenant === INTERNAL_TENANT;
  if (!s) return { ...DEFAULTS, internal };
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const plan = s.plan_code ? (await planTable())[s.plan_code] ?? null : null; // #103: 요금제 숫자는 DB 표에서
  return { ...DEFAULTS, ...s, plan, monthly_credits: num(s.monthly_credits), weekly_credits: num(s.weekly_credits), ai_monthly_usd: num(s.ai_monthly_usd), cost_cap_krw: num(s.cost_cap_krw), internal };
}
/** 270차 #809: 내부 회사가 월 실제 비용 한도(원)를 정했으면 요금제 숫자(크레딧·영상 편수·재생성 횟수) 대신 그 금액으로만 막음 */
export const costMode = (s: Pick<MktSettings, 'internal' | 'cost_cap_krw'>) => !!s.internal && s.cost_cap_krw !== null;
/** 이번 달 이미지·영상 생성에 쓴 돈(원, 어림) = 쓴 크레딧 × 1크레딧 최고 단가 — 한도 비교는 넉넉하게(높게) 잡음 */
export async function monthGenKrw(tenant: string) {
  const [use, cc] = await Promise.all([usageOf(tenant), creditCost()]);
  return { krw: Math.round(use.monthCredits * cc.krwPerCreditMax), krwMin: Math.round(use.monthCredits * cc.krwPerCreditMin), credits: use.monthCredits, perCreditMax: cc.krwPerCreditMax };
}
export function limitsOf(s: MktSettings) {
  if (costMode(s)) return { monthlyCredits: null, weeklyCredits: null, videoMonthly: null, regenMonthly: null, aiMonthlyUsd: s.ai_monthly_usd ?? null };
  const p = s.plan ?? (s.plan_code ? MKT_PLANS[s.plan_code] : null);
  const monthly = s.monthly_credits ?? p?.monthlyCredits ?? null;
  return { monthlyCredits: monthly, weeklyCredits: s.weekly_credits ?? (monthly === null ? null : Math.round((monthly / 4.3) * 10) / 10),
    videoMonthly: s.video_monthly ?? p?.videoMonthly ?? null, regenMonthly: s.regen_monthly ?? p?.regenMonthly ?? null, aiMonthlyUsd: s.ai_monthly_usd ?? p?.aiMonthlyUsd ?? null };
}
/** 대표 10/24 추가 ①: 자동 제작 글(원고·약한 첫 줄 다시 쓰기·수정본·블로그) 모델 단계 — 회사 지정(플랫폼 운영) → 마케팅 요금제 → 빠른 모델. 품질 검사는 그대로 빠른 모델 */
export type WriteTier = 'fast' | 'default' | 'deep';
export const WRITE_TIER_LABEL: Record<WriteTier, string> = { fast: '빠른 모델', default: '표준 모델', deep: '최상 모델' };
export function writeTierOf(s: Pick<MktSettings, 'write_tier' | 'plan'>): { tier: WriteTier; source: 'company' | 'plan' | 'base' } {
  if (s.write_tier) return { tier: s.write_tier, source: 'company' };
  if (s.plan?.writeTier) return { tier: s.plan.writeTier, source: 'plan' };
  return { tier: 'fast', source: 'base' };
}
/** 글 1건 원가(원) 어림 — 최근 60일 자동 제작 원고의 평균 토큰(5건 미만이면 입력 5천·출력 1.5천)을 모델 단계별 단가로 */
export async function writeCostKrw(): Promise<Record<WriteTier, number>> {
  const P = await import('./ai/provider');
  const [r] = await db()<{ i: number | null; o: number | null; n: number }[]>`select avg(input_tokens)::float8 i, avg(output_tokens)::float8 o, count(*)::int n from ai_usage
    where purpose = 'marketing_produce' and input_tokens > 100 and created_at > now() - interval '60 days'`.catch(() => [] as { i: number | null; o: number | null; n: number }[]);
  const usage = r && r.n >= 5 && r.i && r.o ? { input_tokens: r.i, output_tokens: r.o } : { input_tokens: 5000, output_tokens: 1500 };
  const krw = (t: WriteTier) => Math.max(1, Math.round(P.costUsd(P.modelFor(t), usage) * P.usdKrw()));
  return { fast: krw('fast'), default: krw('default'), deep: krw('deep') };
}
const TIER_RANK: Record<WriteTier, number> = { fast: 0, default: 1, deep: 2 };
/** 로컬 10/24(대표 '대기업 수준 홍보'): 만드는 일(원고·시안 지시·말투·월 목표·캡션·카드뉴스·상황 매트릭스·광고 대본)은 글 모델로 — 원래 더 높은 모델을 쓰던 곳(floor)은 그보다 낮추지 않음. 숫자 요약·분석은 그대로 */
export async function makeTier(tenant: string, floor: WriteTier = 'fast'): Promise<WriteTier> {
  const t = writeTierOf(await settingsOf(tenant)).tier;
  return TIER_RANK[t] >= TIER_RANK[floor] ? t : floor;
}
/** #235 ⓑ(대표: '블로그만은 fast 대신 상위 모델 — 비용 차이를 표시'): 블로그 원고·수정본·제목 다시 쓰기는 표준 모델 이상 */
export const BLOG_TIER: WriteTier = 'default';
const isBlog = (c: { channel?: string | null; kind?: string | null }) => c.kind === 'blog' || c.channel === 'blog';
export function draftTierOf(s: Pick<MktSettings, 'write_tier' | 'plan'>, c: { channel?: string | null; kind?: string | null }): WriteTier {
  const t = writeTierOf(s).tier;
  return isBlog(c) && TIER_RANK[t] < TIER_RANK[BLOG_TIER] ? BLOG_TIER : t;
}
/** 블로그 1건 원가(원) 어림 — 1,800~2,500자 원고 + 사진 후보 목록(입력 7천·출력 3.5천 토큰) */
async function blogCostKrw(): Promise<Record<WriteTier, number>> {
  const P = await import('./ai/provider'); const usage = { input_tokens: 7000, output_tokens: 3500 };
  const krw = (t: WriteTier) => Math.max(1, Math.round(P.costUsd(P.modelFor(t), usage) * P.usdKrw()));
  return { fast: krw('fast'), default: krw('default'), deep: krw('deep') };
}
export async function writeModelInfo(s: Pick<MktSettings, 'write_tier' | 'plan'>) {
  const P = await import('./ai/provider');
  const w = writeTierOf(s); const cost = await writeCostKrw(); const bc = await blogCostKrw(); const bt = draftTierOf(s, { kind: 'blog' });
  return { ...w, label: WRITE_TIER_LABEL[w.tier], model: P.modelFor(w.tier), perDraftKrw: cost[w.tier], byTier: cost,
    blog: { tier: bt, label: WRITE_TIER_LABEL[bt], model: P.modelFor(bt), perDraftKrw: bc[bt], upgraded: bt !== w.tier, extraKrw: Math.max(0, bc[bt] - bc[w.tier]), byTier: bc } };
}
/** #103 회사 화면 '이번 달 남은 제작 n건' — 남은 크레딧을 이미지·영상 장수로 환산, 주간 종류별 한도 대비 이번 주 제작 수, 초과 안내(초과 크레딧 금액) */
export async function productionLeft(tenant: string) {
  const s = await settingsOf(tenant); const lim = limitsOf(s); const use = await usageOf(tenant); const cost = await creditCost();
  const plan = s.plan ?? null;
  const left = lim.monthlyCredits === null ? null : Math.max(0, Math.round((lim.monthlyCredits - use.monthCredits) * 10) / 10);
  const over = lim.monthlyCredits !== null && use.monthCredits >= lim.monthlyCredits;
  const today = ymd(new Date()); const dow = new Date(`${today}T12:00:00+09:00`).getUTCDay(); const weekStart = kst(ymd(new Date(Date.now() - ((dow + 6) % 7) * DAY)), '00:00'); const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
  const wk = await db()<{ kind: string; n: number }[]>`select coalesce(kind, 'feed') as kind, count(*)::int n from mkt_contents where tenant = ${tenant} and not is_test and status <> 'canceled' and scheduled_at >= ${weekStart} and scheduled_at < ${weekEnd} group by 1`;
  const weekly = costMode(s) ? [] : Object.entries(plan?.weekly ?? {}).map(([kind, limit]) => ({ kind, label: (KIND_LABEL as Record<string, string>)[kind] ?? kind, limit: Number(limit), used: wk.find((w) => w.kind === kind)?.n ?? 0 }));
  const extra = plan?.extraCreditKrw ?? null; const shortfall = lim.monthlyCredits === null ? 0 : Math.max(0, Math.round((use.monthCredits - lim.monthlyCredits) * 10) / 10);
  const gen = s.internal ? await monthGenKrw(tenant) : null; // 270차 #809
  return { internal: !!s.internal, costCapKrw: s.cost_cap_krw, monthGenKrw: gen?.krw ?? null, monthGenKrwMin: gen?.krwMin ?? null,
    planCode: s.plan_code, planLabel: plan?.label ?? null, monthlyCredits: lim.monthlyCredits, usedCredits: use.monthCredits, leftCredits: left, images: left === null ? null : Math.floor(left / cost.imageCredits), videos: left === null ? null : Math.floor(left / cost.videoCredits),
    videosLeft: lim.videoMonthly === null ? null : Math.max(0, lim.videoMonthly - use.monthVideos), regensLeft: lim.regenMonthly === null ? null : Math.max(0, lim.regenMonthly - use.monthRegens), weekly, over, shortfall, extraCreditKrw: extra,
    overMessage: over ? `이번 달 제작 크레딧 ${lim.monthlyCredits}을 모두 썼습니다${shortfall ? ` (초과 ${shortfall})` : ''}. ${extra ? `초과분은 1크레딧당 ${extra.toLocaleString('ko-KR')}원으로 추가 구매(${shortfall ? `${Math.ceil(shortfall * extra).toLocaleString('ko-KR')}원` : '필요 시'})` : '초과 크레딧 금액은 결정 전'} — 또는 요금제를 올려 주세요.` : null, cost };
}
/** 이번 달 마케팅 AI 비용($) — 자동 원고·캡션 초안 등 purpose 'marketing_%' */
export async function mktAiUsd(tenant: string) {
  const start = kst(`${ymd(new Date()).slice(0, 7)}-01`, '00:00');
  const [r] = await db()<{ usd: number; n: number }[]>`select coalesce(sum(cost_usd), 0)::float8 usd, count(*)::int n from ai_usage where tenant = ${tenant} and purpose like 'marketing%' and created_at >= ${start}`;
  return { usd: Math.round(r.usd * 10000) / 10000, requests: r.n };
}
/** 상용화 ⑦: 마케팅 AI 호출 전 한도 확인 — 크레딧 소진 차단 · 회사 월 AI 예산(원, 대표 10/24 ②)·예전 회사 한도($) · 회사 요금제 월 AI 요청 수 · 마케팅 월 한도($). 넘으면 429(정기 실행은 그 회사 제작을 멈추고 하루 한 번 알림)
 *  video = 영상 제작(기획·검수) — 마케팅 크레딧으로 따로 세므로 회사 AI 예산·요청 수는 보지 않는다 */
export async function assertMktAi(tenant: string, o: { video?: boolean } = {}) {
  const { HttpError } = await import('./errors');
  await (await import('./ai/guard')).assertAiCredit();
  if (!o.video) {
    const B = await import('./ai/companyBudget');
    const b = await B.companyAiBudget(tenant);
    if (b.over) throw new HttpError(429, 'ai_budget', `${B.budgetMessage(b)} — 마케팅 자동 제작도 멈췄습니다`);
    if (b.pct !== null && b.pct >= 80) await B.budgetAlerts(tenant, b).catch(() => {});
    const Pl = await import('./plans');
    const { limits } = await Pl.effectiveLimits(tenant);
    if (limits.aiRequests !== null && (await Pl.currentUsage(tenant)).aiRequests >= limits.aiRequests) throw new HttpError(429, 'ai_quota', `이번 달 회사 AI 요청 ${limits.aiRequests}회를 모두 써 마케팅 자동 제작을 멈췄습니다 — 관리 → 사용량·요금제`);
  }
  const cap = limitsOf(await settingsOf(tenant)).aiMonthlyUsd;
  if (cap !== null && (await mktAiUsd(tenant)).usd >= cap) throw new HttpError(429, 'mkt_ai_quota', `이번 달 마케팅 AI 한도($${cap})를 다 썼습니다 — 자동 제작 설정에서 한도를 올리거나 다음 달 1일에 다시 만듭니다`);
}
/** 이번 주(월요일 시작)·이번 달(서울) 사용량 */
export async function usageOf(tenant: string) {
  const today = ymd(new Date());
  const dow = new Date(`${today}T12:00:00+09:00`).getUTCDay();
  const weekStart = kst(ymd(new Date(Date.now() - ((dow + 6) % 7) * DAY)), '00:00');
  const monthStart = kst(`${today.slice(0, 7)}-01`, '00:00');
  const [r] = await db()<any[]>`select
      coalesce(sum(credits) filter (where created_at >= ${weekStart}), 0)::float8 as wk, coalesce(sum(credits) filter (where created_at >= ${monthStart}), 0)::float8 as mo,
      count(*) filter (where created_at >= ${monthStart} and kind = 'generate_video')::int as videos, count(*) filter (where created_at >= ${monthStart} and kind in ('regen_image', 'regen_video'))::int as regens
    from mkt_credit_ledger where tenant = ${tenant}`;
  return { weekCredits: r.wk, monthCredits: r.mo, monthVideos: r.videos, monthRegens: r.regens };
}

type DeadlineSet = Pick<MktSettings, 'approval_hour'> & { deadline_days?: number };
/** 승인 마감 = 게시 deadline_days 일 전(0 = 당일) approval_hour:00 — 267차 주 단위 묶음 회사는 게시 전날 18:00 */
export const deadlineOf = (scheduledAt: Date | string, s: DeadlineSet) => kst(ymd(new Date(new Date(scheduledAt).getTime() - (s.deadline_days ?? 0) * DAY)), `${pad(s.approval_hour)}:00`);
/** 화면·알림 말 — '게시 전날 18:00' · '게시 2일 전 18:00' · '게시 당일 09:00' */
export const deadlineRule = (s: DeadlineSet) => `게시 ${!s.deadline_days ? '당일' : s.deadline_days === 1 ? '전날' : `${s.deadline_days}일 전`} ${pad(s.approval_hour)}:00`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const addDay = (d: string, n: number) => ymd(new Date(Date.parse(`${d}T12:00:00+09:00`) + n * DAY));
/** 267차 주 단위 묶음: 그 주(월~일, 서울) 월요일 날짜 */
export const weekOf = (at: Date | string) => { const d = ymd(new Date(at)); return addDay(d, -((new Date(`${d}T12:00:00+09:00`).getUTCDay() + 6) % 7)); };
export const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** 그 주 게시분을 승인함에 한 번에 올리는 때 = 앞 주 batch_dow 요일 batch_hour:00(기본 목 10:00) */
export const batchAtOf = (week: string, s: Pick<MktSettings, 'batch_dow' | 'batch_hour'>) => kst(addDay(week, -(((1 - s.batch_dow + 7) % 7) || 7)), `${pad(s.batch_hour)}:00`);
/** 묶음 원고는 올리는 때 4시간 전부터 만들어 둠(올리는 때 한 번에 다 보이게) */
export const BATCH_PREP_H = 4;
/** 자동 칸 원고를 만들기 시작하는 때 — 주 단위 묶음은 그 주 묶음 4시간 전, 한 건씩은 게시 lead_days 일 전 lead_hour 시 */
export const produceAtOf = (at: Date, s: MktSettings) => s.approval_mode === 'weekly' ? new Date(batchAtOf(weekOf(at), s).getTime() - BATCH_PREP_H * 3600e3) : kst(ymd(new Date(at.getTime() - s.lead_days * DAY)), `${pad(s.lead_hour)}:00`);
/** 지금 다음에 오는 묶음 — 올리는 때·그 주(월~일) */
export function nextBatch(s: MktSettings, now = Date.now()) {
  if (s.approval_mode !== 'weekly') return null;
  for (let k = 7; k <= 21; k += 7) { const week = addDay(weekOf(new Date(now)), k); const at = batchAtOf(week, s); if (at.getTime() > now) return { at, week, label: `${md(week)}~${md(addDay(week, 6))} 게시분` }; }
  return null;
}
/** 알림 시각 = 마감 N시간 전. 야간(quiet_start~quiet_end)에 걸리면 그 밤이 시작되기 1시간 전(직전 저녁)으로 당김 */
export function remindAtOf(deadline: Date, s: Pick<MktSettings, 'remind_hours' | 'quiet_start' | 'quiet_end'>) {
  const t = new Date(deadline.getTime() - s.remind_hours * 3600e3);
  const h = hourKst(t); const qs = s.quiet_start, qe = s.quiet_end;
  const quiet = qs === qe ? false : qs > qe ? h >= qs || h < qe : h >= qs && h < qe;
  if (!quiet) return t;
  const eveningDay = qs > qe && h < qe ? ymd(new Date(t.getTime() - DAY)) : ymd(t);
  return kst(eveningDay, `${pad((qs + 23) % 24)}:00`);
}
export const isQuiet = (d: Date, s: Pick<MktSettings, 'quiet_start' | 'quiet_end'>) => { const h = hourKst(d); return s.quiet_start > s.quiet_end ? h >= s.quiet_start || h < s.quiet_end : h >= s.quiet_start && h < s.quiet_end; };

/** 자동 품질 검사(V43 6·7): 금지어·생성 인물을 실고객처럼(후기·체험담)·슬라이드쇼·확인 안 된 숫자. AI 표기는 없으면 자동으로 붙임 */
/** 채우지 않은 자리표시([브랜드]·[회사 이름]·[확인 필요] 등) — 고객에게 그대로 나가면 안 됨 */
export const PLACEHOLDER = /\[(?:시험\]\s*\[)?(브랜드|회사|상호|업체|이름|제품|상품|서비스|지역|주소|가격|금액|날짜|일시|기간|연락처|전화|링크|확인\s*필요|[^\]]{0,12}입력)[^\]]{0,12}\]/;
export function qualityCheck(body: string, brief: string, s: MktSettings, banned: string[], kind?: string | null, title = '') {
  const issues: string[] = [];
  const ph = `${title}\n${body}`.match(PLACEHOLDER);
  if (ph) issues.push(`채우지 않은 자리표시 '${ph[0]}'`);
  for (const w of banned) if (w && body.includes(w)) issues.push(`금지어 '${w}'`);
  if (!s.allow_generated_people && /(실제\s*(고객|회원)|고객\s*후기|회원\s*후기|체험담|"[^"]{5,}"\s*[-—]\s*\S+\s*(님|회원))/.test(body)) issues.push('생성 인물·후기를 실제 고객처럼 씀');
  if (!s.allow_slideshow && (kind === 'reels' || kind === 'video' || kind === 'shorts') && /슬라이드\s*쇼|사진\s*넘기기|느린\s*줌/.test(brief)) issues.push('슬라이드쇼(사진 + 느린 줌) 금지');
  if (emptyBody(body, s.ai_label)) return { passed: false, issues: [...issues, '본문이 비었거나 너무 짧음'], body: body.trim() }; // QA 10/24 ①: 빈 글에 AI 표시 줄만 붙여 '내용 있는 글'로 만들지 않음
  // 대표 10/25 22:20 결정 15-15: 'AI 도움을 받아 제작' 고지 줄을 붙이지 않는다(AI 기본법 제31조 위험 고지함 — 대표 판단). 예전 글에 남은 줄은 뗀다
  const fixed = (s.ai_label ? body.split(s.ai_label).join('') : body).replace(/\n{3,}/g, '\n\n').trim();
  return { passed: issues.length === 0, issues, body: fixed };
}

// ---------------- 정기 실행 ----------------
/** 규칙 → 앞으로 14일 게시 칸(초안) 만들기 — 같은 규칙·시각은 한 번만 */
export async function planSlots(tenant: string, days = 14) {
  const sql = db(); const s = await settingsOf(tenant);
  // 먼저 만든 규칙이 먼저(아래 하루 2건 검사에서 늦게 만든 규칙의 칸이 빠짐)
  const rules = await sql<any[]>`select r.*, b.name as brand, coalesce(b.test_mode, false) as test from mkt_rules r left join mkt_brands b on b.id = r.brand_id where r.tenant = ${tenant} and r.active order by r.created_at, r.id`;
  let made = 0;
  for (const r of rules) for (let k = 0; k <= days; k++) {
    if (s.video_pause && VIDEO_KINDS.includes(r.kind)) break; // 요청 C §3-1: 영상 자동 제작 중단 — 릴스·쇼츠·생성 영상 칸은 만들지 않음
    let date = ymd(new Date(Date.now() + k * DAY));
    if (r.interval_days) { // 대표 10/20 6): n일마다(시작일부터) — 요일 대신
      const anchor = r.anchor_date ? ymd(new Date(`${String(r.anchor_date).slice(0, 10)}T12:00:00+09:00`)) : ymd(new Date(r.created_at));
      const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${anchor}T00:00:00Z`)) / DAY);
      if (diff < 0 || diff % Number(r.interval_days) !== 0) continue;
      // 로컬 10/20 보완 ①: 주말 건너뛰기 — 토·일에 걸리면 다음 월요일(같은 날 두 칸은 (rule_id, scheduled_at) 로 하나만)
      if (r.skip_weekend) { const dow = new Date(`${date}T12:00:00+09:00`).getUTCDay(); if (dow === 6) date = ymd(new Date(Date.parse(`${date}T12:00:00+09:00`) + 2 * DAY)); else if (dow === 0) date = ymd(new Date(Date.parse(`${date}T12:00:00+09:00`) + DAY)); }
    } else {
      const dow = new Date(`${date}T12:00:00+09:00`).getUTCDay();
      if (!(r.weekdays as number[]).includes(dow)) continue;
    }
    const at = kst(date, r.post_time);
    if (deadlineOf(at, s).getTime() <= Date.now()) continue; // 승인 마감이 이미 지난 칸은 만들지 않음
    // 대표 10/24 ③ '하루 2건 = 브랜드 × 채널 × 형식마다 각각 2건': 규칙이 여럿이어도 같은 브랜드·채널·형식은 하루 2건까지·같은 시각/3시간 안 X(#540 과 같은 기준). 이미 만든 칸이면 아래 insert 도 어차피 건너뜀
    const peers = await slotPeers(sql, { id: NIL_ID, tenant, brand_id: r.brand_id, channel: r.channel, kind: r.kind }, date, date);
    if (peers.length && slotIssue({ topics: [], visuals: [] }, peers, at)) continue;
    let produce = produceAtOf(at, s); // 267차: 주 단위 묶음이면 그 주 묶음 4시간 전
    if (produce.getTime() < Date.now()) produce = new Date();
    const cross = (r.cross_channels ?? []) as string[];
    const title = `${r.test ? '[시험] ' : ''}${r.brand ? brandName({ name: r.brand }) + ' ' : ''}${KIND_LABEL[r.kind as Kind]}${cross.length ? '(함께 ' + cross.map((c) => CROSS_LABEL[c] ?? c).join('·') + ')' : ''} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
    const ins = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, rule_id, kind, auto, produce_at, is_test, cross_channels, mode)
      values (${tenant}, ${r.brand_id}, ${title}, ${r.channel}, ${at}, 'draft', 0, ${r.created_by}, ${r.id}, ${r.kind}, true, ${produce}, ${!!r.test}, ${cross}, ${r.mode ?? 'content'})
      on conflict (rule_id, scheduled_at) where rule_id is not null do nothing returning id`;
    made += ins.length;
  }
  return made;
}

/** 알림·승인 받는 사람: 설정에서 고른 사람(회사 안·활성) — 없으면 관리자 전원 */
export async function approvers(tenant: string) {
  // #100 담당자 지정 '승인자' 규칙이 있으면 그 사람(부재면 부 담당)
  const rule = await (await import('./assignees')).resolveAssignee(db(), tenant, 'approver', '').catch(() => null);
  if (rule) return [rule.userId];
  const s = await settingsOf(tenant);
  if (s.notify_user_ids?.length) return (await db()<{ id: string }[]>`select id from users where tenant = ${tenant} and status = 'active' and id = any(${s.notify_user_ids}::uuid[])`).map((r) => r.id);
  return (await db()<{ id: string }[]>`select id from users where tenant = ${tenant} and role in ('owner', 'admin') and status = 'active'`).map((r) => r.id);
}
/** #104 마케팅 알림 라우팅: 브랜드 담당(#100 규칙)에게 바로 · approval 이면 승인자에게도 · 시험 콘텐츠는 실행한 사람(없으면 규칙 만든 사람)에게만 · 담당 미지정은 관리자 1명 하루 묶음 */
export async function mktNotify(sql: any, c: { tenant: string; brand_id?: string | null; is_test?: boolean | null; created_by?: string | null }, actorId: string | null | undefined,
  n: Omit<import('./spaceNotify').SpaceNotifyInput, 'tenant' | 'space' | 'role' | 'test'>) {
  return (await import('./spaceNotify')).notifySpace(sql, { ...n, tenant: c.tenant, space: 'marketing', role: { kind: 'marketing_brand', ref: c.brand_id ?? '' }, test: c.is_test ? { actorId: actorId ?? c.created_by ?? null } : null });
}

/** 제작: Claude 원고(+ 이미지/영상은 제작 요청 카드) → 품질 검사 → 통과본 승인함 · 실패본 '수정 요청'(사유) */
/** 원고 재료(로컬 검수 10/18): 브랜드 키트(소개·주력 상품·이번 주 주제) · 회사 AI 프로필 · 마케팅 자료실 사진 설명 · 최근 게시 제목(겹치지 않게).
 *  내부 업무·일정은 넣지 않음(고객에게 나갈 글에 사내 정보가 섞이지 않게). */
const brandName = (b: any) => String(b?.name ?? '').replace(/^\s*\[시험\]\s*/, '').trim();
/** keep = 수정본(같은 글을 고침) — 그 글의 주제를 그대로 */
export async function materialOf(c: any, brand: any, rule: any, o: { keep?: boolean } = {}) {
  const sql = db();
  const { companyAi } = await import('./ai/persona');
  const co = await companyAi({ tenant: c.tenant } as SessionUser);
  const recent = await sql<{ title: string }[]>`select title from mkt_contents where tenant = ${c.tenant} and id <> ${c.id} and current_version > 0 and coalesce(brand_id::text, '') = ${c.brand_id ?? ''}
    order by coalesce(scheduled_at, created_at) desc limit 6`;
  // 대표 10/20 18:00 ②: 월 운영 목표(승인된 것)의 주간 주제 달력 — 로컬 QA 10/24 ③: 회사 공통 주제는 모든 브랜드에 같은 주제로 내려가지 않게 맨 뒤(pickTopic)
  const G = await import('./mktGoals');
  const day = c.scheduled_at ? G.ymd(new Date(c.scheduled_at)) : G.ymd(new Date());
  const goal = await G.goalFor(c.tenant, c.brand_id ?? null, day.slice(0, 7), sql).catch(() => null);
  const gweek = goal && goal.status !== 'pending' ? G.weekOf(goal.weekly ?? [], day) : null;
  const pick = await pickTopic(sql, c, brand, rule, goal && goal.status !== 'pending' ? goal : null, gweek, day, !!o.keep);
  const topic = pick.topic;
  const about = [brand?.intro, brand?.products, co.business].map((x) => String(x ?? '').trim()).filter(Boolean);
  // 로컬 21:45 버그: 다짐 스토리에 하이링크 주제 — 브랜드 글은 그 브랜드 재료만(브랜드 키트가 있으면 회사 공통 소개는 빼고, 다른 브랜드 이름은 금지)
  const ob = brand ? await otherBrands(c.tenant, brand.id) : []; const others = otherBrandNames(ob); // 137차: 영문·다른 이름(HILINK 등) 포함
  const brandOnly = !!brand && !!(brand.intro || brand.products);
  // #235 ⓒ 쓸 수 있는 사진 = 사진 AI 설명(없으면 자료실 설명) — 글자 든 그래픽·다른 브랜드 사진 빼고 이 브랜드 사진 먼저
  // #235 ⓑ 블로그 새 원고는 번호 붙은 본문 사진 후보(최대 20장) — 원고가 장면 순서로 '[사진 P번호]' 줄을 넣음. 블로그 수정본은 지난 원고의 사진 줄을 그대로 둠(목록 없음)
  const blog = c.kind === 'blog' || c.channel === 'blog';
  const blogPhotos = blog && !o.keep ? await (await import('./mktAutoVisual')).blogPhotoCandidates(c, `${c.title} ${topic}`).catch(() => [] as import('./mktAutoVisual').BlogPhoto[]) : [];
  const photos = blog ? [] : await (await import('./mktPhotos')).photoLines(c.tenant, brandName(brand), others);
  const Q = await import('./mktQuality'); const facts = Q.factsOf(brand?.facts); // 로컬 QA 10/24 ⑤ 사실 카드
  // 로컬 QA 10/24 ③: 같은 주 다른 브랜드 글 제목 — 같은 주제·같은 제목을 피하게
  const peers = c.brand_id ? await sql<{ title: string; brand: string }[]>`select x.title, b.name as brand from mkt_contents x join mkt_brands b on b.id = x.brand_id
    where x.tenant = ${c.tenant} and x.brand_id <> ${c.brand_id} and x.status <> 'canceled' and x.current_version > 0 and x.scheduled_at is not null
      and (x.scheduled_at at time zone 'Asia/Seoul')::date between ${day}::date - 3 and ${day}::date + 3 order by x.scheduled_at limit 8` : [];
  // #235 ⓓ 같은 브랜드 앞뒤 하루의 다른 글(같은 날 묶음·다른 채널 규칙) — 같은 주제여도 첫 줄·문장은 새로(QA: 페이스북·인스타 같은 글 그대로)
  const near = c.brand_id ? await sql<{ channel: string; kind: string | null; body: string }[]>`select x.channel, x.kind, v.body from mkt_contents x join mkt_versions v on v.content_id = x.id and v.version = x.current_version
    where x.tenant = ${c.tenant} and x.brand_id = ${c.brand_id} and x.id <> ${c.id} and x.status <> 'canceled' and x.current_version > 0
      and (coalesce(x.scheduled_at, x.created_at) at time zone 'Asia/Seoul')::date between ${day}::date - 1 and ${day}::date + 1 order by coalesce(x.scheduled_at, x.created_at) limit 6` : [];
  const firstLine = (t: string) => [...(t.split('\n').map((l) => l.replace(/(^|\s)#[^\s#]+/g, '').trim()).find((l) => l.length >= 4) ?? '')].slice(0, 60).join('');
  const lines = [
    `브랜드 이름: ${brandName(brand) || co.name || '(없음)'}`,
    co.name ? `회사: ${co.name}${co.industries?.length ? ` (${co.industries.join('·')})` : ''}` : '',
    brand?.intro ? `브랜드 소개: ${brand.intro}` : '',
    brand?.products ? `주력 상품·서비스: ${brand.products}` : '',
    co.business && !brandOnly ? `회사 사업 소개: ${co.business}` : '',
    co.customers && !brandOnly ? `주요 고객: ${co.customers}` : '',
    brand ? `이 글은 '${brandName(brand)}' 브랜드 전용 — ${ob.length ? `다른 브랜드(${otherBrandLabels(ob).join(', ')})의 상품·소식·이름·명의는 쓰지 않음` : '다른 브랜드 이야기는 쓰지 않음'}` : '',
    topic ? (pick.from === 'company' ? `이번 주 회사 공통 테마: ${topic} — 그대로 쓰지 말고 이 브랜드의 고객·상품에 맞는 구체적인 주제 하나로 바꿔 씀(다른 브랜드 글과 같은 주제·같은 제목 금지)` : `이번 글 주제: ${topic}`) : '',
    Q.factsText(facts),
    newsText(activeNews(facts, day)), // #235 ⓐ 이번 달 실제 소식
    goal && goal.status !== 'pending' ? `이달 운영 목표: ${(goal.goals?.objectives ?? []).join(' / ')}${goal.goals?.message ? ` · 핵심 메시지: ${goal.goals.message}` : ''}` : '',
    photos.length ? `쓸 수 있는 실사 사진(자료실 · AI 사진 설명 — 보이는 장면만 글에 씀):\n${photos.join('\n')}` : '',
    blogPhotos.length ? `[블로그 사진 후보 — 자료실 실사 · AI 사진 설명. 장면이 맞는 사진을 '[사진 P번호]' 한 줄로 넣고, 사진에 보이는 것만 글에 씀]\n${blogPhotos.map((p, k) => `P${k + 1}: ${p.caption}${p.scene ? ` — ${p.scene}` : ''}`).join('\n')}` : '',
    recent.length ? `최근 게시 제목(겹치지 않게):\n${recent.map((r) => `- ${r.title}`).join('\n')}` : '',
    peers.length ? `같은 주 다른 브랜드 글(같은 주제·제목을 피함):\n${peers.map((r) => `- ${brandName({ name: r.brand })}: ${r.title}`).join('\n')}` : '',
    near.length ? `이 브랜드 가까운 날 다른 글의 첫 줄(같은 주제여도 첫 줄·문장·구성은 새로 씀 — 그대로 옮기거나 낱말 몇 개만 바꾸지 않음):\n${near.map((r) => `- ${CH_NAME[r.channel] ?? r.channel}${r.kind ? ` ${KIND_LABEL[r.kind as Kind] ?? r.kind}` : ''}: ${firstLine(r.body)}`).join('\n')}` : '',
  ].filter(Boolean);
  // 주제가 없고 브랜드·회사 소개도 없으면 재료 부족 — 일반론 원고 대신 '주제 필요' 카드로 질문
  return { enough: !!topic || about.length > 0, text: lines.join('\n'), topic, topicFrom: pick.from, name: brandName(brand) || co.name, goal: goal && goal.status !== 'pending' ? goal : null, week: gweek, others, facts, blogPhotos };
}
type TopicFrom = 'answer' | 'kept' | 'goal' | 'brand' | 'news' | 'pool' | 'rule' | 'company' | '';
/** 로컬 QA 10/24 ③ 브랜드마다 주제(월 목표 주간 주제가 모든 브랜드에 내려가 18건이 같은 주제였음):
 *  답한 주제 → 이미 만든 글의 주제(수정본 · 다시 만들기는 이 규칙으로 고른 글만 — 예전 글은 회사 공통 주제였을 수 있어 다시 고름) → 이 브랜드 월 목표 주제 → 키트 '이번 주 주제' → 브랜드 주제 풀 → 규칙 주제 힌트 → 회사 공통 주간 주제(브랜드에 맞게 바꿔 쓰라는 안내와 함께).
 *  주제 풀: 같은 날 같은 브랜드 묶음(피드·쇼츠·릴스·블로그·스토리)은 같은 주제(한 메시지를 형식별로), 아니면 다른 브랜드가 앞뒤 3일 안에 쓴 주제는 건너뛰고 이 브랜드가 가장 오래 안 쓴 것 */
async function pickTopic(sql: any, c: any, brand: any, rule: any, goal: any, gweek: any, day: string, keep = false): Promise<{ topic: string; from: TopicFrom }> {
  const answered = String(c.quality?.topic ?? '').trim(); if (answered) return { topic: answered, from: 'answer' };
  const kept = c.produced_at && (keep || c.rationale?.topicFrom) ? String(c.rationale?.topic ?? '').trim() : '';
  if (kept) return { topic: kept, from: (c.rationale?.topicFrom as TopicFrom) || 'kept' };
  const week = String(gweek?.topic ?? '').trim(); const live = week && week !== '(지난 주)' ? week : '';
  if (live && goal?.brand_id && goal.brand_id === c.brand_id) return { topic: live, from: 'goal' };
  const kit = String(brand?.weekly_topic ?? '').trim(); if (kit) return { topic: kit, from: 'brand' };
  // #235 ⓐ 이번 달 실제 소식(사실 카드) — 주제 풀보다 먼저. 같은 날 묶음은 같은 소식, 한 소식은 이틀(알림·다시 알림)까지
  const news = activeNews(factsOf(brand?.facts), day);
  if (news.length && c.brand_id) {
    const [same] = await sql`select rationale->>'topic' as t from mkt_contents where tenant = ${c.tenant} and brand_id = ${c.brand_id} and id <> ${c.id} and status <> 'canceled'
      and rationale->>'topicFrom' = 'news' and (scheduled_at at time zone 'Asia/Seoul')::date = ${day}::date limit 1`;
    if (same?.t && news.some((n) => normTopic(n.text) === normTopic(same.t))) return { topic: same.t, from: 'news' };
    const days = new Map<string, number>((await sql`select rationale->>'topic' as t, count(distinct (scheduled_at at time zone 'Asia/Seoul')::date)::int as n from mkt_contents
      where tenant = ${c.tenant} and brand_id = ${c.brand_id} and id <> ${c.id} and status <> 'canceled' and rationale->>'topicFrom' = 'news' group by 1`).map((r: any) => [normTopic(r.t), Number(r.n)] as [string, number]));
    const fresh = news.filter((n) => (days.get(normTopic(n.text)) ?? 0) < 2).sort((a, b) => (days.get(normTopic(a.text)) ?? 0) - (days.get(normTopic(b.text)) ?? 0));
    if (fresh.length) return { topic: fresh[0].text, from: 'news' };
  }
  const pool = ((brand?.topic_pool ?? []) as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean);
  if (pool.length && c.brand_id) {
    const [same] = await sql`select rationale->>'topic' as t from mkt_contents where tenant = ${c.tenant} and brand_id = ${c.brand_id} and id <> ${c.id} and status <> 'canceled'
      and rationale->>'topicFrom' = 'pool' and (scheduled_at at time zone 'Asia/Seoul')::date = ${day}::date limit 1`;
    if (same?.t && pool.some((p) => normTopic(p) === normTopic(same.t))) return { topic: same.t, from: 'pool' };
    const busy = new Set((await sql`select distinct rationale->>'topic' as t from mkt_contents where tenant = ${c.tenant} and brand_id is distinct from ${c.brand_id} and status <> 'canceled'
      and rationale->>'topic' is not null and (scheduled_at at time zone 'Asia/Seoul')::date between ${day}::date - 3 and ${day}::date + 3`).map((r: any) => normTopic(r.t)));
    const used = new Map<string, number>((await sql`select rationale->>'topic' as t, max(coalesce(scheduled_at, created_at)) as at from mkt_contents where tenant = ${c.tenant} and brand_id = ${c.brand_id}
      and id <> ${c.id} and status <> 'canceled' and rationale->>'topicFrom' = 'pool' group by 1`).map((r: any) => [normTopic(r.t), new Date(r.at).getTime()] as [string, number]));
    const free = pool.filter((p) => !busy.has(normTopic(p)));
    return { topic: [...(free.length ? free : pool)].sort((a, b) => (used.get(normTopic(a)) ?? 0) - (used.get(normTopic(b)) ?? 0))[0], from: 'pool' }; // 같은 때면 풀 순서
  }
  const hint = String(rule?.topic_hint ?? '').trim(); if (hint) return { topic: hint, from: 'rule' };
  if (live) return { topic: live, from: goal?.brand_id ? 'goal' : 'company' };
  return { topic: '', from: '' };
}
/** 남은 [브랜드] 같은 자리표시는 아는 이름으로 바꿈 */
const fillName = (t: string, name: string) => (name ? t.replace(/\[(브랜드|브랜드\s*이름|브랜드명|회사|회사\s*이름|회사명|상호|업체명)\]/g, name) : t);

/** 로컬 QA 10/24 ①: 빈 글(공백·AI 표시 줄만)·JSON 모양 본문(JSON_LIKE, mktQuality)은 글로 저장하지 않음 */
export const emptyBody = (t: string, aiLabel?: string) => (aiLabel ? t.split(aiLabel).join('') : t).replace(/\s/g, '').length < 5;
type Draft = { title: string; body: string; brief: string; why: string; hooks: string[]; keyword: string; script: string[]; card?: import('./mktFeedTemplates').FeedCard; // card = #544 시안 그림 칸
  persona?: string; subKeywords?: string[]; photos?: string[]; // #235 ⓑ 블로그: 검색자 한 명·서브 키워드·본문 사진(글에 나온 순서의 자료실 id)
  pages?: import('./mktAutoVisual').CardPage[]; // 요청 C §3-1: 피드 카드뉴스 장(slides) · 스토리 프레임(frames) — 표지 뒤 장
  design?: { memory: number; guide: number } }; // 187차 ④ 지시문에 넣은 디자인 지침(줄)·기억(항목) 개수 — 노트 '반영: …'
/** 요청 C: 표지 뒤 장을 그리는 형식(피드 카드뉴스·스토리 프레임) — 인스타·페북만 */
const pagedKind = (c: { channel?: string | null; kind?: string | null }) => (c.kind === 'feed' || c.kind === 'story') && (c.channel === 'instagram' || c.channel === 'facebook');
const VIDEO_KINDS = ['reels', 'shorts', 'video'];
/** #426 훅 자리: 릴스·쇼츠·영상 = 첫 장면(3초), 블로그 = 제목, 그 밖 = 본문 첫 줄 */
const hookAt = (kind: string) => (VIDEO_KINDS.includes(kind) ? '첫 장면(첫 3초)' : kind === 'blog' ? '제목' : '본문 첫 줄');
export async function logAi(c: any, p: { name: string; model: string }, r: any, P: typeof import('./ai/provider')) {
  // 275차 #809: 어느 글(→ 브랜드)의 글 작성 비용인지 — 상용화 시험 보기가 브랜드별로 나눔(키트 AI 등 글 없는 호출은 비움)
  await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose, mkt_content_id)
    values (${c.tenant}, ${c.created_by}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_produce', ${c.id ?? null})`;
}
export const textOf = (r: any) => (r.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('');

async function writeDraft(c: any, s: MktSettings, brand: any, rule: any, extra?: { prev: string; comment: string; tier?: WriteTier }, mat?: Awaited<ReturnType<typeof materialOf>>): Promise<Draft> {
  const m = mat ?? (await materialOf(c, brand, rule, { keep: !!extra }));
  const P = await import('./ai/provider'); const Q = await import('./mktQuality');
  // 로컬 QA 10/24 ②·⑥: 블로그 1,800~2,500자 · 릴스·쇼츠는 대본(script)과 캡션(body)을 따로 · 스토리는 문구 1~2줄 + '스티커 제안:' 줄
  const kindRule = { feed: '인스타그램 피드 캡션 4~6줄 + 카드뉴스 3~5장(slides)', blog: '네이버 블로그 원고(제목 1줄 + 본문 1,800~2,500자 — 아래 네이버 블로그 형식대로)', reels: '인스타 릴스 — script 는 자막 대본(5~7컷, 컷마다 한 줄), body 는 게시 캡션 2~3줄만(컷 대본·장면 설명은 body 에 쓰지 않음)', video: '15~20초 광고 영상 — script 는 컷 구성(4~5컷), body 는 캡션 3줄만(컷은 body 에 쓰지 않음)', shorts: '유튜브 쇼츠(세로 영상 15~45초) — script 는 자막 대본(5~8컷, 컷마다 한 줄), title 은 쇼츠 제목 1줄, body 는 설명 2줄만(컷 대본은 body 에 쓰지 않음)', story: '인스타·페이스북 스토리(세로 1080×1920, 24시간) 3~5프레임(frames) — body 는 첫 프레임에 올릴 문구 1~2줄 + 마지막 줄 "스티커 제안: (투표·질문 스티커 내용)" 한 줄', photo: '인스타그램 사진 게시물(사진 1장) 캡션 3~5줄' }[c.kind as Kind] ?? '게시물 글';
  const video = VIDEO_KINDS.includes(c.kind); const blog = isBlog(c); const story = c.kind === 'story'; const paged = pagedKind(c); // 요청 C: 피드 = 카드뉴스 장 · 스토리 = 프레임
  const V = await import('./mktAutoVisual');
  if (!P.aiEnabled()) return { title: c.title, body: extra ? extra.prev : `[AI 비서 꺼짐] ${rule?.topic_hint ?? c.title}`, brief: '', why: '', hooks: [], keyword: '', script: [] };
  await assertMktAi(c.tenant);
  const p = P.anthropicProvider({ tier: extra?.tier ?? draftTierOf(s, c) }); // 대표 10/24 추가 ①: 회사·요금제가 정한 글 모델 · #235 ⓑ 블로그는 표준 모델 이상 · 255차 수정 요청 수정본은 최상 모델
  const contact = Q.contactLine(m.facts); // 로컬 QA 10/24 ⑤ 사실 카드 연락처
  const voice = Q.voicePrompt(brand?.voice);
  const ex = examplesPrompt(examplesOf(brand?.examples), exampleKindOf(c.channel, c.kind)); // #235 ⓔ 같은 형식 잘 된 예시 글(구성 참고)
  // #534 지난 수정 요청 사유(디자인 담당 기억) + 187차 ④ 대표가 적은 디자인 지침(회사 전체·브랜드) — 넣은 개수는 노트에 그대로
  const design = await (await import('./mktTeam')).designBrief(c.tenant, c.brand_id ?? null).catch(() => ({ text: '', memory: 0, guide: 0 }));
  const mem = design.text;
  const F = await import('./mktFeedTemplates'); // #544 피드 틀 칸(머리말·핵심·비교·강조 낱말·기간·가격 — 금액·기간은 재료에 있는 것만)
  // 187차 ⑤(대표 '표지 머리말이 다 같다'): 브랜드 키트 머리말을 채웠으면 그 값으로 고정 · 비웠으면 AI 가 글마다 — 게시 시각이 가까운 같은 브랜드 글 머리말과 겹치지 않게
  const kitKicker = String(brand?.feed?.kicker ?? '').trim();
  const nearKickers = video || kitKicker || !c.brand_id ? [] : (await db()<{ k: string }[]>`select quality->'card'->>'kicker' as k from mkt_contents
    where tenant = ${c.tenant} and brand_id = ${c.brand_id} and id <> ${c.id} and status <> 'canceled' and deleted_at is null and coalesce(quality->'card'->>'kicker', '') <> ''
    order by abs(extract(epoch from (coalesce(scheduled_at, created_at) - ${c.scheduled_at ? new Date(c.scheduled_at) : new Date()}::timestamptz))) limit 12`.catch(() => [])).map((r) => r.k);
  const kickerGuide = video ? '' : kitKicker ? `\n- card.kicker·kickerAlts: 빈 값으로 둡니다(브랜드 키트 머리말 '${kitKicker}'로 고정).`
    : `\n- card.kicker: 이 글 내용을 한마디로 줄인 표지 머리말(2~8자). 게시 시각이 가까운 같은 브랜드 글 머리말${nearKickers.length ? `(${[...new Set(nearKickers)].map((k) => `'${k}'`).join(', ')})` : ''}과 겹치지 않게. kickerAlts: 다른 후보 2개(역시 겹치지 않게).`;
  // #235 ⓑ(대표 노션 '네이버 블로그 자동 작성 툴'): 메인 키워드(지역+업종) 자리·횟수 · 서브 키워드는 소제목 · 검색자 한 명 · 한 문장 한 줄 · 300~400자마다 끊기 · 인용구 · 사진 8~15장(장면 순서) — 숫자는 글 품질 규칙표와 같음
  const R = (await Q.qualityRules()).blog; const kws = (m.facts.keywords ?? []).filter(Boolean); const nPh = m.blogPhotos?.length ?? 0;
  const blogGuide = !blog ? '' : `
- 네이버 블로그 형식(검색 상위 노출):
  · 메인 키워드 = 지역+업종(지역 이름 뒤에 업종 낱말)${kws.length ? ` — 사실 카드의 블로그 키워드(${kws.join(', ')}) 중 주제에 맞는 것 하나` : ' — 재료의 주소·지역과 업종으로'}. keyword 칸에 쓰고, 제목 맨 앞쪽(${R.titleFront}자 안)·첫 문단·마지막 문단에 꼭 넣으며 본문 전체에 ${R.keywordMin}~${R.keywordMax}번(문장에 자연스럽게).
  · 서브 키워드 2~3개(메인 키워드와 함께 찾는 말 — 가격·시간·처음·준비물처럼 재료에 있는 것) → subKeywords 칸. 소제목마다 하나씩 넣습니다.
  · 이 글을 검색한 사람 한 명을 정해 persona 칸에 한 줄(누가·어떤 상황에서). 첫 문단은 그 사람의 상황에 공감하고 이 글의 결론을 먼저 알려 줍니다.
  · 휴대폰에서 읽기 쉽게: 한 문장을 쓰면 줄을 바꾸고(한 줄에 한 문장) 3~5줄마다 빈 줄. 소제목은 "■ 소제목" 한 줄로 4~6개.
  · 300~400자마다 소제목·인용구·사진 줄 중 하나로 끊습니다 — 글자만 ${R.maxTextRun}자 넘게 이어지면 실패입니다.
  · 인용구 ${R.minQuotes}~${R.maxQuotes}개: “ ”로 감싼 한 줄(이 글의 요점 한 문장 — 고객 후기·남의 말처럼 지어내지 않음).
  · ${extra ? '지난 원고의 "[사진 n] …" 줄은 번호·설명·순서 그대로 둡니다(새 사진 줄을 만들지 않음).' : nPh ? `사진: [블로그 사진 후보]에서 장면이 맞는 사진을 골라 그 자리에 "[사진 P번호]" 한 줄만 씁니다(예: [사진 P3]) — ${nPh > R.minPhotos ? `${R.minPhotos}~${Math.min(R.maxPhotos, nPh)}장` : `후보 ${nPh}장 모두`}, 같은 사진 두 번 금지, 글 흐름(장면) 순서대로.` : '사진 후보가 없어 사진 줄은 쓰지 않습니다(표지·사진은 따로 붙임).'}`;
  const req: Parameters<typeof p.chat>[0] = {
    system: `회사 마케팅 담당 AI 비서입니다. ${kindRule}를 씁니다. JSON 만.
- 한국어, 브랜드 말투: ${brand?.tone || '친절하고 담백하게'}. 금지어: ${bannedOf(brand).join(', ') || '없음'}.
- 실사 사진 우선. ${s.allow_generated_people ? '' : '생성 인물을 실제 고객처럼 쓰지 않음(후기·체험담 지어내지 않음). '}${s.allow_slideshow ? '' : '슬라이드쇼(사진 + 느린 줌) 구성 금지. '}
- 아래 [재료]에 있는 사실만 씁니다. 숫자·연혁·실적·가격·날짜는 재료에 있는 값만 — 없으면 그 문장을 빼고, [확인 필요]·[브랜드] 같은 대괄호 자리표시는 절대 쓰지 않습니다. 과장·최상급 금지.
- 브랜드 이름은 '${m.name || '우리'}' 그대로 씁니다. 제목에 [시험] 같은 표시는 붙이지 않습니다.
- brief 에는 이미지/영상 제작 지시(실사 사진 + 글자 렌더 우선, 촬영 구도·필요한 사진)를 씁니다.
- why 에는 '왜 이 글인가'를 한 문장(이달 목표·이번 주 주제와 어떻게 이어지는지)으로 씁니다.
${Q.hookGuide(hookAt(c.kind), Q.asMode(c.mode))}
- keyword: ${blog ? '메인 키워드 1개(지역+업종, 2~15자)' : '검색 키워드 1개(재료의 브랜드·지역·상품에서, 2~12자)'}.${blogGuide}${video ? '\n- script: 컷 줄(화면 자막·내레이션) 배열 — 한 컷 2~4초(분당 300음절), 첫 컷은 3초 안, 마지막 컷은 첫 컷과 이어지게(반복 시청).' : `\n${F.CARD_GUIDE}${kickerGuide}`}${!paged ? '' : story
    ? '\n- frames: 스토리 3~5프레임 — 배열, 프레임마다 {title: 프레임 글 1줄(16자 안), body: 보조 글 1~2줄(각 24자 안, 줄바꿈으로 — 없으면 빈 문자열)}. 순서 = 질문(첫 프레임, body 첫 줄과 같은 문구) → 답 → 행동(마지막 프레임은 문의·저장·프로필 중 하나). 글자는 그림에 올라가므로 짧게.'
    : `\n- slides: 카드뉴스 3~5장 — 배열, 장마다 {role: cover|problem|solution|proof|cta 중 하나, title: 장 제목(16자 안), body: 본문 1~3줄(각 24자 안, 줄바꿈으로 — 없으면 빈 문자열)}. 순서 = cover(표지, 첫 줄 훅) → problem(공감) → solution(해결) → proof(근거 — 재료의 사실·숫자만) → cta(행동: 문의·저장·댓글 중 하나${contact ? `, 연락처 '${contact}'` : ''}). 글자는 그림에 올라가므로 짧게.`}${video || blog ? '' : `
- 캡션 가독성(한 눈에 읽히게): 첫 줄은 25자 안의 훅 한 줄 · 한 문장이 끝나면 줄을 바꿈(한 줄에 한 문장) · 문단은 3줄 안에서 끊고 문단 사이 빈 줄 · 나열은 화살표(→)·번호·체크(✓)로 · 이모지는 문단마다 1~2개만, 같은 이모지를 잇달아 쓰지 않음 · 강조는 【 】 · 해시태그는 맨 아래 한 줄에 5개 이하.`}
- 사람이 쓴 글처럼: 상투어(다양한·혁신적인·놓치지 마세요·지금 바로·~해 보는 건 어떨까요)·느낌표/이모지 나열·특수 대시(—)는 쓰지 않고, 문장 길이를 섞습니다.
- 문구 기준(표시광고법·신뢰): 최고·1위·유일·최초·100%·무조건·완벽·국내 최대는 [재료]에 근거가 없으면 쓰지 않고, 효과·결과를 단정하지 않으며(매출 2배 보장 같은 말), 다른 회사를 깎아내리지 않습니다. 차세대·올인원 솔루션·시너지·극대화 같은 빈 말도 쓰지 않습니다.
- 요금·무료 범위·가격·혜택·기간은 [재료]의 상품 설명·[사실 카드]에 적힌 그대로만 씁니다(추측해서 바꾸지 않음). 한 브랜드 글에 다른 브랜드의 이름·명의를 섞지 않습니다.
- 글 한 편에 대상 1명·상황 1개·행동(권유) 1개 — 문의·예약·저장·댓글 가운데 하나만 요청합니다.
- 연락처: ${contact ? `[사실 카드]의 '${contact}'를 본문 마지막 줄에 그대로 씁니다(스토리 제외)` : '재료에 없는 전화번호·링크는 지어내지 않습니다'}. '이미지 참조'·'이미지에 안내된 연락처'·'사진 속 번호'처럼 연락처를 그림으로 돌리지 않습니다.
- 채널 틀: 인스타·페이스북은 첫 줄(약 125자 안)에 핵심·해시태그 5개 이하·행동 권유 1개, 블로그는 검색 키워드를 제목과 첫 문단에, 숏폼·릴스는 첫 3초 질문으로 열고 마지막에 행동 권유 하나.${voice ? `\n${voice}` : ''}${ex ? `\n${ex}` : ''}${mem ? `\n${mem}` : ''}`,
    tools: [], messages: [{ role: 'user', content: `[재료]\n${m.text}\n\n` + (extra ? `[지난 원고]\n${extra.prev}\n\n[수정 요청]\n${extra.comment}\n\n수정 요청을 반영해 다시 써 주세요.` : `채널: ${c.channel}\n게시일: ${ymd(new Date(c.scheduled_at))}\n주제: ${m.topic || '재료의 브랜드·상품 소개에서 이번 주에 알릴 만한 것 하나'}`) }],
    format: { type: 'object', additionalProperties: false, required: ['title', 'body', 'brief', 'why', 'hooks', 'keyword', ...(video ? ['script'] : ['card']), ...(blog ? ['persona', 'subKeywords'] : []), ...(paged ? [story ? 'frames' : 'slides'] : [])],
      properties: { title: { type: 'string' }, body: { type: 'string' }, brief: { type: 'string' }, why: { type: 'string' }, hooks: { type: 'array', items: { type: 'string' } }, keyword: { type: 'string' }, ...(video ? { script: { type: 'array', items: { type: 'string' } } } : { card: F.CARD_FORMAT }),
        ...(blog ? { persona: { type: 'string' }, subKeywords: { type: 'array', items: { type: 'string' } } } : {}),
        ...(paged ? (story ? { frames: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string' }, body: { type: 'string' } } } } }
          : { slides: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['role', 'title', 'body'], properties: { role: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } } } }) : {}) } },
  };
  const strip = (t: string) => fillName(t.replace(/^\s*\[시험\]\s*/, ''), m.name);
  const arr = (x: unknown) => (Array.isArray(x) ? x.map((y) => fillName(String(y ?? ''), m.name).trim()).filter(Boolean) : []);
  // 로컬 QA 10/24 ①: 형식이 깨진 답(길이 초과로 잘림·JSON 아님·본문이 비었거나 JSON 모양)은 본문에 넣지 않음 — 한 번 다시, 그래도면 '제작 실패'
  const parse = (r: any): Draft | null => {
    if (r.stop_reason === 'max_tokens') return null;
    let o: any; try { o = JSON.parse(textOf(r)); } catch { return null; }
    if (!o || typeof o !== 'object' || emptyBody(String(o.body ?? ''), s.ai_label) || JSON_LIKE.test(String(o.body ?? ''))) return null;
    const text = fillName(String(o.body ?? ''), m.name);
    // 요청 C §3-4 캡션 가독성: 피드·스토리·사진 게시물(인스타·페북)은 한 문장 한 줄·문단 3줄·해시태그 맨 아래로 다시 배치 · 블로그는 네이버 형식 · 나머지는 그대로
    const caption = !video && !blog && ['feed', 'story', 'photo'].includes(c.kind) && c.channel !== 'threads';
    const laid = blog ? layoutBody('blog', text) : caption ? layoutCaption(text) : layoutBody(c.kind, text);
    // #235 ⓑ 사진 줄: 새 원고 '[사진 P번호]' → '[사진 n] AI 사진 설명'(글에 나온 순서) · 수정본은 지난 원고의 사진 줄을 번호로 되살림
    const ph = blog ? placePhotos(laid, m.blogPhotos ?? [], extra?.prev ?? '', R.maxPhotos) : null;
    return { title: strip(String(o.title || c.title)).slice(0, 200), body: ph ? ph.body : laid, brief: fillName(String(o.brief ?? ''), m.name), why: fillName(String(o.why ?? ''), m.name).slice(0, 300), hooks: arr(o.hooks).slice(0, 3), keyword: String(o.keyword ?? '').trim().slice(0, 30), script: arr(o.script).slice(0, 12), card: video ? undefined : F.pickKicker(F.cardFrom(o.card, m.text), o.card?.kickerAlts, nearKickers, kitKicker),
      ...(blog ? { persona: fillName(String(o.persona ?? ''), m.name).trim().slice(0, 120), subKeywords: arr(o.subKeywords).map((x) => x.slice(0, 30)).slice(0, 3), photos: ph?.ids ?? [] } : {}),
      ...(paged ? { pages: V.pagesFrom(story ? o.frames : o.slides, story).map((p) => ({ ...p, title: fillName(p.title, m.name), body: fillName(p.body, m.name) })) } : {}) };
  };
  let d: Draft | null = null;
  for (let k = 0; k < 2 && !d; k++) { const r = await p.chat(req); await logAi(c, p, r, P); d = parse(r); }
  if (!d) { const { HttpError } = await import('./errors'); throw new HttpError(502, 'draft_invalid', '원고 형식이 두 번 다 깨져 본문에 넣지 않았습니다(제작 실패)'); }
  return { ...d, design: { memory: design.memory, guide: design.guide } };
}

/** #426 약한 훅 다시 쓰기 — 후보 3개가 모두 탈락했을 때 한 번만 */
async function rewriteHooks(c: any, brand: any, cur: string, prev: string[], why: string): Promise<string[]> {
  const P = await import('./ai/provider'); const Q = await import('./mktQuality');
  if (!P.aiEnabled()) return [];
  await assertMktAi(c.tenant);
  const p = P.anthropicProvider({ tier: draftTierOf(await settingsOf(c.tenant), c) }); // 원고와 같은 글 모델(블로그는 표준 모델 이상)
  const design = await (await import('./mktTeam')).designBrief(c.tenant, c.brand_id ?? null).catch(() => null); // 187차 ④ 원고와 같은 디자인 지침·기억
  const r = await p.chat({
    system: `회사 마케팅 담당 AI 비서입니다. 약한 훅을 다시 씁니다. JSON 만.\n${Q.hookGuide(hookAt(c.kind), Q.asMode(c.mode))}\n- 브랜드 말투: ${brand?.tone || '친절하고 담백하게'}. 재료에 없는 숫자·결과·가격은 쓰지 않습니다.${design?.text ? `\n${design.text}` : ''}`,
    tools: [], messages: [{ role: 'user', content: `글 제목: ${c.title}\n지금 훅: ${cur}\n앞서 낸 후보(모두 약함): ${prev.join(' / ') || '(없음)'}\n약한 이유: ${why}\n\n${Q.asMode(c.mode) === 'ad' ? '누구에게(직업·상황·단지를 구체적으로) 무엇을 주는지(제안·혜택·가격 — 재료에 있는 것만) 2초 안에 말하는 광고형 훅' : '더 구체적이고(숫자·장면·대상) 궁금하게 만드는 훅'} 3개를 다시 써 주세요.` }],
    format: { type: 'object', additionalProperties: false, required: ['hooks'], properties: { hooks: { type: 'array', items: { type: 'string' } } } },
  });
  await logAi(c, p, r, P);
  try { const o = JSON.parse(textOf(r)); return (Array.isArray(o.hooks) ? o.hooks : []).map((x: unknown) => String(x ?? '').trim()).filter(Boolean).slice(0, 3); } catch { return []; }
}

/**
 * #426 글 품질 엔진: 상투어 사전·보이지 않는 문자·특수 대시 정리 → 인스타 해시태그 상한 → 지금 훅이 탈락이면 통과한 후보로(점수는 거르기용 — 통과한 훅끼리는 AI 순서)
 * → 후보가 모두 탈락이면 AI 로 한 번 더 → 보고서(사람다움·훅 3개 점수·채널 검사·초 단위 구성표). 막는 문제(채널 error)는 errors 로
 */
async function refineDraft(c: any, d: Draft, brand: any, opt: { keepTitle?: boolean } = {}) {
  const Q = await import('./mktQuality'); const rules = await Q.qualityRules();
  const notes: string[] = []; let title = d.title; let body = Q.humanize(d.body, rules).text; const script = [...d.script];
  const video = VIDEO_KINDS.includes(c.kind);
  // 로컬 QA 10/24 ⑥: 릴스·쇼츠·영상은 캡션(게시 글)과 컷 대본을 나눔 — 인스타 첫 125자가 대본으로 채워지지 않게 · 스토리는 '스티커 제안:' 줄 모양을 맞춤
  if (video) { const sp = Q.splitScript(body, script); if (sp.script.length >= 2) { if (script.length < 2) script.splice(0, script.length, ...sp.script); body = sp.caption; if (sp.moved) notes.push(`컷 대본 ${sp.moved}줄을 캡션에서 대본 칸으로 옮김`); } }
  if (c.kind === 'story') body = Q.normalizeSticker(body);
  // 해시태그 상한: 인스타·페이스북·스레드(같이 올리는 채널 포함)
  const social = ['instagram', 'facebook', 'threads'];
  if (social.includes(c.channel) || ((c.cross_channels ?? []) as string[]).some((x) => social.includes(x))) { const t = Q.trimHashtags(body, rules.instagram.hashtags); if (t.removed) { body = t.body; notes.push(`해시태그 ${t.removed}개 뺌(최대 ${rules.instagram.hashtags}개)`); } }
  // 로컬 QA 10/24 ⑤: 사실 카드 연락처가 글에 없으면 마지막 줄에(스토리·스레드 제외 — '이미지 참조' 대신 글 안에 직접)
  const facts = Q.factsOf(brand?.facts); const line = Q.contactLine(facts);
  if (c.kind !== 'story' && c.channel !== 'threads' && line && !Q.contactIn(body, facts)) { body = withContact(body, line); notes.push(`연락처 줄을 붙임(사실 카드: ${line})`); }
  if (video && script.length < 2) script.splice(0, script.length, ...Q.scriptLines(body));
  const kw = [brandName(brand)].filter(Boolean); const mode = Q.asMode(c.mode); // #499-1 콘텐츠형/광고형 채점 따로
  let hooks = d.hooks;
  const cur = Q.hookOf(c.kind, title, body, script); const curScore = cur ? Q.scoreHook(cur, rules, kw, mode) : null;
  if (cur && curScore && !curScore.pass && hooks.length && !(c.kind === 'blog' && opt.keepTitle)) {
    let best = hooks.find((h) => h !== cur && Q.scoreHook(h, rules, kw, mode).pass);
    if (!best) {
      const why = [...curScore.fails, ...(curScore.notes ?? []), ...Object.entries(curScore.parts).filter(([, v]) => !v).map(([k]) => ({ front: '앞부분이 흐림', specific: '구체성(숫자·장면) 없음', stakes: '걸린 것(손해·변화) 없음', callout: '대상 호명 없음', curiosity: '궁금증 없음', offer: '제안(무엇을 주는지) 없음' } as Record<string, string>)[k])].join(', ');
      const more = await rewriteHooks(c, brand, cur, hooks, why).catch(() => [] as string[]);
      if (more.length) { hooks = more; best = more.find((h) => Q.scoreHook(h, rules, kw, mode).pass); }
    }
    if (best) {
      if (c.kind === 'blog') title = best;
      else { if (body.includes(cur)) body = body.replace(cur, () => best!); if (video && script.length) script[0] = best; }
      notes.push(`약한 훅(${curScore.score}점)을 바꿈: '${[...cur].slice(0, 30).join('')}' → '${[...best].slice(0, 30).join('')}'`);
    } else notes.push(`훅 후보가 모두 약함(${curScore.score}점) — 다른 훅으로 수정 요청해 주세요`);
  }
  const rep = Q.qualityReport({ channel: c.channel, kind: c.kind, title, body, hooks, script, keywords: kw, mainKeyword: d.keyword || null, subKeywords: d.subKeywords, persona: d.persona, voice: brand?.voice, cross: c.cross_channels ?? [], mode }, rules);
  return { title, body: rep.body, script, report: { ...rep.report, notes }, errors: rep.report.channel.filter((x) => x.level === 'error').map((x) => x.msg), timing: rep.report.timing ? Q.timingText(rep.report.timing) : '' };
}
/** 연락처 줄을 본문 끝(해시태그 줄 앞)에 */
function withContact(body: string, line: string) {
  const ls = body.split('\n'); let k = ls.length;
  while (k > 0 && (!ls[k - 1].trim() || /^(?:#[^\s#]+\s*)+$/.test(ls[k - 1].trim()))) k--;
  const tail = ls.slice(k).filter((l) => l.trim());
  return [...ls.slice(0, k), line, ...(tail.length ? ['', ...tail] : [])].join('\n').trim();
}
/** 로컬 QA 10/24 ②: 올리기 전 자동 검사 — 걸리면 승인함 대신 '수정 요청'(이유와 함께). 다른 브랜드 이름·사실 카드는 이 브랜드 기준 */
async function preflightOf(c: any, brand: any, s: MktSettings, x: { title: string; body: string; script?: string[] | null }) {
  const Q = await import('./mktQuality');
  const others = otherBrandNames(await otherBrands(c.tenant, brand?.id));
  return Q.preflight({ channel: c.channel, kind: c.kind, title: x.title, body: x.body, isTest: !!c.is_test, aiLabel: s.ai_label, facts: Q.factsOf(brand?.facts), otherBrands: others, brandName: brandName(brand), script: x.script ?? null, cross: c.cross_channels ?? [],
    siblings: await Q.siblingPosts(c.tenant, c), // #235 ⓓ 채널별 같은 글
    examples: examplesOf(brand?.examples).map((e) => e.text), allow: [brand?.intro, brand?.products, Q.factsText(Q.factsOf(brand?.facts))].filter(Boolean) }, await Q.qualityRules()); // #235 ⓔ 예시 베끼기
}
const bannedOf = (brand: any): string[] => [...(brand?.banned_words ?? []), ...avoidOf(brand?.voice)];

/** 제작 요청 카드 — 한도를 넘으면 needs_approval(제작 전 승인 요청) */
export async function requestCard(c: any, version: number, kind: 'image' | 'video' | 'regen_image' | 'regen_video', brief: string, est: number, tx?: any, o: { ask?: boolean } = {}) {
  const sql = tx ?? db(); const s = await settingsOf(c.tenant); const lim = limitsOf(s); const use = await usageOf(c.tenant);
  let reason: string | null = null;
  if (kind === 'video' && est >= EST.video && lim.videoMonthly !== null && use.monthVideos >= lim.videoMonthly) reason = `이번 달 생성 영상 ${lim.videoMonthly}편을 다 썼습니다`;
  else if (kind.startsWith('regen') && lim.regenMonthly !== null && use.monthRegens >= lim.regenMonthly) reason = `이번 달 재생성 ${lim.regenMonthly}회를 다 썼습니다 — 추가 1회 = 약 ${est}크레딧`;
  else if (est > 0 && lim.weeklyCredits !== null && use.weekCredits + est > lim.weeklyCredits) reason = `이번 주 크레딧 한도(${lim.weeklyCredits}) 초과 예상 — 약 ${est}크레딧`;
  else if (est > 0 && costMode(s)) { // 270차 #809 내부 회사: 월 실제 비용 한도(원)
    const g = await monthGenKrw(c.tenant); const add = Math.round(est * g.perCreditMax);
    if (g.krw + add > (s.cost_cap_krw ?? 0)) reason = `이번 달 이미지·영상 생성 비용 한도 ${(s.cost_cap_krw ?? 0).toLocaleString('ko-KR')}원을 넘습니다(지금 약 ${g.krw.toLocaleString('ko-KR')}원, 이번 제작 약 ${add.toLocaleString('ko-KR')}원)`;
  }
  if (o.ask) { // 255차 #792: 수정 요청으로 영상·AI 이미지를 다시 만들 때는 늘 대표 승인 먼저 — 비용(크레딧·원)과 이번 달 남은 수
    const cc = await creditCost(); const won = `약 ${Math.round(est * cc.krwPerCreditMin).toLocaleString('ko-KR')}~${Math.round(est * cc.krwPerCreditMax).toLocaleString('ko-KR')}원`;
    const videosLeft = lim.videoMonthly === null ? null : Math.max(0, lim.videoMonthly - use.monthVideos); const regensLeft = lim.regenMonthly === null ? null : Math.max(0, lim.regenMonthly - use.monthRegens);
    const left = kind === 'regen_video' ? `이번 달 남은 영상 ${videosLeft ?? '제한 없음'}${videosLeft === null ? '' : '편'} · 재생성 ${regensLeft ?? '제한 없음'}${regensLeft === null ? '' : '회'}` : `이번 달 남은 재생성 ${regensLeft ?? '제한 없음'}${regensLeft === null ? '' : '회'}`;
    reason = `${reason ? `${reason} · ` : ''}다시 만들기 약 ${est}크레딧(${won}) · ${left} — 승인하면 제작`;
  }
  const [q] = await sql<{ id: string }[]>`insert into mkt_production_requests (tenant, content_id, version, kind, brief, est_credits, status, reason)
    values (${c.tenant}, ${c.id}, ${version}, ${kind}, ${brief.slice(0, 4000)}, ${est}, ${reason ? 'needs_approval' : 'open'}, ${reason}) returning id`;
  if (reason) await mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `제작 전 승인 필요: ${c.title}`, body: reason, link: '/s/marketing/automation', entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktreq:${q.id}` });
  return { id: q.id, reason };
}

/** how: 'auto' = 정기·밤사이 자동 제작(#544 브랜드 템플릿 전에는 초안 보관), 'manual' = 사람이 직접 누른 제작 */
export async function produceContent(c: any, actorId?: string | null, how: 'auto' | 'manual' = 'manual') {
  const sql = db(); const s = await settingsOf(c.tenant);
  const [brand] = c.brand_id ? await sql<any[]>`select * from mkt_brands where id = ${c.brand_id}` : [];
  const [rule] = c.rule_id ? await sql<any[]>`select * from mkt_rules where id = ${c.rule_id}` : [];
  const m = await materialOf(c, brand, rule);
  if (!m.enough) return askTopic(c, actorId);
  let d = await writeDraft(c, s, brand, rule, undefined, m).catch(async (e) => { if (e?.code === 'draft_invalid') await markFailed(c, e.message); throw e; });
  let f = await refineDraft(c, d, brand);
  const kind = c.kind as Kind;
  let q = qualityCheck(f.body, d.brief, s, bannedOf(brand), kind, f.title);
  if (emptyBody(q.body, s.ai_label)) { await markFailed(c, '본문이 비었거나 너무 짧음'); const { HttpError } = await import('./errors'); throw new HttpError(502, 'draft_invalid', '다듬은 뒤 본문이 비어 저장하지 않았습니다(제작 실패)'); }
  if (f.errors.length) { q.passed = false; q.issues = [...q.issues, ...f.errors]; }
  // 로컬 QA 10/24 ②: 올리기 전 자동 검사에 걸리면 승인함(승인 대기) 대신 '수정 요청'에 이유와 함께 — 걸린 줄은 preflight 에도 따로(사람이 고친 수정본이 오면 지움)
  let pre = await preflightOf(c, brand, s, { title: f.title, body: q.body, script: f.script });
  // 172차(로컬 10/26 ①: 하이링크 스토리 '문구 3줄'·다짐 블로그 1,440자가 두 세트 연속 수정 요청으로 쌓임): 검사에 걸리면 걸린 줄을 알려 주고 1번만 다시 써 본 뒤 다시 검사 —
  //  덜 걸리면 그 원고로(승인함), 그래도 같으면 첫 원고 그대로 수정 요청. MKT_PREFLIGHT_RETRY=0 이면 안 함(시험 서버)
  let retried: string[] | null = null; let retryNote = '';
  if (pre.length && process.env.MKT_PREFLIGHT_RETRY !== '0') {
    try {
      const d2 = await writeDraft(c, s, brand, rule, { prev: q.body, comment: `올리기 전 자동 검사에 걸렸습니다. 같은 주제·같은 재료로, 아래를 고쳐 다시 써 주세요:\n- ${pre.join('\n- ')}` }, m);
      const f2 = await refineDraft(c, d2, brand);
      const q2 = qualityCheck(f2.body, d2.brief, s, bannedOf(brand), kind, f2.title);
      if (!emptyBody(q2.body, s.ai_label) && !f2.errors.length) {
        const pre2 = await preflightOf(c, brand, s, { title: f2.title, body: q2.body, script: f2.script });
        if (pre2.length < pre.length) { retried = pre; retryNote = ` · 검사에 걸려 1번 다시 씀(${pre.join(' · ')})`; d = d2; f = f2; q = q2; pre = pre2; }
      }
    } catch { /* 다시 쓰기 실패(AI 오류·크레딧)는 첫 원고로 */ }
  }
  if (pre.length) { q.passed = false; q.issues = [...new Set([...q.issues, ...pre])]; }
  const script = VIDEO_KINDS.includes(kind) && f.script.length >= 2 ? f.script : null; // 로컬 QA 10/24 ⑥ 대본 칸(영상 제작용 — 게시 글에는 안 들어감)
  // #516 시안이 붙은 뒤에만 승인함: 피드·스토리(인스타·페북)는 서버가 바로 그림(크레딧 0), 영상은 제작 요청 카드로 만든 뒤 붙으면 승인 대기
  // 블로그(로컬 10/24 (c)): 대표 이미지를 그리고 본문 사진(실사)을 붙임 — 둘 다 붙어야 승인 대기(대표 10/20 18:45 ③), 실사가 없으면 '수정 요청'에서 사진을 기다림
  // #235 ⓑ 원고가 '[사진 n]' 줄로 고른 사진들(장면 순서) = 본문 사진(표지 바탕으로는 다시 안 씀) · 고른 사진이 없으면 예전처럼 1장
  const V = await import('./mktAutoVisual');
  let mediaIds: string[] = []; let visualNote = ''; let photoId: string | null = null; let bodyIds: string[] = []; let template: string | null = null; let photoIds: string[] = [];
  let cover: { photoFix?: string[]; scene?: boolean; gen?: boolean } = {}; // 188차 #621 시안 기록: 표지 사진 보정·영상 장면
  if (V.serverVisual({ channel: c.channel, kind })) {
    try { const dv = await V.drawAutoVisual({ ...c, title: f.title, card: d.card }, q.body, d.photos?.length ? { bodyIds: d.photos } : {}); bodyIds = dv.bodyIds; mediaIds = [dv.fileId, ...bodyIds]; photoId = dv.photoId; template = dv.template; photoIds = dv.photoIds; cover = dv;
      visualNote = ` · 시안 서버 그리기(${[dv.templateLabel ? `틀: ${dv.templateLabel}` : '', dv.photoTitle ? `사진: ${dv.photoTitle}` : '브랜드 색 바탕'].filter(Boolean).join(' · ')})` + (dv.bodyTitle ? ` · 본문 사진: ${dv.bodyTitle}` : ''); }
    catch (e: any) { visualNote = ` · 시안 그리기 실패: ${String(e?.message ?? e).slice(0, 80)}`; }
  }
  // 요청 C §3-1·3-3(대표 10/25 22:20 '시안이 표지만 있다'): 표지 뒤 장 — 피드 = 카드뉴스 3~5장 · 스토리 = 3~5프레임(원고 AI 의 slides/frames, 없으면 본문 줄로) · 블로그 = 본문 실사가 3장이 안 되면 도표형 카드로 채움 → 못 미치면 승인함 대신 수정 요청
  let pages: import('./mktAutoVisual').CardPage[] | null = null;
  if (mediaIds.length && pagedKind(c)) {
    try { const Q = await import('./mktQuality'); pages = V.pagesOf(kind, d.pages ?? null, q.body, Q.contactLine(factsOf(brand?.facts))); const ids = await V.drawPages({ ...c, title: f.title }, pages, { exclude: new Set([...(photoId ? [photoId] : []), ...photoIds]) }); mediaIds = [...mediaIds, ...ids]; visualNote += ` · ${kind === 'story' ? '프레임' : '카드'} ${mediaIds.length}장${V.photoNote(pages)}`; }
    catch (e: any) { visualNote += ` · 장 그리기 실패: ${String(e?.message ?? e).slice(0, 80)}`; }
  }
  if (mediaIds.length && kind === 'blog' && mediaIds.length < V.BLOG_AUTO_MEDIA) {
    try { const ids = await V.drawInfoCards({ ...c, title: f.title }, q.body, V.BLOG_AUTO_MEDIA - mediaIds.length); mediaIds = [...mediaIds, ...ids]; if (ids.length) visualNote += ` · 도표형 카드 ${ids.length}장`; }
    catch (e: any) { visualNote += ` · 카드 그리기 실패: ${String(e?.message ?? e).slice(0, 80)}`; }
  }
  const M = await import('./marketing');
  const mediaIssue = M.mediaRule(c.channel, kind, mediaIds.length, true);
  if (mediaIssue && (mediaIds.length || kind === 'blog')) { q.passed = false; q.issues = [...q.issues, mediaIssue]; }
  const visualIssue = VIDEO_KINDS.includes(kind) ? '영상 시안 제작 중 — 영상이 붙으면 승인 대기로 올라갑니다' : '시안 이미지 없음 — 승인함에서 [지금 만들기]';
  if (!mediaIds.length && c.channel !== 'threads' && kind !== 'blog') { q.passed = false; q.issues = [...q.issues, visualIssue]; }
  const visualOnly = !q.passed && q.issues.length === 1 && q.issues[0] === visualIssue;
  const held = how === 'auto' && !!s.auto_hold && !V.templateReady(brand); // #544 브랜드 템플릿 전(회사 설정 켬): 승인함 대신 초안 보관(알림 없음)
  const deadline = deadlineOf(c.scheduled_at, s);
  const v = (c.current_version ?? 0) + 1; // 처음 제작 = v1, 다시 만들기 = 다음 버전
  // 267차(대표 #795): 주 단위 묶음 — 정기 자동 제작 첫 원고는 그 주 묶음을 올리는 때(목 10:00)까지 초안으로 모아 두고 한 번에 승인함에(사이사이 한 건씩 안 올림·알림은 묶음 1건).
  //  이미 올린 주에 늦게 나온 원고·사람이 누른 제작·다시 만들기·시험 브랜드는 예전처럼 바로
  const batchWeek = !held && how === 'auto' && v === 1 && s.approval_mode === 'weekly' && c.scheduled_at && !c.is_test ? weekOf(c.scheduled_at) : null;
  const batch = batchWeek && !(await sql`select 1 from mkt_batches where tenant = ${c.tenant} and week = ${batchWeek}::date`).length ? batchWeek : null;
  // 대표 10/20 18:00 ①: 근거(목적·목표 지표·핵심 메시지·왜) — 목표·주차 주제·규칙에서, AI 가 쓴 why 가 있으면 그것
  const G = await import('./mktGoals');
  const rationale = G.rationaleFrom({ goal: m.goal, day: c.scheduled_at ? G.ymd(new Date(c.scheduled_at)) : G.ymd(new Date()), rule, channel: c.channel, kind, why: d.why || null, source: m.goal ? 'goal' : rule ? 'rule' : 'ai', topic: m.topic || null, topicFrom: m.topicFrom || null });
  const designNote = (await import('./mktTeam')).designNote(d.design); // 187차 ④ '반영: 디자인 지침 n개·디자인 기억 n개'
  const videoMethod = (brand?.video?.method ?? null) as 'photos' | 'screen' | 'ai' | null; // 271차 #811
  // 원고·원장·제작 요청 카드를 한 번에(중간에 끊겨 원고만 남고 카드가 빠지는 일이 없게)
  await sql.begin(async (tx) => {
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, ${v}, ${q.body}, ${mediaIds}, ${(v === 1 ? 'AI 자동 제작' : 'AI 다시 만들기') + designNote + retryNote + visualNote}, ${c.created_by})`;
    if (v > 1) await tx`update mkt_production_requests set status = 'canceled', reason = coalesce(reason, '다시 만들기로 대체'), decided_at = now() where content_id = ${c.id} and kind in ('image', 'video') and status in ('open', 'needs_approval')`;
    await tx`update mkt_contents set title = ${(c.is_test && !f.title.startsWith('[시험]') ? '[시험] ' : '') + f.title}, current_version = ${v}, reminded_at = null, status = ${held || batch ? 'draft' : q.passed ? 'pending' : 'changes'}, produced_at = now(), quality = ${tx.json({ passed: q.passed, issues: q.issues, ...(batch ? { batch: { week: batch, status: q.passed ? 'pending' : 'changes', at: new Date().toISOString() } } : {}), ...(retried ? { preflightRetry: retried } : {}), brief: d.brief, ...(d.design ? { design: d.design } : {}), report: { ...f.report, v, preflight: pre }, ...(pre.length ? { preflight: pre } : {}), ...(script ? { script } : {}), ...(d.card ? { card: d.card } : {}), ...(pages?.length ? { pages } : {}), ...(held ? { held: { at: new Date().toISOString(), reason: 'template' } } : {}),
      ...(!mediaIds.length && d.photos?.length ? { bodyPlan: d.photos } : {}), ...(mediaIds.length ? { visual: { by: 'server', fileId: mediaIds[0], at: new Date().toISOString(), photoId, rv: 3, tried: photoId ? [photoId] : [], ...(bodyIds.length ? { bodyIds } : {}), ...(template ? { template } : {}), ...(photoIds.length > 1 ? { photoIds } : {}), ...V.coverMark(cover) } } : {}) } as never)}, rationale = ${tx.json(rationale as never)}, updated_at = now() where id = ${c.id}`;
    await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'text', 0, ${v === 1 ? '원고(Claude) — 크레딧 0' : '다시 만들기 원고(Claude) — 크레딧 0'}, (select title from mkt_contents where id = ${c.id}))`;
    // 이미지·영상은 제작 요청 카드(Higgsfield 계약 전: 사람이 실사 + 글자 렌더로 제작해 붙임) — #544 초안 보관이면 만들지 않음(쓰지 않을 영상에 비용 X)
    // #426: 영상은 초 단위 장면표(분당 300음절)를 그대로 넘김 — Higgsfield 연동 뒤에는 장면별 프롬프트로
    const base = (kind === 'blog' ? `표지 1장 + 본문 사진 3장 이상(실사)${d.photos?.length ? ` — 원고의 [사진 1~${d.photos.length}] 자리에 넣을 사진은 이미 골라 두었습니다` : ''}. ${d.brief ?? ''}`.trim() : d.brief) || (kind === 'story' ? '세로 1080×1920 실사 + 글자 렌더(24시간 스토리)' : '실사 사진 + 글자 렌더');
    // 271차 #811 영상 만드는 방법(브랜드 영상 키트): 앱 화면 녹화 = 생성 비용 0 — 녹화 파일을 붙이는 카드(예상 크레딧 0)
    const screen = VIDEO_KINDS.includes(kind) && videoMethod === 'screen';
    const brief = screen ? `앱 화면 녹화로 만듭니다(생성 비용 0) — 데모 회사 화면을 녹화해 자료실 '마케팅/화면 녹화'에 올린 뒤 이 글에 붙여 주세요.\n\n${base}` : base;
    if (!mediaIds.length && !held) await requestCard(c, v, kind === 'video' || kind === 'reels' || kind === 'shorts' ? 'video' : 'image', f.timing ? `${brief}\n\n${f.timing}` : brief, screen ? 0 : kind === 'video' ? EST.video : kind === 'reels' || kind === 'shorts' ? EST.video_reels : EST.image, tx);
    else await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'generate_image', 0, '시안 서버 그리기 — 크레딧 0', ${f.title})`;
  });
  if (!held && !batch && !isQuiet(new Date(), s)) await mktNotify(sql, c, actorId, { approval: true, type: 'review_requested', title: q.passed ? `승인 요청: ${f.title}` : kind === 'blog' && q.issues.length === 1 ? `사진 필요: ${f.title}` : visualOnly ? `시안 제작 중: ${f.title}` : `품질 검사 미통과: ${f.title}`,
    body: q.passed ? `승인 마감 ${Number(ymd(deadline).slice(5, 7))}/${Number(ymd(deadline).slice(8))} ${pad(s.approval_hour)}:00` : q.issues.join(' · '), link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktp:${c.id}:${v}` });
  // 271차 #811 영상 만드는 방법이 실제 사진이면 원고 직후 이 판에 사진 영상(생성 비용 0) — 사진이 3장이 안 되면 제작 요청 카드 그대로
  // 273차: 앱 화면 녹화면 이 브랜드의 안 쓴 녹화(자료실 '마케팅/화면 녹화')로 — 없으면 카드 그대로
  if (VIDEO_KINDS.includes(kind) && !mediaIds.length && !held && (videoMethod === 'photos' || videoMethod === 'screen')) {
    try {
      const Z = await import('./mktSlideshow');
      const r = videoMethod === 'photos' ? await Z.autoSlideshow({ ...c, title: f.title }, v, q.body, d.photos ?? []) : await Z.autoRecording({ ...c, title: f.title }, v, q.body);
      if (r.skipped) await sql`update mkt_versions set note = concat_ws(' · ', note, ${`${videoMethod === 'photos' ? '실제 사진' : '화면 녹화'} 영상 못 만듦: ${r.skipped}`}::text) where content_id = ${c.id} and version = ${v}`;
    } catch (e: any) { console.error('[mkt] 자동 영상', videoMethod, c.id, e?.message ?? e); }
  }
  return { id: c.id, passed: q.passed, issues: q.issues, ...(held ? { held: true } : {}), ...(batch ? { batch } : {}) };
}

/** 로컬 QA 10/24 ①: 원고 형식이 깨져 만들지 못한 칸 — 본문 없이 '제작 실패' 표시. 자동 제작은 2시간 뒤 한 번 더, 두 번째도 실패면 자동은 멈추고 사람이 [AI 다시 만들기] */
async function markFailed(c: any, reason: string) {
  const n = Number(c.quality?.failed?.n ?? 0) + 1;
  await db()`update mkt_contents set quality = coalesce(quality, '{}'::jsonb) || ${db().json({ failed: { at: new Date().toISOString(), reason: reason.slice(0, 200), n } } as never)},
    produce_at = ${n >= 2 ? null : new Date(Date.now() + 2 * 3600e3)}, updated_at = now() where id = ${c.id} and produced_at is null`.catch(() => {});
}

/** 재료 부족: 원고를 만들지 않고 '주제 필요' 카드로 질문 — 답(주제)을 넣으면 다음 실행에 그 주제로 제작 */
async function askTopic(c: any, actorId?: string | null) {
  const sql = db();
  const open = await sql`select 1 from mkt_production_requests where content_id = ${c.id} and kind = 'topic' and status = 'open'`;
  if (!open.length) {
    const [q] = await sql<{ id: string }[]>`insert into mkt_production_requests (tenant, content_id, version, kind, brief, est_credits, status, reason)
      values (${c.tenant}, ${c.id}, 0, 'topic', ${'이번 글에 쓸 주제·소식을 알려 주세요(예: 신규 상품, 이벤트, 현장 사진 이야기). 브랜드 키트의 소개·주력 상품을 채워 두면 다음부터는 묻지 않습니다.'}, 0, 'open', '재료 부족') returning id`;
    await mktNotify(sql, c, actorId, { type: 'review_requested', title: `주제 필요: ${c.title}`, body: '쓸 재료가 없어 시안을 만들지 않았습니다 — 주제를 알려 주세요', link: '/s/marketing/automation', entityType: 'mkt_content', entityId: c.id, dedupeKey: `mkttopic:${q.id}` });
  }
  return { id: c.id, passed: false, issues: ['주제 필요'], needsTopic: true };
}

/** 마감 N시간 전 알림(야간이면 직전 저녁) · 마감 지난 자동 시안 정리 */
export async function remindAndExpire(tenant: string) {
  const sql = db(); const s = await settingsOf(tenant);
  const restored = await restoreExpired(sql, tenant);
  const rows = await sql<any[]>`select id, tenant, title, scheduled_at, status, auto, reminded_at, is_test, created_by, brand_id, rule_id, channel, kind, quality from mkt_contents where tenant = ${tenant} and status in ('pending', 'changes', 'draft') and scheduled_at is not null and scheduled_at > now() - interval '2 days'`;
  let reminded = 0, expired = 0, moved = 0, postponed = 0;
  for (const c of rows) {
    if (c.status === 'draft' && (c.quality?.held || c.quality?.batch)) continue; // #544 초안 보관 · 267차 묶음 기다리는 원고 — 승인 마감 정리·미루기·알림 없음
    const dl = deadlineOf(c.scheduled_at, s);
    if (c.auto && dl.getTime() < Date.now()) {
      // #516 (d): 승인 마감이 지나도 미승인이면 버리지 않고 다음 슬롯으로(최대 3번), 승인자에게 알림 — 못 옮기면 예전처럼 정리(V43 7: '마감 지남'만 반복해 보이지 않게)
      const n = Number(c.quality?.moved ?? 0);
      const at = c.status !== 'draft' && n < 3 ? await nextSlot(c, s) : null;
      if (at) {
        const done = await sql`update mkt_contents set scheduled_at = ${at}, reminded_at = null, quality = coalesce(quality, '{}'::jsonb) || ${sql.json({ moved: n + 1, movedFrom: new Date(c.scheduled_at).toISOString() } as never)}, updated_at = now()
          where id = ${c.id} and abs(extract(epoch from scheduled_at - ${c.scheduled_at}::timestamptz)) < 1`.then((r) => r.count, () => 0); // 같은 규칙 칸과 겹치면(유일 색인) 옮기지 않음 · 그사이 바뀐 글은 그대로(DB 시각은 마이크로초라 1초 안이면 같은 칸)
        if (done) {
          const when = (d: Date) => `${Number(ymd(d).slice(5, 7))}/${Number(ymd(d).slice(8))} ${hm(d)}`;
          await mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `승인 마감이 지나 다음 슬롯으로 미뤘습니다: ${c.title}`, body: `${when(new Date(c.scheduled_at))} → ${when(at)} 게시 · 승인 마감 ${when(deadlineOf(at, s))}${n + 1 >= 3 ? ' · 이번이 마지막(3번째) 미룸' : ''}`,
            link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktmove:${c.id}:${at.toISOString()}` });
          moved++; continue;
        }
      }
      if (c.status !== 'draft') {
        // 로컬 10/24 09:00: 옮길 날짜가 없으면 취소하지 않고 '미뤄진 글'(보류·날짜 비움)에 둔다 — 승인함에서 [날짜 골라 다시 올리기]·[버리기]
        const done = await sql`update mkt_contents set status = 'hold', scheduled_at = null, reminded_at = null,
            quality = coalesce(quality, '{}'::jsonb) || ${sql.json({ postponed: { from: new Date(c.scheduled_at).toISOString(), at: new Date().toISOString(), moved: n, status: c.status } } as never)}, updated_at = now()
          where id = ${c.id} and abs(extract(epoch from scheduled_at - ${c.scheduled_at}::timestamptz)) < 1 and status in ('pending', 'changes')`.then((r) => r.count, () => 0);
        if (done) {
          await mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `옮길 날짜가 없어 '미뤄진 글'에 두었습니다: ${c.title}`, body: '취소하지 않았습니다 — 승인함 › 미뤄진 글에서 날짜를 골라 다시 올리거나 버려 주세요',
            link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktpost:${c.id}` });
          postponed++;
        }
        continue;
      }
      // 예정(초안) = 아직 만들지 않은 계획 칸만 예전처럼 정리
      await sql`update mkt_contents set status = 'canceled', quality = coalesce(quality, '{}'::jsonb) || '{"expired": true}'::jsonb, updated_at = now() where id = ${c.id}`;
      expired++; continue;
    }
    if (c.status !== 'pending' || c.reminded_at || Date.now() < remindAtOf(dl, s).getTime() || isQuiet(new Date(), s)) continue;
    await mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `승인 마감 ${s.remind_hours}시간 전: ${c.title}`, body: `마감 ${Number(ymd(dl).slice(5, 7))}/${Number(ymd(dl).slice(8))} ${pad(s.approval_hour)}:00`, link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktr:${c.id}` });
    await sql`update mkt_contents set reminded_at = now() where id = ${c.id}`;
    reminded++;
  }
  // 267차(대표 #795): 게시 3일 안으로 들어왔는데 아직 승인 안 된 글 — 승인하는 사람에게 한 번, 묶어서(올린 지 하루 안 된 글은 빼고)
  let nudged = 0;
  if (s.approval_mode === 'weekly' && !isQuiet(new Date(), s)) {
    const due3 = await sql<{ id: string; title: string; scheduled_at: string }[]>`update mkt_contents set quality = coalesce(quality, '{}'::jsonb) || jsonb_build_object('nudge3', now())
      where tenant = ${tenant} and status in ('pending', 'changes') and not is_test and deleted_at is null and scheduled_at > now() and scheduled_at <= now() + interval '3 days'
        and not (coalesce(quality, '{}'::jsonb) ? 'nudge3') and coalesce(produced_at, updated_at) < now() - interval '1 day' returning id, title, scheduled_at`;
    if (due3.length) {
      const list = [...due3].sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
      await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', approval: true, type: 'review_requested', title: `게시 3일 안 남았는데 승인 안 된 글 ${list.length}건`,
        body: `${list.slice(0, 3).map((r) => `${md(ymd(new Date(r.scheduled_at)))} ${r.title}`).join(' · ')}${list.length > 3 ? ` 외 ${list.length - 3}건` : ''} · 승인 마감 ${deadlineRule(s)}`, link: '/s/marketing/approvals', dedupeKey: `mktnudge3:${list[0].id}` });
      nudged = list.length;
    }
  }
  return { reminded, expired, moved, postponed, ...(nudged ? { nudged } : {}), ...(restored ? { restored } : {}) };
}
/** 1회 복구(로컬 10/24 09:00): 그날 09시 정리에서 '옮길 날짜 없음'으로 취소된 승인 대기 글(시안 있음)을 '미뤄진 글'로 되돌림.
 *  이제는 취소하지 않으므로 그 정리 시각(08:50~10:00)에 취소된 것만 — 예정(초안)은 시안이 없어 빠짐 */
async function restoreExpired(sql: any, tenant: string): Promise<number> {
  const r = await sql`update mkt_contents c set status = 'hold', reminded_at = null, scheduled_at = null, updated_at = now(),
      quality = (coalesce(c.quality, '{}'::jsonb) - 'expired') || jsonb_build_object('postponed', jsonb_build_object('from', c.scheduled_at, 'at', now(), 'restored', true))
    from mkt_versions v where v.content_id = c.id and v.version = c.current_version and cardinality(v.media_ids) > 0
      and c.tenant = ${tenant} and c.status = 'canceled' and c.auto and c.quality->>'expired' = 'true'
      and c.updated_at >= '2026-10-24T08:50:00+09:00' and c.updated_at < '2026-10-24T10:00:00+09:00'`.catch(() => ({ count: 0 }));
  return r.count;
}

export const postponedInput = z.object({ action: z.enum(['reschedule', 'discard']), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), time: z.string().regex(/^\d{2}:\d{2}$/).optional() });
/** 로컬 10/24 09:00 '미뤄진 글'(옮길 날짜가 없어 보류·날짜 비움): [날짜 골라 다시 올리기] = 고른 날짜·시각의 승인 대기로 / [버리기] = 취소 — 승인하는 관리자만 */
export async function postponedAction(u: SessionUser, id: string, i: z.infer<typeof postponedInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('미뤄진 글은 승인하는 관리자가 다시 올리거나 버립니다');
  if (!zUuid.safeParse(id).success) throw notFound('콘텐츠를 찾을 수 없습니다');
  const sql = db(); const t = tenantOf(u);
  const [c] = await sql<any[]>`select id, title, status, quality, brand_id, channel, kind from mkt_contents where id = ${id} and tenant = ${t}`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (c.status !== 'hold' || !c.quality?.postponed) throw badRequest('미뤄진 글이 아닙니다 — 승인함을 새로 고쳐 확인해 주세요');
  const { audit } = await import('./log');
  if (i.action === 'discard') {
    await sql`update mkt_contents set status = 'canceled', quality = coalesce(quality, '{}'::jsonb) || ${sql.json({ discarded: { by: u.id, at: new Date().toISOString() } } as never)}, updated_at = now() where id = ${id} and status = 'hold'`;
    await audit(sql, u.id, 'mkt.postponed_discard', 'mkt_content', id, { from: c.quality.postponed.from ?? null }).catch(() => {});
    return { ok: true, status: 'canceled' };
  }
  if (!i.date || !i.time) throw badRequest('다시 올릴 날짜와 시각을 골라 주세요');
  const s = await settingsOf(t);
  const at = kst(i.date, i.time);
  if (Number.isNaN(at.getTime())) throw badRequest('날짜·시각을 다시 확인해 주세요');
  if (deadlineOf(at, s).getTime() <= Date.now()) throw badRequest(`그날 승인 마감(${deadlineRule(s)})이 이미 지났습니다 — 더 뒤 날짜를 골라 주세요`);
  await assertSlot(sql, { id, tenant: t, brand_id: c.brand_id, channel: c.channel, kind: c.kind }, at, s); // #540 하루 2건·3시간·같은 주제/시안
  const [same] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_contents where tenant = ${t} and id <> ${id} and status <> 'canceled' and brand_id is not distinct from ${c.brand_id}
    and channel = ${c.channel} and coalesce(kind, '') = ${c.kind ?? ''} and (scheduled_at at time zone 'Asia/Seoul')::date = ${i.date}::date`;
  const status = c.quality.postponed.status === 'changes' ? 'changes' : 'pending';
  try {
    await sql`update mkt_contents set status = ${status}, scheduled_at = ${at}, reminded_at = null, updated_at = now(),
      quality = (coalesce(quality, '{}'::jsonb) - 'postponed' - 'expired' - 'moved' - 'movedFrom') || ${sql.json({ rescheduled: { by: u.id, at: new Date().toISOString(), from: c.quality.postponed.from ?? null } } as never)}
      where id = ${id} and status = 'hold'`;
  } catch (e: any) {
    if (e?.code === '23505') throw badRequest('그 시각에 같은 자동 제작 칸의 글이 이미 있습니다 — 다른 시각을 골라 주세요');
    throw e;
  }
  await audit(sql, u.id, 'mkt.postponed_reschedule', 'mkt_content', id, { at: at.toISOString(), from: c.quality.postponed.from ?? null }).catch(() => {});
  return { ok: true, status, scheduledAt: at.toISOString(), sameDay: same?.n ?? 0 };
}
/** #540 같은 브랜드 하루 2건(대표 결정 10/24, 단 겹치면 안 됨): 같은 브랜드·채널·형식 글은 하루 2건까지 — 같은 시각 겹침 금지·3시간 넘게 띄움·같은 주제나 같은 시안(같은 사진)이면 막음.
 *  다른 채널·형식(묶음 규칙의 피드·쇼츠·릴스·블로그·스토리)은 따로 셈(대표 10/24 ③ '각각 2건'). 규칙이 칸 만들기·다음 슬롯 찾기·미뤄진 글 다시 올리기·게시 시각 바꾸기(캘린더)가 같은 검사를 씀 */
export const SAME_DAY_MAX = 2;
const GAP = 3 * 3600e3;
const NIL_ID = '00000000-0000-0000-0000-000000000000'; // 아직 없는 칸(규칙이 만들 칸)
type SlotPost = { id: string; tenant: string; brand_id: string | null; channel: string; kind: string | null };
type SlotKeys = { topics: string[]; visuals: string[] };
type Peer = SlotKeys & { title: string; at: Date };
const normTopic = (x: unknown) => String(x ?? '').replace(/^\s*\[시험\]\s*/, '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
/** 주제 = 답한 주제 · 만든 글의 제목(아직 안 만든 칸의 제목은 칸 이름이라 뺌) / 시안 = 지금 버전 파일 · 서버 그리기 바탕 사진 */
const keysOf = (r: { title?: string | null; current_version?: number | null; quality?: any; media_ids?: string[] | null }): SlotKeys => ({
  topics: [normTopic(r.quality?.topic), Number(r.current_version ?? 0) > 0 ? normTopic(r.title) : ''].filter((x) => x.length >= 2),
  visuals: [...(r.media_ids ?? []), r.quality?.visual?.photoId].filter(Boolean).map(String) });
const shortTitle = (t: string) => (t.length > 20 ? `${t.slice(0, 20)}…` : t);
async function selfKeys(sql: any, id: string): Promise<SlotKeys> {
  const [r] = await sql`select c.title, c.current_version, c.quality, v.media_ids from mkt_contents c left join mkt_versions v on v.content_id = c.id and v.version = c.current_version where c.id = ${id}`;
  return r ? keysOf(r) : { topics: [], visuals: [] };
}
/** 그 기간(서울 날짜) 같은 브랜드·채널·형식 글 — 취소 말고 전부(승인·게시·초안 보관 포함) */
async function slotPeers(sql: any, c: SlotPost, from: string, to: string): Promise<Peer[]> {
  const rows = await sql`select c.title, c.scheduled_at, c.current_version, c.quality, v.media_ids from mkt_contents c
      left join mkt_versions v on v.content_id = c.id and v.version = c.current_version
    where c.tenant = ${c.tenant} and c.id <> ${c.id} and c.status <> 'canceled' and c.brand_id is not distinct from ${c.brand_id}
      and c.channel = ${c.channel} and coalesce(c.kind, '') = ${c.kind ?? ''} and c.scheduled_at is not null
      and (c.scheduled_at at time zone 'Asia/Seoul')::date between ${from}::date and ${to}::date`;
  return rows.map((r: any) => ({ ...keysOf(r), title: String(r.title ?? ''), at: new Date(r.scheduled_at) }));
}
/** 그 시각에 놓을 수 있으면 null, 아니면 이유(화면에 그대로 보임) */
function slotIssue(me: SlotKeys, peers: Peer[], at: Date): string | null {
  const day = ymd(at);
  const same = peers.filter((p) => ymd(p.at) === day);
  if (same.length >= SAME_DAY_MAX) return `그날 같은 브랜드·채널·형식 글이 이미 ${same.length}건입니다(하루 ${SAME_DAY_MAX}건까지)`;
  const near = same.find((p) => Math.abs(p.at.getTime() - at.getTime()) < GAP);
  if (near) return Math.abs(near.at.getTime() - at.getTime()) < 60e3 ? `그 시각(${hm(at)})에 같은 브랜드·채널·형식 글이 이미 있습니다` : `같은 브랜드·채널·형식 글(${hm(near.at)} '${shortTitle(near.title)}')과 3시간 넘게 띄워야 합니다`;
  const topic = same.find((p) => p.topics.some((x) => me.topics.includes(x)));
  if (topic) return `그날 같은 주제의 글('${shortTitle(topic.title)}')이 있습니다`;
  const visual = same.find((p) => p.visuals.some((x) => me.visuals.includes(x)));
  if (visual) return `그날 같은 시안(같은 사진)을 쓴 글('${shortTitle(visual.title)}')이 있습니다`;
  return null;
}
/** 그날 넣어 볼 시각: 원래 시각 → 3시간씩 뒤·앞(승인 마감 다음 시각 ~ 21:00 안) */
function slotTimes(day: string, time: string, s: DeadlineSet) {
  const base = kst(day, time); const lo = (s.deadline_days ?? 0) > 0 ? '08:00' : `${pad(Math.max(8, s.approval_hour + 1))}:00`; // 267차: 마감이 전날이면 그날 아침부터
  const out = [base];
  for (let k = 1; k <= 4; k++) for (const sign of [1, -1]) {
    const t = new Date(base.getTime() + sign * k * GAP);
    if (ymd(t) === day && hm(t) >= lo && hm(t) <= '21:00') out.push(t);
  }
  return out;
}
/** 사람이 고른 시각(미뤄진 글 다시 올리기·캘린더 옮기기) 검사 — 안 되면 그날 넣을 수 있는 가장 가까운 시각을 붙여 400 */
export async function assertSlot(sql: any, c: SlotPost, at: Date, s?: DeadlineSet) {
  const day = ymd(at);
  const peers = await slotPeers(sql, c, day, day);
  if (!peers.length) return;
  const me = await selfKeys(sql, c.id);
  const issue = slotIssue(me, peers, at);
  if (!issue) return;
  const alt = slotTimes(day, hm(at), s ?? (await settingsOf(c.tenant))).slice(1).find((t) => !slotIssue(me, peers, t));
  throw badRequest(`${issue} — ${alt ? `그날은 ${hm(alt)}에 넣을 수 있습니다` : '그날은 더 넣을 수 없습니다. 다른 날을 골라 주세요'}`);
}
/** #516 다음 슬롯: 하루씩 뒤로(규칙의 요일·주말 건너뛰기 지킴) — #540 그날 같은 브랜드·채널·형식 글이 있으면 원래 시각에서 3시간씩 옮겨 보고(하루 2건까지·같은 주제/시안 X), 같은 규칙 칸과 같은 시각은 피함 — 승인 마감이 아직 안 지난 날만, 14일 안 */
export async function nextSlot(c: SlotPost & { rule_id: string | null; scheduled_at: string | Date }, s: MktSettings) {
  const sql = db();
  const [rule] = c.rule_id ? await sql<{ weekdays: number[]; skip_weekend: boolean }[]>`select weekdays, skip_weekend from mkt_rules where id = ${c.rule_id}` : [];
  const from = new Date(c.scheduled_at); const time = hm(from);
  const base = Math.max(from.getTime(), Date.now() - DAY); // 원래 날이 며칠 전이면 지난 날을 세지 않고 오늘부터(14일 안에 못 찾아 null 이 되지 않게)
  const me = await selfKeys(sql, c.id);
  const peers = await slotPeers(sql, c, ymd(new Date(base + DAY)), ymd(new Date(base + 14 * DAY)));
  for (let k = 1; k <= 14; k++) {
    const day = ymd(new Date(base + k * DAY));
    const dow = new Date(`${day}T12:00:00+09:00`).getUTCDay();
    if (rule?.skip_weekend && (dow === 0 || dow === 6)) continue;
    if (rule?.weekdays?.length && !rule.weekdays.includes(dow)) continue;
    if (deadlineOf(kst(day, time), s).getTime() <= Date.now() + 3600e3) continue; // 승인할 시간이 1시간은 남게(마감은 그날 기준)
    for (const at of slotTimes(day, time, s)) {
      if (at.getTime() <= Date.now()) continue; // 마감(게시일 09:00)이 아직이어도 그 시각 자체가 지났으면 X — 09:00 전에 돌 때 오늘 새벽 시각으로 잡히던 것
      if (slotIssue(me, peers, at)) continue;
      if (c.rule_id && (await sql`select 1 from mkt_contents where rule_id = ${c.rule_id} and scheduled_at = ${at}`).length) continue;
      return at;
    }
  }
  return null;
}

/** 정해진 시각이 된 자동 제작 칸을 만든다 — 회사마다 한 번에 하나(정기 실행 뒤 이어 만들기·밤사이 비서·[지금 실행]이 같은 글을 두 번 만들지 않게).
 *  글 모델이 최상 모델이면 1건 30~60초라 budgetMs 가 지나면 다음 건은 시작하지 않고 다음 실행에 넘긴다(left) */
async function produceDue(tenant: string, actorId: string | undefined, budgetMs: number, opt: { sampleOnly?: boolean } = {}): Promise<{ produced: any[]; left: number; busy?: boolean }> {
  const L = await import('./later');
  const r = await L.withLock(`mktProduce:${tenant}`, async () => {
    const noVideo = (await settingsOf(tenant)).video_pause; // 요청 C §3-1: 영상 자동 제작 중단(릴스·쇼츠·생성 영상 칸은 두고 만들지 않음 — 다시 켜면 그때 제작)
    const due = await db()<any[]>`select * from mkt_contents where tenant = ${tenant} and auto and status = 'draft' and produced_at is null and produce_at <= now()
      and (${!noVideo} or coalesce(kind, '') not in ('reels', 'shorts', 'video'))
      ${opt.sampleOnly ? db()`and (quality->>'sample' = 'true' or (rule_id is null and title like '%시안 세트%'))` : db()`and true`} -- 170차: 일시정지 중에는 시안 세트 칸만(예전 세트는 제목으로)
      and not exists (select 1 from mkt_production_requests q where q.content_id = mkt_contents.id and q.kind = 'topic' and q.status = 'open') order by produce_at limit 5`;
    const start = Date.now(); const produced: any[] = []; let k = 0;
    for (; k < due.length; k++) {
      const c = due[k];
      if (produced.length && Date.now() - start > budgetMs) break;
      const [fresh] = await db()<any[]>`select * from mkt_contents where id = ${c.id} and status = 'draft' and produced_at is null`; // 그사이 [지금 만들기] 등으로 만들어졌으면 건너뜀
      if (!fresh) continue;
      const r: any = await produceContent(fresh, actorId, 'auto').catch((e) => ({ id: c.id, error: String(e?.message ?? e).slice(0, 200), quota: e?.code === 'ai_quota' || e?.code === 'mkt_ai_quota' || e?.code === 'ai_credit' }));
      produced.push(r);
      if (r.quota) { // 한도·크레딧: 남은 칸도 같은 이유로 실패하므로 멈추고, 받는 사람에게 하루 한 번 알림
        await (await import('./spaceNotify')).notifySpace(db(), { tenant, space: 'marketing', approval: true, type: 'usage_alert', title: '마케팅 자동 제작 멈춤(AI 한도)', body: r.error, link: '/s/marketing/automation', dedupeKey: `mktquota:${tenant}:${ymd(new Date())}` }).catch(() => {});
        k++; break;
      }
    }
    return { produced, left: due.length - k };
  });
  return L.isBusy(r) ? { produced: [] as any[], left: 0, busy: true } : r;
}
export async function runTenant(tenant: string, actorId?: string, opt: { later?: boolean } = {}) {
  // 대표 10/25 22:20(15-16) 자동 생성 일시정지: 칸 만들기·제작·시안 그리기·마감 정리를 모두 건너뜀(사람이 누르는 [지금 만들기]는 produceContent 로 따로)
  if (await autoPaused(tenant)) {
    // 170차: 일시정지 중에도 시안 세트 칸(quality.sample)만은 이어서 만든다 — 응답 뒤 제작이 시간 제한에 끊긴 나머지·2시간 뒤 재시도 칸(로컬 10/26 10:45: 13건 중 5건 초안으로 남음)
    const made = opt.later ? null : await produceDue(tenant, actorId, 150e3, { sampleOnly: true });
    if (opt.later) (await import('./later')).runLater('mktProduce', async () => ({ tenant, sampleOnly: true, ...(await produceDue(tenant, undefined, 120e3, { sampleOnly: true })) }));
    return { paused: true, planned: 0, produced: made?.produced ?? ([] as any[]), visuals: [] as any[], redraws: [] as any[], ...(made ? { left: made.left, ...(made.busy ? { busy: true } : {}) } : { producing: 'later' as const }) };
  }
  // 예전 칸 제목의 '[시험] [시험] ' 겹침 정리(브랜드 이름에 [시험]이 들어 있던 때 만든 아직 안 만든 칸)
  await db()`update mkt_contents set title = regexp_replace(title, '^\\[시험\\]\\s*\\[시험\\]\\s*', '[시험] ') where tenant = ${tenant} and title like '[시험]%[시험]%' and produced_at is null`;
  const planned = await planSlots(tenant);
  // 정기 실행(later): 글 제작은 응답 뒤에 — 최상 모델은 1건 30~60초라 게시·알림·메일 단계를 밀어내지 않게. [지금 실행]은 그 자리에서(2분 30초 안에 시작한 건까지)
  const made = opt.later ? null : await produceDue(tenant, actorId, 150e3);
  if (opt.later) (await import('./later')).runLater('mktProduce', async () => ({ tenant, ...(await produceDue(tenant, undefined, 120e3)) }));
  // #235 ⓒ 설명 없는 마케팅 사진 6장씩(응답 뒤) — 시안 바탕·블로그 사진 고르기·원고 사진 설명에 씀
  if (opt.later) (await import('./later')).runLater('mktVision', async () => ({ tenant, ...(await (await import('./mktPhotos')).describeBatch(tenant, { limit: 6, budgetMs: 40e3 })) }));
  const produced = made?.produced ?? [];
  // #516 (b): 시안 없이 승인 대기에 걸린 자동 제작 글 → 서버 그리기로 시안을 붙여 재승인(마감 정리보다 먼저)
  // #516 후속: 글자 든 그래픽을 바탕으로 그린 승인 전 시안 → 새 규칙으로 다시 그림(한 번)
  const V = await import('./mktAutoVisual');
  const redraws = await V.redrawTextVisuals(tenant).catch((e) => [{ id: '', error: String(e?.message ?? e).slice(0, 200) }]);
  const visuals = await V.fillMissingVisuals(tenant).catch((e) => [{ id: '', error: String(e?.message ?? e).slice(0, 200) }]);
  const batches = await releaseBatches(tenant).catch((e) => [{ week: '', n: 0, error: String(e?.message ?? e).slice(0, 200) }]); // 267차 주 단위 묶음 올리기(마감 정리보다 먼저)
  return { planned, produced, ...(made ? { left: made.left, ...(made.busy ? { busy: true } : {}) } : { producing: 'later' as const }), visuals, redraws, ...(batches.length ? { batches } : {}), ...(await remindAndExpire(tenant)) };
}
/** 267차(대표 #795): 주 단위 묶음 올리기 — 그 주 묶음을 올리는 때(목 10:00)가 지났고 그 주 자동 원고가 다 만들어졌으면(덜 됐어도 첫 원고 뒤 2시간이면) 모아 둔 초안을 한 번에
 *  승인 대기(검사 미통과는 수정 요청)로 + 승인하는 사람에게 알림 1건. 무알림 시간에는 기다림. '한 건씩' 방식으로 바꾸면 모아 둔 것을 바로 올림 */
const BATCH_GRACE = 2 * 3600e3;
export async function releaseBatches(tenant: string, s?: MktSettings): Promise<{ week: string; n: number; error?: string }[]> {
  const sql = db(); const st = s ?? (await settingsOf(tenant));
  const weeks = await sql<{ week: string; first: string }[]>`select quality->'batch'->>'week' as week, min(produced_at) as first from mkt_contents
    where tenant = ${tenant} and status = 'draft' and quality ? 'batch' and not (quality->'batch' ? 'released') and deleted_at is null group by 1 order by 1`;
  const out: { week: string; n: number }[] = [];
  if (!weeks.length || isQuiet(new Date(), st)) return out;
  const thisWeek = weekOf(new Date());
  for (const w of weeks) {
    const at = batchAtOf(w.week, st); const now = Date.now();
    if (st.approval_mode === 'weekly') {
      if (now < at.getTime()) continue;
      const [left] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_contents where tenant = ${tenant} and auto and not is_test and status = 'draft' and produced_at is null and produce_at is not null and produce_at <= now()
        and deleted_at is null and (scheduled_at at time zone 'Asia/Seoul')::date between ${w.week}::date and ${w.week}::date + 6
        and not exists (select 1 from mkt_production_requests q where q.content_id = mkt_contents.id and q.kind = 'topic' and q.status = 'open')`;
      if (left.n > 0 && now < Math.max(at.getTime(), new Date(w.first).getTime()) + BATCH_GRACE) continue; // 아직 만드는 중 — 다 되면 한 번에
    }
    const rows = await sql<{ id: string; title: string; status: string; scheduled_at: string; brand: string | null }[]>`update mkt_contents c set status = case when c.quality->'batch'->>'status' = 'changes' then 'changes' else 'pending' end,
        reminded_at = null, updated_at = now(), quality = jsonb_set(c.quality, '{batch,released}', to_jsonb(now()))
      where c.tenant = ${tenant} and c.status = 'draft' and c.quality->'batch'->>'week' = ${w.week} and not (c.quality->'batch' ? 'released')
      returning c.id, c.title, c.status, c.scheduled_at, (select b.name from mkt_brands b where b.id = c.brand_id) as brand`;
    await sql`insert into mkt_batches (tenant, week, released_at, n) values (${tenant}, ${w.week}::date, now(), ${rows.length}) on conflict (tenant, week) do update set n = mkt_batches.n + excluded.n`;
    if (!rows.length) continue;
    const label = w.week === addDay(thisWeek, 7) ? '다음 주' : w.week === thisWeek ? '이번 주' : `${md(w.week)}~${md(addDay(w.week, 6))}`;
    const changes = rows.filter((r) => r.status === 'changes').length;
    const brands = [...new Set(rows.map((r) => r.brand).filter(Boolean))].map((b) => String(b).replace(/^\s*\[시험\]\s*/, ''));
    await (await import('./spaceNotify')).notifySpace(sql, { tenant, space: 'marketing', approval: true, type: 'review_requested', title: `${label} 게시 ${rows.length}건을 한 번에 올렸습니다. 승인해 주세요`,
      body: `${md(w.week)}~${md(addDay(w.week, 6))} 게시${brands.length ? ` · ${brands.slice(0, 4).join('·')}` : ''}${changes ? ` · 검사에 걸려 수정 요청 ${changes}건 포함` : ''} · 승인 마감 ${deadlineRule(st)} · 수정 요청하면 최상 모델로 바로 수정본`,
      link: '/s/marketing/approvals', dedupeKey: `mktbatch:${tenant}:${w.week}:${rows[0].id}` });
    out.push({ week: w.week, n: rows.length });
  }
  return out;
}
/** tick: 규칙이 있는 회사만(한 번에 3곳) — 글 제작은 응답 뒤(runLater) */
export async function mktAutoTick() {
  // 170차: 규칙이 없는 회사라도 이어서 만들 시안 세트 칸이 있으면 포함(자동 생성 일시정지 중에도)
  const ts = await db()<{ tenant: string }[]>`select tenant from (select distinct tenant from mkt_rules where active
    union select distinct tenant from mkt_contents where auto and status = 'draft' and produced_at is null and produce_at <= now() and (quality->>'sample' = 'true' or (rule_id is null and title like '%시안 세트%'))) x order by tenant limit 3`;
  const out = [];
  for (const t of ts) out.push({ tenant: t.tenant, ...(await runTenant(t.tenant, undefined, { later: true })) });
  return out;
}

/** 수정 요청 나누기(V43 5 → #545·#534): 글(문구·첫 줄·해시태그·말투…) · 사진(바탕·이미지 바꾸기) · AI 이미지(Higgsfield 재생성) · 영상 다시 — 한 요청에 여럿이면 함께 */
const REV_TEXT = /(글|문구|문장|카피|제목|첫\s*줄|훅|본문|해시태그|말투|표현|오타|맞춤법|짧게|길게|줄여|늘려)/;
export function revisionParts(comment: string, kind?: string | null) {
  // 255차(대표 10/28 릴스 의견 '영상 퀄리티가… 외국이네요 배경은 공사현장'): 영상 글은 영상·화면·배경·인물·화질을 말하면 영상 다시 만들기
  const video = /(영상|동영상|컷|클립).{0,12}(다시|새로|바꿔|교체|재생성)|재촬영/.test(comment) || (VIDEO_KINDS.includes(kind ?? '') && /영상|화면|장면|배경|퀄리티|품질|화질|인물|외국|촬영|분위기/.test(comment));
  const ai = !video && /AI\s*이미지/i.test(comment); // 승인함 [AI 이미지로 다시](크레딧) 버튼 문구
  const photo = !video && (ai || /(사진|이미지|그림|썸네일|배경|바탕).{0,12}(다시|새로|바꿔|교체|재생성|다른)|재생성/.test(comment));
  const text = !(video || photo) || REV_TEXT.test(comment);
  return { text, photo, video, ai };
}
export function classifyRevision(comment: string): 'text' | 'regen_image' | 'regen_video' {
  const p = revisionParts(comment); return p.video ? 'regen_video' : p.photo ? 'regen_image' : 'text';
}
/** 187차(대표 ③ — 3번 제한 없앰): AI 수정본 횟수 제한 없음. 비용은 회사 월 AI 예산(assertMktAi — 다 쓰면 멈춤)이 막고, 시안 다시 그리기는 크레딧 0.
 *  대신 같은 글 요청이 연달아 SAME_REQUEST_STOP 번 '반영 안 됨'이면 AI 를 다시 부르지 않음(같은 결과에 비용만 듦) — 다르게 적거나 사람이 수정본을 올림 */
export const SAME_REQUEST_STOP = 2;
/** 같은 요청인지 비교용: 띄어쓰기·끝 문장부호·영문 대소문자 무시(버전에 남기는 요청과 같은 500자까지) */
export const normRequest = (s: string | null | undefined) => String(s ?? '').slice(0, 500).replace(/\s+/g, ' ').trim().replace(/[.!?~…。]+$/u, '').trim().toLowerCase();
/** 최근 AI 수정본부터 거꾸로: 이번 요청과 같은 요청이 '반영 안 됨'으로 끝난 횟수(연달아) */
export function repeatStreak(comment: string, prior: { request: string | null; status: string | null }[]) {
  const key = normRequest(comment); let n = 0;
  if (!key) return 0;
  for (const p of prior) { if (normRequest(p.request) === key && p.status === 'unmet') n++; else break; }
  return n;
}
/** 로컬 10/24(d22c7d8e '첫 줄을 더 짧게' — 첫 줄이 그대로인데 '반영한 요청'): 수정본이 요청을 실제로 반영했는지 잴 수 있는 것만 검사.
 *  첫 줄·글 길이 · 해시태그·이모지 수 · 따옴표 낱말 빼기/넣기 · 사진 바꾸기. 잴 수 없는 요청(말투·내용)은 unknown(글이 바뀌었으면 '반영한 요청'),
 *  글을 고치라 했는데 글이 그대로면 unmet — 화면·메모·알림이 '반영한 요청 / 일부 반영 / 요청(이미 충족) / 반영 안 됨'으로 나뉨 */
export type RevisionCheck = { status: 'applied' | 'partial' | 'already' | 'unmet' | 'unknown'; detail: string };
type CheckSide = { body: string; photoId?: string | null; template?: string | null };
export function checkRevision(comment: string, a: CheckSide, b: CheckSide & { drawn: boolean }, parts: { text: boolean; photo: boolean }): RevisionCheck {
  const r: { s: 'applied' | 'partial' | 'already' | 'unmet'; d: string }[] = [];
  const len = (x: string) => [...x.trim()].length;
  const first = (x: string) => x.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const same = a.body.trim() === b.body.trim();
  if (parts.text) {
    const shorter = /(짧게|짧은|줄여|줄이|간결)/.test(comment), longer = /(길게|늘려|늘리|자세히|풍부하게)/.test(comment);
    if (shorter || longer) {
      const head = /(첫\s*(줄|문장|머리)|훅|제목)/.test(comment); const what = head ? '첫 줄' : '글';
      const x = len(head ? first(a.body) : a.body), y = len(head ? first(b.body) : b.body);
      if (shorter) r.push(y <= x - 3 && y <= x * 0.9 ? { s: 'applied', d: `${what} ${x}자 → ${y}자` } : head && x <= 20 ? { s: 'already', d: `${what}은 이미 ${x}자로 짧음(수정본 ${y}자)` } : { s: 'unmet', d: `${what} 길이가 거의 그대로(${x}자 → ${y}자)` });
      else r.push(y >= x + 3 && y >= x * 1.1 ? { s: 'applied', d: `${what} ${x}자 → ${y}자` } : { s: 'unmet', d: `${what} 길이가 거의 그대로(${x}자 → ${y}자)` });
    }
    const drop = /(빼|없애|지워|지우|삭제|제거|줄여|줄이|적게)/, add = /(넣어|넣|추가|늘려|늘리|달아|붙여)/;
    if (/해시\s*태그/.test(comment)) {
      const t = (x: string) => (x.match(/#[^\s#]+/g) ?? []).length; const x = t(a.body), y = t(b.body);
      if (drop.test(comment)) r.push(y < x ? { s: 'applied', d: `해시태그 ${x}개 → ${y}개` } : x === 0 ? { s: 'already', d: '해시태그가 원래 없음' } : { s: 'unmet', d: `해시태그 ${x}개 그대로` });
      else if (add.test(comment)) r.push(y > x ? { s: 'applied', d: `해시태그 ${x}개 → ${y}개` } : { s: 'unmet', d: `해시태그 ${x}개 그대로` });
    }
    if (/(이모지|이모티콘)/.test(comment) && drop.test(comment)) {
      const e = (x: string) => (x.match(/\p{Extended_Pictographic}/gu) ?? []).length; const x = e(a.body), y = e(b.body);
      r.push(y < x ? { s: 'applied', d: `이모지 ${x}개 → ${y}개` } : x === 0 ? { s: 'already', d: '이모지가 원래 없음' } : { s: 'unmet', d: `이모지 ${x}개 그대로` });
    }
    for (const m of comment.matchAll(/['"‘“「『]([^'"’”」』\n]{1,30})['"’”」』]/g)) { // '…' 빼 줘 → 없어야 · '…'(으)로 바꿔/넣어 → 있어야
      const w = m[1].trim(); const after = comment.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 10);
      if (!w) continue;
      if (/^\s*(을|를|은|는|도)?\s*(빼|없애|지워|지우|삭제|제거)/.test(after)) r.push(!b.body.includes(w) ? { s: 'applied', d: `'${w}' 뺌` } : { s: 'unmet', d: `'${w}' 아직 있음` });
      else if (/^\s*(으로|로)\s*(바꿔|바꾸|고쳐|수정|변경)|^\s*(을|를|도)?\s*(넣어|넣|추가|붙여|써)/.test(after)) r.push(b.body.includes(w) ? { s: 'applied', d: `'${w}' 넣음` } : { s: 'unmet', d: `'${w}' 없음` });
    }
    if (same && !r.some((x) => x.s === 'already')) r.push({ s: 'unmet', d: '글이 바뀌지 않음' });
  }
  if (parts.photo) {
    if (!b.drawn) r.push({ s: 'unmet', d: '시안을 다시 그리지 못함' });
    else if (b.photoId && b.photoId !== a.photoId) r.push({ s: 'applied', d: '바탕 사진 바꿈' });
    else if (b.template && b.template !== a.template) r.push({ s: 'partial', d: '바꿀 바탕 사진이 없어 다른 틀로 다시 그림' });
    else r.push({ s: 'unmet', d: "바꿀 바탕 사진이 없어 같은 바탕으로 다시 그림 — 자료실 '마케팅/시안 바탕(글자 없는 사진)'에 사진을 올려 주세요" });
  }
  if (!r.length) return { status: 'unknown', detail: '' };
  const has = (k: string) => r.some((x) => x.s === k);
  const status = has('unmet') ? (has('applied') || has('partial') ? 'partial' : 'unmet') : has('partial') ? 'partial' : has('applied') ? 'applied' : 'already';
  const detail = r.map((x) => x.d).join(' · ') + (status === 'already' && parts.text && !same ? ' — 본문만 고침' : '');
  return { status, detail };
}
export const revisionLabel = (c?: { status: string } | null) => (c?.status === 'unmet' ? '반영 안 됨' : c?.status === 'partial' ? '일부 반영' : c?.status === 'already' ? '요청(이미 충족)' : '반영한 요청');
type By = { id: string; name?: string | null } | null | undefined;
/** #545(+#534) 수정 요청 → AI 가 그 내용으로 고친 수정본을 승인함에 다시 올림(자동 제작 글).
 *  글 = AI 가 다시 씀 · 서버가 그린 시안 = 새 글(첫 줄)로 다시 그림, 사진을 바꾸라면 이 글에 써 본 바탕 사진은 빼고 — 한 버전으로(0크레딧)
 *  AI 이미지·영상 다시·사람이 붙인 사진 바꾸기 = 제작 요청 카드(크레딧·한도) · 요청 사유는 사람이 올린 글이어도 디자인 담당 기억(다음 시안·제작 프롬프트 재료) */
export async function onChangesRequested(contentId: string, comment: string, by?: By) {
  const sql = db();
  const [c] = await sql<any[]>`select * from mkt_contents where id = ${contentId}`;
  if (!c) return null;
  await (await import('./mktTeam')).remember(c.tenant, 'designer', { brandId: c.brand_id, kind: 'edit', text: comment, sourceType: 'mkt_content', sourceId: c.id, by: by?.id ?? null }).catch(() => {});
  // 255차 #792(대표 10/29 01:45 '수정 요청을 남기면 최상 모델이 점검해 시안을 만들어 승인함에'): 사람이 쓴 글도 — 예전에는 자동 제작 글만 수정본을 만들었음
  let parts = revisionParts(comment, c.kind);
  // 사람이 쓴 글의 사진 바꾸기·사진/파일 넣기는 작성자가(AI 가 대신 붙일 수 없음) — 글도 고치라면 글만 수정본, 아니면 예전처럼 작성자의 새 버전을 기다림
  if (!c.auto && !parts.video && !parts.ai && (parts.photo || /(사진|이미지|그림|파일|자료).{0,8}(넣|추가|첨부|붙이|붙여|올려)/.test(comment))) {
    if (!REV_TEXT.test(comment)) return null;
    parts = { ...parts, photo: false, text: true };
  }
  const prior = await sql<{ request: string | null; status: string | null }[]>`select revision->>'request' as request, revision->'check'->>'status' as status from mkt_versions
    where content_id = ${c.id} and coalesce((revision->>'ai')::boolean, false) order by version desc`;
  const n = prior.length;
  // 187차: 같은 글 요청이 연달아 2번 반영 안 됐으면 글은 AI 에 다시 맡기지 않음 — 사진 다시 그리기(크레딧 0)·제작 요청 카드는 그대로
  const same = parts.text ? repeatStreak(comment, prior) : 0; const repeat = same >= SAME_REQUEST_STOP;
  if (repeat && !parts.photo && !parts.video && !parts.ai) return { kind: 'repeat' as const, used: n, same };
  const V = await import('./mktAutoVisual');
  const [cur] = await sql<{ media_ids: string[] }[]>`select media_ids from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
  const media = (cur?.media_ids ?? []).map(String);
  const drawable = V.serverVisual(c) && (!media.length || (c.quality?.visual?.by === 'server' && media[0] === c.quality.visual.fileId));
  if (parts.video || parts.ai || (parts.photo && !drawable)) { // 서버가 다시 그릴 수 없는 시안 = 제작 요청 카드 — 글도 고치라면 글은 지금 수정본으로
    const kind = parts.video ? 'regen_video' : 'regen_image';
    await sql`update mkt_production_requests set status = 'canceled', reason = coalesce(reason, '새 수정 요청으로 대체'), decided_at = now() where content_id = ${c.id} and kind in ('regen_image', 'regen_video') and status in ('open', 'needs_approval')`;
    const card = await requestCard(c, c.current_version, kind, comment, kind === 'regen_video' ? EST.regen_video : EST.regen_image, undefined, { ask: true }); // 255차: 비용·이번 달 남은 수를 적고 대표 승인 뒤 제작
    if (!parts.text || repeat) return { kind, card, ...(repeat ? { repeat: same } : {}) };
    return { kind, card, ...(await reviseText(c, comment, { photo: false, by, n: n + 1 })) };
  }
  const text = parts.text && !repeat;
  const r = await reviseText(c, comment, { text, photo: parts.photo, by, n: n + 1 });
  return { kind: text && parts.photo ? 'both' : parts.photo ? 'visual' : 'text', ...r, ...(repeat ? { repeat: same } : {}) };
}
/** 글·시안 고치기(수정 요청·AI로 다듬기 공용) → 새 버전 1개 · 0크레딧 원장.
 *  글 = AI 가 다시 씀(품질 엔진) · 서버가 그린 시안 = 새 글(첫 줄)로 다시 그림(같은 바탕 사진), photo = 이 글에 써 본 바탕 사진은 빼고 새로
 *  n(#545 수정 요청 몇 번째) = 버전에 반영한 요청·바뀐 것을 남기고 승인자에게 '수정본 승인 요청' 알림 */
async function reviseText(c: any, comment: string, o: { text?: boolean; photo?: boolean; by?: By; n?: number; note?: string; ledgerNote?: string; actorId?: string | null; fresh?: boolean } = {}) {
  const sql = db(); const s = await settingsOf(c.tenant);
  const [brand] = c.brand_id ? await sql<any[]>`select * from mkt_brands where id = ${c.brand_id}` : [];
  const [prev] = await sql<{ body: string; media_ids: string[] }[]>`select body, media_ids from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
  const v = c.current_version + 1; const M = await import('./marketing'); const V = await import('./mktAutoVisual');
  const old = prev?.body ?? ''; let body = old; let q: { passed: boolean; issues: string[] }; let report: any = c.quality?.report ? { ...c.quality.report, v } : undefined; let brief = c.quality?.brief; let card = c.quality?.card;
  // 255차 fresh = 영상 글을 이미지 카드뉴스로 바꿔 만들기 — 예전 시안(영상)·대본·장은 버리고 서버가 표지·장을 새로 그림
  let script: string[] | null = o.fresh ? null : c.quality?.script ?? null; let pre: string[] = c.quality?.preflight ?? [];
  let pages: import('./mktAutoVisual').CardPage[] | null = o.fresh ? null : c.quality?.pages ?? null; // 요청 C: 카드뉴스 장·스토리 프레임(글을 다시 쓰면 새 원고의 장으로)
  let design: { memory: number; guide: number } | null = null; // 187차 ④ 이 수정본 지시문에 넣은 디자인 지침·기억
  if (o.text !== false) {
    const d = await writeDraft(c, s, brand, null, { prev: old, comment, ...(o.n ? { tier: 'deep' as WriteTier } : {}) }); design = d.design ?? null; // 255차 #792 수정 요청 수정본 = 최상 모델
    const f = await refineDraft(c, { ...d, title: c.title }, brand, { keepTitle: true });
    const qc = qualityCheck(f.body, d.brief, s, bannedOf(brand), c.kind);
    if (f.errors.length) { qc.passed = false; qc.issues = [...qc.issues, ...f.errors]; }
    if (VIDEO_KINDS.includes(c.kind) && f.script.length >= 2) script = f.script;
    pre = await preflightOf(c, brand, s, { title: c.title, body: qc.body, script }); // 로컬 QA 10/24 ②: 수정본도 올리기 전 검사
    if (pre.length) { qc.passed = false; qc.issues = [...new Set([...qc.issues, ...pre])]; }
    body = qc.body; q = { passed: qc.passed, issues: qc.issues }; report = { ...f.report, v, preflight: pre }; brief = d.brief || brief; card = d.card ?? card; if (d.pages?.length) pages = d.pages;
  } else q = { passed: c.quality?.passed !== false, issues: [...(c.quality?.issues ?? [])] };
  // 시안: 서버가 그린 시안이면(없으면 새로) 새 글로 다시 그림 — 사람이 붙인 사진·영상은 그대로
  let media = o.fresh ? [] : (prev?.media_ids ?? []).map(String); let visual = o.fresh ? null : c.quality?.visual ?? null; let drawn: Awaited<ReturnType<typeof V.drawAutoVisual>> | null = null;
  const server = V.serverVisual(c) && (o.fresh || (media.length ? visual?.by === 'server' && media[0] === visual.fileId : !!c.auto)); // 시안 없는 글은 자동 제작 글만 새로 그림(사람이 쓴 글에 그림을 붙이지 않음) · 카드뉴스로 바꿀 때는 새로
  if (server && (o.photo || body !== old || !media.length)) {
    const tried = new Set<string>([...((visual?.tried ?? []) as string[]), ...(visual?.photoId ? [visual.photoId as string] : [])]);
    // #544 피드 틀: 글만 고치면 같은 틀·같은 사진 · 사진을 바꾸라면 사진 틀은 그대로 새 사진으로, 사진 없는 틀이면 다른 틀로
    const F = await import('./mktFeedTemplates'); const t = visual?.template as string | undefined;
    const keepT = o.photo ? (t && F.usesPhoto(t) ? { template: t } : { notTemplate: t ?? null }) : { template: t ?? null };
    const bodyKeep = media.length ? media.slice(1) : ((c.quality?.bodyPlan ?? []) as string[]); // #235 ⓑ 블로그 본문 사진은 그대로(표지 바탕으로 다시 안 씀)
    drawn = await V.drawAutoVisual({ ...c, title: c.title, card }, body, { ...(o.photo ? { exclude: tried, ...keepT } : visual && 'photoId' in visual ? { photoId: visual.photoId ?? null, photoIds: visual.photoIds ?? null, ...keepT } : keepT), bodyIds: bodyKeep.length ? bodyKeep : null });
    const tail = media.length ? media.slice(1) : drawn.bodyIds;
    media = [drawn.fileId, ...tail];
    // 요청 C: 피드·스토리는 글이 바뀌었거나 장이 없으면 표지 뒤 장도 새 글로 다시(사진만 바꿀 때는 장 그대로) · 블로그는 표지+3장이 안 되면 도표형 카드로 채움
    if ((c.auto || o.fresh) && pagedKind(c) && (body !== old || tail.length === 0)) { const Q = await import('./mktQuality'); pages = V.pagesOf(c.kind, pages, body, Q.contactLine(factsOf(brand?.facts))); media = [drawn.fileId, ...(await V.drawPages(c, pages, { exclude: new Set([...(drawn.photoId ? [drawn.photoId] : []), ...drawn.photoIds]) }))]; }
    else if (c.auto && isBlog(c) && media.length < V.BLOG_AUTO_MEDIA) media = [...media, ...(await V.drawInfoCards(c, body, V.BLOG_AUTO_MEDIA - media.length).catch(() => [] as string[]))];
    visual = { by: 'server', fileId: drawn.fileId, at: new Date().toISOString(), photoId: drawn.photoId, rv: 3, tried: [...new Set([...tried, ...(drawn.photoId ? [drawn.photoId] : [])])].slice(-20), ...(media.length > 1 ? { bodyIds: media.slice(1) } : {}),
      ...(drawn.template ? { template: drawn.template } : {}), ...(drawn.photoIds.length > 1 ? { photoIds: drawn.photoIds } : {}), ...V.coverMark(drawn) };
    const left = q.issues.filter((x) => !V.VISUAL_ISSUE.test(x));
    if (!q.passed && q.issues.length && !left.length) q.passed = true; // 시안이 없어서만 막혀 있던 글
    q.issues = left;
  }
  // 요청 C §3-3: 사진 수 규칙(자동 제작 피드 3~5장·스토리 3~5프레임·블로그 표지+3장, 사람 글 블로그 2장) — 못 미치면 승인함 대신 수정 요청
  q.issues = q.issues.filter((x) => !M.MEDIA_RULES.includes(x));
  const mediaIssue = M.mediaRule(c.channel, c.kind, media.length, !!c.auto || !!o.fresh);
  if (mediaIssue) { q.passed = false; q.issues.push(mediaIssue); }
  const status = q.passed ? 'pending' : 'changes';
  // 요청 C §3-6(대표 10/25 22:20 '원래 게시일 유지'): 수정본은 원래 게시 시각 그대로 — 승인 마감이 이미 지났으면 다음 슬롯(#540 규칙)으로 옮기고 카드에 '원래 m/d → m/d'
  const movedN = Number(c.quality?.moved ?? 0);
  // 255차 #791: 수정 요청 수정본은 사람이 쓴 글도·몇 번 옮겼어도 원 게시일이 지났으면 다음 빈 칸으로(자동 다듬기는 예전처럼 자동 글 3번까지)
  const moveTo = status === 'pending' && c.scheduled_at && deadlineOf(c.scheduled_at, s).getTime() <= Date.now() && (o.n ? true : c.auto && movedN < 3) ? await nextSlot(c, s).catch(() => null) : null;
  const rescheduled = moveTo ? { from: new Date(c.scheduled_at).toISOString(), to: moveTo.toISOString(), at: new Date().toISOString() } : null;
  const changed = [...(body !== old ? ['text'] : []), ...(drawn ? ['visual'] : [])];
  const check = o.n ? checkRevision(comment, { body: old, photoId: c.quality?.visual?.photoId ?? null, template: c.quality?.visual?.template ?? null },
    { body, drawn: !!drawn, photoId: drawn?.photoId ?? null, template: drawn?.template ?? null }, { text: o.text !== false, photo: !!o.photo }) : null;
  const revision = o.n ? { ai: true, n: o.n, from: c.current_version, request: comment.slice(0, 500), by: o.by?.name ?? null, at: new Date().toISOString(), parts: changed, backdrop: drawn ? (drawn.photoTitle ?? '브랜드 색 바탕') : null, check } : null;
  const drawnNote = drawn ? ` · 시안 다시 그림(${[drawn.templateLabel ? `틀: ${drawn.templateLabel}` : '', drawn.photoTitle ? `사진: ${drawn.photoTitle}` : '브랜드 색 바탕'].filter(Boolean).join(' · ')})` : '';
  const checkNote = check?.detail ? ` (${check.status === 'applied' ? '확인: ' : ''}${check.detail})` : '';
  const note = (o.note ?? (o.n ? `수정본(AI 수정 ${o.n}번째) — ${revisionLabel(check)}: ${comment.slice(0, 160)}${checkNote}` : `수정 요청 반영(0크레딧): ${comment.slice(0, 200)}`)) + drawnNote + (await import('./mktTeam')).designNote(design);
  const ok = await sql.begin(async (tx) => {
    const [lock] = await tx<{ current_version: number; status: string }[]>`select current_version, status from mkt_contents where id = ${c.id} for update`;
    if (!lock || lock.current_version !== c.current_version || ['published', 'canceled'].includes(lock.status)) return false; // AI 가 쓰는 동안 다른 수정본·게시가 먼저 됨
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by, revision) values (${c.id}, ${v}, ${body}, ${media}, ${note}, ${o.actorId ?? c.created_by}, ${revision ? tx.json(revision as never) : null})`;
    await tx`update mkt_contents set current_version = ${v}, status = ${status}, quality = ${tx.json({ passed: q.passed, issues: q.issues, ...(brief ? { brief } : {}), ...(design ? { design } : c.quality?.design ? { design: c.quality.design } : {}), ...(report ? { report } : {}), ...(card ? { card } : {}), ...(visual ? { visual } : {}), ...(script ? { script } : {}), ...(pre.length ? { preflight: pre } : {}), ...(pages?.length ? { pages } : {}),
      ...(rescheduled ? { rescheduled, moved: movedN + 1, movedFrom: rescheduled.from } : c.quality?.moved ? { moved: c.quality.moved, movedFrom: c.quality.movedFrom ?? null } : {}) } as never)}, reminded_at = null, updated_at = now() where id = ${c.id}`;
    if (moveTo) await tx`update mkt_contents set scheduled_at = ${moveTo} where id = ${c.id}`;
    if (o.fresh) { // 255차: 영상 → 이미지 카드뉴스(형식 바꿈 · 열린 영상 제작 요청은 취소)
      await tx`update mkt_contents set kind = ${c.kind} where id = ${c.id}`;
      await tx`update mkt_production_requests set status = 'canceled', reason = coalesce(reason, '이미지 카드뉴스로 바꿔 만듦'), decided_at = now() where content_id = ${c.id} and kind in ('video', 'regen_video', 'image', 'regen_image') and status in ('open', 'needs_approval')`;
    }
    if (body !== old) await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'text', 0, ${o.ledgerNote ?? '수정 요청 — 글자'}, ${c.title})`;
    if (drawn) await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'generate_image', 0, '수정 요청 — 시안 서버 다시 그리기(크레딧 0)', ${c.title})`;
    return true;
  });
  if (!ok) return { version: null as number | null, skipped: '그사이 다른 수정본이 올라왔습니다' };
  const when = (d: Date) => `${Number(ymd(d).slice(5, 7))}/${Number(ymd(d).slice(8))} ${hm(d)}`;
  if (o.n && status === 'pending' && !isQuiet(new Date(), s)) await mktNotify(sql, c, o.by?.id ?? null, { approval: true, type: 'review_requested', title: `수정본 승인 요청(v${v}): ${c.title}`, body: `${revisionLabel(check)}: ${comment.slice(0, 120)}${checkNote}${moveTo ? ` · 승인 마감이 지나 ${when(new Date(c.scheduled_at))} → ${when(moveTo)} 게시로 옮김` : ''}`,
    link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, actorId: o.by?.id ?? null, dedupeKey: `mktrev:${c.id}:${v}` });
  return { version: v as number | null, status, parts: changed, n: o.n ?? null, backdrop: revision?.backdrop ?? null, check, ...(rescheduled ? { rescheduled } : {}) };
}

// ---------------- 화면 API ----------------
export async function automationView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const s = await settingsOf(t);
  const [rules, requests, ledger, brands, people] = await Promise.all([
    sql`select r.id, r.brand_id, b.name as brand, r.channel, r.kind, r.weekdays, r.post_time, r.topic_hint, r.active, r.interval_days, r.anchor_date::text as anchor_date, r.cross_channels, r.bundle_key, r.skip_weekend, r.mode from mkt_rules r left join mkt_brands b on b.id = r.brand_id where r.tenant = ${t} order by r.created_at`,
    sql`select q.id, q.kind, q.brief, q.est_credits::float8 est_credits, q.status, q.reason, q.created_at, q.brief_id, c.id as content_id, c.title, c.scheduled_at from mkt_production_requests q join mkt_contents c on c.id = q.content_id
      where q.tenant = ${t} and q.status in ('open', 'needs_approval') order by c.scheduled_at nulls last limit 50`,
    sql`select l.kind, l.credits::float8 credits, l.note, l.version, l.created_at, coalesce(l.title, c.title) as title from mkt_credit_ledger l left join mkt_contents c on c.id = l.content_id where l.tenant = ${t} order by l.created_at desc limit 30`,
    sql`select id, name, color, tone, intro, products, weekly_topic, banned_words, test_mode, ad_priority, ad_share::float8 as ad_share, ad_note, voice, video, feed, facts, topic_pool, examples from mkt_brands where tenant = ${t} order by name`,
    sql`select id, name, role from users where tenant = ${t} and status = 'active' and not is_demo order by name`,
  ]);
  const co = await (await import('./ai/assistant')).usageThisMonth(t);
  // #544(로컬 13:55): 그림·프롬프트가 실제로 쓰는 바탕 색과 출처(피드 틀·영상 끝 화면·브랜드 색·회사 기본 색)를 키트 화면에 그대로
  const D = await import('./mktCarouselDraw');
  const withDraw = await Promise.all((brands as any[]).map(async (b) => ({ ...b, draw: await D.brandColorInfo(t, b).catch(() => ({ color: null, from: null })) })));
  // #602(대표 10/25): 고객사에게는 모델 이름·원고 1건 비용·달러 한도·외부 서비스 이름을 빼고 등급 이름·원화·크레딧만(슈퍼관리자·내부 테넌트는 그대로)
  const full = seesInternals(u); const rate = (await import('./ai/provider')).usdKrw();
  const wm = await writeModelInfo(s); const lim = limitsOf(s); const plans = await planTable();
  const usageAll = { ...(await usageOf(t)), ai: await mktAiUsd(t), companyAiUsd: co.costUsd, companyAiLimitUsd: co.limitUsd, companyAi: { usedKrw: co.budget.usedKrw, limitKrw: co.budget.limitKrw, pct: co.budget.pct, resetLabel: co.budget.resetLabel } };
  const krwOf = (usd: number | null) => (usd === null ? null : Math.round(usd * rate));
  const { ai: _ai, companyAiUsd: _cu, companyAiLimitUsd: _cl, ...usageCust } = usageAll;
  const planCust = Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, { ...p, aiMonthlyUsd: null, aiMonthlyKrw: krwOf(p.aiMonthlyUsd) }]));
  const nb = nextBatch(s); // 267차(대표 #795) 승인 올리는 방식 안내 줄
  const [wait] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_contents where tenant = ${t} and status = 'draft' and quality ? 'batch' and not (quality->'batch' ? 'released') and deleted_at is null`;
  return { full, rhythm: { deadlineRule: deadlineRule(s), next: nb ? { at: nb.at.toISOString(), label: nb.label } : null, waiting: wait.n, dows: DOW, prepHours: BATCH_PREP_H },
    settings: full ? s : { ...s, ai_monthly_usd: null, plan: s.plan ? { ...s.plan, aiMonthlyUsd: null, writeTier: null } : s.plan }, limits: full ? lim : { ...lim, aiMonthlyUsd: null, aiMonthlyKrw: krwOf(lim.aiMonthlyUsd) },
    writeModel: full ? wm : { tier: wm.tier, label: wm.label, source: wm.source, blog: { tier: wm.blog.tier, label: wm.blog.label, upgraded: wm.blog.upgraded } },
    usage: full ? usageAll : usageCust, plans: full ? plans : planCust, production: await productionLeft(t), rules,
    requests: full ? requests : (requests as unknown as { reason: string | null }[]).map((r) => ({ ...r, reason: customerText(r.reason) })), ledger: full ? ledger : (ledger as unknown as { note: string | null }[]).map((l) => ({ ...l, note: customerText(l.note) })), brands: withDraw, people, canEdit: isAdmin(u),
    feedCatalog: { templates: TEMPLATE_IDS.map((id) => { const x = FEED_TEMPLATES[id]; return { id, label: x.label, desc: x.desc, need: x.need ? NEED_LABEL[x.need as keyof typeof NEED_LABEL] : null }; }), styles: Object.entries(FEED_STYLES).map(([id, x]) => ({ id, label: x.label, templates: [...x.templates] as string[] })) } };
}
/** 대표 10/27 ⑤('요금제는 한곳에 — 자동 제작실은 제작만'): 사용량·요금제 화면의 마케팅 제작 요금제 — 요금제 표·이번 달 쓴 크레딧·직접 정한 한도만(자동 제작실 전체는 안 불러옴) */
export async function mktPlanView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const s = await settingsOf(t); const plans = await planTable(); const use = await usageOf(t);
  const full = seesInternals(u); const rate = (await import('./ai/provider')).usdKrw();
  return { planCode: s.plan_code, overrides: { monthlyCredits: s.monthly_credits, weeklyCredits: s.weekly_credits, videoMonthly: s.video_monthly, regenMonthly: s.regen_monthly },
    plans: Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, full ? p : { ...p, aiMonthlyUsd: null, aiMonthlyKrw: p.aiMonthlyUsd === null ? null : Math.round(p.aiMonthlyUsd * rate), writeTier: null }])),
    used: { monthCredits: use.monthCredits, monthVideos: use.monthVideos, monthRegens: use.monthRegens }, canEdit: isAdmin(u) };
}
function adminOnly(u: SessionUser) { if (!isAdmin(u)) throw forbidden('자동 제작 설정은 관리자가 합니다'); }

const nInt = (a: number, b: number) => z.number().int().min(a).max(b);
export const settingsInput = z.object({ planCode: z.enum(['basic', 'standard', 'pro']).nullable().optional(), monthlyCredits: z.number().min(0).max(100000).nullable().optional(), weeklyCredits: z.number().min(0).max(100000).nullable().optional(),
  videoMonthly: nInt(0, 1000).nullable().optional(), regenMonthly: nInt(0, 1000).nullable().optional(), approvalHour: nInt(0, 23).optional(), leadDays: nInt(0, 14).optional(), leadHour: nInt(0, 23).optional(),
  remindHours: nInt(0, 72).optional(), quietStart: nInt(0, 23).optional(), quietEnd: nInt(0, 23).optional(), allowGeneratedPeople: z.boolean().optional(), allowSlideshow: z.boolean().optional(), aiLabel: z.string().trim().min(2).max(60).optional(), notifyUserIds: z.array(zUuid).max(30).nullable().optional(), aiMonthlyUsd: z.number().min(0).max(10000).nullable().optional(), autoPublish: z.boolean().optional(), autoPause: z.boolean().optional(), autoHold: z.boolean().optional(),
  /** 요청 C §3-1: 릴스·쇼츠·생성 영상 자동 제작 중단(기본 켬) */ videoPause: z.boolean().optional(),
  /** 189차: 사진이 모자라면 실사 참고로 생성(크레딧) */ photoGen: z.boolean().optional(),
  /** 267차(대표 #795): 승인 올리는 방식·묶음 요일·시각·승인 마감 며칠 전 */ approvalMode: z.enum(['weekly', 'lead']).optional(), batchDow: nInt(0, 6).optional(), batchHour: nInt(0, 23).optional(), deadlineDays: nInt(0, 7).optional(),
  /** 270차 #809 내부 회사 이미지·영상 생성 월 실제 비용 한도(원, null = 요금제 숫자) */ costCapKrw: nInt(0, 100_000_000).nullable().optional() });
export async function saveSettings(u: SessionUser, i: z.infer<typeof settingsInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const cur = await settingsOf(tenantOf(u));
  const v = { plan_code: i.planCode !== undefined ? i.planCode : cur.plan_code, monthly_credits: i.monthlyCredits !== undefined ? i.monthlyCredits : cur.monthly_credits, weekly_credits: i.weeklyCredits !== undefined ? i.weeklyCredits : cur.weekly_credits,
    video_monthly: i.videoMonthly !== undefined ? i.videoMonthly : cur.video_monthly, regen_monthly: i.regenMonthly !== undefined ? i.regenMonthly : cur.regen_monthly, approval_hour: i.approvalHour ?? cur.approval_hour,
    lead_days: i.leadDays ?? cur.lead_days, lead_hour: i.leadHour ?? cur.lead_hour, remind_hours: i.remindHours ?? cur.remind_hours, quiet_start: i.quietStart ?? cur.quiet_start, quiet_end: i.quietEnd ?? cur.quiet_end,
    allow_generated_people: i.allowGeneratedPeople ?? cur.allow_generated_people, allow_slideshow: i.allowSlideshow ?? cur.allow_slideshow, ai_label: i.aiLabel ?? cur.ai_label,
    notify_user_ids: i.notifyUserIds !== undefined ? (i.notifyUserIds?.length ? i.notifyUserIds : null) : cur.notify_user_ids, ai_monthly_usd: i.aiMonthlyUsd !== undefined ? i.aiMonthlyUsd : cur.ai_monthly_usd, auto_publish: i.autoPublish ?? cur.auto_publish, auto_hold: i.autoHold ?? cur.auto_hold,
    auto_pause: i.autoPause ?? cur.auto_pause, video_pause: i.videoPause ?? cur.video_pause, photo_gen: i.photoGen ?? cur.photo_gen,
    approval_mode: i.approvalMode ?? cur.approval_mode, batch_dow: i.batchDow ?? cur.batch_dow, batch_hour: i.batchHour ?? cur.batch_hour, deadline_days: i.deadlineDays ?? cur.deadline_days,
    cost_cap_krw: cur.internal && i.costCapKrw !== undefined ? i.costCapKrw : cur.cost_cap_krw }; // 내부 회사만 바꿈
  const sql = db();
  await sql`insert into mkt_settings ${sql({ tenant: tenantOf(u), ...v, updated_by: u.id } as never)}
    on conflict (tenant) do update set plan_code = excluded.plan_code, monthly_credits = excluded.monthly_credits, weekly_credits = excluded.weekly_credits, video_monthly = excluded.video_monthly,
      regen_monthly = excluded.regen_monthly, approval_hour = excluded.approval_hour, lead_days = excluded.lead_days, lead_hour = excluded.lead_hour, remind_hours = excluded.remind_hours,
      quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, allow_generated_people = excluded.allow_generated_people, allow_slideshow = excluded.allow_slideshow, ai_label = excluded.ai_label, notify_user_ids = excluded.notify_user_ids, ai_monthly_usd = excluded.ai_monthly_usd, auto_publish = excluded.auto_publish, auto_hold = excluded.auto_hold,
      auto_pause = excluded.auto_pause, video_pause = excluded.video_pause, photo_gen = excluded.photo_gen, approval_mode = excluded.approval_mode, batch_dow = excluded.batch_dow, batch_hour = excluded.batch_hour,
      deadline_days = excluded.deadline_days, cost_cap_krw = excluded.cost_cap_krw, updated_by = excluded.updated_by, updated_at = now()`;
  if (v.cost_cap_krw !== cur.cost_cap_krw) await (await import('./log')).audit(sql, u.id, 'mkt.cost_cap', 'tenant', tenantOf(u), { from: cur.cost_cap_krw, to: v.cost_cap_krw }).catch(() => {});
  if (v.approval_mode !== cur.approval_mode) await (await import('./log')).audit(sql, u.id, 'mkt.approval_mode', 'tenant', tenantOf(u), { from: cur.approval_mode, to: v.approval_mode }).catch(() => {});
  if (i.autoPause !== undefined && i.autoPause !== cur.auto_pause) await (await import('./log')).audit(sql, u.id, i.autoPause ? 'mkt.auto_pause' : 'mkt.auto_resume', 'tenant', tenantOf(u), {}).catch(() => {});
  if (i.videoPause !== undefined && i.videoPause !== cur.video_pause) await (await import('./log')).audit(sql, u.id, i.videoPause ? 'mkt.video_pause' : 'mkt.video_resume', 'tenant', tenantOf(u), {}).catch(() => {});
  if (i.photoGen !== undefined && i.photoGen !== cur.photo_gen) await (await import('./log')).audit(sql, u.id, i.photoGen ? 'mkt.photo_gen_on' : 'mkt.photo_gen_off', 'tenant', tenantOf(u), {}).catch(() => {});
  // 제작 시점(게시 D-n·시각 · 267차 승인 올리는 방식·묶음 요일·시각)이 바뀌면 아직 만들지 않은 자동 칸도 다시 계산(지난 시각이면 지금)
  const weekly = v.approval_mode === 'weekly';
  const changed = v.approval_mode !== cur.approval_mode || (weekly ? v.batch_dow !== cur.batch_dow || v.batch_hour !== cur.batch_hour : v.lead_days !== cur.lead_days || v.lead_hour !== cur.lead_hour);
  const back = ((1 - v.batch_dow + 7) % 7) || 7;
  const re = !changed ? [] : weekly
    ? await sql`update mkt_contents set produce_at = greatest(now(), (date_trunc('week', scheduled_at at time zone 'Asia/Seoul') - make_interval(days => ${back}::int) + make_interval(hours => ${v.batch_hour - BATCH_PREP_H}::int)) at time zone 'Asia/Seoul')
        where tenant = ${tenantOf(u)} and auto and status = 'draft' and produced_at is null and scheduled_at is not null returning id`
    : await sql`update mkt_contents set produce_at = greatest(now(), (((scheduled_at at time zone 'Asia/Seoul')::date - ${v.lead_days}::int) + make_time(${v.lead_hour}::int, 0, 0)) at time zone 'Asia/Seoul')
        where tenant = ${tenantOf(u)} and auto and status = 'draft' and produced_at is null and scheduled_at is not null returning id`;
  const released = !weekly && cur.approval_mode === 'weekly' ? await releaseBatches(tenantOf(u)).catch(() => []) : []; // 한 건씩으로 바꾸면 모아 둔 원고를 바로 승인함에
  return { ok: true, rescheduled: re.length, ...(released.length ? { released } : {}) };
}

const ruleBase = z.object({ brandId: zUuid.nullable().optional(), channel: z.enum(['instagram', 'facebook', 'threads', 'blog', 'youtube', 'naver_place', 'other']), kind: z.enum(['feed', 'blog', 'reels', 'video', 'shorts', 'story', 'photo']),
  weekdays: z.array(nInt(0, 6)).max(7).default([]), postTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), topicHint: z.string().max(300).optional(), active: z.boolean().optional(),
  /** 대표 10/20 6): n일마다(요일 대신)·시작일·같은 글을 함께 올릴 채널 */
  intervalDays: nInt(1, 30).nullable().optional(), anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), crossChannels: z.array(z.enum(['instagram', 'facebook', 'threads'])).max(3).optional(), skipWeekend: z.boolean().optional(),
  /** #499-1 용도: 콘텐츠형(참여) / 광고형(전환) — 훅·구성 안내와 채점이 다름 */
  mode: z.enum(['content', 'ad']).optional() })
export const ruleInput = ruleBase.refine((i) => i.intervalDays || i.weekdays.length, { message: '요일을 고르거나 n일마다를 정하세요' });
export async function createRule(u: SessionUser, i: z.infer<typeof ruleInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  if (i.brandId && !(await sql`select 1 from mkt_brands where id = ${i.brandId} and tenant = ${t}`).length) throw notFound('브랜드를 찾을 수 없습니다');
  const [r] = await sql<{ id: string }[]>`insert into mkt_rules (tenant, brand_id, channel, kind, weekdays, post_time, topic_hint, active, created_by, interval_days, anchor_date, cross_channels, skip_weekend, mode)
    values (${t}, ${i.brandId ?? null}, ${i.channel}, ${i.kind}, ${[...new Set(i.weekdays)].sort()}, ${i.postTime}, ${i.topicHint ?? null}, ${i.active ?? true}, ${u.id}, ${i.intervalDays ?? null}, ${i.anchorDate ?? null}, ${(i.crossChannels ?? []).filter((c) => c !== i.channel)}, ${i.skipWeekend ?? false}, ${i.mode ?? 'content'}) returning id`;
  return { id: r.id, planned: await planSlots(t) };
}
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** 로컬 10/20 보완 ②: 묶음의 종류별 게시 시각을 한 번에(피드·쇼츠·릴스·블로그·스토리) — 비우면 기본 BUNDLE 시각 */
const bundleTimes = z.object({ feed: HHMM.optional(), shorts: HHMM.optional(), reels: HHMM.optional(), blog: HHMM.optional(), story: HHMM.optional() });
export const bundleInput = z.object({ brandId: zUuid.nullable().optional(), intervalDays: nInt(2, 3).default(3), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), topicHint: z.string().max(300).optional(),
  weekdays: z.array(nInt(0, 6)).max(7).optional(), skipWeekend: z.boolean().optional(), times: bundleTimes.optional(), // 로컬 10/20 보완: 요일 지정(월·수·금)·주말 건너뛰기·시각
  kinds: z.array(z.enum(['feed', 'shorts', 'reels', 'blog', 'story'])).min(1).max(5).optional() }); // 270차 #808: 묶음에 넣을 종류(예: 스토리 빼고 피드·릴스·쇼츠·블로그 4개)
/** 대표 10/20 6): 기본 묶음 규칙 5개를 한 번에(브랜드마다, 2~3일에 한 번) — 같은 bundle_key, 요일 대신 n일마다(또는 요일 지정) */
export async function createBundle(u: SessionUser, i: z.infer<typeof bundleInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  if (i.brandId && !(await sql`select 1 from mkt_brands where id = ${i.brandId} and tenant = ${t}`).length) throw notFound('브랜드를 찾을 수 없습니다');
  const key = randomUUID(); const start = i.startDate ?? ymd(new Date());
  const byDow = !!i.weekdays?.length; // 요일을 고르면 n일마다 대신 그 요일에(마케팅 계획: 워크인 월·수·금, 하이링크·다짐 화·목·토)
  const ids: string[] = [];
  for (const b of BUNDLE.filter((x) => !i.kinds?.length || i.kinds.includes(x.kind as never))) {
    const [r] = await sql<{ id: string }[]>`insert into mkt_rules (tenant, brand_id, channel, kind, weekdays, post_time, topic_hint, active, created_by, interval_days, anchor_date, cross_channels, bundle_key, skip_weekend)
      values (${t}, ${i.brandId ?? null}, ${b.channel}, ${b.kind}, ${byDow ? [...new Set(i.weekdays)].sort() : []}, ${i.times?.[b.kind as keyof typeof i.times] ?? b.postTime}, ${i.topicHint ?? null}, true, ${u.id}, ${byDow ? null : i.intervalDays}, ${byDow ? null : start}, ${b.cross}, ${key}, ${!byDow && !!i.skipWeekend}) returning id`;
    ids.push(r.id);
  }
  return { bundleKey: key, ids, planned: await planSlots(t) };
}
export const bundlePatch = z.object({ bundleKey: zUuid, times: bundleTimes.optional(), weekdays: z.array(nInt(0, 6)).max(7).optional(), intervalDays: nInt(1, 30).optional(), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), skipWeekend: z.boolean().optional() });
/** 로컬 10/20 보완: 이미 만든 묶음의 시각·요일/주기·주말 건너뛰기를 한 번에 — 아직 제작 안 한 초안은 새 시각으로 옮기고(요일·주기를 바꾸면 지우고 다시 계획) */
export async function updateBundle(u: SessionUser, i: z.infer<typeof bundlePatch>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  const rules = await sql<{ id: string; kind: string }[]>`select id, kind from mkt_rules where tenant = ${t} and bundle_key = ${i.bundleKey}`;
  if (!rules.length) throw notFound('묶음을 찾을 수 없습니다');
  const ids = rules.map((r) => r.id);
  for (const r of rules) {
    const tm = i.times?.[r.kind as keyof typeof i.times];
    if (!tm) continue;
    await sql`update mkt_rules set post_time = ${tm} where id = ${r.id}`;
    // 제작 전 초안은 같은 날 새 시각으로 — 대표 10/24 ③: 새 시각이 같은 브랜드·채널·형식 하루 2건·3시간 규칙에 걸리는 칸은 지움(아직 빈 칸 — 규칙도 다시 만들지 않음)
    const drafts = await sql<{ id: string; tenant: string; brand_id: string | null; channel: string; kind: string | null; d: string }[]>`select id, tenant, brand_id, channel, kind, (scheduled_at at time zone 'Asia/Seoul')::date::text as d
      from mkt_contents where rule_id = ${r.id} and status = 'draft' and produced_at is null and scheduled_at > now()`;
    for (const c of drafts) {
      const at = kst(c.d, tm);
      const peers = await slotPeers(sql, c, c.d, c.d);
      if (peers.length && slotIssue({ topics: [], visuals: [] }, peers, at)) await sql`delete from mkt_contents where id = ${c.id}`;
      else await sql`update mkt_contents set scheduled_at = ${at} where id = ${c.id}`;
    }
  }
  const reschedule = i.weekdays !== undefined || i.intervalDays !== undefined || i.skipWeekend !== undefined || i.startDate !== undefined;
  if (reschedule) {
    const byDow = !!i.weekdays?.length;
    await sql`update mkt_rules set weekdays = case when ${byDow} then ${byDow ? [...new Set(i.weekdays)].sort() : []}::int[] else weekdays end,
      interval_days = case when ${byDow} then null else coalesce(${i.intervalDays ?? null}, interval_days) end, anchor_date = case when ${byDow} then null else coalesce(${i.startDate ?? null}, anchor_date) end,
      skip_weekend = case when ${byDow} then false else coalesce(${i.skipWeekend ?? null}, skip_weekend) end where id = any(${ids}::uuid[])`;
    await sql`delete from mkt_contents where rule_id = any(${ids}::uuid[]) and tenant = ${t} and status = 'draft' and produced_at is null and scheduled_at > now()`;
  }
  return { ok: true, planned: await planSlots(t) };
}
export const rulePatch = ruleBase.partial();
export async function updateRule(u: SessionUser, id: string, i: z.infer<typeof rulePatch>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db();
  const [r] = await sql`update mkt_rules set channel = coalesce(${i.channel ?? null}, channel), kind = coalesce(${i.kind ?? null}, kind), weekdays = coalesce(${i.weekdays ? ([...new Set(i.weekdays)].sort() as number[]) : null}::int[], weekdays), interval_days = coalesce(${i.intervalDays ?? null}, interval_days), anchor_date = coalesce(${i.anchorDate ?? null}, anchor_date),
    post_time = coalesce(${i.postTime ?? null}, post_time), topic_hint = coalesce(${i.topicHint ?? null}, topic_hint), active = coalesce(${i.active ?? null}, active), skip_weekend = coalesce(${i.skipWeekend ?? null}, skip_weekend),
    mode = coalesce(${i.mode ?? null}, mode) where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!r) throw notFound();
  if (i.mode) await sql`update mkt_contents set mode = ${i.mode} where rule_id = ${id} and tenant = ${tenantOf(u)} and status = 'draft' and produced_at is null`; // 아직 안 만든 칸도 새 용도로
  return { ok: true };
}
/** 규칙 지우기: 아직 제작 안 한 초안만 같이 지움(제작된 것·승인 이력은 남김) */
export async function deleteRule(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db();
  await sql`delete from mkt_contents where rule_id = ${id} and tenant = ${tenantOf(u)} and status = 'draft' and produced_at is null`;
  const r = await sql`delete from mkt_rules where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!r.length) throw notFound();
  return { ok: true };
}

export const requestAction = z.object({ action: z.enum(['approve', 'done', 'cancel']), topic: z.string().trim().min(2).max(300).optional(), credits: z.number().min(0).max(10000).optional(), mediaIds: z.array(zUuid).max(10).optional() });
/** 제작 요청 카드: 승인(한도 초과 제작 허용) · 완료(실제 사용 크레딧 원장 기록, 만든 자료를 시안으로 붙이면 새 버전) · 취소 */
export async function actRequest(u: SessionUser, id: string, i: z.infer<typeof requestAction>) {
  await assertSpace(u, 'marketing');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [q] = await sql<any[]>`select * from mkt_production_requests where id = ${id} and tenant = ${t}`;
  if (!q) throw notFound();
  if (i.action === 'approve') { adminOnly(u); if (q.status !== 'needs_approval') throw badRequest('승인할 요청이 아닙니다');
    await sql`update mkt_production_requests set status = 'open', decided_by = ${u.id}, decided_at = now() where id = ${id}`; return { status: 'open' }; }
  if (i.action === 'cancel' && q.kind === 'topic') { // 주제 질문 취소 = 이번 칸 건너뛰기
    await sql.begin(async (tx) => {
      await tx`update mkt_production_requests set status = 'canceled', decided_by = ${u.id}, decided_at = now() where id = ${id}`;
      await tx`update mkt_contents set status = 'canceled', updated_at = now() where id = ${q.content_id} and tenant = ${t} and status = 'draft' and produced_at is null`;
    });
    return { status: 'canceled' };
  }
  if (i.action === 'cancel') { await sql`update mkt_production_requests set status = 'canceled', decided_by = ${u.id}, decided_at = now() where id = ${id}`; await (await import('./mktStudio')).onRequestSettled(id, 'canceled'); return { status: 'canceled' }; }
  if (q.kind === 'topic') { // 주제 답 → 다음 실행(또는 지금 한 번 돌리기)에 그 주제로 제작
    if (q.status !== 'open') throw badRequest('이미 끝난 요청입니다');
    if (!i.topic) throw badRequest('주제를 적어 주세요');
    await sql.begin(async (tx) => {
      await tx`update mkt_contents set quality = coalesce(quality, '{}'::jsonb) || ${tx.json({ topic: i.topic } as never)}, produce_at = least(coalesce(produce_at, now()), now()), updated_at = now() where id = ${q.content_id} and tenant = ${t}`;
      await tx`update mkt_production_requests set status = 'done', brief = ${`${q.brief}\n\n답: ${i.topic}`.slice(0, 4000)}, decided_by = ${u.id}, decided_at = now() where id = ${id}`;
    });
    return { status: 'done' };
  }
  if (q.status !== 'open') throw badRequest(q.status === 'needs_approval' ? '한도를 넘는 제작이라 관리자 승인이 먼저 필요합니다' : '이미 끝난 요청입니다');
  const credits = i.credits ?? Number(q.est_credits);
  const kind = q.kind === 'image' ? 'generate_image' : q.kind === 'video' ? 'generate_video' : q.kind;
  if (i.mediaIds?.length) { const { addVersion } = await import('./marketing'); const [prev] = await sql<{ body: string }[]>`select v.body from mkt_versions v join mkt_contents c on c.id = v.content_id and v.version = c.current_version where c.id = ${q.content_id}`;
    await addVersion(u, q.content_id, { body: prev?.body ?? '', mediaIds: i.mediaIds, note: `제작 요청 완료(${{ image: '이미지', video: '영상', regen_image: '이미지 재생성', regen_video: '영상 재생성' }[q.kind as 'image']})` }); }
  await sql.begin(async (tx) => {
    await tx`update mkt_production_requests set status = 'done', decided_by = ${u.id}, decided_at = now() where id = ${id}`;
    await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, created_by, title) values (${t}, ${q.content_id}, ${q.version}, ${kind}, ${credits}, ${'제작 요청 완료'}, ${u.id}, (select title from mkt_contents where id = ${q.content_id}))`;
  });
  await (await import('./mktStudio')).onRequestSettled(id, 'done'); // 제작의뢰실 의뢰 → 승인 대기
  return { status: 'done', credits };
}

export const contentActInput = z.object({ action: z.enum(['regen', 'archive', 'polish', 'submit', 'revise', 'to_cards']) });
/** 시안 다시 만들기(자동 제작 시안: 지금 재료로 새 버전 — 이전 이미지·영상 카드는 취소) · 보관(취소 상태 = 목록에서 숨김, 지우지 않음) · #426 AI로 다듬기(사람이 쓴 글도, 같은 사진으로 새 버전) */
export async function actContent(u: SessionUser, id: string, i: z.infer<typeof contentActInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db();
  const [c] = await sql<any[]>`select * from mkt_contents where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!c) throw notFound();
  if (['published', 'canceled'].includes(c.status)) throw badRequest('게시되었거나 보관된 콘텐츠입니다');
  if (i.action === 'archive') {
    await sql.begin(async (tx) => {
      await tx`update mkt_contents set status = 'canceled', quality = coalesce(quality, '{}'::jsonb) || ${tx.json({ archived_by: u.id } as never)}, updated_at = now() where id = ${id}`;
      await tx`update mkt_production_requests set status = 'canceled', decided_by = ${u.id}, decided_at = now() where content_id = ${id} and status in ('open', 'needs_approval')`;
    });
    return { status: 'canceled' };
  }
  if (i.action === 'revise' || i.action === 'to_cards') {
    // 255차 #792: [AI 수정본 만들기] = 이 버전에 남은 수정 요청을 지금 처리(255차 전 사람이 쓴 글은 수정본을 안 만들었음)
    //   [이미지 카드뉴스로 바꿔 만들기 · 0크레딧] = 영상 글(인스타·페이스북)을 카드뉴스로 — 최상 모델이 캡션·장을 다시 쓰고 서버가 표지·장을 그림(영상 제작 요청은 취소)
    const [d] = await sql<{ comment: string | null }[]>`select comment from mkt_decisions where content_id = ${id} and version = ${c.current_version} and decision = 'changes' order by decided_at desc limit 1`;
    if (i.action === 'revise') {
      if (c.status !== 'changes' || !d?.comment) throw badRequest('이 버전에 처리할 수정 요청이 없습니다 — 새로 고쳐 확인해 주세요');
      const r = await onChangesRequested(id, d.comment, { id: u.id, name: u.name });
      await (await import('./log')).audit(sql, u.id, 'mkt.revise_now', 'mkt_content', id, { kind: (r as any)?.kind ?? null }).catch(() => {});
      return { revision: r };
    }
    if (!VIDEO_KINDS.includes(c.kind) || !['instagram', 'facebook'].includes(c.channel)) throw badRequest('인스타그램·페이스북 영상 글만 이미지 카드뉴스로 바꿀 수 있습니다');
    if (c.status === 'approved') throw badRequest('승인된 글은 바꾸지 않습니다 — [게시 전 수정 요청] 뒤에');
    const [n] = await sql<{ n: number }[]>`select count(*)::int as n from mkt_versions where content_id = ${id} and coalesce((revision->>'ai')::boolean, false)`;
    const ask = `${d?.comment ? `${d.comment}\n\n` : ''}영상 대신 이미지 카드뉴스(표지 + 3~5장)로 바꿔 만듭니다 — 캡션도 카드뉴스에 맞게(장마다 한 가지 내용, 첫 장은 훅).`;
    const r = await reviseText({ ...c, kind: 'feed' }, ask, { text: true, photo: true, fresh: true, by: { id: u.id, name: u.name }, n: n.n + 1, actorId: u.id, ledgerNote: '이미지 카드뉴스로 바꿔 만들기 — 글자' });
    await (await import('./log')).audit(sql, u.id, 'mkt.to_cards', 'mkt_content', id, { from: c.kind, version: r.version }).catch(() => {});
    return { revision: { kind: 'cards', ...r } };
  }
  if (i.action === 'submit') {
    // #544 초안 보관 자동 시안 → 사람이 [승인 요청]: 승인 대기(검사 미통과면 수정 요청 칸) · 승인자 알림 · 감사 기록
    if (c.status !== 'draft' || !c.quality?.held) throw badRequest('초안 보관 중인 자동 시안만 승인 요청할 수 있습니다 — 새로 고쳐 확인해 주세요');
    const { held, ...q } = c.quality;
    const st = q.passed === false ? 'changes' : 'pending';
    const n = await sql`update mkt_contents set status = ${st}, reminded_at = null, quality = ${sql.json({ ...q, submitted: { by: u.id, at: new Date().toISOString(), heldAt: held?.at ?? null } } as never)}, updated_at = now()
      where id = ${id} and status = 'draft'`.then((r) => r.count);
    if (!n) throw badRequest('이미 처리된 초안입니다 — 새로 고쳐 확인해 주세요');
    await mktNotify(sql, c, u.id, { approval: true, type: 'review_requested', title: `승인 대기: ${c.title}`, body: `${u.name} · 초안 보관 자동 시안 승인 요청`, link: `/s/marketing/approvals?c=${id}`, entityType: 'mkt_content', entityId: id, dedupeKey: `mktsubmit:${id}:${c.current_version}` });
    await (await import('./log')).audit(sql, u.id, 'mkt.held_submit', 'mkt_content', id, { status: st }).catch(() => {});
    return { status: st };
  }
  if (i.action === 'polish') {
    if (c.status === 'approved') throw badRequest('승인된 시안은 다듬지 않습니다 — [게시 전 수정 요청]으로 바꿔 주세요');
    if (!(await import('./ai/provider')).aiEnabled()) throw badRequest('AI 비서가 꺼져 있어 다듬을 수 없습니다');
    const [cur] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${id} and version = ${c.current_version}`;
    if (!cur?.body?.trim()) throw badRequest('다듬을 본문이 없습니다');
    const Q = await import('./mktQuality');
    const [brand] = c.brand_id ? await sql<any[]>`select voice from mkt_brands where id = ${c.brand_id}` : [];
    const r = Q.qualityReport({ channel: c.channel, kind: c.kind, title: c.title, body: cur.body, voice: brand?.voice, mode: Q.asMode(c.mode) }, await Q.qualityRules()).report;
    const why = [...r.human.issues.filter((x) => !/지움|바꿈/.test(x)), ...(r.hook && !r.hook.pass ? [`첫 줄 훅이 약함(${r.hook.score}점${r.hook.fails.length ? `: ${r.hook.fails.join('·')}` : ''})`] : []), ...r.voice].join(', ');
    const comment = `AI 티 줄이기 — ${why || '문장을 더 사람답게'}. 사실·숫자·가격·브랜드 이름·링크는 그대로 두고, 상투어·과한 느낌표·이모지 나열·특수 대시를 빼고 문장 길이를 섞어 주세요.${r.hook && !r.hook.pass ? ' 첫 줄은 구체적인 숫자·장면·대상으로 다시.' : ''}`;
    const rv = await reviseText(c, comment, { note: `AI로 다듬기(0크레딧)${why ? `: ${why.slice(0, 160)}` : ''}`, ledgerNote: 'AI로 다듬기 — 글자', actorId: u.id }); // #545 서버가 그린 시안은 새 첫 줄로 함께
    if (!rv.version) throw badRequest(rv.skipped ?? '그사이 콘텐츠가 바뀌었습니다 — 새로 고쳐 다시');
    return { version: rv.version };
  }
  if (!c.auto) throw badRequest('자동 제작 시안만 다시 만들 수 있습니다');
  if (c.status === 'approved') throw badRequest('승인된 시안은 다시 만들지 않습니다');
  return produceContent(c, u.id);
}

// ---------------- 대표 10/25 22:20 전면 정리(결정 15-16 · 로컬 23:10 요청 A) ----------------
export const archiveAllInput = z.object({ statuses: z.array(z.enum(['draft', 'pending', 'changes', 'hold', 'approved'])).min(1).max(5).default(['draft', 'pending', 'changes', 'hold']),
  reason: z.string().trim().min(1).max(200).default('대표 10/25 22:20 전면 정리'), dryRun: z.boolean().optional() });
/** 미게시 글(초안·승인 대기·수정 요청·보류 — 고르면 승인됨까지)을 한 번에 '취소'로 보관. quality 에 archived_from(원래 상태)·archived_at(묶음 키)·archived_reason 을 남겨 [되돌리기]가 됨.
 *  게시됨은 손대지 않음 · 열린 제작 요청 카드도 취소 · 감사 기록 */
export async function archiveAll(u: SessionUser, i: z.infer<typeof archiveAllInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const rows = await sql<{ status: string; n: number }[]>`select status, count(*)::int n from mkt_contents where tenant = ${t} and status = any(${i.statuses}) group by status`;
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r.n])); const count = rows.reduce((n, r) => n + r.n, 0);
  if (i.dryRun) return { dryRun: true, count, byStatus };
  const at = new Date().toISOString();
  await sql.begin(async (tx) => {
    await tx`update mkt_production_requests set status = 'canceled', decided_by = ${u.id}, decided_at = now()
      where status in ('open', 'needs_approval') and content_id in (select id from mkt_contents where tenant = ${t} and status = any(${i.statuses}))`;
    await tx`update mkt_contents set status = 'canceled', reminded_at = null, updated_at = now(),
      quality = coalesce(quality, '{}'::jsonb) || jsonb_build_object('archived_from', status, 'archived_at', ${at}::text, 'archived_reason', ${i.reason}::text, 'archived_by', ${u.id}::text)
      where tenant = ${t} and status = any(${i.statuses})`;
    await (await import('./log')).audit(tx, u.id, 'mkt.archive_all', 'tenant', t, { count, byStatus, reason: i.reason, at });
  });
  return { count, byStatus, at };
}
export const unarchiveInput = z.object({ at: z.string().max(40).optional() });
/** [되돌리기]: 같은 묶음(archived_at)으로 보관한 글을 원래 상태로 — at 을 안 주면 가장 최근 묶음. 제작 요청 카드는 되살리지 않음(필요하면 [다시 만들기]) */
export async function unarchiveAll(u: SessionUser, i: z.infer<typeof unarchiveInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const t = tenantOf(u); const sql = db();
  const at = i.at ?? (await sql<{ at: string }[]>`select quality->>'archived_at' as at from mkt_contents where tenant = ${t} and status = 'canceled' and quality->>'archived_at' is not null order by quality->>'archived_at' desc limit 1`)[0]?.at;
  if (!at) throw badRequest('되돌릴 보관 묶음이 없습니다');
  const rows = await sql`update mkt_contents set status = quality->>'archived_from', updated_at = now(),
      quality = (quality - 'archived_from' - 'archived_at' - 'archived_reason' - 'archived_by') || jsonb_build_object('unarchived_at', ${new Date().toISOString()}::text)
    where tenant = ${t} and status = 'canceled' and quality->>'archived_at' = ${at} and quality->>'archived_from' in ('draft', 'pending', 'changes', 'hold', 'approved') returning id`;
  await (await import('./log')).audit(sql, u.id, 'mkt.unarchive_all', 'tenant', t, { count: rows.length, at });
  return { count: rows.length, at };
}

export const brandKitInput = z.object({ tone: z.string().max(200).nullable().optional(), intro: z.string().max(1000).nullable().optional(), products: z.string().max(1000).nullable().optional(), weeklyTopic: z.string().max(300).nullable().optional(), bannedWords: z.array(z.string().trim().min(1).max(30)).max(50).optional(),
  adPriority: z.number().int().min(1).max(99).nullable().optional(), adShare: z.number().min(0).max(100).nullable().optional(), adNote: z.string().max(300).nullable().optional(), // 대표 02:30 ③ 광고 예산 브랜드 축
  testMode: z.boolean().optional(), voice: voiceInput.optional(), // #426 말투 프로필
  // #454 영상 끝 화면·자막: 로고(자료실 이미지)·끝 화면 한 줄·CTA·배경색·글꼴(자료실 OTF/TTF)
  video: z.object({ logoFileId: z.string().uuid().nullable().optional(), headline: z.string().trim().max(30).nullable().optional(), cta: z.string().trim().max(60).nullable().optional(),
    endColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), fontFileId: z.string().uuid().nullable().optional(),
    // 209차 #666 ⑤ 출연진 고정: 주인공 사진(자료실 이미지) · 묘사(영문이면 장면 지시에 그대로) · 생성 인물 / 실존 인물(광고 사용 동의를 받았을 때만)
    castFileId: z.string().uuid().nullable().optional(), castEn: z.string().trim().max(300).nullable().optional(), castKind: z.enum(['generated', 'real']).nullable().optional(), castConsent: z.boolean().optional(),
    // 271차 #811 릴스·쇼츠 영상 만드는 방법: 실제 사진 영상(생성 비용 0) · 앱 화면 녹화(생성 비용 0, 녹화 파일을 자료실에) · AI 영상(크레딧) — 비우면 지금처럼 제작 요청 카드
    method: z.enum(['photos', 'screen', 'ai']).nullable().optional() }).optional(),
  feed: feedInput.optional(), // #544 피드 틀(쓸 틀·색·머리줄·연락처 줄·머리말) — 통째로 저장
  facts: factsInput.optional(), // 로컬 QA 10/24 ⑤ 사실 카드(연락처·운영 시간·요금·숫자·섞으면 안 되는 이름) — 통째로 저장
  topicPool: z.array(z.string().trim().min(1).max(120)).max(40).optional(), // 로컬 QA 10/24 ③ 브랜드 주제 풀(한 줄에 하나, 돌아가며 씀)
  examples: z.array(exampleInput).max(12).optional(), // #235 ⓔ 잘 된 예시 글(형식마다 3개) — 통째로 저장
  aiFill: z.array(z.string().trim().min(1).max(24)).max(24).optional() }); // 190차 [AI로 채우기]에서 고른 칸 이름 — 감사 기록만(값은 위 칸들)
/** #235 ⓐ 소식: 끝나는 날이 없으면 시작(없으면 오늘)부터 30일 뒤 — 지난 소식이 계속 주제로 나가지 않게 */
function factsToSave(f: z.infer<typeof factsInput>) {
  if (!f.news) return f;
  for (const n of f.news) if (n.from && n.to && n.from > n.to) throw badRequest(`소식 '${n.text.slice(0, 20)}' — 시작 날짜가 끝 날짜보다 늦습니다`);
  return { ...f, news: f.news.map((n) => ({ text: n.text, ...(n.from ? { from: n.from } : {}), to: n.to ?? dayAdd(n.from ?? todayKst(), 30) })) };
}
export async function saveBrandKit(u: SessionUser, id: string, i: z.infer<typeof brandKitInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  // #454 영상 키트 파일은 이 회사 자료실(기밀 아님)만
  for (const fid of [i.video?.logoFileId, i.video?.fontFileId, i.video?.castFileId]) if (fid && !(await db()`select 1 from library_files where id = ${fid} and tenant = ${tenantOf(u)} and deleted_at is null and coalesce(security, 'internal') <> 'confidential'`).length) throw badRequest('자료실에서 고른 파일만 쓸 수 있습니다(기밀 파일 제외)');
  if (i.video?.castFileId && !(await db()`select 1 from library_files where id = ${i.video.castFileId} and mime_type like 'image/%'`).length) throw badRequest('주인공은 사진 파일만 고를 수 있습니다');
  // 209차 ⑤ 실존 인물 사진은 광고 사용 동의를 받았다고 표시해야 씀(동의한 시각·사람을 남김) — 생성 인물은 그대로
  if (i.video?.castKind === 'real' && !i.video.castConsent) throw badRequest('실존 인물 사진은 광고에 써도 된다는 동의를 받은 뒤에 쓸 수 있습니다 — 동의를 받았으면 표시해 주세요');
  if (i.video) { const { castConsent, ...rest } = i.video; i = { ...i, video: { ...rest, ...(i.video.castKind ? { castConsentAt: castConsent && i.video.castKind === 'real' ? new Date().toISOString() : null, castConsentBy: castConsent && i.video.castKind === 'real' ? u.id : null } : {}) } as typeof i.video }; }
  if (i.examples) for (const k of Object.keys(EXAMPLE_KINDS) as (keyof typeof EXAMPLE_KINDS)[]) if (i.examples.filter((e) => e.kind === k).length > EXAMPLE_PER_KIND) throw badRequest(`${EXAMPLE_KINDS[k]} 예시는 ${EXAMPLE_PER_KIND}개까지입니다`);
  const [b] = await db()`update mkt_brands set tone = ${i.tone === undefined ? db()`tone` : i.tone}, intro = ${i.intro === undefined ? db()`intro` : i.intro || null}, products = ${i.products === undefined ? db()`products` : i.products || null},
    weekly_topic = ${i.weeklyTopic === undefined ? db()`weekly_topic` : i.weeklyTopic || null}, banned_words = coalesce(${i.bannedWords ?? null}::text[], banned_words), test_mode = coalesce(${i.testMode ?? null}, test_mode),
    ad_priority = ${i.adPriority === undefined ? db()`ad_priority` : i.adPriority}, ad_share = ${i.adShare === undefined ? db()`ad_share` : i.adShare}, ad_note = ${i.adNote === undefined ? db()`ad_note` : i.adNote || null}, voice = ${i.voice === undefined ? db()`voice` : db().json(i.voice as never)},
    video = ${i.video === undefined ? db()`video` : db()`video || ${db().json(i.video as never)}::jsonb`}, feed = ${i.feed === undefined ? db()`feed` : db().json(normalizeFeed(i.feed) as never)},
    facts = ${i.facts === undefined ? db()`facts` : db().json(Object.fromEntries(Object.entries(factsToSave(i.facts)).filter(([, v]) => (Array.isArray(v) ? v.length : !!v))) as never)},
    topic_pool = ${i.topicPool === undefined ? db()`topic_pool` : [...new Set(i.topicPool)]},
    examples = ${i.examples === undefined ? db()`examples` : db().json(i.examples.map((e) => ({ ...e, at: e.at ?? new Date().toISOString() })) as never)} where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!b) throw notFound();
  if (i.aiFill?.length) await (await import('./log')).audit(db(), u.id, 'mkt.brand_kit_ai', 'mkt_brand', id, { fields: i.aiFill });
  // 재료(소개·상품·주제)가 생기면 이 브랜드의 열린 '주제 필요' 질문은 닫고 다음 실행에 제작
  if (i.intro || i.products || i.weeklyTopic || i.topicPool?.length) await db()`update mkt_production_requests q set status = 'done', brief = q.brief || ${'\n\n브랜드 키트 재료로 대신함'}, decided_by = ${u.id}, decided_at = now()
    from mkt_contents c where c.id = q.content_id and c.brand_id = ${id} and q.kind = 'topic' and q.status = 'open'`;
  return { ok: true };
}
export const exampleFromInput = z.object({ note: z.string().trim().max(200).optional(), remove: z.boolean().optional() });
/** #235 ⓔ [좋은 예시로 저장]: 승인·게시한 글(승인 버전 본문 + 릴스·쇼츠 대본)을 이 브랜드의 같은 형식 예시로 — 형식마다 3개, 넘으면 가장 오래된 것을 뺌. remove = 예시에서 빼기 */
export async function saveExampleFrom(u: SessionUser, id: string, i: z.infer<typeof exampleFromInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('콘텐츠를 찾을 수 없습니다');
  const sql = db(); const t = tenantOf(u);
  const [c] = await sql<any[]>`select c.id, c.brand_id, c.channel, c.kind, c.status, c.quality, coalesce(c.approved_version, c.current_version) as v, b.examples
    from mkt_contents c left join mkt_brands b on b.id = c.brand_id where c.id = ${id} and c.tenant = ${t}`;
  if (!c) throw notFound('콘텐츠를 찾을 수 없습니다');
  if (!c.brand_id) throw badRequest('브랜드가 정해진 글만 예시로 저장할 수 있습니다');
  const kind = exampleKindOf(c.channel, c.kind);
  let list = examplesOf(c.examples).filter((e) => e.contentId !== c.id);
  if (!i.remove) {
    if (!['approved', 'published'].includes(c.status)) throw badRequest('승인했거나 게시한 글만 좋은 예시로 저장할 수 있습니다');
    const [v] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${c.id} and version = ${c.v}`;
    const label = (await settingsOf(t)).ai_label;
    const body = (label ? String(v?.body ?? '').split(label).join('') : String(v?.body ?? '')).trim();
    const script: string[] = Array.isArray(c.quality?.script) ? c.quality.script : [];
    const text = [...`${body}${script.length ? `\n\n대본(컷):\n${script.map((x) => `- ${x}`).join('\n')}` : ''}`].slice(0, 4000).join('');
    if ([...text].length < 20) throw badRequest('본문이 너무 짧아 예시로 쓰기 어렵습니다');
    const same = list.filter((e) => e.kind === kind);
    if (same.length >= EXAMPLE_PER_KIND) list = list.filter((e) => e !== same[0]);
    list.push({ kind, text, ...(i.note ? { note: i.note } : {}), contentId: c.id, at: new Date().toISOString() });
  }
  await sql`update mkt_brands set examples = ${sql.json(list as never)} where id = ${c.brand_id} and tenant = ${t}`;
  return { saved: !i.remove, kind, count: list.filter((e) => e.kind === kind).length };
}
/** #426 [잘 된 글로 말투 만들기]: 이 브랜드의 승인·게시 글(최근 8개)로 말투 프로필 초안 — 저장하지 않음(화면에서 고쳐 [저장] = 대표 승인) */
export async function voiceDraft(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [b] = await sql<any[]>`select id, name, tone, intro, products from mkt_brands where id = ${id} and tenant = ${t}`;
  if (!b) throw notFound();
  const posts = await sql<{ id: string; title: string; body: string }[]>`select c.id, c.title, v.body from mkt_contents c join mkt_versions v on v.content_id = c.id and v.version = coalesce(c.approved_version, c.current_version)
    where c.tenant = ${t} and c.brand_id = ${id} and c.status in ('published', 'approved') and length(trim(v.body)) > 20
    order by (c.status = 'published') desc, coalesce(c.published_at, c.scheduled_at, c.updated_at) desc limit 8`;
  if (!posts.length) throw badRequest('이 브랜드에 승인·게시된 글이 아직 없습니다 — 잘 된 글 예시를 직접 붙여 넣어 주세요');
  const P = await import('./ai/provider');
  if (!P.aiEnabled()) throw badRequest('AI 비서가 꺼져 있어 초안을 만들 수 없습니다');
  await assertMktAi(t);
  const p = P.anthropicProvider({ tier: await makeTier(t) }); // 말투 초안도 글 모델
  const r = await p.chat({
    system: `회사 마케팅 담당 AI 비서입니다. 이 브랜드의 실제 게시 글에서 말투 프로필을 뽑습니다. JSON 만.
- topics: 주로 다루는 주제 한 줄 · audience: 타겟 한 줄 · offer: 파는 것 한 줄
- phrases: 글에 실제로 자주 나오는 말(최대 8개) · avoid: 이 브랜드가 쓰지 않는 표현(상투어·과장 가운데 글에 없는 것, 최대 8개)
- formality: polite(존댓말)·casual(반말)·mixed · emoji: none·few·many(글의 실제 사용량)
- examples: 아래 글 가운데 말투가 가장 잘 드러난 글 번호 최대 3개(1부터)
글에 없는 사실은 지어내지 않습니다.`,
    tools: [], messages: [{ role: 'user', content: `브랜드: ${brandName(b)}${b.intro ? `\n소개: ${b.intro}` : ''}${b.products ? `\n상품: ${b.products}` : ''}${b.tone ? `\n지금 말투 한 줄: ${b.tone}` : ''}\n\n[게시 글]\n${posts.map((x, k) => `${k + 1}) ${x.title}\n${[...x.body].slice(0, 600).join('')}`).join('\n\n')}` }],
    format: { type: 'object', additionalProperties: false, required: ['topics', 'audience', 'offer', 'phrases', 'avoid', 'formality', 'emoji', 'examples'],
      properties: { topics: { type: 'string' }, audience: { type: 'string' }, offer: { type: 'string' }, phrases: { type: 'array', items: { type: 'string' } }, avoid: { type: 'array', items: { type: 'string' } },
        formality: { type: 'string', enum: ['polite', 'casual', 'mixed'] }, emoji: { type: 'string', enum: ['none', 'few', 'many'] }, examples: { type: 'array', items: { type: 'integer' } } } },
  });
  await logAi({ tenant: t, created_by: u.id }, p, r, P);
  let o: any = {}; try { o = JSON.parse(textOf(r)); } catch { /* 형식 오류 → 빈 초안 */ }
  const cut = (x: unknown, n: number) => [...String(x ?? '').trim()].slice(0, n).join('');
  const list = (x: unknown) => (Array.isArray(x) ? x.map((y) => cut(y, 60)).filter(Boolean) : []).slice(0, 8);
  const picks = (Array.isArray(o.examples) ? o.examples : []).map((n: unknown) => posts[Number(n) - 1]).filter(Boolean).slice(0, 3);
  const draft = voiceInput.parse({ topics: cut(o.topics, 300), audience: cut(o.audience, 300), offer: cut(o.offer, 300), phrases: list(o.phrases), avoid: list(o.avoid),
    formality: ['polite', 'casual', 'mixed'].includes(o.formality) ? o.formality : 'polite', emoji: ['none', 'few', 'many'].includes(o.emoji) ? o.emoji : 'few',
    examples: (picks.length ? picks : posts.slice(0, 2)).map((x: { body: string }) => cut(x.body, 1500)) });
  return { draft, sources: posts.map((x) => ({ id: x.id, title: x.title })) };
}
/** 로컬 QA 10/24 ③ [AI로 주제 20개 제안]: 브랜드 소개·상품·고객·사실 카드로 주제 풀 초안 — 저장 안 함(화면에서 고쳐 [저장]).
 *  이 브랜드 최근 제목·다른 브랜드가 최근 2주에 쓴 제목과 겹치지 않게, 다른 브랜드 이름이 든 주제는 뺌 */
export async function topicDraft(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db(); const t = tenantOf(u);
  const [b] = await sql<any[]>`select id, name, intro, products, voice, facts, topic_pool from mkt_brands where id = ${id} and tenant = ${t}`;
  if (!b) throw notFound();
  const v = b.voice ?? {};
  if (!b.intro && !b.products && !v.topics && !v.audience && !v.offer) throw badRequest('브랜드 소개·주력 상품(또는 말투 프로필의 고객·파는 것)을 먼저 적어 주세요 — 그걸로 주제를 뽑습니다');
  const mine = await sql<{ title: string }[]>`select title from mkt_contents where tenant = ${t} and brand_id = ${id} and status <> 'canceled' order by coalesce(scheduled_at, created_at) desc limit 20`;
  const peers = await sql<{ title: string }[]>`select c.title from mkt_contents c where c.tenant = ${t} and c.brand_id is distinct from ${id} and c.status <> 'canceled' and coalesce(c.scheduled_at, c.created_at) > now() - interval '14 days' order by coalesce(c.scheduled_at, c.created_at) desc limit 20`;
  const others = otherBrandNames(await otherBrands(t, id)); // 137차: 'HILINK' 같은 영문 이름도 거름
  const P = await import('./ai/provider');
  if (!P.aiEnabled()) throw badRequest('AI 비서가 꺼져 있어 초안을 만들 수 없습니다');
  await assertMktAi(t);
  const Q = await import('./mktQuality');
  const p = P.anthropicProvider({ tier: await makeTier(t) }); // 만드는 일 = 글 모델
  const r = await p.chat({
    system: `회사 마케팅 담당 AI 비서입니다. 이 브랜드 SNS·블로그 글에 돌아가며 쓸 '주제 풀'을 만듭니다. JSON 만.
- topics: 주제 20개, 한 줄에 하나, 30자 안팎
- 누가(고객 한 명)·어떤 상황에서·무엇을 얻는지 보이게 구체적으로. '월말 정리'·'다음 달 준비'·'○○의 모든 것' 같은 막연한 주제 금지
- 이 브랜드의 고객과 상품에만 맞는 것. 다른 브랜드·회사 이야기 금지
- 계절·시기를 타는 주제는 3개 이하, 나머지는 언제 써도 되는 주제
- 숫자·가격·후기는 주제에 넣지 않음(원고에서 사실 카드에 있는 것만 씀)
- 형식을 섞기: 자주 묻는 질문·체크리스트·실제 장면·비교·흔한 오해 바로잡기·처음 쓰는 사람 안내
- 아래 '최근 제목'·'다른 브랜드 최근 제목'과 겹치지 않게`,
    tools: [], messages: [{ role: 'user', content: [`브랜드: ${brandName(b)}`, b.intro ? `소개: ${b.intro}` : '', b.products ? `주력 상품: ${b.products}` : '', v.audience ? `고객: ${v.audience}` : '', v.topics ? `주로 다루는 주제: ${v.topics}` : '', v.offer ? `파는 것: ${v.offer}` : '',
      Q.factsText(Q.factsOf(b.facts)), (b.topic_pool ?? []).length ? `[이미 있는 주제 — 겹치지 않게]\n${(b.topic_pool as string[]).join('\n')}` : '',
      mine.length ? `[이 브랜드 최근 제목]\n${mine.map((x) => x.title).join('\n')}` : '', peers.length ? `[다른 브랜드 최근 제목 — 겹치지 않게만 참고]\n${peers.map((x) => x.title).join('\n')}` : ''].filter(Boolean).join('\n') }],
    format: { type: 'object', additionalProperties: false, required: ['topics'], properties: { topics: { type: 'array', items: { type: 'string' } } } },
  });
  await logAi({ tenant: t, created_by: u.id }, p, r, P);
  let o: any = {}; try { o = JSON.parse(textOf(r)); } catch { /* 형식 오류 → 아래에서 안내 */ }
  const key = (x: string) => x.replace(/[\s'"‘’“”.,!?·]/g, '');
  const have = new Set([...(b.topic_pool ?? []), ...mine.map((x) => x.title)].map(key));
  const topics = [...new Set((Array.isArray(o.topics) ? o.topics : []).map((x: unknown) => [...String(x ?? '').trim()].slice(0, 120).join('')).filter(Boolean) as string[])]
    .filter((x) => !have.has(key(x)) && !Q.otherBrandIn(x, others, brandName(b))).slice(0, 20);
  if (!topics.length) throw badRequest('주제 초안을 만들지 못했습니다 — 잠시 뒤 다시 눌러 주세요');
  return { topics };
}
export const brandCreateInput = z.object({ name: z.string().trim().min(1).max(40), testMode: z.boolean().optional() });
/** 브랜드 추가(이름이 같으면 그 브랜드를 씀) + 시험 모드 — 한 번에 */
export async function createBrandWithKit(u: SessionUser, i: z.infer<typeof brandCreateInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db();
  const [b] = await sql<{ id: string; name: string; test_mode: boolean }[]>`insert into mkt_brands (tenant, name, test_mode) values (${tenantOf(u)}, ${i.name}, ${!!i.testMode})
    on conflict (tenant, name) do update set test_mode = case when ${i.testMode === undefined} then mkt_brands.test_mode else excluded.test_mode end returning id, name, test_mode`;
  return { brand: b };
}
export async function runNow(u: SessionUser) { await assertSpace(u, 'marketing'); adminOnly(u); return runTenant(tenantOf(u), u.id); }

/** 요청 C §4(대표 10/25 22:20 '브랜드별 시안 세트를 보고 승인'): 브랜드마다 내일 피드(카드뉴스·페북 함께)·스토리 1건씩, 고른 브랜드는 블로그 1건을 바로 만들어 승인함에 — 정기 규칙·일시정지와 무관한 1회 제작(사람이 누른 제작) */
export const sampleInput = z.object({ brandIds: z.array(zUuid).max(10).optional(), blogBrandIds: z.array(zUuid).max(10).optional(), kinds: z.array(z.enum(['feed', 'story'])).max(2).optional() });
export async function sampleSet(u: SessionUser, i: z.infer<typeof sampleInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  // 로컬 10/26(160차 확인): 브랜드를 고르지 않으면 시험 브랜드([시험], test_mode)는 세트에서 뺀다 — 대표가 볼 시안 세트에 시험 글이 섞이지 않게. 고른 브랜드(brandIds)는 그대로
  const brands = await sql<{ id: string; name: string; test_mode: boolean | null }[]>`select id, name, test_mode from mkt_brands where tenant = ${t} ${i.brandIds?.length ? sql`and id = any(${i.brandIds}::uuid[])` : sql`and coalesce(test_mode, false) = false`} order by name`;
  const blogBrands = i.blogBrandIds?.length ? await sql<{ id: string; name: string; test_mode: boolean | null }[]>`select id, name, test_mode from mkt_brands where tenant = ${t} and id = any(${i.blogBrandIds}::uuid[]) order by name` : [];
  if (!brands.length && !blogBrands.length) throw badRequest('브랜드가 없습니다 — 브랜드 키트에서 브랜드를 먼저 만들어 주세요');
  const day = ymd(new Date(Date.now() + DAY)); const md = `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`;
  const plan: { brand: typeof brands[number]; kind: Kind; channel: string; time: string; cross: string[] }[] = [];
  for (const b of brands) for (const kind of i.kinds ?? ['feed', 'story']) plan.push({ brand: b, kind, channel: 'instagram', time: kind === 'feed' ? '10:00' : '18:00', cross: ['facebook'] });
  for (const b of blogBrands) plan.push({ brand: b, kind: 'blog', channel: 'blog', time: '13:00', cross: [] });
  const made: { id: string; brand: string; kind: string }[] = [];
  for (const p of plan) {
    const title = `${p.brand.test_mode ? '[시험] ' : ''}${brandName(p.brand)} ${KIND_LABEL[p.kind]} 시안 세트 ${md}`;
    const [c] = await sql<{ id: string }[]>`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produce_at, is_test, cross_channels, mode, quality)
      values (${t}, ${p.brand.id}, ${title}, ${p.channel}, ${kst(day, p.time)}, 'draft', 0, ${u.id}, ${p.kind}, true, now(), ${!!p.brand.test_mode}, ${p.cross}, 'content', ${sql.json({ sample: true } as never)}) returning id`; // quality.sample: 일시정지 중에도 이어서 만드는 표시(170차)
    made.push({ id: c.id, brand: p.brand.name, kind: p.kind });
  }
  await (await import('./log')).audit(sql, u.id, 'mkt.sample_set', 'tenant', t, { n: made.length, kinds: [...new Set(made.map((m) => m.kind))] }).catch(() => {});
  // 제작은 응답 뒤(최상 모델이면 1건 30~60초) — 만든 순서대로, 실패한 건은 '제작 실패'로 남고 나머지는 계속
  // 170차(로컬 10/26 10:45: 13건 중 5건이 9시간 뒤에도 초안): 응답 뒤 제작은 함수 시간 제한(300초)에 끊긴다 → 시간 예산(MKT_SAMPLE_BUDGET_MS) 안에서만 만들고,
  // 남은 칸은 정기 실행이 이어받는다 — 자동 생성 일시정지 중에도 시안 세트 칸(quality.sample)만은 runTenant 가 이어서 만든다
  const budgetMs = Number(process.env.MKT_SAMPLE_BUDGET_MS ?? 150_000);
  (await import('./later')).runLater('mktSample', async () => {
    const out: { id: string; ok: boolean; error?: string }[] = []; const start = Date.now(); let tried = 0;
    for (const m of made) {
      if (tried && Date.now() - start > budgetMs) break;
      const [c] = await sql<any[]>`select * from mkt_contents where id = ${m.id} and status = 'draft' and produced_at is null`;
      if (!c) continue;
      tried++;
      out.push(await produceContent(c, u.id, 'manual').then(() => ({ id: m.id, ok: true }), (e) => ({ id: m.id, ok: false, error: String(e?.message ?? e).slice(0, 200) })));
    }
    return { tenant: t, out, left: made.filter((m) => !out.some((o) => o.id === m.id)).length, budgetMs };
  });
  return { ok: true, day, contents: made, producing: 'later' as const };
}
