import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { badRequest, forbidden, notFound } from './errors';
import { notify } from './notifications';
import { zUuid } from './api';
import { layoutBody } from './mktText';
import { tenantOf, type SessionUser } from './types';

/**
 * V41 4-3 + V43 마케팅 자동 제작(대표 방향 10/18): 브랜드·채널별 주간 규칙 → (게시 D-n 제작 시각) Claude 원고 + 이미지/영상 '제작 요청 카드'
 * → 자동 품질 검사 → 통과본만 승인함 → 알림(제작 완료 즉시 + 마감 N시간 전, 야간 무알림이면 직전 저녁) → 마감 지난 자동 시안은 정리.
 * 상업화(V43): 회사 요금제(금액 칸은 대표 결정 전 빈칸)·월/주 크레딧·생성 영상 편수·재생성 횟수, 고객·게시물·버전별 크레딧 원장, 수정 요청 분류(글자·배치 0 / 이미지·영상 재생성).
 * 이미지·영상 생성 엔진(Higgsfield API)은 계약(대표 결정) 뒤 — 지금은 카드에 실제 사용 크레딧을 기록하며 사람이 제작해 붙임.
 */
export const KIND_LABEL = { feed: '피드', blog: '블로그', reels: '릴스·쇼츠', video: '생성 영상' } as const;
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
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const kst = (date: string, hhmm: string) => new Date(`${date}T${hhmm.length === 5 ? hhmm : hhmm.padStart(2, '0') + ':00'}:00+09:00`);
const hourKst = (d: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(d)) % 24;
const pad = (n: number) => String(n).padStart(2, '0');

export type MktSettings = { plan_code: keyof typeof MKT_PLANS | null; monthly_credits: number | null; weekly_credits: number | null; video_monthly: number | null; regen_monthly: number | null;
  approval_hour: number; lead_days: number; lead_hour: number; remind_hours: number; quiet_start: number; quiet_end: number; allow_generated_people: boolean; allow_slideshow: boolean; ai_label: string; notify_user_ids: string[] | null; ai_monthly_usd: number | null };
const DEFAULTS: MktSettings = { plan_code: null, monthly_credits: null, weekly_credits: null, video_monthly: null, regen_monthly: null, approval_hour: 9, lead_days: 3, lead_hour: 13,
  remind_hours: 6, quiet_start: 22, quiet_end: 8, allow_generated_people: false, allow_slideshow: false, ai_label: 'AI 도움을 받아 제작했습니다', notify_user_ids: null, ai_monthly_usd: null };
export async function settingsOf(tenant: string): Promise<MktSettings> {
  const [s] = await db()<any[]>`select * from mkt_settings where tenant = ${tenant}`;
  if (!s) return { ...DEFAULTS };
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return { ...DEFAULTS, ...s, monthly_credits: num(s.monthly_credits), weekly_credits: num(s.weekly_credits), ai_monthly_usd: num(s.ai_monthly_usd) };
}
export function limitsOf(s: MktSettings) {
  const p = s.plan_code ? MKT_PLANS[s.plan_code] : null;
  const monthly = s.monthly_credits ?? p?.monthlyCredits ?? null;
  return { monthlyCredits: monthly, weeklyCredits: s.weekly_credits ?? (monthly === null ? null : Math.round((monthly / 4.3) * 10) / 10),
    videoMonthly: s.video_monthly ?? p?.videoMonthly ?? null, regenMonthly: s.regen_monthly ?? p?.regenMonthly ?? null, aiMonthlyUsd: s.ai_monthly_usd ?? p?.aiMonthlyUsd ?? null };
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
  if (!s.allow_slideshow && (kind === 'reels' || kind === 'video') && /슬라이드\s*쇼|사진\s*넘기기|느린\s*줌/.test(brief)) issues.push('슬라이드쇼(사진 + 느린 줌) 금지');
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
    const date = ymd(new Date(Date.now() + k * DAY));
    const dow = new Date(`${date}T12:00:00+09:00`).getUTCDay();
    if (!(r.weekdays as number[]).includes(dow)) continue;
    const at = kst(date, r.post_time);
    if (deadlineOf(at, s).getTime() <= Date.now()) continue; // 승인 마감이 이미 지난 칸은 만들지 않음
    let produce = kst(ymd(new Date(at.getTime() - s.lead_days * DAY)), `${pad(s.lead_hour)}:00`);
    if (produce.getTime() < Date.now()) produce = new Date();
    const title = `${r.test ? '[시험] ' : ''}${r.brand ? brandName({ name: r.brand }) + ' ' : ''}${KIND_LABEL[r.kind as Kind]} ${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
    const ins = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, rule_id, kind, auto, produce_at, is_test)
      values (${tenant}, ${r.brand_id}, ${title}, ${r.channel}, ${at}, 'draft', 0, ${r.created_by}, ${r.id}, ${r.kind}, true, ${produce}, ${!!r.test})
      on conflict (rule_id, scheduled_at) where rule_id is not null do nothing returning id`;
    made += ins.length;
  }
  return made;
}

