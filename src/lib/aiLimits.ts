import { db, type Sql } from './db';
import { AI_NAME } from './aiNames';

/**
 * 대표 10/21 14:30 (#412) 요금제별 AI 한도 통합: 업무 AI 비서 · 영업 AI 세일즈 · 마케팅 AI 마케터 각각 "이번 달 한도 → 쓴 양 → 남은 양"을 한 표로,
 * 크레딧/달러/횟수를 체감 단위(질문 n회·메일 초안 n건·시안 n장·영상 n편)로 병기. 요금제별 기준표(베이직/스탠다드/프로 × 세 AI)는 이 파일 하나가
 * 고객 화면(사용량·요금제)·소개 사이트(/api/public/ai-plans)·플랫폼 운영에 같은 데이터를 준다.
 *
 * 한도 구조(지금): 업무·영업 AI 는 회사 공유 주머니 하나(요금제 월 요청 수 + 회사 월 AI 한도 $). 영업 사용자 인당 한도는 요금 설계안(대표 결정 전)이라
 * 영업 줄은 '회사 공유'로 표시한다. 마케팅은 마케팅 요금제(크레딧·마케팅 AI $·생성 영상 편수)가 따로 있다.
 * 쓴 양은 ai_usage.purpose 로 나눈다: marketing* → 마케팅, sales* → 영업, 나머지 → 업무. AI 비서 대화는 호출한 공간에 따라 sales_assistant·marketing_assistant 로 기록.
 */
export type AiSpace = 'work' | 'sales' | 'marketing';
export const spaceOfPurpose = (p: string | null | undefined): AiSpace => (!p ? 'work' : /^marketing/.test(p) ? 'marketing' : /^sales/.test(p) ? 'sales' : 'work');

/** 체감 단위 평균 단가($/건) — 최근 60일 플랫폼 전체 실측 평균(5건 이상일 때), 없으면 기본값(V45 실측 근사: 질문 약 70원·메일 초안 약 30원·문서 약 200원·원고 약 40원) */
const FEEL_DEFAULT_USD: Record<string, number> = { assistant: 0.05, sales_assistant: 0.05, mail_draft: 0.02, doc_engine: 0.15, marketing_produce: 0.03 };
export async function feelRates(sql: Sql = db()): Promise<Record<string, number>> {
  const keys = Object.keys(FEEL_DEFAULT_USD);
  const rows = await sql<{ purpose: string; n: number; usd: number }[]>`select purpose, count(distinct coalesce(request_id::text, id::text))::int n, coalesce(sum(cost_usd), 0)::float8 usd
    from ai_usage where purpose = any(${keys}) and created_at > now() - interval '60 days' group by purpose`.catch(() => [] as { purpose: string; n: number; usd: number }[]);
  const out = { ...FEEL_DEFAULT_USD };
  for (const r of rows) if (r.n >= 5 && r.usd > 0) out[r.purpose] = Math.round((r.usd / r.n) * 10000) / 10000;
  return out;
}
export type Feel = { label: string; n: number | null; unit: string; per: string };
const usdKrwRate = () => Number(process.env.USD_KRW) || 1400;
const krw = (usd: number, rate: number) => `${Math.max(1, Math.round(usd * rate)).toLocaleString('ko-KR')}원`;
/** 남은 $ → 체감 건수 */
function feelOf(leftUsd: number | null, items: [string, number, string][], rate: number): Feel[] {
  return items.map(([label, per, unit]) => ({ label, n: leftUsd === null ? null : Math.floor(leftUsd / per), unit, per: `1${unit} 약 ${krw(per, rate)}` }));
}

const month = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);

