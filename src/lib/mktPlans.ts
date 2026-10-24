import { z } from 'zod';
import { db } from './db';
import { notFound } from './errors';
import { audit } from './log';
import { MKT_PLANS, WRITE_TIER_LABEL, creditCost, planTable, writeCostKrw } from './mktAuto';
import type { SessionUser } from './types';

/** 대표 10/20 15:40 (#103): 플랫폼 운영 — 요금제별 제작 범위·금액 표(숫자만 바꿈, 배포 없음) + 실측 원가로 한도별 원가율 */
export const planLimitInput = z.object({ code: z.enum(['basic', 'standard', 'pro']), label: z.string().trim().min(1).max(30).optional(), priceKrw: z.number().int().min(0).max(100_000_000).nullable().optional(),
  monthlyCredits: z.number().min(0).max(1_000_000).optional(), weekly: z.record(z.enum(['feed', 'blog', 'reels', 'shorts', 'story', 'video']), z.number().int().min(0).max(100)).optional(),
  videoMonthly: z.number().int().min(0).max(1000).optional(), regenMonthly: z.number().int().min(0).max(1000).optional(), aiMonthlyUsd: z.number().min(0).max(10_000).nullable().optional(), extraCreditKrw: z.number().int().min(0).max(1_000_000).nullable().optional(),
  writeTier: z.enum(['fast', 'default', 'deep']).nullable().optional() }); // 대표 10/24 추가 ①: 자동 제작 글 모델(비우면 빠른 모델)
export const creditCostInput = z.object({ imageCredits: z.number().min(0.1).max(1000), videoCredits: z.number().min(0.1).max(10_000), krwPerCreditMin: z.number().min(1).max(100_000), krwPerCreditMax: z.number().min(1).max(100_000) });
export async function mktPlansView(u: SessionUser) {
  if (!u.platformAdmin) throw notFound();
  const plans = await planTable(); const cost = await creditCost();
  const rows = Object.values(plans).map((p) => {
    const costMin = Math.round(p.monthlyCredits * cost.krwPerCreditMin), costMax = Math.round(p.monthlyCredits * cost.krwPerCreditMax);
    return { ...p, costMin, costMax, rateMin: p.price ? Math.round((costMin / p.price) * 1000) / 10 : null, rateMax: p.price ? Math.round((costMax / p.price) * 1000) / 10 : null,
      images: Math.floor(p.monthlyCredits / cost.imageCredits), videos: Math.floor(p.monthlyCredits / cost.videoCredits), weeklyTotal: Object.values(p.weekly).reduce((s, n) => s + Number(n), 0) };
  });
  return { plans: rows, cost, defaults: MKT_PLANS, writeTiers: WRITE_TIER_LABEL, writeCost: await writeCostKrw() };
}
export async function savePlanLimit(u: SessionUser, i: z.infer<typeof planLimitInput>) {
  if (!u.platformAdmin) throw notFound();
  const sql = db(); const cur = (await planTable())[i.code];
  const weekly = i.weekly ? Object.fromEntries(Object.entries(i.weekly).filter(([, n]) => n > 0)) : cur.weekly;
  await sql`insert into mkt_plan_limits (code, label, price_krw, monthly_credits, weekly, video_monthly, regen_monthly, ai_monthly_usd, extra_credit_krw, write_tier, updated_by)
    values (${i.code}, ${i.label ?? cur.label}, ${i.priceKrw === undefined ? cur.price : i.priceKrw}, ${i.monthlyCredits ?? cur.monthlyCredits}, ${sql.json(weekly as never)}, ${i.videoMonthly ?? cur.videoMonthly}, ${i.regenMonthly ?? cur.regenMonthly}, ${i.aiMonthlyUsd === undefined ? cur.aiMonthlyUsd : i.aiMonthlyUsd}, ${i.extraCreditKrw === undefined ? cur.extraCreditKrw : i.extraCreditKrw}, ${i.writeTier === undefined ? cur.writeTier : i.writeTier}, ${u.id})
    on conflict (code) do update set label = excluded.label, price_krw = excluded.price_krw, monthly_credits = excluded.monthly_credits, weekly = excluded.weekly, video_monthly = excluded.video_monthly, regen_monthly = excluded.regen_monthly, ai_monthly_usd = excluded.ai_monthly_usd, extra_credit_krw = excluded.extra_credit_krw, write_tier = excluded.write_tier, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'platform.mkt_plan.save', 'mkt_plan_limits', i.code, { ...i }).catch(() => {});
  return mktPlansView(u);
}
export async function saveCreditCost(u: SessionUser, i: z.infer<typeof creditCostInput>) {
  if (!u.platformAdmin) throw notFound();
  if (i.krwPerCreditMax < i.krwPerCreditMin) throw new (await import('./errors')).HttpError(400, 'validation', '1크레딧 원화 최대가 최소보다 작습니다');
  const sql = db();
  await sql`insert into app_settings (key, value, updated_by) values ('mkt_credit_cost', ${sql.json(i as never)}, ${u.id}) on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql, u.id, 'platform.mkt_credit_cost.save', 'app_settings', 'mkt_credit_cost', { ...i }).catch(() => {});
  return mktPlansView(u);
}

/** 대표 10/24 추가 ①: 회사별 마케팅 글 모델(플랫폼 운영 › 회사 관리) — null = 마케팅 요금제 값(없으면 빠른 모델). 우리 회사는 최상 모델(193) */
export const tenantWriteInput = z.object({ tier: z.enum(['fast', 'default', 'deep']).nullable() });
export async function setTenantWriteTier(u: SessionUser, tenant: string, i: z.infer<typeof tenantWriteInput>, ip: string | null) {
  if (!u.platformAdmin) throw notFound();
  const sql = db();
  if (!(await sql`select 1 from tenants where id = ${tenant}`).length) throw notFound('없는 회사입니다');
  await sql`insert into mkt_settings (tenant, write_tier) values (${tenant}, ${i.tier}) on conflict (tenant) do update set write_tier = excluded.write_tier, updated_at = now()`;
  await audit(sql, u.id, 'platform.mkt_write_tier', 'tenant', null, { tenant, tier: i.tier }, ip).catch(() => {});
  return tenantWriteView(tenant);
}
export async function tenantWriteView(tenant: string) {
  const M = await import('./mktAuto'); const s = await M.settingsOf(tenant);
  return { company: s.write_tier, plan: s.plan ? { code: s.plan.code, label: s.plan.label, tier: s.plan.writeTier } : null, ...(await M.writeModelInfo(s)) };
}