/** 알림·승인 받는 사람: 설정에서 고른 사람(회사 안·활성) — 없으면 관리자 전원 */
export async function approvers(tenant: string) {
  const s = await settingsOf(tenant);
  if (s.notify_user_ids?.length) return (await db()<{ id: string }[]>`select id from users where tenant = ${tenant} and status = 'active' and id = any(${s.notify_user_ids}::uuid[])`).map((r) => r.id);
  return (await db()<{ id: string }[]>`select id from users where tenant = ${tenant} and role in ('owner', 'admin') and status = 'active'`).map((r) => r.id);
}
/** 시험 콘텐츠는 실행한 사람(없으면 규칙 만든 사람)에게만 */
const audience = async (c: any, actorId?: string | null) => (c.is_test ? [actorId ?? c.created_by].filter(Boolean) as string[] : approvers(c.tenant));

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
  const topic = String(c.quality?.topic ?? '').trim() || String(brand?.weekly_topic ?? '').trim() || String(rule?.topic_hint ?? '').trim();
  const about = [brand?.intro, brand?.products, co.business].map((x) => String(x ?? '').trim()).filter(Boolean);
  const lines = [
    `브랜드 이름: ${brandName(brand) || co.name || '(없음)'}`,
    co.name ? `회사: ${co.name}${co.industry ? ` (${co.industry})` : ''}` : '',
    brand?.intro ? `브랜드 소개: ${brand.intro}` : '',
    brand?.products ? `주력 상품·서비스: ${brand.products}` : '',
    co.business ? `회사 사업 소개: ${co.business}` : '',
    co.customers ? `주요 고객: ${co.customers}` : '',
    topic ? `이번 글 주제: ${topic}` : '',
    photos.length ? `쓸 수 있는 실사 사진(자료실):\n${photos.map((p) => `- ${p.title}${p.description ? `: ${p.description.slice(0, 120)}` : ''}`).join('\n')}` : '',
    recent.length ? `최근 게시 제목(겹치지 않게):\n${recent.map((r) => `- ${r.title}`).join('\n')}` : '',
  ].filter(Boolean);
  // 주제가 없고 브랜드·회사 소개도 없으면 재료 부족 — 일반론 원고 대신 '주제 필요' 카드로 질문
  return { enough: !!topic || about.length > 0, text: lines.join('\n'), topic, name: brandName(brand) || co.name };
}
/** 남은 [브랜드] 같은 자리표시는 아는 이름으로 바꿈 */
const fillName = (t: string, name: string) => (name ? t.replace(/\[(브랜드|브랜드\s*이름|브랜드명|회사|회사\s*이름|회사명|상호|업체명)\]/g, name) : t);

