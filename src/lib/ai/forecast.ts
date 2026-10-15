import { z } from 'zod';
import { db, type Sql } from '../db';
import { notFound } from '../errors';
import { audit } from '../log';
import { notify } from '../notifications';
import type { SessionUser } from '../types';
import { usdKrw } from './provider';

/**
 * V23 5장 플랫폼 운영자 "AI 원가 전망" — 기존 기능 동작은 바꾸지 않고 계산·표시만.
 * 모든 금액은 ai_usage 의 정가(건별 결제 가정). 확보 크레딧·다음 달 확보·콘솔 실제 청구·AI 몫 비율은 운영자가 입력(app_settings ai_finance).
 */
const KEY = 'ai_finance';
/** 검토용 요금표(V27 확정안, 1인 월) — 계산·표시 전용. 실제 요금(plans)은 대표 확정 후 따로 바꾼다 */
const REVIEW_PRICES = [
  { code: 'free', name: '무료', perUserKrw: 0, note: '10명까지 — AI 한도로 관리' },
  { code: 'basic', name: '베이직', perUserKrw: 2200, note: '' },
  { code: 'standard', name: '스탠다드', perUserKrw: 4500, note: '' },
  { code: 'pro', name: '프로', perUserKrw: 8500, note: '' },
];
export const financeInput = z.object({
  securedUsd: z.number().min(0).max(1_000_000).optional(),        // 이번 달 확보 크레딧(예: Max $100)
  nextSecuredUsd: z.number().min(0).max(1_000_000).optional(),    // 다음 달 확보 예정
  consoleUsd: z.number().min(0).max(1_000_000).nullable().optional(), // 콘솔 실제 청구(이번 달)
  companySize: z.number().int().min(1).max(1000).optional(),      // 고객사 1곳 인원(기본 10)
  aiShare: z.number().min(0).max(1).optional(),                   // 요금 중 AI 몫(기본 30%)
  cycleStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), // 크레딧 주기 시작일(예: Max 결제일 2026-09-25) — 비우면 달력 월
});
type Finance = { securedUsd: number; nextSecuredUsd: number; consoleUsd: number | null; consoleAt?: string; companySize: number; aiShare: number; cycleStart: string | null };
async function finance(sql: Sql): Promise<Finance> {
  const [r] = await sql<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = r?.value ?? {};
  return { securedUsd: v.securedUsd ?? 100, nextSecuredUsd: v.nextSecuredUsd ?? v.securedUsd ?? 100, consoleUsd: v.consoleUsd ?? null, consoleAt: v.consoleAt, companySize: v.companySize ?? 10, aiShare: v.aiShare ?? 0.3, cycleStart: v.cycleStart ?? null };
}
export async function setFinance(u: SessionUser, i: z.infer<typeof financeInput>) {
  if (!u.platformAdmin) throw notFound();
  const sql = db();
  const cur = await finance(sql);
  const next = { ...cur, ...Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)), ...(i.consoleUsd !== undefined ? { consoleAt: new Date().toISOString() } : {}) };
  await sql`insert into app_settings (key, value, updated_by) values (${KEY}, ${sql.json(next as never)}, ${u.id}) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'ai.finance', null, null, i, null);
  return { ok: true };
}

const seoulNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
/** 크레딧 주기: 시작일(cycleStart)의 "일"이 매달 돌아오는 날부터 한 달(예: 25일~다음 달 24일). 없으면 달력 월 */
function monthInfo(cycleStart?: string | null) {
  const n = seoulNow();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = cycleStart ? Number(cycleStart.slice(8, 10)) : 1;
  const clampDay = (y: number, m: number) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  let start = clampDay(n.getFullYear(), n.getMonth());
  if (start > n) start = clampDay(n.getFullYear(), n.getMonth() - 1);
  const end = clampDay(start.getFullYear(), start.getMonth() + 1);
  const days = Math.round((end.getTime() - start.getTime()) / 86400_000);
  const elapsed = (n.getTime() - start.getTime()) / 86400_000; // 지난 날(소수)
  const month = cycleStart ? `${ymd(start)} ~ ${ymd(new Date(end.getTime() - 86400_000))}` : ymd(start).slice(0, 7);
  return { month, start: ymd(start), days, elapsed: Math.max(elapsed, 0.25), today: n };
}

export async function aiForecast(u: SessionUser) {
  if (!u.platformAdmin) throw notFound();
  return computeForecast(db());
}
export async function computeForecast(sql: Sql) {
  const f = await finance(sql);
  const rate = usdKrw();
  const { month, start: startDay, days, elapsed, today } = monthInfo(f.cycleStart);
  const start = sql`(${startDay}::date::timestamp at time zone 'Asia/Seoul')`;
  const [[cum], byTenant, byPurpose, [week], unitRows, [docAvg], userRows] = await Promise.all([
    sql<{ usd: number }[]>`select coalesce(sum(cost_usd), 0)::float8 usd from ai_usage where created_at >= ${start}`,
    sql<{ tenant: string; name: string | null; usd: number }[]>`select a.tenant, t.name, sum(a.cost_usd)::float8 usd from ai_usage a left join tenants t on t.id = a.tenant where a.created_at >= ${start} group by a.tenant, t.name order by usd desc`,
    sql<{ purpose: string; usd: number; n: number }[]>`select coalesce(purpose, 'assistant') purpose, sum(cost_usd)::float8 usd, count(*)::int n from ai_usage where created_at >= ${start} group by 1 order by usd desc`,
    sql<{ usd: number }[]>`select coalesce(sum(cost_usd), 0)::float8 usd from ai_usage where created_at >= now() - interval '7 days'`,
    // 최근 30일 기능별 1건 평균: 대화는 질문 1번(request_id 묶음), 그 밖은 호출 1번
    sql<{ purpose: string; avg: number; n: number }[]>`select purpose, avg(c)::float8 avg, count(*)::int n from (
        select coalesce(purpose, 'assistant') purpose, request_id, sum(cost_usd) c from ai_usage where created_at >= now() - interval '30 days' and coalesce(purpose, 'assistant') <> 'doc_engine'
        group by 1, 2) x group by purpose order by n desc`,
    sql<{ avg: number | null; n: number }[]>`select avg(cost_usd)::float8 avg, count(*)::int n from ai_doc_jobs where status = 'done' and created_at >= now() - interval '30 days'`,
    // 사람별 최근 30일 사용(원) — 사용한 사람만
    sql<{ usd: number }[]>`select sum(cost_usd)::float8 usd from ai_usage where created_at >= now() - interval '30 days' and user_id is not null group by user_id order by 1`,
  ]);
  const monthUsd = cum.usd;
  const forecastUsd = (monthUsd / elapsed) * days;
  const dailyUsd = week.usd / 7;
  // 사용자 유형: 사용량 순 3등분(가벼움·보통·많음) 평균, 30일 → 월
  const per = userRows.map((r) => r.usd * rate);
  const third = (k: number) => { const n = per.length; if (!n) return 0; const a = per.slice(Math.floor((n * k) / 3), Math.max(Math.floor((n * (k + 1)) / 3), Math.floor((n * k) / 3) + 1)); return Math.round(a.reduce((s, x) => s + x, 0) / a.length); };
  const measured = { light: third(0), medium: third(1), heavy: third(2), users: per.length };
  // 데이터 부족(사용자 10명 미만 또는 쌓인 기간 30일 미만)이면 V23 5.2 가정값으로 계산하고 실측은 옆에 표시
  const [firstUse] = await sql<{ at: Date | null }[]>`select min(created_at) at from ai_usage`;
  const dataDays = firstUse?.at ? (Date.now() - new Date(firstUse.at).getTime()) / 86400_000 : 0;
  const estimated = measured.users < 10 || dataDays < 30;
  const ASSUMED = { light: 1600, medium: 5300, heavy: 10600 };
  const tiers = estimated ? { ...ASSUMED, users: measured.users } : measured;
  // 고객사 1곳 월 원가(인원 N, 많음 10%·보통 30%·가벼움 60%)
  const n = f.companySize;
  const heavyN = Math.max(1, Math.round(n * 0.1)), mediumN = Math.round(n * 0.3), lightN = Math.max(0, n - heavyN - mediumN);
  const companyKrw = heavyN * tiers.heavy + mediumN * tiers.medium + lightN * tiers.light;
  const ourForecastUsd = byTenant.find((t) => t.tenant === 'default') ? (byTenant.find((t) => t.tenant === 'default')!.usd / elapsed) * days : 0;
  const freeCompanies = companyKrw > 0 ? Math.max(0, Math.floor(((f.securedUsd * 0.7 - ourForecastUsd) * rate) / companyKrw)) : null;
  const remainUsd = f.securedUsd - monthUsd;
  const exhaustDays = dailyUsd > 0 ? remainUsd / dailyUsd : null;
  const exhaustDate = exhaustDays !== null ? new Date(today.getTime() + Math.max(0, exhaustDays) * 86400_000) : null;
  const rechargeUsd = Math.max(0, forecastUsd * 1.2 - f.nextSecuredUsd);
  const units = [...unitRows.map((r) => ({ purpose: r.purpose, krw: Math.round(r.avg * rate * 10) / 10, n: r.n })),
    ...(docAvg.n ? [{ purpose: 'doc_job', krw: Math.round((docAvg.avg ?? 0) * rate * 10) / 10, n: docAvg.n }] : [])];
  // 요금 역산(V28 로컬 요청): 실제 plans 가 아닌 "검토용 요금표"(V27 확정안)로 계산 — 무료는 적자/흑자가 아니라 AI 한도로 관리.
  // 유료만 1인 AI 원가(보통 사용자, 추정/실측) × 2 와 1인 요금 × AI 몫 비율을 비교한다. plans 테이블 요금은 바꾸지 않는다
  const needPerUser = tiers.medium * 2;
  const pricing = REVIEW_PRICES.map((p) => {
    if (!p.perUserKrw) return { code: p.code, name: p.name, free: true, note: p.note, perUserKrw: 0, aiPartKrw: 0, needKrw: needPerUser, deficit: false };
    const aiPart = Math.round(p.perUserKrw * f.aiShare);
    return { code: p.code, name: p.name, free: false, note: p.note, perUserKrw: p.perUserKrw, aiPartKrw: aiPart, needKrw: needPerUser, deficit: aiPart < needPerUser };
  });
  const usedPct = f.securedUsd > 0 ? Math.round((monthUsd / f.securedUsd) * 100) : null;
  return {
    month, rate, days, elapsed: Math.round(elapsed * 10) / 10, finance: f,
    monthUsd: r2(monthUsd), monthKrw: Math.round(monthUsd * rate), forecastUsd: r2(forecastUsd), forecastKrw: Math.round(forecastUsd * rate), usedPct,
    dailyUsd: r2(dailyUsd), cycleStart: f.cycleStart, // 주기 안에 소진될 때만 날짜
    exhaustDate: exhaustDate && exhaustDays !== null && exhaustDays <= days - elapsed ? exhaustDate.toISOString().slice(0, 10) : null,
    byTenant: byTenant.map((t) => ({ tenant: t.tenant, name: t.name ?? t.tenant, usd: r2(t.usd), forecastUsd: r2((t.usd / elapsed) * days) })),
    byPurpose: byPurpose.map((p) => ({ ...p, usd: r2(p.usd) })), units, tiers, measuredTiers: measured, estimated, dataDays: Math.floor(dataDays),
    company: { size: n, heavyN, mediumN, lightN, krw: companyKrw }, ourForecastUsd: r2(ourForecastUsd), freeCompanies,
    rechargeUsd: r2(rechargeUsd), rechargeKrw: Math.round(rechargeUsd * rate), pricing,
    console: f.consoleUsd !== null ? { usd: f.consoleUsd, at: f.consoleAt ?? null, diffPct: f.consoleUsd > 0 ? Math.round(((monthUsd - f.consoleUsd) / f.consoleUsd) * 100) : null } : null,
  };
}
const r2 = (x: number) => Math.round(x * 100) / 100;

/** 정기 실행: 확보 크레딧의 70%·90% 에 닿으면 플랫폼 운영자에게 달마다 한 번씩 */
export async function aiCreditAlertsJob() {
  const sql = db();
  const f = await finance(sql);
  if (!f.securedUsd) return { skipped: true };
  const { start } = monthInfo(f.cycleStart);
  const month = start;
  const [cum] = await sql<{ usd: number }[]>`select coalesce(sum(cost_usd), 0)::float8 usd from ai_usage where created_at >= (${start}::date::timestamp at time zone 'Asia/Seoul')`;
  const pct = (cum.usd / f.securedUsd) * 100;
  const admins = (await sql<{ id: string }[]>`select id from users where platform_admin and status = 'active'`).map((x) => x.id);
  for (const level of [90, 70]) if (pct >= level) {
    await notify(sql, { userIds: admins, type: 'usage_alert', title: `AI 크레딧 ${level}% 사용`, body: `이번 달 정가 $${r2(cum.usd)} / 확보 $${f.securedUsd} — 충전·한도를 확인하세요`, link: '/platform#ai-forecast', dedupeKey: `ai_credit_pct:${month}:${level}` });
    break;
  }
  return { pct: Math.round(pct) };
}