export type AiLimitRow = {
  key: AiSpace; name: string; shared: boolean; planLabel: string | null;
  limit: { requests: number | null; usd: number | null; credits?: number | null; videos?: number | null };
  used: { requests: number; usd: number | null; credits?: number; videos?: number };
  left: { requests: number | null; usd: number | null; credits?: number | null; videos?: number | null };
  pct: number | null; feel: Feel[]; note: string;
  /** 한도·쓴 양을 체감 단위(질문 n회)로 — 화면이 달러로 계산하지 않게 서버가 미리(#602: 고객사 응답엔 달러가 없음) */
  feelLimit?: number | null; feelUsed?: number | null;
};
/** 회사 한 곳의 세 AI 한도·사용·잔여 표 + 요금제별 기준표 */
export async function aiLimitsView(tenant: string, sql: Sql = db(), full = true) {
  const P = await import('./plans'); const M = await import('./mktAuto'); const A = await import('./ai/assistant');
  const start = `${month()}-01`;
  const [{ limits }, usage, m, bySpace, rates, ms, mu, cost, plans] = await Promise.all([
    P.effectiveLimits(tenant, sql), P.currentUsage(tenant, sql), A.usageThisMonth(tenant),
    sql<{ space: AiSpace; requests: number; usd: number }[]>`select case when purpose like 'marketing%' then 'marketing' when purpose like 'sales%' then 'sales' else 'work' end as space,
        count(distinct coalesce(request_id::text, id::text))::int requests, coalesce(sum(cost_usd), 0)::float8 usd
      from ai_usage where tenant = ${tenant} and created_at >= (${start}::date::timestamp at time zone 'Asia/Seoul') group by 1`,
    feelRates(sql), M.settingsOf(tenant), M.usageOf(tenant), M.creditCost(), aiPlanMatrix(sql),
  ]);
  const rate = usdKrwRate();
  const of = (s: AiSpace) => bySpace.find((x) => x.space === s) ?? { space: s, requests: 0, usd: 0 };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const poolReqLeft = limits.aiRequests === null ? null : Math.max(0, limits.aiRequests - usage.aiRequests);
  // 대표 10/24 ② 회사 월 AI 예산(원, 영상 제작 제외) — 달러 칸은 예산을 환율로 바꾼 값
  const b = m.budget;
  const poolUsdLimit = b.limitKrw === null ? null : r2(b.limitKrw / rate);
  const poolUsdLeft = b.leftKrw === null ? null : r2(b.leftKrw / rate);
  const poolPct = limits.aiRequests !== null && limits.aiRequests > 0 ? Math.max(Math.round((usage.aiRequests / limits.aiRequests) * 100), b.pct ?? 0) : b.pct;
  const w = of('work'), s = of('sales'), k = of('marketing');
  const ml = M.limitsOf(ms);
  const creditsLeft = ml.monthlyCredits === null ? null : Math.max(0, Math.round((ml.monthlyCredits - mu.monthCredits) * 10) / 10);
  const mktUsdLimit = ml.aiMonthlyUsd ?? null;
  const mktUsdLeft = mktUsdLimit === null ? poolUsdLeft : Math.max(0, r2(mktUsdLimit - k.usd));
  const rows: AiLimitRow[] = [
    { key: 'work', name: AI_NAME.work, shared: true, planLabel: null, limit: { requests: limits.aiRequests, usd: poolUsdLimit }, used: { requests: w.requests, usd: r2(w.usd) },
      left: { requests: poolReqLeft, usd: poolUsdLeft }, pct: poolPct,
      feel: feelOf(poolUsdLeft, [['질문·답변', rates.assistant, '회'], ['메일·문자 초안', rates.mail_draft, '건'], ['문서 생성', rates.doc_engine, '건']], rate),
      note: b.source === 'legacy' ? '회사가 함께 쓰는 한도(요금제 월 요청 수 + 회사 월 AI 한도)' : `회사 월 AI 예산을 업무·영업·마케팅 글 AI 가 함께 씀(영상 제작 제외) · ${b.resetLabel}에 다시 채워짐` },
    { key: 'sales', name: AI_NAME.sales, shared: true, planLabel: null, limit: { requests: limits.aiRequests, usd: poolUsdLimit }, used: { requests: s.requests, usd: r2(s.usd) },
      left: { requests: poolReqLeft, usd: poolUsdLeft }, pct: poolPct,
      feel: feelOf(poolUsdLeft, [['영업 질문·분석', rates.sales_assistant, '회'], ['제안서·견적 문서', rates.doc_engine, '건']], rate),
      note: b.source === 'legacy' ? '업무 AI 와 같은 회사 한도를 나눠 씁니다(영업 사용자 인당 한도는 요금 설계안 — 결정 전)' : '업무 AI 와 같은 회사 월 AI 예산을 나눠 씁니다' },
    { key: 'marketing', name: AI_NAME.marketing, shared: mktUsdLimit === null, planLabel: ms.plan?.label ?? null,
      limit: { requests: null, usd: mktUsdLimit, credits: ml.monthlyCredits, videos: ml.videoMonthly }, used: { requests: k.requests, usd: r2(k.usd), credits: mu.monthCredits, videos: mu.monthVideos },
      left: { requests: null, usd: mktUsdLeft, credits: creditsLeft, videos: ml.videoMonthly === null ? null : Math.max(0, ml.videoMonthly - mu.monthVideos) },
      pct: ml.monthlyCredits ? Math.min(999, Math.round((mu.monthCredits / ml.monthlyCredits) * 100)) : mktUsdLimit ? Math.round((k.usd / mktUsdLimit) * 100) : null,
      feel: [
        { label: '시안 이미지', n: creditsLeft === null ? null : Math.floor(creditsLeft / cost.imageCredits), unit: '장', per: `1장 ${cost.imageCredits}크레딧` },
        { label: '생성 영상', n: creditsLeft === null ? null : Math.floor(creditsLeft / cost.videoCredits), unit: '편', per: `1편 ${cost.videoCredits}크레딧` },
        ...feelOf(mktUsdLeft, [['원고·캡션', rates.marketing_produce, '건']], rate),
      ],
      note: ms.plan_code ? `마케팅 요금제 ${ms.plan?.label ?? ms.plan_code}: 월 크레딧·마케팅 AI 한도·생성 영상 편수` : '마케팅 요금제를 고르면 크레딧 한도가 생깁니다(지금은 회사 AI 한도만)' },
  ];
  for (const r of rows) { // 체감 단위 환산은 서버에서(화면은 숫자만 보여 줌)
    const f = r.feel[0]; const left = r.left.usd, used = r.used.usd ?? 0;
    r.feelLimit = r.key !== 'marketing' && r.limit.requests === null && f && f.n !== null && left !== null ? Math.round(((left + used) / Math.max(1e-9, left)) * f.n) : null;
    r.feelUsed = r.key !== 'marketing' && f && f.n !== null && left !== null && left > 0 ? Math.round((used / left) * f.n) : null;
  }
  const out = { month: month(), usdKrw: rate, rows, pool: { requests: { limit: limits.aiRequests, used: usage.aiRequests, left: poolReqLeft }, usd: { limit: poolUsdLimit, used: r2(m.costUsd) as number | null, left: poolUsdLeft } }, budget: b, plans };
  return full ? out : customerAiLimits(out);
}
/** #602(대표 10/25): 고객사에게는 달러·단가('1회 약 66원')를 빼고 횟수·%·남은 양만. 요금제 기준표의 마케팅 AI 달러는 원화 '분'으로 */
export function customerAiLimits<T extends { usdKrw: number; rows: AiLimitRow[]; pool: { requests: unknown; usd: { limit: number | null; used: number | null; left: number | null } }; plans: Awaited<ReturnType<typeof aiPlanMatrix>> }>(v: T): T {
  return { ...v,
    rows: v.rows.map((r) => ({ ...r, limit: { ...r.limit, usd: null }, used: { ...r.used, usd: null }, left: { ...r.left, usd: null }, feel: r.feel.map((f) => ({ ...f, per: '' })) })),
    pool: { ...v.pool, usd: { limit: null, used: null, left: null } },
    plans: { ...v.plans, plans: v.plans.plans.map((p) => ({ ...p, work: { ...p.work, feelPerUser: p.work.feelPerUser.map((f) => ({ ...f, per: '' })) },
      marketing: p.marketing ? { ...p.marketing, aiMonthlyUsd: null, aiMonthlyKrw: p.marketing.aiMonthlyUsd === null ? null : Math.round(p.marketing.aiMonthlyUsd * v.usdKrw) } : null })) } };
}