async function writeDraft(c: any, s: MktSettings, brand: any, rule: any, extra?: { prev: string; comment: string }) {
  const m = await materialOf(c, brand, rule);
  const P = await import('./ai/provider');
  const kindRule = { feed: '인스타그램 피드 캡션 4~6줄', blog: '블로그 원고(제목 1줄 + 본문 10~15문장, 소제목 2~3개 — 소제목은 "■ 소제목" 한 줄로 따로, 문단은 2~3문장씩 빈 줄로 나눔)', reels: '릴스·쇼츠 자막 대본(5~7컷, 컷마다 한 줄)과 캡션 3줄', video: '15~20초 광고 영상 컷 구성(4~5컷)과 캡션 3줄' }[c.kind as Kind] ?? '게시물 글';
  if (!P.aiEnabled()) return { title: c.title, body: extra ? extra.prev : `[AI 비서 꺼짐] ${rule?.topic_hint ?? c.title}`, brief: '' };
  await assertMktAi(c.tenant);
  const p = P.anthropicProvider({ tier: 'fast' });
  const r = await p.chat({
    system: `회사 마케팅 담당 AI 비서입니다. ${kindRule}를 씁니다. JSON 만.
- 한국어, 브랜드 말투: ${brand?.tone || '친절하고 담백하게'}. 금지어: ${(brand?.banned_words ?? []).join(', ') || '없음'}.
- 실사 사진 우선. ${s.allow_generated_people ? '' : '생성 인물을 실제 고객처럼 쓰지 않음(후기·체험담 지어내지 않음). '}${s.allow_slideshow ? '' : '슬라이드쇼(사진 + 느린 줌) 구성 금지. '}
- 아래 [재료]에 있는 사실만 씁니다. 숫자·연혁·실적·가격·날짜는 재료에 있는 값만 — 없으면 그 문장을 빼고, [확인 필요]·[브랜드] 같은 대괄호 자리표시는 절대 쓰지 않습니다. 과장·최상급 금지.
- 브랜드 이름은 '${m.name || '우리'}' 그대로 씁니다. 제목에 [시험] 같은 표시는 붙이지 않습니다.
- brief 에는 이미지/영상 제작 지시(실사 사진 + 글자 렌더 우선, 촬영 구도·필요한 사진)를 씁니다.`,
    tools: [], messages: [{ role: 'user', content: `[재료]\n${m.text}\n\n` + (extra ? `[지난 원고]\n${extra.prev}\n\n[수정 요청]\n${extra.comment}\n\n수정 요청을 반영해 다시 써 주세요.` : `채널: ${c.channel}\n게시일: ${ymd(new Date(c.scheduled_at))}\n주제: ${m.topic || '재료의 브랜드·상품 소개에서 이번 주에 알릴 만한 것 하나'}`) }],
    format: { type: 'object', additionalProperties: false, required: ['title', 'body', 'brief'], properties: { title: { type: 'string' }, body: { type: 'string' }, brief: { type: 'string' } } },
  });
  await db()`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, purpose)
    values (${c.tenant}, ${c.created_by}, ${randomUUID()}, ${p.name}, ${r.model ?? p.model}, ${r.usage.input_tokens}, ${r.usage.output_tokens}, 0, 0, ${P.costUsd(r.model ?? p.model, r.usage)}, 'marketing_produce')`;
  const raw = (r.content as any[]).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const strip = (t: string) => fillName(t.replace(/^\s*\[시험\]\s*/, ''), m.name);
  try { const o = JSON.parse(raw); return { title: strip(String(o.title || c.title)).slice(0, 200), body: layoutBody(c.kind, fillName(String(o.body ?? ''), m.name)), brief: fillName(String(o.brief ?? ''), m.name) }; }
  catch { return { title: c.title, body: fillName(raw, m.name), brief: '' }; }
}

