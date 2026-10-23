import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { zUuid } from './api';
import { layoutBody } from './mktText';
import { avoidOf, voiceInput } from './mktQuality';
import { tenantOf, type SessionUser } from './types';

/**
 * V41 4-3 + V43 마케팅 자동 제작(대표 방향 10/18): 브랜드·채널별 주간 규칙 → (게시 D-n 제작 시각) Claude 원고 + 이미지/영상 '제작 요청 카드'
 * → 자동 품질 검사 → 통과본만 승인함 → 알림(제작 완료 즉시 + 마감 N시간 전, 야간 무알림이면 직전 저녁) → 마감 지난 자동 시안은 정리.
 * 상업화(V43): 회사 요금제(금액 칸은 대표 결정 전 빈칸)·월/주 크레딧·생성 영상 편수·재생성 횟수, 고객·게시물·버전별 크레딧 원장, 수정 요청 분류(글자·배치 0 / 이미지·영상 재생성).
 * 이미지·영상 생성 엔진(Higgsfield API)은 계약(대표 결정) 뒤 — 지금은 카드에 실제 사용 크레딧을 기록하며 사람이 제작해 붙임.
 */
export const KIND_LABEL = { feed: '피드', blog: '블로그', reels: '릴스', video: '생성 영상', shorts: '쇼츠', story: '스토리' } as const; // 대표 10/20 6): 쇼츠(유튜브 세로 영상)·스토리(세로 1080×1920·24시간) 추가
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
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const kst = (date: string, hhmm: string) => new Date(`${date}T${hhmm.length === 5 ? hhmm : hhmm.padStart(2, '0') + ':00'}:00+09:00`);
const hourKst = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(d)) % 24;
const pad = (n: number) => String(n).padStart(2, '0');

/** 대표 10/20 15:40 (#103): 요금제 표는 DB(mkt_plan_limits, 플랫폼 운영에서 편집) — 없으면 코드 기본값 */
export type PlanRow = { code: string; label: string; price: number | null; weekly: Record<string, number>; monthlyCredits: number; videoMonthly: number; regenMonthly: number; aiMonthlyUsd: number | null; extraCreditKrw: number | null };
export async function planTable(): Promise<Record<string, PlanRow>> {
  const rows = await db()<any[]>`select code, label, price_krw, monthly_credits::float8 monthly_credits, weekly, video_monthly, regen_monthly, ai_monthly_usd::float8 ai_monthly_usd, extra_credit_krw from mkt_plan_limits`.catch(() => [] as any[]);
  const out: Record<string, PlanRow> = {};
  for (const [k, p] of Object.entries(MKT_PLANS)) { const r = rows.find((x) => x.code === k);
    out[k] = r ? { code: k, label: r.label, price: r.price_krw ?? null, weekly: r.weekly ?? {}, monthlyCredits: Number(r.monthly_credits), videoMonthly: r.video_monthly, regenMonthly: r.regen_monthly, aiMonthlyUsd: r.ai_monthly_usd ?? null, extraCreditKrw: r.extra_credit_krw ?? null }
      : { code: k, label: p.label, price: p.price, weekly: { ...p.weekly }, monthlyCredits: p.monthlyCredits, videoMonthly: p.videoMonthly, regenMonthly: p.regenMonthly, aiMonthlyUsd: p.aiMonthlyUsd, extraCreditKrw: null }; }
  return out;
}
export type CreditCost = { imageCredits: number; videoCredits: number; krwPerCreditMin: number; krwPerCreditMax: number };
export async function creditCost(): Promise<CreditCost> {
  const [r] = await db()<{ value: Partial<CreditCost> }[]>`select value from app_settings where key = 'mkt_credit_cost'`.catch(() => [] as any[]);
  return { imageCredits: 6.5, videoCredits: 80, krwPerCreditMin: 43, krwPerCreditMax: 70, ...(r?.value ?? {}) };
}
export type MktSettings = { plan?: PlanRow | null; plan_code: keyof typeof MKT_PLANS | null; monthly_credits: number | null; weekly_credits: number | null; video_monthly: number | null; regen_monthly: number | null;
  approval_hour: number; lead_days: number; lead_hour: number; remind_hours: number; quiet_start: number; quiet_end: number; allow_generated_people: boolean; allow_slideshow: boolean; ai_label: string; notify_user_ids: string[] | null; ai_monthly_usd: number | null; auto_publish: boolean };
const DEFAULTS: MktSettings = { plan_code: null, monthly_credits: null, weekly_credits: null, video_monthly: null, regen_monthly: null, approval_hour: 9, lead_days: 3, lead_hour: 13,
  remind_hours: 6, quiet_start: 22, quiet_end: 8, allow_generated_people: false, allow_slideshow: false, ai_label: 'AI 도움을 받아 제작했습니다', notify_user_ids: null, ai_monthly_usd: null, auto_publish: false };