/** #602(대표 10/25 '고객에게 원가·단가를 보이지 않기'): 로그인 없는 소개 사이트용 기준표 — 요금제·한도·크레딧만. 요청당 평균 원가(rates)·크레딧 원가(cost)·환율·'1회 약 n원'·마케팅 AI 달러는 뺌 */
export function publicAiPlans(m: Awaited<ReturnType<typeof aiPlanMatrix>>) {
  return {
    plans: m.plans.map((p) => ({ ...p, work: { ...p.work, feelPerUser: p.work.feelPerUser.map((f) => ({ ...f, per: '' })) },
      marketing: p.marketing ? { ...p.marketing, aiMonthlyUsd: null } : null })),
    packs: m.packs, note: m.note,
  };
}
export type AiPlanRow = {
  code: string; name: string; perUserKrw: number | null; monthlyKrw: number | null; minUsers: number | null; description: string | null;
  work: { perUserAi: number | null; aiRequests: number | null; feelPerUser: Feel[]; budgetKrw: number | null; perUserBudgetKrw: number | null };
  sales: { shared: true };
  marketing: { code: string; label: string; price: number | null; monthlyCredits: number; aiMonthlyUsd: number | null; videoMonthly: number; regenMonthly: number; images: number; videos: number; weekly: Record<string, number> } | null;
};
/** 요금제별 기준표 — 업무 요금제(plans 표, 공개·활성) × 마케팅 요금제(mkt_plan_limits, 코드 w_basic→basic 식으로 짝) + AI 크레딧 팩. 한 함수가 모든 화면에 같은 값을 준다 */
export async function aiPlanMatrix(sql: Sql = db()) {
  const M = await import('./mktAuto');
  const [plans, packs, mkt, cost, rates] = await Promise.all([
    sql<any[]>`select code, name, per_user_krw, monthly_krw, min_users, limits, description from plans where public and active order by sort`,
    sql<any[]>`select code, name, monthly_krw, adds from plan_addons where active and (adds->>'aiRequests') is not null order by sort`,
    M.planTable(), M.creditCost(), feelRates(sql),
  ]);
  const rate = usdKrwRate();
  const rows: AiPlanRow[] = plans.map((p) => {
    const lim = (p.limits ?? {}) as { aiRequests?: number | null; perUserAi?: number | null; aiBudgetKrw?: number | null; perUserAiBudgetKrw?: number | null };
    const mk = mkt[p.code.replace(/^w_/, '')] ?? null;
    // 1인당 월 요청 수 → 체감(질문 기준): 요청 1회 = 질문 1회로 본다. 대표 10/24 ② 원 예산 요금제는 1인 금액 ÷ 최근 평균 단가
    const per = lim.perUserAi ?? null;
    const perKrw = lim.perUserAiBudgetKrw ?? null;
    const feelPerUser: Feel[] = perKrw !== null ? [{ label: '질문·답변', n: Math.floor(perKrw / (rates.assistant * rate)), unit: '회', per: `1회 약 ${krw(rates.assistant, rate)}` }, { label: '메일·문자 초안', n: Math.floor(perKrw / (rates.mail_draft * rate)), unit: '건', per: `1건 약 ${krw(rates.mail_draft, rate)}` }]
      : per === null ? [] : [{ label: '질문·답변', n: per, unit: '회', per: `1회 약 ${krw(rates.assistant, rate)}` }, { label: '메일·문자 초안', n: Math.floor((per * rates.assistant) / rates.mail_draft), unit: '건', per: `1건 약 ${krw(rates.mail_draft, rate)}` }];
    return { code: p.code, name: p.name, perUserKrw: p.per_user_krw ?? null, monthlyKrw: p.monthly_krw ?? null, minUsers: p.min_users ?? null, description: p.description ?? null,
      work: { perUserAi: per, aiRequests: lim.aiRequests ?? null, feelPerUser, budgetKrw: lim.aiBudgetKrw ?? null, perUserBudgetKrw: perKrw },
      sales: { shared: true as const },
      marketing: mk ? { code: mk.code, label: mk.label, price: mk.price, monthlyCredits: mk.monthlyCredits, aiMonthlyUsd: mk.aiMonthlyUsd, videoMonthly: mk.videoMonthly, regenMonthly: mk.regenMonthly,
        images: Math.floor(mk.monthlyCredits / cost.imageCredits), videos: Math.floor(mk.monthlyCredits / cost.videoCredits), weekly: mk.weekly } : null };
  });
  return { plans: rows, packs: packs.map((a) => ({ code: a.code, name: a.name, monthlyKrw: a.monthly_krw, aiRequests: Number(a.adds?.aiRequests ?? 0), aiBudgetKrw: a.adds?.aiBudgetKrw === undefined ? null : Number(a.adds.aiBudgetKrw) })), cost, rates, usdKrw: rate,
    note: '업무·영업·마케팅 글 AI 는 회사 월 AI 예산 하나를 함께 씀(1인 금액 × 결제 인원 + 마케팅 요금제 AI 몫 + AI 크레딧 팩, 매달 1일 다시 채워짐). 영상·시안 생성은 마케팅 크레딧으로 따로.' };
}