/** 제작 요청 카드 — 한도를 넘으면 needs_approval(제작 전 승인 요청) */
async function requestCard(c: any, version: number, kind: 'image' | 'video' | 'regen_image' | 'regen_video', brief: string, est: number, tx?: any) {
  const sql = tx ?? db(); const s = await settingsOf(c.tenant); const lim = limitsOf(s); const use = await usageOf(c.tenant);
  let reason: string | null = null;
  if (kind === 'video' && est >= EST.video && lim.videoMonthly !== null && use.monthVideos >= lim.videoMonthly) reason = `이번 달 생성 영상 ${lim.videoMonthly}편을 다 썼습니다`;
  else if (kind.startsWith('regen') && lim.regenMonthly !== null && use.monthRegens >= lim.regenMonthly) reason = `이번 달 재생성 ${lim.regenMonthly}회를 다 썼습니다 — 추가 1회 = 약 ${est}크레딧`;
  else if (est > 0 && lim.weeklyCredits !== null && use.weekCredits + est > lim.weeklyCredits) reason = `이번 주 크레딧 한도(${lim.weeklyCredits}) 초과 예상 — 약 ${est}크레딧`;
  const [q] = await sql<{ id: string }[]>`insert into mkt_production_requests (tenant, content_id, version, kind, brief, est_credits, status, reason)
    values (${c.tenant}, ${c.id}, ${version}, ${kind}, ${brief.slice(0, 4000)}, ${est}, ${reason ? 'needs_approval' : 'open'}, ${reason}) returning id`;
  if (reason) await notify(sql, { userIds: await audience(c), type: 'review_requested', title: `제작 전 승인 필요: ${c.title}`, body: reason, link: '/s/marketing/automation', entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktreq:${q.id}` });
  return { id: q.id, reason };
}

export async function produceContent(c: any, actorId?: string | null) {
  const sql = db(); const s = await settingsOf(c.tenant);
  const [brand] = c.brand_id ? await sql<any[]>`select * from mkt_brands where id = ${c.brand_id}` : [];
  const [rule] = c.rule_id ? await sql<any[]>`select * from mkt_rules where id = ${c.rule_id}` : [];
  const m = await materialOf(c, brand, rule);
  if (!m.enough) return askTopic(c, actorId);
  const d = await writeDraft(c, s, brand, rule);
  const kind = c.kind as Kind;
  const q = qualityCheck(d.body, d.brief, s, brand?.banned_words ?? [], kind, d.title);
  const deadline = deadlineOf(c.scheduled_at, s);
  const v = (c.current_version ?? 0) + 1; // 처음 제작 = v1, 다시 만들기 = 다음 버전
  // 원고·원장·제작 요청 카드를 한 번에(중간에 끊겨 원고만 남고 카드가 빠지는 일이 없게)
  await sql.begin(async (tx) => {
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, ${v}, ${q.body}, ${[]}, ${v === 1 ? 'AI 자동 제작' : 'AI 다시 만들기'}, ${c.created_by})`;
    if (v > 1) await tx`update mkt_production_requests set status = 'canceled', reason = coalesce(reason, '다시 만들기로 대체'), decided_at = now() where content_id = ${c.id} and kind in ('image', 'video') and status in ('open', 'needs_approval')`;
    await tx`update mkt_contents set title = ${(c.is_test && !d.title.startsWith('[시험]') ? '[시험] ' : '') + d.title}, current_version = ${v}, reminded_at = null, status = ${q.passed ? 'pending' : 'changes'}, produced_at = now(), quality = ${tx.json({ passed: q.passed, issues: q.issues, brief: d.brief } as never)}, updated_at = now() where id = ${c.id}`;
    await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'text', 0, ${v === 1 ? '원고(Claude) — 크레딧 0' : '다시 만들기 원고(Claude) — 크레딧 0'}, (select title from mkt_contents where id = ${c.id}))`;
    // 이미지·영상은 제작 요청 카드(Higgsfield 계약 전: 사람이 실사 + 글자 렌더로 제작해 붙임)
    if (kind !== 'blog' || d.brief) await requestCard(c, v, kind === 'video' || kind === 'reels' ? 'video' : 'image', d.brief || '실사 사진 + 글자 렌더', kind === 'video' ? EST.video : kind === 'reels' ? EST.video_reels : EST.image, tx);
  });
  if (!isQuiet(new Date(), s)) await notify(sql, { userIds: await audience(c, actorId), type: 'review_requested', title: q.passed ? `제작 완료 — 승인해 주세요: ${d.title}` : `품질 검사 미통과: ${d.title}`,
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
    await notify(sql, { userIds: await audience(c, actorId), type: 'review_requested', title: `주제 필요: ${c.title}`, body: '쓸 재료가 없어 시안을 만들지 않았습니다 — 주제를 알려 주세요', link: '/s/marketing/automation', entityType: 'mkt_content', entityId: c.id, dedupeKey: `mkttopic:${q.id}` });
  }
  return { id: c.id, passed: false, issues: ['주제 필요'], needsTopic: true };
}

/** 마감 N시간 전 알림(야간이면 직전 저녁) · 마감 지난 자동 시안 정리 */
export async function remindAndExpire(tenant: string) {
  const sql = db(); const s = await settingsOf(tenant);
  const rows = await sql<any[]>`select id, tenant, title, scheduled_at, status, auto, reminded_at, is_test, created_by from mkt_contents where tenant = ${tenant} and status in ('pending', 'changes', 'draft') and scheduled_at is not null and scheduled_at > now() - interval '2 days'`;
  let reminded = 0, expired = 0;
  for (const c of rows) {
    const dl = deadlineOf(c.scheduled_at, s);
    if (c.auto && dl.getTime() < Date.now()) { // 고객에게 '마감 지남'만 반복해 보이지 않게(V43 7)
      await sql`update mkt_contents set status = 'canceled', quality = coalesce(quality, '{}'::jsonb) || '{"expired": true}'::jsonb, updated_at = now() where id = ${c.id}`;
      expired++; continue;
    }
    if (c.status !== 'pending' || c.reminded_at || Date.now() < remindAtOf(dl, s).getTime() || isQuiet(new Date(), s)) continue;
    await notify(sql, { userIds: await audience(c), type: 'review_requested', title: `승인 마감 ${s.remind_hours}시간 전: ${c.title}`, body: `마감 ${Number(ymd(dl).slice(5, 7))}/${Number(ymd(dl).slice(8))} ${pad(s.approval_hour)}:00`, link: `/s/marketing/approvals?c=${c.id}`, entityType: 'mkt_content', entityId: c.id, dedupeKey: `mktr:${c.id}` });
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
      await notify(db(), { userIds: await approvers(tenant), type: 'usage_alert', title: '마케팅 자동 제작 멈춤(AI 한도)', body: r.error, link: '/s/marketing/automation', dedupeKey: `mktquota:${tenant}:${ymd(new Date())}` }).catch(() => {});
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
  const s = await settingsOf(c.tenant);
  const [brand] = c.brand_id ? await sql<any[]>`select * from mkt_brands where id = ${c.brand_id}` : [];
  const [prev] = await sql<{ body: string }[]>`select body from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
  const d = await writeDraft(c, s, brand, null, { prev: prev?.body ?? '', comment });
  const q = qualityCheck(d.body, d.brief, s, brand?.banned_words ?? [], c.kind);
  const v = c.current_version + 1;
  const [old] = await sql<{ media_ids: string[] }[]>`select media_ids from mkt_versions where content_id = ${c.id} and version = ${c.current_version}`;
  await sql.begin(async (tx) => {
    await tx`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, ${v}, ${q.body}, ${old?.media_ids ?? []}, ${`수정 요청 반영(글자·배치, 0크레딧): ${comment.slice(0, 200)}`}, ${c.created_by})`;
    await tx`update mkt_contents set current_version = ${v}, status = ${q.passed ? 'pending' : 'changes'}, quality = ${tx.json({ passed: q.passed, issues: q.issues } as never)}, reminded_at = null, updated_at = now() where id = ${c.id}`;
    await tx`insert into mkt_credit_ledger (tenant, content_id, version, kind, credits, note, title) values (${c.tenant}, ${c.id}, ${v}, 'text', 0, '수정 요청 — 글자·배치', (select title from mkt_contents where id = ${c.id}))`;
  });
  return { kind, version: v };
}

// ---------------- 화면 API ----------------
export async function automationView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const s = await settingsOf(t);
  const [rules, requests, ledger, brands, people] = await Promise.all([
    sql`select r.id, r.brand_id, b.name as brand, r.channel, r.kind, r.weekdays, r.post_time, r.topic_hint, r.active from mkt_rules r left join mkt_brands b on b.id = r.brand_id where r.tenant = ${t} order by r.created_at`,
    sql`select q.id, q.kind, q.brief, q.est_credits::float8 est_credits, q.status, q.reason, q.created_at, c.id as content_id, c.title, c.scheduled_at from mkt_production_requests q join mkt_contents c on c.id = q.content_id
      where q.tenant = ${t} and q.status in ('open', 'needs_approval') order by c.scheduled_at nulls last limit 50`,
    sql`select l.kind, l.credits::float8 credits, l.note, l.version, l.created_at, coalesce(l.title, c.title) as title from mkt_credit_ledger l left join mkt_contents c on c.id = l.content_id where l.tenant = ${t} order by l.created_at desc limit 30`,
    sql`select id, name, tone, intro, products, weekly_topic, banned_words, test_mode from mkt_brands where tenant = ${t} order by name`,
    sql`select id, name, role from users where tenant = ${t} and status = 'active' and not is_demo order by name`,
  ]);
  const co = await (await import('./ai/assistant')).usageThisMonth(t);
  return { settings: s, limits: limitsOf(s), usage: { ...(await usageOf(t)), ai: await mktAiUsd(t), companyAiUsd: co.costUsd, companyAiLimitUsd: co.limitUsd }, plans: MKT_PLANS, rules, requests, ledger, brands, people, canEdit: isAdmin(u) };
}
function adminOnly(u: SessionUser) { if (!isAdmin(u)) throw forbidden('자동 제작 설정은 관리자가 합니다'); }