export async function settingsOf(tenant: string): Promise<MktSettings> {
  const [s] = await db()<any[]>`select * from mkt_settings where tenant = ${tenant}`;
  if (!s) return { ...DEFAULTS };
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const plan = s.plan_code ? (await planTable())[s.plan_code] ?? null : null; // #103: 요금제 숫자는 DB 표에서
  return { ...DEFAULTS, ...s, plan, monthly_credits: num(s.monthly_credits), weekly_credits: num(s.weekly_credits), ai_monthly_usd: num(s.ai_monthly_usd) };
}
export function limitsOf(s: MktSettings) {
  const p = s.plan ?? (s.plan_code ? MKT_PLANS[s.plan_code] : null);
  const monthly = s.monthly_credits ?? p?.monthlyCredits ?? null;
  return { monthlyCredits: monthly, weeklyCredits: s.weekly_credits ?? (monthly === null ? null : Math.round((monthly / 4.3) * 10) / 10),
    videoMonthly: s.video_monthly ?? p?.videoMonthly ?? null, regenMonthly: s.regen_monthly ?? p?.regenMonthly ?? null, aiMonthlyUsd: s.ai_monthly_usd ?? p?.aiMonthlyUsd ?? null };
}
/** #103 회사 화면 '이번 달 남은 제작 n건' — 남은 크레딧을 이미지·영상 장수로 환산, 주간 종류별 한도 대비 이번 주 제작 수, 초과 안내(초과 크레딧 금액) */
export async function productionLeft(tenant: string) {
  const s = await settingsOf(tenant); const lim = limitsOf(s); const use = await usageOf(tenant); const cost = await creditCost();
  const plan = s.plan ?? null;
  const left = lim.monthlyCredits === null ? null : Math.max(0, Math.round((lim.monthlyCredits - use.monthCredits) * 10) / 10);
  const over = lim.monthlyCredits !== null && use.monthCredits >= lim.monthlyCredits;
  const today = ymd(new Date()); const dow = new Date(`${today}T12:00:00+09:00`).getUTCDay(); const weekStart = kst(ymd(new Date(Date.now() - ((dow + 6) % 7) * DAY)), '00:00'); const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
  const wk = await db()<{ kind: string; n: number }[]>`select coalesce(kind, 'feed') as kind, count(*)::int n from mkt_contents where tenant = ${tenant} and not is_test and status <> 'canceled' and scheduled_at >= ${weekStart} and scheduled_at < ${weekEnd} group by 1`;
  const weekly = Object.entries(plan?.weekly ?? {}).map(([kind, limit]) => ({ kind, label: (KIND_LABEL as Record<string, string>)[kind] ?? kind, limit: Number(limit), used: wk.find((w) => w.kind === kind)?.n ?? 0 }));
  const extra = plan?.extraCreditKrw ?? null; const shortfall = lim.monthlyCredits === null ? 0 : Math.max(0, Math.round((use.monthCredits - lim.monthlyCredits) * 10) / 10);
  return { planCode: s.plan_code, planLabel: plan?.label ?? null, monthlyCredits: lim.monthlyCredits, usedCredits: use.monthCredits, leftCredits: left, images: left === null ? null : Math.floor(left / cost.imageCredits), videos: left === null ? null : Math.floor(left / cost.videoCredits),
    videosLeft: lim.videoMonthly === null ? null : Math.max(0, lim.videoMonthly - use.monthVideos), regensLeft: lim.regenMonthly === null ? null : Math.max(0, lim.regenMonthly - use.monthRegens), weekly, over, shortfall, extraCreditKrw: extra,
    overMessage: over ? `이번 달 제작 크레딧 ${lim.monthlyCredits}을 모두 썼습니다${shortfall ? ` (초과 ${shortfall})` : ''}. ${extra ? `초과분은 1크레딧당 ${extra.toLocaleString('ko-KR')}원으로 추가 구매(${shortfall ? `${Math.ceil(shortfall * extra).toLocaleString('ko-KR')}원` : '필요 시'})` : '초과 크레딧 금액은 결정 전'} — 또는 요금제를 올려 주세요.` : null, cost };
}
/** 이번 달 마케팅 AI 비용($) — 자동 원고·캡션 초안 등 purpose 'marketing_%' */
export async function mktAiUsd(tenant: string) {
  const start = kst(`${ymd(new Date()).slice(0, 7)}-01`, '00:00');
  const [r] = await db()<{ usd: number; n: number }[]>`select coalesce(sum(cost_usd), 0)::float8 usd, count(*)::int n from ai_usage where tenant = ${tenant} and purpose like 'marketing%' and created_at >= ${start}`;
  return { usd: Math.round(r.usd * 10000) / 10000, requests: r.n };
}
/** 상용화 ⑦: 마케팅 AI 호출 전 한도 확인 — 크레딧 소진 차단 · 회사 요금제 월 AI 요청 수 · 회사 AI 월 한도($) · 마케팅 월 한도($). 넘으면 429(정기 실행은 그 회사 제작을 멈추고 하루 한 번 알림) */
export async function assertMktAi(tenant: string) {
  const { HttpError } = await import('./errors');
  await (await import('./ai/guard')).assertAiCredit();
  const Pl = await import('./plans');
  const { limits } = await Pl.effectiveLimits(tenant);
  if (limits.aiRequests !== null && (await Pl.currentUsage(tenant)).aiRequests >= limits.aiRequests) throw new HttpError(429, 'ai_quota', `이번 달 회사 AI 요청 ${limits.aiRequests}회를 모두 써 마케팅 자동 제작을 멈췄습니다 — 관리 → 사용량·요금제`);
  const co = await (await import('./ai/assistant')).usageThisMonth(tenant);
  if (co.limitUsd > 0 && co.costUsd >= co.limitUsd) throw new HttpError(429, 'ai_quota', `이번 달 회사 AI 한도($${co.limitUsd})에 닿아 마케팅 자동 제작을 멈췄습니다 — 관리 → 사용량·요금제`);
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

/** 승인 마감 = 게시 당일 approval_hour:00 */
export const deadlineOf = (scheduledAt: Date | string, s: Pick<MktSettings, 'approval_hour'>) => kst(ymd(new Date(scheduledAt)), `${pad(s.approval_hour)}:00`);
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
  const fixed = body.includes(s.ai_label) ? body : `${body.trim()}\n\n${s.ai_label}`;
  return { passed: issues.length === 0, issues, body: fixed };
}

