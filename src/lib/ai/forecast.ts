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
export const financeInput = z.object({
  securedUsd: z.number().min(0).max(1_000_000).optional(),        // 이번 달 확보 크레딧(예: Max $100)
  nextSecuredUsd: z.number().min(0).max(1_000_000).optional(),    // 다음 달 확보 예정
  consoleUsd: z.number().min(0).max(1_000_000).nullable().optional(), // 콘솔 실제 청구(이번 달)
  companySize: z.number().int().min(1).max(1000).optional(),      // 고객사 1곳 인원(기본 10)
  aiShare: z.number().min(0).max(1).optional(),                   // 요금 중 AI 몫(기본 30%)
});
type Finance = { securedUsd: number; nextSecuredUsd: number; consoleUsd: number | null; consoleAt?: string; companySize: number; aiShare: number };
async function finance(sql: Sql): Promise<Finance> {
  const [r] = await sql<{ value: any }[]>`select value from app_settings where key = ${KEY}`;
  const v = r?.value ?? {};
  return { securedUsd: v.securedUsd ?? 100, nextSecuredUsd: v.nextSecuredUsd ?? v.securedUsd ?? 100, consoleUsd: v.consoleUsd ?? null, consoleAt: v.consoleAt, companySize: v.companySize ?? 10, aiShare: v.aiShare ?? 0.3 };
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
function monthInfo() {
  const n = seoulNow();
  const days = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate();
  const elapsed = n.getDate() - 1 + (n.getHours() * 60 + n.getMinutes()) / 1440; // 지난 날(소수)
  const month = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`;
  return { month, days, elapsed: Math.max(elapsed, 0.25), today: n };
}

export async function aiForecast(u: SessionUser) {
  if (!u.platformAdmin) throw notFound();
  return computeForecast(db());
}
export async function computeForecast(sql: Sql) {
  const f = await finance(sql);
  const rate = usdKrw();
  const { month, days, elapsed, today } = monthInfo();
  const start = sql`(${month + '-01'}::date::timestamp at time zone 'Asia/Seoul')`;
  const [[cum], byTenant, byPurpose, [week], unitRows, [docAvg], userRows, plans] = await Promise.all([
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
    sql<{ code: string; name: string; per_user_krw: number | null; monthly_krw: number | null; min_users: number | null }[]>`select code, name, per_user_krw, monthly_krw, min_users from plans where active order by sort`,
  ]);
  const monthUsd = cum.usd;
  const forecastUsd = (monthUsd / elapsed) * days;
  const dailyUsd = week.usd / 7;
  // 사용자 유형: 사용량 순 3등분(가벼움·보통·많음) 평균, 30일 → 월
  const per = userRows.map((r) => r.usd * rate);
  const third = (k: number) => { const n = per.length; if (!n) return 0; const a = per.slice(Math.floor((n * k) / 3), Math.max(Math.floor((n * (k + 1)) / 3), Math.floor((n * k) / 3) + 1)); return Math.round(a.reduce((s, x) => s + x, 0) / a.length); };
  const tiers = { light: third(0), medium: third(1), heavy: third(2), users: per.length };
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
  // 요금 역산: 1인 AI 원가 × 2 = AI 몫 최소 → 요금 × AI 몫 비율과 비교(보통 사용자 기준)
  const needPerUser = tiers.medium * 2;
  const pricing = plans.filter((p) => p.per_user_krw !== null || p.monthly_krw !== null).map((p) => {
    const perUser = p.per_user_krw ?? (p.monthly_krw && p.min_users ? Math.round(p.monthly_krw / p.min_users) : p.monthly_krw ?? 0);
    const aiPart = Math.round(perUser * f.aiShare);
    return { code: p.code, name: p.name, perUserKrw: perUser, aiPartKrw: aiPart, needKrw: needPerUser, deficit: perUser > 0 && aiPart < needPerUser };
  });
  const usedPct = f.securedUsd > 0 ? Math.round((monthUsd / f.securedUsd) * 100) : null;
  return {
    month, rate, days, elapsed: Math.round(elapsed * 10) / 10, finance: f,
    monthUsd: r2(monthUsd), monthKrw: Math.round(monthUsd * rate), forecastUsd: r2(forecastUsd), forecastKrw: Math.round(forecastUsd * rate), usedPct,
    dailyUsd: r2(dailyUsd), exhaustDate: exhaustDate && exhaustDays !== null && exhaustDays < 400 ? exhaustDate.toISOString().slice(0, 10) : null,
    byTenant: byTenant.map((t) => ({ tenant: t.tenant, name: t.name ?? t.tenant, usd: r2(t.usd), forecastUsd: r2((t.usd / elapsed) * days) })),
    byPurpose: byPurpose.map((p) => ({ ...p, usd: r2(p.usd) })), units, tiers,
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
  const { month } = monthInfo();
  const [cum] = await sql<{ usd: number }[]>`select coalesce(sum(cost_usd), 0)::float8 usd from ai_usage where created_at >= (${month + '-01'}::date::timestamp at time zone 'Asia/Seoul')`;
  const pct = (cum.usd / f.securedUsd) * 100;
  const admins = (await sql<{ id: string }[]>`select id from users where platform_admin and status = 'active'`).map((x) => x.id);
  for (const level of [90, 70]) if (pct >= level) {
    await notify(sql, { userIds: admins, type: 'usage_alert', title: `AI 크레딧 ${level}% 사용`, body: `이번 달 정가 $${r2(cum.usd)} / 확보 $${f.securedUsd} — 충전·한도를 확인하세요`, link: '/platform#ai-forecast', dedupeKey: `ai_credit_pct:${month}:${level}` });
    break;
  }
  return { pct: Math.round(pct) };
}