const nInt = (a: number, b: number) => z.number().int().min(a).max(b);
export const settingsInput = z.object({ planCode: z.enum(['basic', 'standard', 'pro']).nullable().optional(), monthlyCredits: z.number().min(0).max(100000).nullable().optional(), weeklyCredits: z.number().min(0).max(100000).nullable().optional(),
  videoMonthly: nInt(0, 1000).nullable().optional(), regenMonthly: nInt(0, 1000).nullable().optional(), approvalHour: nInt(0, 23).optional(), leadDays: nInt(0, 14).optional(), leadHour: nInt(0, 23).optional(),
  remindHours: nInt(0, 72).optional(), quietStart: nInt(0, 23).optional(), quietEnd: nInt(0, 23).optional(), allowGeneratedPeople: z.boolean().optional(), allowSlideshow: z.boolean().optional(), aiLabel: z.string().trim().min(2).max(60).optional(), notifyUserIds: z.array(zUuid).max(30).nullable().optional(), aiMonthlyUsd: z.number().min(0).max(10000).nullable().optional() });
export async function saveSettings(u: SessionUser, i: z.infer<typeof settingsInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const cur = await settingsOf(tenantOf(u));
  const v = { plan_code: i.planCode !== undefined ? i.planCode : cur.plan_code, monthly_credits: i.monthlyCredits !== undefined ? i.monthlyCredits : cur.monthly_credits, weekly_credits: i.weeklyCredits !== undefined ? i.weeklyCredits : cur.weekly_credits,
    video_monthly: i.videoMonthly !== undefined ? i.videoMonthly : cur.video_monthly, regen_monthly: i.regenMonthly !== undefined ? i.regenMonthly : cur.regen_monthly, approval_hour: i.approvalHour ?? cur.approval_hour,
    lead_days: i.leadDays ?? cur.lead_days, lead_hour: i.leadHour ?? cur.lead_hour, remind_hours: i.remindHours ?? cur.remind_hours, quiet_start: i.quietStart ?? cur.quiet_start, quiet_end: i.quietEnd ?? cur.quiet_end,
    allow_generated_people: i.allowGeneratedPeople ?? cur.allow_generated_people, allow_slideshow: i.allowSlideshow ?? cur.allow_slideshow, ai_label: i.aiLabel ?? cur.ai_label,
    notify_user_ids: i.notifyUserIds !== undefined ? (i.notifyUserIds?.length ? i.notifyUserIds : null) : cur.notify_user_ids, ai_monthly_usd: i.aiMonthlyUsd !== undefined ? i.aiMonthlyUsd : cur.ai_monthly_usd };
  const sql = db();
  await sql`insert into mkt_settings ${sql({ tenant: tenantOf(u), ...v, updated_by: u.id } as never)}
    on conflict (tenant) do update set plan_code = excluded.plan_code, monthly_credits = excluded.monthly_credits, weekly_credits = excluded.weekly_credits, video_monthly = excluded.video_monthly,
      regen_monthly = excluded.regen_monthly, approval_hour = excluded.approval_hour, lead_days = excluded.lead_days, lead_hour = excluded.lead_hour, remind_hours = excluded.remind_hours,
      quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, allow_generated_people = excluded.allow_generated_people, allow_slideshow = excluded.allow_slideshow, ai_label = excluded.ai_label, notify_user_ids = excluded.notify_user_ids, ai_monthly_usd = excluded.ai_monthly_usd,
      updated_by = excluded.updated_by, updated_at = now()`;
  // 제작 시점(게시 D-n·시각)이 바뀌면 아직 만들지 않은 자동 칸도 다시 계산(지난 시각이면 지금)
  const re = v.lead_days !== cur.lead_days || v.lead_hour !== cur.lead_hour
    ? await sql`update mkt_contents set produce_at = greatest(now(), (((scheduled_at at time zone 'Asia/Seoul')::date - ${v.lead_days}::int) + make_time(${v.lead_hour}::int, 0, 0)) at time zone 'Asia/Seoul')
        where tenant = ${tenantOf(u)} and auto and status = 'draft' and produced_at is null and scheduled_at is not null returning id` : [];
  return { ok: true, rescheduled: re.length };
}