// ---------------- 정기 실행 ----------------
/** 규칙 → 앞으로 14일 게시 칸(초안) 만들기 — 같은 규칙·시각은 한 번만 */
export async function planSlots(tenant: string, days = 14) {
  const sql = db(); const s = await settingsOf(tenant);
  const rules = await sql<any[]>`select r.*, b.name as brand, coalesce(b.test_mode, false) as test from mkt_rules r left join mkt_brands b on b.id = r.brand_id where r.tenant = ${tenant} and r.active`;
  let made = 0;
  for (const r of rules) for (let k = 0; k <= days; k++) {
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
    let produce = kst(ymd(new Date(at.getTime() - s.lead_days * DAY)), `${pad(s.lead_hour)}:00`);
    if (produce.getTime() < Date.now()) produce = new Date();
    const cross = (r.cross_channels ?? []) as string[];
    const title = `${r.test ? '[시험] ' : ''}${r.brand ? brandName({ name: r.brand }) + ' ' : ''}${KIND_LABEL[r.kind as Kind]}${cross.length ? '(함께 ' + cross.map((c) => CROSS_LABEL[c] ?? c).join('·') + ')' : ''} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
    const ins = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, rule_id, kind, auto, produce_at, is_test, cross_channels)
      values (${tenant}, ${r.brand_id}, ${title}, ${r.channel}, ${at}, 'draft', 0, ${r.created_by}, ${r.id}, ${r.kind}, true, ${produce}, ${!!r.test}, ${cross})
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
export async function materialOf(c: any, brand: any, rule: any) {
  const sql = db();
  const { companyAi } = await import('./ai/persona');
  const co = await companyAi({ tenant: c.tenant } as SessionUser);
  const photos = await sql<{ title: string; description: string | null }[]>`select title, description from library_files
    where tenant = ${c.tenant} and space = 'marketing' and deleted_at is null and upload_status = 'ready' and security <> 'confidential' and mime_type like 'image/%'
    order by created_at desc limit 8`;
  const recent = await sql<{ title: string }[]>`select title from mkt_contents where tenant = ${c.tenant} and id <> ${c.id} and current_version > 0 and coalesce(brand_id::text, '') = ${c.brand_id ?? ''}
    order by coalesce(scheduled_at, created_at) desc limit 6`;
  // 대표 10/20 18:00 ②: 월 운영 목표(승인된 것)의 주간 주제 달력이 있으면 그 주 주제가 기본 주제 — 묶음 규칙은 목표에서 자동
  const G = await import('./mktGoals');
  const day = c.scheduled_at ? G.ymd(new Date(c.scheduled_at)) : G.ymd(new Date());
  const goal = await G.goalFor(c.tenant, c.brand_id ?? null, day.slice(0, 7), sql).catch(() => null);
  const gweek = goal && goal.status !== 'pending' ? G.weekOf(goal.weekly ?? [], day) : null;
  const topic = String(c.quality?.topic ?? '').trim() || String(gweek?.topic ?? '').trim() || String(brand?.weekly_topic ?? '').trim() || String(rule?.topic_hint ?? '').trim();
  const about = [brand?.intro, brand?.products, co.business].map((x) => String(x ?? '').trim()).filter(Boolean);
  // 로컬 21:45 버그: 다짐 스토리에 하이링크 주제 — 브랜드 글은 그 브랜드 재료만(브랜드 키트가 있으면 회사 공통 소개는 빼고, 다른 브랜드 이름은 금지)
  const others = brand ? (await sql<{ name: string }[]>`select name from mkt_brands where tenant = ${c.tenant} and id <> ${brand.id}`).map((b) => brandName(b)).filter(Boolean) : [];
  const brandOnly = !!brand && !!(brand.intro || brand.products);
  const lines = [
    `브랜드 이름: ${brandName(brand) || co.name || '(없음)'}`,
    co.name ? `회사: ${co.name}${co.industries?.length ? ` (${co.industries.join('·')})` : ''}` : '',
    brand?.intro ? `브랜드 소개: ${brand.intro}` : '',
    brand?.products ? `주력 상품·서비스: ${brand.products}` : '',
    co.business && !brandOnly ? `회사 사업 소개: ${co.business}` : '',
    co.customers && !brandOnly ? `주요 고객: ${co.customers}` : '',
    brand ? `이 글은 '${brandName(brand)}' 브랜드 전용 — ${others.length ? `다른 브랜드(${others.join(', ')})의 상품·소식·이름은 쓰지 않음` : '다른 브랜드 이야기는 쓰지 않음'}` : '',
    topic ? `이번 글 주제: ${topic}` : '',
    goal && goal.status !== 'pending' ? `이달 운영 목표: ${(goal.goals?.objectives ?? []).join(' / ')}${goal.goals?.message ? ` · 핵심 메시지: ${goal.goals.message}` : ''}` : '',
    photos.length ? `쓸 수 있는 실사 사진(자료실):\n${photos.map((p) => `- ${p.title}${p.description ? `: ${p.description.slice(0, 120)}` : ''}`).join('\n')}` : '',
    recent.length ? `최근 게시 제목(겹치지 않게):\n${recent.map((r) => `- ${r.title}`).join('\n')}` : '',
  ].filter(Boolean);
  // 주제가 없고 브랜드·회사 소개도 없으면 재료 부족 — 일반론 원고 대신 '주제 필요' 카드로 질문
  return { enough: !!topic || about.length > 0, text: lines.join('\n'), topic, name: brandName(brand) || co.name, goal: goal && goal.status !== 'pending' ? goal : null, week: gweek };
}
/** 남은 [브랜드] 같은 자리표시는 아는 이름으로 바꿈 */
const fillName = (t: string, name: string) => (name ? t.replace(/\[(브랜드|브랜드\s*이름|브랜드명|회사|회사\s*이름|회사명|상호|업체명)\]/g, name) : t);

type Draft = { title: string; body: string; brief: string; why: string; hooks: string[]; keyword: string; script: string[] };
const VIDEO_KINDS = ['reels', 'shorts', 'video'];
/** #426 훅 자리: 릴스·쇼츠·영상 = 첫 장면(3초), 블로그 = 제목, 그 밖 = 본문 첫 줄 */
const hookAt = (kind: string) => (VIDEO_KINDS.includes(kind) ? '첫 장면(첫 3초)' : kind === 'blog' ? '제목' : '본문 첫 줄');
async function logAi(c: any, p: { name: string; model: string }, r: any, P: typeof import('./ai/provider')) {
  await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${c.tenant}, ${c.created_by}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_produce')`;
}
const textOf = (r: any) => (r.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('');

async function writeDraft(c: any, s: MktSettings, brand: any, rule: any, extra?: { prev: string; comment: string }): Promise<Draft> {
  const m = await materialOf(c, brand, rule);
  const P = await import('./ai/provider'); const Q = await import('./mktQuality');
  const kindRule = { feed: '인스타그램 피드 캡션 4~6줄', blog: '블로그 원고(제목 1줄 + 본문 10~15문장, 소제목 2~3개 — 소제목은 "■ 소제목" 한 줄로 따로, 문단은 2~3문장씩 빈 줄로 나눔)', reels: '릴스 자막 대본(5~7컷, 컷마다 한 줄)과 캡션 3줄', video: '15~20초 광고 영상 컷 구성(4~5컷)과 캡션 3줄', shorts: '유튜브 쇼츠(세로 영상 15~45초) 자막 대본(5~8컷, 컷마다 한 줄)과 제목 1줄·설명 2줄', story: '인스타·페이스북 스토리(세로 1080×1920, 24시간) 한 장 문구 1~2줄 + 스티커/질문 제안 1줄' }[c.kind as Kind] ?? '게시물 글';
  const video = VIDEO_KINDS.includes(c.kind);
  if (!P.aiEnabled()) return { title: c.title, body: extra ? extra.prev : `[AI 비서 꺼짐] ${rule?.topic_hint ?? c.title}`, brief: '', why: '', hooks: [], keyword: '', script: [] };
  await assertMktAi(c.tenant);
  const p = P.anthropicProvider({ tier: 'fast' });
  const voice = Q.voicePrompt(brand?.voice);
  const r = await p.chat({
    system: `회사 마케팅 담당 AI 비서입니다. ${kindRule}를 씁니다. JSON 만.
- 한국어, 브랜드 말투: ${brand?.tone || '친절하고 담백하게'}. 금지어: ${bannedOf(brand).join(', ') || '없음'}.
- 실사 사진 우선. ${s.allow_generated_people ? '' : '생성 인물을 실제 고객처럼 쓰지 않음(후기·체험담 지어내지 않음). '}${s.allow_slideshow ? '' : '슬라이드쇼(사진 + 느린 줌) 구성 금지. '}
- 아래 [재료]에 있는 사실만 씁니다. 숫자·연혁·실적·가격·날짜는 재료에 있는 값만 — 없으면 그 문장을 빼고, [확인 필요]·[브랜드] 같은 대괄호 자리표시는 절대 쓰지 않습니다. 과장·최상급 금지.
- 브랜드 이름은 '${m.name || '우리'}' 그대로 씁니다. 제목에 [시험] 같은 표시는 붙이지 않습니다.
- brief 에는 이미지/영상 제작 지시(실사 사진 + 글자 렌더 우선, 촬영 구도·필요한 사진)를 씁니다.
- why 에는 '왜 이 글인가'를 한 문장(이달 목표·이번 주 주제와 어떻게 이어지는지)으로 씁니다.
${Q.hookGuide(hookAt(c.kind))}
- keyword: 검색 키워드 1개(재료의 브랜드·지역·상품에서, 2~12자).${video ? '\n- script: 컷 줄(화면 자막·내레이션) 배열 — 한 컷 2~4초(분당 300음절), 첫 컷은 3초 안, 마지막 컷은 첫 컷과 이어지게(반복 시청).' : ''}
- 사람이 쓴 글처럼: 상투어(다양한·혁신적인·놓치지 마세요·지금 바로·~해 보는 건 어떨까요)·느낌표/이모지 나열·특수 대시(—)는 쓰지 않고, 문장 길이를 섞습니다.${voice ? `\n${voice}` : ''}`,
    tools: [], messages: [{ role: 'user', content: `[재료]\n${m.text}\n\n` + (extra ? `[지난 원고]\n${extra.prev}\n\n[수정 요청]\n${extra.comment}\n\n수정 요청을 반영해 다시 써 주세요.` : `채널: ${c.channel}\n게시일: ${ymd(new Date(c.scheduled_at))}\n주제: ${m.topic || '재료의 브랜드·상품 소개에서 이번 주에 알릴 만한 것 하나'}`) }],
    format: { type: 'object', additionalProperties: false, required: ['title', 'body', 'brief', 'why', 'hooks', 'keyword', ...(video ? ['script'] : [])],
      properties: { title: { type: 'string' }, body: { type: 'string' }, brief: { type: 'string' }, why: { type: 'string' }, hooks: { type: 'array', items: { type: 'string' } }, keyword: { type: 'string' }, ...(video ? { script: { type: 'array', items: { type: 'string' } } } : {}) } },
  });
  await logAi(c, p, r, P);
  const raw = textOf(r);
  const strip = (t: string) => fillName(t.replace(/^\s*\[시험\]\s*/, ''), m.name);
  const arr = (x: unknown) => (Array.isArray(x) ? x.map((y) => fillName(String(y ?? ''), m.name).trim()).filter(Boolean) : []);
  try { const o = JSON.parse(raw); return { title: strip(String(o.title || c.title)).slice(0, 200), body: layoutBody(c.kind, fillName(String(o.body ?? ''), m.name)), brief: fillName(String(o.brief ?? ''), m.name), why: fillName(String(o.why ?? ''), m.name).slice(0, 300), hooks: arr(o.hooks).slice(0, 3), keyword: String(o.keyword ?? '').trim().slice(0, 30), script: arr(o.script).slice(0, 12) }; }
  catch { return { title: c.title, body: fillName(raw, m.name), brief: '', why: '', hooks: [], keyword: '', script: [] }; }
}

/** #426 약한 훅 다시 쓰기 — 후보 3개가 모두 탈락했을 때 한 번만 */
async function rewriteHooks(c: any, brand: any, cur: string, prev: string[], why: string): Promise<string[]> {
  const P = await import('./ai/provider'); const Q = await import('./mktQuality');
  if (!P.aiEnabled()) return [];
  await assertMktAi(c.tenant);
  const p = P.anthropicProvider({ tier: 'fast' });
  const r = await p.chat({
    system: `회사 마케팅 담당 AI 비서입니다. 약한 훅을 다시 씁니다. JSON 만.\n${Q.hookGuide(hookAt(c.kind))}\n- 브랜드 말투: ${brand?.tone || '친절하고 담백하게'}. 재료에 없는 숫자·결과·가격은 쓰지 않습니다.`,
    tools: [], messages: [{ role: 'user', content: `글 제목: ${c.title}\n지금 훅: ${cur}\n앞서 낸 후보(모두 약함): ${prev.join(' / ') || '(없음)'}\n약한 이유: ${why}\n\n더 구체적이고(숫자·장면·대상) 궁금하게 만드는 훅 3개를 다시 써 주세요.` }],
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
  if (c.channel === 'instagram') { const t = Q.trimHashtags(body, rules.instagram.hashtags); if (t.removed) { body = t.body; notes.push(`해시태그 ${t.removed}개 뺌(최대 ${rules.instagram.hashtags}개)`); } }
  const video = VIDEO_KINDS.includes(c.kind);
  if (video && script.length < 2) script.splice(0, script.length, ...Q.scriptLines(body));
  const kw = [brandName(brand)].filter(Boolean);
  let hooks = d.hooks;
  const cur = Q.hookOf(c.kind, title, body, script); const curScore = cur ? Q.scoreHook(cur, rules, kw) : null;
  if (cur && curScore && !curScore.pass && hooks.length && !(c.kind === 'blog' && opt.keepTitle)) {
    let best = hooks.find((h) => h !== cur && Q.scoreHook(h, rules, kw).pass);
    if (!best) {
      const why = [...curScore.fails, ...Object.entries(curScore.parts).filter(([, v]) => !v).map(([k]) => ({ front: '앞부분이 흐림', specific: '구체성(숫자·장면) 없음', stakes: '걸린 것(손해·변화) 없음', callout: '대상 호명 없음', curiosity: '궁금증 없음' } as Record<string, string>)[k])].join(', ');
      const more = await rewriteHooks(c, brand, cur, hooks, why).catch(() => [] as string[]);
      if (more.length) { hooks = more; best = more.find((h) => Q.scoreHook(h, rules, kw).pass); }
    }
    if (best) {
      if (c.kind === 'blog') title = best;
      else { if (body.includes(cur)) body = body.replace(cur, () => best!); if (video && script.length) script[0] = best; }
      notes.push(`약한 훅(${curScore.score}점)을 바꿈: '${[...cur].slice(0, 30).join('')}' → '${[...best].slice(0, 30).join('')}'`);
    } else notes.push(`훅 후보가 모두 약함(${curScore.score}점) — 다른 훅으로 수정 요청해 주세요`);
  }
  const rep = Q.qualityReport({ channel: c.channel, kind: c.kind, title, body, hooks, script, keywords: kw, mainKeyword: d.keyword || null, voice: brand?.voice, cross: c.cross_channels ?? [] }, rules);
  return { title, body: rep.body, report: { ...rep.report, notes }, errors: rep.report.channel.filter((x) => x.level === 'error').map((x) => x.msg), timing: rep.report.timing ? Q.timingText(rep.report.timing) : '' };
}
const bannedOf = (brand: any): string[] => [...(brand?.banned_words ?? []), ...avoidOf(brand?.voice)];

/** 제작 요청 카드 — 한도를 넘으면 needs_approval(제작 전 승인 요청) */
export async function requestCard(c: any, version: number, kind: 'image' | 'video' | 'regen_image' | 'regen_video', brief: string, est: number, tx?: any) {
  const sql = tx ?? db(); const s = await settingsOf(c.tenant); const lim = limitsOf(s); const use = await usageOf(c.tenant);
  let reason: string | null = null;
  if (kind === 'video' && est >= EST.video && lim.videoMonthly !== null && use.monthVideos >= lim.videoMonthly) reason = `이번 달 생성 영상 ${lim.videoMonthly}편을 다 썼습니다`;
  else if (kind.startsWith('regen') && lim.regenMonthly !== null && use.monthRegens >= lim.regenMonthly) reason = `이번 달 재생성 ${lim.regenMonthly}회를 다 썼습니다 — 추가 1회 = 약 ${est}크레딧`;
  else if (est > 0 && lim.weeklyCredits !== null && use.weekCredits + est > lim.weeklyCredits) reason = `이번 주 크레딧 한도(${lim.weeklyCredits}) 초과 예상 — 약 ${est}크레딧`;
  const [q] = await sql<{ id: string }[]>`insert into mkt_production_requests (tenant, content_id, version, kind, brief, est_credits, status, reason)
    values (${c.tenant}, ${c.id}, ${version}, ${kind}, ${brief.slice(0, 4000)}, ${est}, ${reason ? 'needs_approval' : 'open'}, ${reason}) returning id`;
  if (reason) await mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `제작 전 승인 필요: ${c.title}`, body: reason, link: '/s/marketing/automation', entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktreq:${q.id}` });
  return { id: q.id, reason };
}

export async function produceContent(c: any, actorId?: string | null) {
  const sql = db(); const s = await settingsOf(c.tenant);
  const [brand] = c.brand_id ? await sql<any[]>`select * from mkt_brands where id = ${c.brand_id}` : [];
  const [rule] = c.rule_id ? await sql<any[]>`select * from mkt_rules where id = ${c.rule_id}` : [];
  const m = await materialOf(c, brand, rule);
  if (!m.enough) return askTopic(c, actorId);
  const d = await writeDraft(c, s, brand, rule);
  const f = await refineDraft(c, d, brand);
  const kind = c.kind as Kind;
  const q = qualityCheck(f.body, d.brief, s, bannedOf(brand), kind, f.title);
  if (f.errors.length) { q.passed = false; q.issues = [...q.issues, ...f.errors]; }
  if (kind === 'blog') { q.passed = false; q.issues = [...q.issues, (await import('./marketing')).BLOG_PHOTO_RULE]; } // 대표 10/20 18:45 ③: 블로그는 표지+본문 사진이 붙어야 승인 대기
  const deadline = deadlineOf(c.scheduled_at, s);
  const v = (c.current_version ?? 0) + 1; // 처음 제작 = v1, 다시 만들기 = 다음 버전
  // 대표 10/20 18:00 ①: 근거(목적·목표 지표·핵심 메시지·왜) — 목표·주차 주제·규칙에서, AI 가 쓴 why 가 있으면 그것
  const G = await import('./mktGoals');
  const rationale = G.rationaleFrom({ goal: m.goal, day: c.scheduled_at ? G.ymd(new Date(c.scheduled_at)) : G.ymd(new Date()), rule, channel: c.channel, kind, why: d.why || null, source: m.goal ? 'goal' : rule ? 'rule' : 'ai' });
  // 원고·원장·제작 요청 카드를 한 번에(중간에 끊겨 원고만 남고 카드가 빠지는 일이 없게)
  await sql.begin(async (tx) => {
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, ${v}, ${q.body}, ${[]}, ${v === 1 ? 'AI 자동 제작' : 'AI 다시 만들기'}, ${c.created_by})`;
    if (v > 1) await tx`update mkt_production_requests set status = 'canceled', reason = coalesce(reason, '다시 만들기로 대체'), decided_at = now() where content_id = ${c.id} and kind in ('image', 'video') and status in ('open', 'needs_approval')`;
    await tx`update mkt_contents set title = ${(c.is_test && !f.title.startsWith('[시험]') ? '[시험] ' : '') + f.title}, current_version = ${v}, reminded_at = null, status = ${q.passed ? 'pending' : 'changes'}, produced_at = now(), quality = ${tx.json({ passed: q.passed, issues: q.issues, brief: d.brief, report: { ...f.report, v } } as never)}, rationale = ${tx.json(rationale as never)}, updated_at = now() where id = ${c.id}`;
    await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'text', 0, ${v === 1 ? '원고(Claude) — 크레딧 0' : '다시 만들기 원고(Claude) — 크레딧 0'}, (select title from mkt_contents where id = ${c.id}))`;
    // 이미지·영상은 제작 요청 카드(Higgsfield 계약 전: 사람이 실사 + 글자 렌더로 제작해 붙임)
    // #426: 영상은 초 단위 장면표(분당 300음절)를 그대로 넘김 — Higgsfield 연동 뒤에는 장면별 프롬프트로
    const base = (kind === 'blog' ? `표지 1장 + 본문 사진 1장 이상(실사). ${d.brief ?? ''}`.trim() : d.brief) || (kind === 'story' ? '세로 1080×1920 실사 + 글자 렌더(24시간 스토리)' : '실사 사진 + 글자 렌더');
    await requestCard(c, v, kind === 'video' || kind === 'reels' || kind === 'shorts' ? 'video' : 'image', f.timing ? `${base}\n\n${f.timing}` : base, kind === 'video' ? EST.video : kind === 'reels' || kind === 'shorts' ? EST.video_reels : EST.image, tx);
  });
  if (!isQuiet(new Date(), s)) await mktNotify(sql, c, actorId, { approval: true, type: 'review_requested', title: q.passed ? `제작 완료 — 승인해 주세요: ${f.title}` : kind === 'blog' && q.issues.length === 1 ? `원고 완료 — 표지·본문 사진을 붙여 주세요: ${f.title}` : `품질 검사 미통과: ${f.title}`,
    body: q.passed ? `승인 마감 ${Number(ymd(deadline).slice(5, 7))}/${Number(ymd(deadline).slice(8))} ${pad(s.approval_hour)}:00` : q.issues.join(' · '), link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktp:${c.id}:${v}` });
  return { id: c.id, passed: q.passed, issues: q.issues };
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
  const rows = await sql<any[]>`select id, tenant, title, scheduled_at, status, auto, reminded_at, is_test, created_by, brand_id from mkt_contents where tenant = ${tenant} and status in ('pending', 'changes', 'draft') and scheduled_at is not null and scheduled_at > now() - interval '2 days'`;
  let reminded = 0, expired = 0;
  for (const c of rows) {
    const dl = deadlineOf(c.scheduled_at, s);
    if (c.auto && dl.getTime() < Date.now()) { // 고객에게 '마감 지남'만 반복해 보이지 않게(V43 7)
      await sql`update mkt_contents set status = 'canceled', quality = coalesce(quality, '{}'::jsonb) || '{"expired": true}'::jsonb, updated_at = now() where id = ${c.id}`;
      expired++; continue;
    }
    if (c.status !== 'pending' || c.reminded_at || Date.now() < remindAtOf(dl, s).getTime() || isQuiet(new Date(), s)) continue;
    await mktNotify(sql, c, null, { approval: true, type: 'review_requested', title: `승인 마감 ${s.remind_hours}시간 전: ${c.title}`, body: `마감 ${Number(ymd(dl).slice(5, 7))}/${Number(ymd(dl).slice(8))} ${pad(s.approval_hour)}:00`, link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktr:${c.id}` });
    await sql`update mkt_contents set reminded_at = now() where id = ${c.id}`;
    reminded++;
  }
  return { reminded, expired };
}

export async function runTenant(tenant: string, actorId?: string) {
  // 예전 칸 제목의 '[시험] [시험] ' 겹침 정리(브랜드 이름에 [시험]이 들어 있던 때 만든 아직 안 만든 칸)
  await db()`update mkt_contents set title = regexp_replace(title, '^\\[시험\\]\\s*\\[시험\\]\\s*', '[시험] ') where tenant = ${tenant} and title like '[시험]%[시험]%' and produced_at is null`;
  const planned = await planSlots(tenant);
  const due = await db()<any[]>`select * from mkt_contents where tenant = ${tenant} and auto and status = 'draft' and produced_at is null and produce_at <= now()
    and not exists (select 1 from mkt_production_requests q where q.content_id = mkt_contents.id and q.kind = 'topic' and q.status = 'open') order by produce_at limit 5`;
  const produced = [];
  for (const c of due) {
    const r: any = await produceContent(c, actorId).catch((e) => ({ id: c.id, error: String(e?.message ?? e).slice(0, 200), quota: e?.code === 'ai_quota' || e?.code === 'mkt_ai_quota' || e?.code === 'ai_credit' }));
    produced.push(r);
    if (r.quota) { // 한도·크레딧: 남은 칸도 같은 이유로 실패하므로 멈추고, 받는 사람에게 하루 한 번 알림
      await (await import('./spaceNotify')).notifySpace(db(), { tenant, space: 'marketing', approval: true, type: 'usage_alert', title: '마케팅 자동 제작 멈춤(AI 한도)', body: r.error, link: '/s/marketing/automation', dedupeKey: `mktquota:${tenant}:${ymd(new Date())}` }).catch(() => {});
      break;
    }
  }
  return { planned, produced, ...(await remindAndExpire(tenant)) };
}
/** tick: 규칙이 있는 회사만(한 번에 3곳) */
export async function mktAutoTick() {
  const ts = await db()<{ tenant: string }[]>`select distinct tenant from mkt_rules where active limit 3`;
  const out = [];
  for (const t of ts) out.push({ tenant: t.tenant, ...(await runTenant(t.tenant)) });
  return out;
}

/** 수정 요청(V43 5): 분류 → 글자·배치 = AI 가 새 버전(0크레딧) / 이미지·영상 재생성 = 제작 요청 카드(재생성 횟수·크레딧 확인, 넘으면 승인 요청) */
export function classifyRevision(comment: string): 'text' | 'regen_image' | 'regen_video' {
  if (/(영상|동영상|컷|클립).{0,12}(다시|새로|바꿔|교체|재생성)|재촬영/.test(comment)) return 'regen_video';
  if (/(사진|이미지|그림|썸네일|배경).{0,12}(다시|새로|바꿔|교체|재생성)|재생성/.test(comment)) return 'regen_image';
  return 'text';
}
export async function onChangesRequested(contentId: string, comment: string) {
  const sql = db();
  const [c] = await sql<any[]>`select * from mkt_contents where id = ${contentId}`;
  if (!c?.auto) return null;
  const kind = classifyRevision(comment);
  if (kind !== 'text') return { kind, card: await requestCard(c, c.current_version, kind, comment, kind === 'regen_video' ? EST.regen_video : EST.regen_image) };
  return { kind, version: await reviseText(c, comment, `수정 요청 반영(글자·배치, 0크레딧): ${comment.slice(0, 200)}`, '수정 요청 — 글자·배치') };
}
/** 글자 다시 쓰기(수정 요청·AI로 다듬기 공용): 같은 사진으로 새 버전 + 품질 엔진 + 0크레딧 원장 */
async function reviseText(c: any, comment: string, note: string, ledgerNote: string, actorId?: string | null) {
  const sql = db(); const s = await settingsOf(c.tenant);
  const [brand] = c.brand_id ? await sql<any[]>`select * from mkt_brands where id = ${c.brand_id}` : [];
  const [prev] = await sql<{ body: string; media_ids: string[] }[]>`select body, media_ids from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
  const d = await writeDraft(c, s, brand, null, { prev: prev?.body ?? '', comment });
  const f = await refineDraft(c, { ...d, title: c.title }, brand, { keepTitle: true });
  const q = qualityCheck(f.body, d.brief, s, bannedOf(brand), c.kind);
  if (f.errors.length) { q.passed = false; q.issues = [...q.issues, ...f.errors]; }
  const v = c.current_version + 1;
  if ((await import('./marketing')).needsPhotos(c.channel, prev?.media_ids?.length ?? 0)) { q.passed = false; q.issues = [...q.issues, (await import('./marketing')).BLOG_PHOTO_RULE]; }
  await sql.begin(async (tx) => {
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, ${v}, ${q.body}, ${prev?.media_ids ?? []}, ${note}, ${actorId ?? c.created_by})`;
    await tx`update mkt_contents set current_version = ${v}, status = ${q.passed ? 'pending' : 'changes'}, quality = ${tx.json({ passed: q.passed, issues: q.issues, report: { ...f.report, v } } as never)}, reminded_at = null, updated_at = now() where id = ${c.id}`;
    await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'text', 0, ${ledgerNote}, (select title from mkt_contents where id = ${c.id}))`;
  });
  return v;
}

// ---------------- 화면 API ----------------
export async function automationView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const s = await settingsOf(t);
  const [rules, requests, ledger, brands, people] = await Promise.all([
    sql`select r.id, r.brand_id, b.name as brand, r.channel, r.kind, r.weekdays, r.post_time, r.topic_hint, r.active, r.interval_days, r.anchor_date::text as anchor_date, r.cross_channels, r.bundle_key, r.skip_weekend from mkt_rules r left join mkt_brands b on b.id = r.brand_id where r.tenant = ${t} order by r.created_at`,
    sql`select q.id, q.kind, q.brief, q.est_credits::float8 est_credits, q.status, q.reason, q.created_at, q.brief_id, c.id as content_id, c.title, c.scheduled_at from mkt_production_requests q join mkt_contents c on c.id = q.content_id
      where q.tenant = ${t} and q.status in ('open', 'needs_approval') order by c.scheduled_at nulls last limit 50`,
    sql`select l.kind, l.credits::float8 credits, l.note, l.version, l.created_at, coalesce(l.title, c.title) as title from mkt_credit_ledger l left join mkt_contents c on c.id = l.content_id where l.tenant = ${t} order by l.created_at desc limit 30`,
    sql`select id, name, color, tone, intro, products, weekly_topic, banned_words, test_mode, ad_priority, ad_share::float8 as ad_share, ad_note, voice, video from mkt_brands where tenant = ${t} order by name`,
    sql`select id, name, role from users where tenant = ${t} and status = 'active' and not is_demo order by name`,
  ]);
  const co = await (await import('./ai/assistant')).usageThisMonth(t);
  return { settings: s, limits: limitsOf(s), usage: { ...(await usageOf(t)), ai: await mktAiUsd(t), companyAiUsd: co.costUsd, companyAiLimitUsd: co.limitUsd }, plans: await planTable(), production: await productionLeft(t), rules, requests, ledger, brands, people, canEdit: isAdmin(u) };
}
function adminOnly(u: SessionUser) { if (!isAdmin(u)) throw forbidden('자동 제작 설정은 관리자가 합니다'); }

const nInt = (a: number, b: number) => z.number().int().min(a).max(b);
export const settingsInput = z.object({ planCode: z.enum(['basic', 'standard', 'pro']).nullable().optional(), monthlyCredits: z.number().min(0).max(100000).nullable().optional(), weeklyCredits: z.number().min(0).max(100000).nullable().optional(),
  videoMonthly: nInt(0, 1000).nullable().optional(), regenMonthly: nInt(0, 1000).nullable().optional(), approvalHour: nInt(0, 23).optional(), leadDays: nInt(0, 14).optional(), leadHour: nInt(0, 23).optional(),
  remindHours: nInt(0, 72).optional(), quietStart: nInt(0, 23).optional(), quietEnd: nInt(0, 23).optional(), allowGeneratedPeople: z.boolean().optional(), allowSlideshow: z.boolean().optional(), aiLabel: z.string().trim().min(2).max(60).optional(), notifyUserIds: z.array(zUuid).max(30).nullable().optional(), aiMonthlyUsd: z.number().min(0).max(10000).nullable().optional(), autoPublish: z.boolean().optional() });
export async function saveSettings(u: SessionUser, i: z.infer<typeof settingsInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const cur = await settingsOf(tenantOf(u));
  const v = { plan_code: i.planCode !== undefined ? i.planCode : cur.plan_code, monthly_credits: i.monthlyCredits !== undefined ? i.monthlyCredits : cur.monthly_credits, weekly_credits: i.weeklyCredits !== undefined ? i.weeklyCredits : cur.weekly_credits,
    video_monthly: i.videoMonthly !== undefined ? i.videoMonthly : cur.video_monthly, regen_monthly: i.regenMonthly !== undefined ? i.regenMonthly : cur.regen_monthly, approval_hour: i.approvalHour ?? cur.approval_hour,
    lead_days: i.leadDays ?? cur.lead_days, lead_hour: i.leadHour ?? cur.lead_hour, remind_hours: i.remindHours ?? cur.remind_hours, quiet_start: i.quietStart ?? cur.quiet_start, quiet_end: i.quietEnd ?? cur.quiet_end,
    allow_generated_people: i.allowGeneratedPeople ?? cur.allow_generated_people, allow_slideshow: i.allowSlideshow ?? cur.allow_slideshow, ai_label: i.aiLabel ?? cur.ai_label,
    notify_user_ids: i.notifyUserIds !== undefined ? (i.notifyUserIds?.length ? i.notifyUserIds : null) : cur.notify_user_ids, ai_monthly_usd: i.aiMonthlyUsd !== undefined ? i.aiMonthlyUsd : cur.ai_monthly_usd, auto_publish: i.autoPublish ?? cur.auto_publish };
  const sql = db();
  await sql`insert into mkt_settings ${sql({ tenant: tenantOf(u), ...v, updated_by: u.id } as never)}
    on conflict (tenant) do update set plan_code = excluded.plan_code, monthly_credits = excluded.monthly_credits, weekly_credits = excluded.weekly_credits, video_monthly = excluded.video_monthly,
      regen_monthly = excluded.regen_monthly, approval_hour = excluded.approval_hour, lead_days = excluded.lead_days, lead_hour = excluded.lead_hour, remind_hours = excluded.remind_hours,
      quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, allow_generated_people = excluded.allow_generated_people, allow_slideshow = excluded.allow_slideshow, ai_label = excluded.ai_label, notify_user_ids = excluded.notify_user_ids, ai_monthly_usd = excluded.ai_monthly_usd, auto_publish = excluded.auto_publish,
      updated_by = excluded.updated_by, updated_at = now()`;
  // 제작 시점(게시 D-n·시각)이 바뀌면 아직 만들지 않은 자동 칸도 다시 계산(지난 시각이면 지금)
  const re = v.lead_days !== cur.lead_days || v.lead_hour !== cur.lead_hour
    ? await sql`update mkt_contents set produce_at = greatest(now(), (((scheduled_at at time zone 'Asia/Seoul')::date - ${v.lead_days}::int) + make_time(${v.lead_hour}::int, 0, 0)) at time zone 'Asia/Seoul')
        where tenant = ${tenantOf(u)} and auto and status = 'draft' and produced_at is null and scheduled_at is not null returning id` : [];
  return { ok: true, rescheduled: re.length };
}

const ruleBase = z.object({ brandId: zUuid.nullable().optional(), channel: z.enum(['instagram', 'facebook', 'threads', 'blog', 'youtube', 'naver_place', 'other']), kind: z.enum(['feed', 'blog', 'reels', 'video', 'shorts', 'story']),
  weekdays: z.array(nInt(0, 6)).max(7).default([]), postTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), topicHint: z.string().max(300).optional(), active: z.boolean().optional(),
  /** 대표 10/20 6): n일마다(요일 대신)·시작일·같은 글을 함께 올릴 채널 */
  intervalDays: nInt(1, 30).nullable().optional(), anchorDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), crossChannels: z.array(z.enum(['instagram', 'facebook', 'threads'])).max(3).optional(), skipWeekend: z.boolean().optional() })