export const ruleInput = z.object({ brandId: zUuid.nullable().optional(), channel: z.enum(['instagram', 'facebook', 'threads', 'blog', 'youtube', 'naver_place', 'other']), kind: z.enum(['feed', 'blog', 'reels', 'video']),
  weekdays: z.array(nInt(0, 6)).min(1).max(7), postTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), topicHint: z.string().max(300).optional(), active: z.boolean().optional() });
export async function createRule(u: SessionUser, i: z.infer<typeof ruleInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const sql = db(); const t = tenantOf(u);
  if (i.brandId && !(await sql`select 1 from mkt_brands where id = ${i.brandId} and tenant = ${t}`).length) throw notFound('브랜드를 찾을 수 없습니다');
  const [r] = await sql<{ id: string }[]>`insert into mkt_rules (tenant, brand_id, channel, kind, weekdays, post_time, topic_hint, active, created_by)
    values (${t}, ${i.brandId ?? null}, ${i.channel}, ${i.kind}, ${[...new Set(i.weekdays)].sort()}, ${i.postTime}, ${i.topicHint ?? null}, ${i.active ?? true}, ${u.id}) returning id`;
  return { id: r.id, planned: await planSlots(t) };
}
export const rulePatch = ruleInput.partial();
export async function updateRule(u: SessionUser, id: string, i: z.infer<typeof rulePatch>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const sql = db();
  const [r] = await sql`update mkt_rules set channel = coalesce(${i.channel ?? null}, channel), kind = coalesce(${i.kind ?? null}, kind), weekdays = coalesce(${i.weekdays ? [...new Set(i.weekdays)].sort() : null}::int[], weekdays),
    post_time = coalesce(${i.postTime ?? null}, post_time), topic_hint = coalesce(${i.topicHint ?? null}, topic_hint), active = coalesce(${i.active ?? null}, active) where id = ${id} and tenant = ${tenantOf(u)} returning id`;
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
  if (i.action === 'cancel') { await sql`update mkt_production_requests set status = 'canceled', decided_by = ${u.id}, decided_at = now() where id = ${id}`; return { status: 'canceled' }; }
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
  return { status: 'done', credits };
}