export const ruleInput = ruleBase.refine((i) => i.intervalDays || i.weekdays.length, { message: '요일을 고르거나 n일마다를 정하세요' });
export async function createRule(u: SessionUser, i: z.infer<typeof ruleInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  if (i.brandId && !(await sql`select 1 from mkt_brands where id = ${i.brandId} and tenant = ${t}`).length) throw notFound('브랜드를 찾을 수 없습니다');
  const [r] = await sql<{ id: string }[]>`insert into mkt_rules (tenant, brand_id, channel, kind, weekdays, post_time, topic_hint, active, created_by, interval_days, anchor_date, cross_channels, skip_weekend)
    values (${t}, ${i.brandId ?? null}, ${i.channel}, ${i.kind}, ${[...new Set(i.weekdays)].sort()}, ${i.postTime}, ${i.topicHint ?? null}, ${i.active ?? true}, ${u.id}, ${i.intervalDays ?? null}, ${i.anchorDate ?? null}, ${(i.crossChannels ?? []).filter((c) => c !== i.channel)}, ${i.skipWeekend ?? false}) returning id`;
  return { id: r.id, planned: await planSlots(t) };
}
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** 로컬 10/20 보완 ②: 묶음의 종류별 게시 시각을 한 번에(피드·쇼츠·릴스·블로그·스토리) — 비우면 기본 BUNDLE 시각 */
const bundleTimes = z.object({ feed: HHMM.optional(), shorts: HHMM.optional(), reels: HHMM.optional(), blog: HHMM.optional(), story: HHMM.optional() });
export const bundleInput = z.object({ brandId: zUuid.nullable().optional(), intervalDays: nInt(2, 3).default(3), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), topicHint: z.string().max(300).optional(),
  weekdays: z.array(nInt(0, 6)).max(7).optional(), skipWeekend: z.boolean().optional(), times: bundleTimes.optional() }); // 로컬 10/20 보완: 요일 지정(월·수·금)·주말 건너뛰기·시각