export const contentActInput = z.object({ action: z.enum(['regen', 'archive']) });
/** 시안 다시 만들기(자동 제작 시안: 지금 재료로 새 버전 — 이전 이미지·영상 카드는 취소) · 보관(취소 상태 = 목록에서 숨김, 지우지 않음) */
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
  if (!c.auto) throw badRequest('자동 제작 시안만 다시 만들 수 있습니다');
  if (c.status === 'approved') throw badRequest('승인된 시안은 다시 만들지 않습니다');
  return produceContent(c, u.id);
}

export const brandKitInput = z.object({ tone: z.string().max(200).nullable().optional(), intro: z.string().max(1000).nullable().optional(), products: z.string().max(1000).nullable().optional(), weeklyTopic: z.string().max(300).nullable().optional(), bannedWords: z.array(z.string().trim().min(1).max(30)).max(50).optional(), testMode: z.boolean().optional() });
export async function saveBrandKit(u: SessionUser, id: string, i: z.infer<typeof brandKitInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound();
  const [b] = await db()`update mkt_brands set tone = ${i.tone === undefined ? db()`tone` : i.tone}, intro = ${i.intro === undefined ? db()`intro` : i.intro || null}, products = ${i.products === undefined ? db()`products` : i.products || null},
    weekly_topic = ${i.weeklyTopic === undefined ? db()`weekly_topic` : i.weeklyTopic || null}, banned_words = coalesce(${i.bannedWords ?? null}::text[], banned_words), test_mode = coalesce(${i.testMode ?? null}, test_mode) where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!b) throw notFound();
  // 재료(소개·상품·주제)가 생기면 이 브랜드의 열린 '주제 필요' 질문은 닫고 다음 실행에 제작
  if (i.intro || i.products || i.weeklyTopic) await db()`update mkt_production_requests q set status = 'done', brief = q.brief || ${'\n\n브랜드 키트 재료로 대신함'}, decided_by = ${u.id}, decided_at = now()
    from mkt_contents c where c.id = q.content_id and c.brand_id = ${id} and q.kind = 'topic' and q.status = 'open'`;
  return { ok: true };
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