/** 대표 10/20 6): 기본 묶음 규칙 5개를 한 번에(브랜드마다, 2~3일에 한 번) — 같은 bundle_key, 요일 대신 n일마다(또는 요일 지정) */
export async function createBundle(u: SessionUser, i: z.infer<typeof bundleInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  if (i.brandId && !(await sql`select 1 from mkt_brands where id = ${i.brandId} and tenant = ${t}`).length) throw notFound('브랜드를 찾을 수 없습니다');
  const key = randomUUID(); const start = i.startDate ?? ymd(new Date());
  const byDow = !!i.weekdays?.length; // 요일을 고르면 n일마다 대신 그 요일에(마케팅 계획: 워크인 월·수·금, 하이링크·다짐 화·목·토)
  const ids: string[] = [];
  for (const b of BUNDLE) {
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
    // 제작 전 초안은 같은 날 새 시각으로
    await sql`update mkt_contents set scheduled_at = ((scheduled_at at time zone 'Asia/Seoul')::date::text || ' ' || ${tm})::timestamp at time zone 'Asia/Seoul' where rule_id = ${r.id} and status = 'draft' and produced_at is null and scheduled_at > now()`;
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
    post_time = coalesce(${i.postTime ?? null}, post_time), topic_hint = coalesce(${i.topicHint ?? null}, topic_hint), active = coalesce(${i.active ?? null}, active), skip_weekend = coalesce(${i.skipWeekend ?? null}, skip_weekend) where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!r) throw notFound();
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

export const contentActInput = z.object({ action: z.enum(['regen', 'archive', 'polish']) });
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
  if (i.action === 'polish') {
    if (c.status === 'approved') throw badRequest('승인된 시안은 다듬지 않습니다 — [게시 전 수정 요청]으로 바꿔 주세요');
    if (!(await import('./ai/provider')).aiEnabled()) throw badRequest('AI 비서가 꺼져 있어 다듬을 수 없습니다');
    const [cur] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${id} and version = ${c.current_version}`;
    if (!cur?.body?.trim()) throw badRequest('다듬을 본문이 없습니다');
    const Q = await import('./mktQuality');
    const [brand] = c.brand_id ? await sql<any[]>`select voice from mkt_brands where id = ${c.brand_id}` : [];
    const r = Q.qualityReport({ channel: c.channel, kind: c.kind, title: c.title, body: cur.body, voice: brand?.voice }, await Q.qualityRules()).report;
    const why = [...r.human.issues.filter((x) => !/지움|바꿈/.test(x)), ...(r.hook && !r.hook.pass ? [`첫 줄 훅이 약함(${r.hook.score}점${r.hook.fails.length ? `: ${r.hook.fails.join('·')}` : ''})`] : []), ...r.voice].join(', ');
    const comment = `AI 티 줄이기 — ${why || '문장을 더 사람답게'}. 사실·숫자·가격·브랜드 이름·링크는 그대로 두고, 상투어·과한 느낌표·이모지 나열·특수 대시를 빼고 문장 길이를 섞어 주세요.${r.hook && !r.hook.pass ? ' 첫 줄은 구체적인 숫자·장면·대상으로 다시.' : ''}`;
    return { version: await reviseText(c, comment, `AI로 다듬기(0크레딧)${why ? `: ${why.slice(0, 160)}` : ''}`, 'AI로 다듬기 — 글자', u.id) };
  }
  if (!c.auto) throw badRequest('자동 제작 시안만 다시 만들 수 있습니다');
  if (c.status === 'approved') throw badRequest('승인된 시안은 다시 만들지 않습니다');
  return produceContent(c, u.id);
}

export const brandKitInput = z.object({ tone: z.string().max(200).nullable().optional(), intro: z.string().max(1000).nullable().optional(), products: z.string().max(1000).nullable().optional(), weeklyTopic: z.string().max(300).nullable().optional(), bannedWords: z.array(z.string().trim().min(1).max(30)).max(50).optional(),
  adPriority: z.number().int().min(1).max(99).nullable().optional(), adShare: z.number().min(0).max(100).nullable().optional(), adNote: z.string().max(300).nullable().optional(), // 대표 02:30 ③ 광고 예산 브랜드 축
  testMode: z.boolean().optional(), voice: voiceInput.optional(), // #426 말투 프로필
  // #454 영상 끝 화면·자막: 로고(자료실 이미지)·끝 화면 한 줄·CTA·배경색·글꼴(자료실 OTF/TTF)
  video: z.object({ logoFileId: z.string().uuid().nullable().optional(), headline: z.string().trim().max(30).nullable().optional(), cta: z.string().trim().max(60).nullable().optional(),
    endColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(), fontFileId: z.string().uuid().nullable().optional() }).optional() });
export async function saveBrandKit(u: SessionUser, id: string, i: z.infer<typeof brandKitInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  // #454 영상 키트 파일은 이 회사 자료실(기밀 아님)만
  for (const fid of [i.video?.logoFileId, i.video?.fontFileId]) if (fid && !(await db()`select 1 from library_files where id = ${fid} and tenant = ${tenantOf(u)} and deleted_at is null and coalesce(security, 'internal') <> 'confidential'`).length) throw badRequest('자료실에서 고른 파일만 쓸 수 있습니다(기밀 파일 제외)');
  const [b] = await db()`update mkt_brands set tone = ${i.tone === undefined ? db()`tone` : i.tone}, intro = ${i.intro === undefined ? db()`intro` : i.intro || null}, products = ${i.products === undefined ? db()`products` : i.products || null},
    weekly_topic = ${i.weeklyTopic === undefined ? db()`weekly_topic` : i.weeklyTopic || null}, banned_words = coalesce(${i.bannedWords ?? null}::text[], banned_words), test_mode = coalesce(${i.testMode ?? null}, test_mode),
    ad_priority = ${i.adPriority === undefined ? db()`ad_priority` : i.adPriority}, ad_share = ${i.adShare === undefined ? db()`ad_share` : i.adShare}, ad_note = ${i.adNote === undefined ? db()`ad_note` : i.adNote || null}, voice = ${i.voice === undefined ? db()`voice` : db().json(i.voice as never)},
    video = ${i.video === undefined ? db()`video` : db()`video || ${db().json(i.video as never)}::jsonb`} where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!b) throw notFound();
  // 재료(소개·상품·주제)가 생기면 이 브랜드의 열린 '주제 필요' 질문은 닫고 다음 실행에 제작
  if (i.intro || i.products || i.weeklyTopic) await db()`update mkt_production_requests q set status = 'done', brief = q.brief || ${'\n\n브랜드 키트 재료로 대신함'}, decided_by = ${u.id}, decided_at = now()
    from mkt_contents c where c.id = q.content_id and c.brand_id = ${id} and q.kind = 'topic' and q.status = 'open'`;
  return { ok: true };
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
  const p = P.anthropicProvider({ tier: 'fast' });
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
