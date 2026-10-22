import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { forbidden } from './errors';
import { audit } from './log';
import { tenantOf, type SessionUser } from './types';
import { adAttrib, isTelLabel, kwKey } from './adAttrib';

/**
 * 광고 최적화 1차 ③ 통화 기반 최적화 — 키워드별 광고비(매체가 하루 한 번 주는 키워드 성과) × 광고로 들어온 전화·문의
 * (사이트 비콘의 전화 클릭, 웹 문의의 유입 주소, 전화 기록에 적은 광고 키워드) → 전환당 비용과 판단(서버 숫자, AI 없음).
 * - 전화 = 전화 클릭과 전화 기록 중 큰 값(같은 전화를 두 번 세지 않게), 리드 = 전화 + 문의.
 * - 판단: 0건인데 돈만 쓴 키워드 = '끄기 제안'(광고 키워드를 아는 전화·문의가 절반 이상일 때만 — 추적이 덜 됐으면 '0건'이 틀릴 수 있어서),
 *   목표의 70% 이하 = '잘 됨', 목표의 2배 이상 = '비용 높음'. 목표 = 회사 설정(target_cpa) 또는 기간 평균.
 * - 끄기·켜기는 워크인이 만든 세팅안의 네이버 키워드만(adOps kw_pause·kw_resume).
 */
const DEFAULT_CPA = 30000; // 목표·평균이 없을 때 '끄기 제안' 기준(원)
const MIN_WASTE = 20000;   // 이보다 적게 쓴 키워드는 0건이어도 판단하지 않음(원)
const MIN_CLICKS = 10;
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
export type LeadRow = { key: string; provider: string; itemId: string | null; keyword: string; campaign: string; clicks: number; cost: number; mediaConv: number;
  tel: number; calls: number; phone: number; inquiries: number; cta: number; leads: number; cpa: number | null; flag: 'waste' | 'high' | 'good' | null; planId: string | null; paused: boolean };

export async function leadsReport(u: SessionUser, q: { days?: number }) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db();
  const days = [7, 30, 90].includes(Number(q.days)) ? Number(q.days) : 30;
  const from = ymd(new Date(Date.now() - (days - 1) * 864e5)); const fromTs = `${from}T00:00:00+09:00`;
  const [items, beacon, calls, inq, ctas, [st], plans] = await Promise.all([
    sql<any[]>`select a.provider, s.item_id, max(s.item_name) as keyword, max(s.campaign_name) as campaign, sum(s.clicks)::float8 clicks, sum(s.cost_krw)::float8 cost, sum(s.conversions)::float8 conversions
      from mkt_ad_items s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.kind = 'keyword' and s.day >= ${from}::date group by a.provider, s.item_id order by sum(s.cost_krw) desc`,
    sql<any[]>`select provider, keyword_key, keyword_id, max(keyword) as keyword, kind, sum(n)::int n from mkt_ad_leads where tenant = ${t} and day >= ${from}::date group by provider, keyword_key, keyword_id, kind`,
    sql<any[]>`select ad_keyword, ad_provider, count(*)::int n from mkt_calls where tenant = ${t} and status <> 'excluded' and called_at >= ${fromTs}::timestamptz group by ad_keyword, ad_provider`,
    sql<{ payload: any }[]>`select payload from inquiries where tenant = ${t} and created_at >= ${fromTs}::timestamptz`,
    sql<{ label: string; n: number }[]>`select label, sum(n)::int n from mkt_site_events where tenant = ${t} and event = 'cta' and day >= ${from}::date group by label`,
    sql<{ target_cpa: number | null }[]>`select target_cpa from mkt_settings where tenant = ${t}`,
    sql<any[]>`select id, external from mkt_ad_plans where tenant = ${t} and status in ('created', 'active', 'paused')`,
  ]);
  const rows = new Map<string, LeadRow>();
  const blank = (key: string, provider: string, itemId: string | null, keyword: string, campaign = ''): LeadRow => ({ key, provider, itemId, keyword, campaign, clicks: 0, cost: 0, mediaConv: 0,
    tel: 0, calls: 0, phone: 0, inquiries: 0, cta: 0, leads: 0, cpa: null, flag: null, planId: null, paused: false });
  const byId = new Map<string, string>(); const byKw = new Map<string, string>(); const anyKw = new Map<string, string>();
  for (const it of items) { // 광고비 많은 순 — 같은 키워드가 여러 캠페인에 있으면 가장 많이 쓴 쪽에 붙임
    const key = `${it.provider}:${it.item_id}`;
    rows.set(key, { ...blank(key, it.provider, String(it.item_id), String(it.keyword ?? ''), String(it.campaign ?? '')), clicks: Math.round(it.clicks), cost: Math.round(it.cost), mediaConv: Math.round(it.conversions) });
    byId.set(String(it.item_id), key);
    const k = kwKey(String(it.keyword ?? '')); if (k) { if (!byKw.has(`${it.provider}:${k}`)) byKw.set(`${it.provider}:${k}`, key); if (!anyKw.has(k)) anyKw.set(k, key); }
  }
  /** 광고 키워드 → 표의 줄(네이버 키워드 id 먼저, 없으면 같은 매체의 같은 글자, 매체를 모르면 아무 매체). 광고비 표에 없는 키워드는 새 줄('성과 없음') */
  const row = (provider: string | null, keywordId: string, keyword: string) => {
    const key = (keywordId && byId.get(keywordId)) || (provider ? byKw.get(`${provider}:${kwKey(keyword)}`) : anyKw.get(kwKey(keyword)));
    if (key) return rows.get(key)!;
    const nk = `${provider ?? 'other'}:kw:${kwKey(keyword)}`;
    if (!rows.has(nk)) rows.set(nk, blank(nk, provider ?? 'other', null, keyword));
    return rows.get(nk)!;
  };
  const unknown = { tel: 0, calls: 0, inquiries: 0 }; // 광고 키워드를 모르는 것(광고가 아니거나 추적이 안 된 것)
  let telTracked = 0;
  for (const b of beacon) {
    if (b.kind === 'tel') telTracked += b.n;
    if (!b.keyword_key && !b.keyword_id) { if (b.kind === 'tel') unknown.tel += b.n; continue; } // 광고로 왔지만 키워드 없음(예: 구글 gclid 만)
    const r = row(b.provider, String(b.keyword_id ?? ''), String(b.keyword ?? b.keyword_key));
    if (b.kind === 'tel') r.tel += b.n; else r.cta += b.n;
  }
  unknown.tel += Math.max(0, ctas.filter((c) => isTelLabel(c.label)).reduce((a, c) => a + c.n, 0) - telTracked);
  for (const c of calls) {
    if (!c.ad_keyword) { unknown.calls += c.n; continue; }
    row(c.ad_provider ?? null, '', String(c.ad_keyword)).calls += c.n;
  }
  for (const { payload: p } of inq) {
    const at = adAttrib({ landing: p?.landing_page ?? p?.landing, utm: p?.utm, utm_source: p?.utm_source, utm_medium: p?.utm_medium, utm_term: p?.utm_term });
    if (!at || (!at.keyword && !at.keywordId)) { unknown.inquiries++; continue; }
    row(at.provider, at.keywordId, at.keyword).inquiries++;
  }
  // 워크인이 만든 세팅안의 네이버 키워드 → 끄기·켜기 가능
  const owner = new Map<string, { planId: string; paused: boolean }>();
  for (const p of plans) (Array.isArray(p.external?.keywordIds) ? p.external.keywordIds as string[] : []).forEach((kid) => owner.set(kid, { planId: p.id, paused: !!p.external?.kwLocks?.[kid] }));
  const list = [...rows.values()];
  for (const r of list) {
    r.phone = Math.max(r.tel, r.calls); r.leads = r.phone + r.inquiries; r.cpa = r.leads ? Math.round(r.cost / r.leads) : null;
    const o = r.provider === 'naver' && r.itemId ? owner.get(r.itemId) : undefined; if (o) { r.planId = o.planId; r.paused = o.paused; }
  }
  const sum = (f: (r: LeadRow) => number) => list.reduce((a, r) => a + f(r), 0);
  const totals = { cost: sum((r) => r.cost), clicks: sum((r) => r.clicks), tel: sum((r) => r.tel), calls: sum((r) => r.calls), phone: sum((r) => r.phone), inquiries: sum((r) => r.inquiries), cta: sum((r) => r.cta), leads: sum((r) => r.leads), cpa: null as number | null };
  totals.cpa = totals.leads ? Math.round(totals.cost / totals.leads) : null;
  const unknownLeads = unknown.inquiries + Math.max(unknown.tel, unknown.calls);
  const coverage = totals.leads + unknownLeads ? Math.round((totals.leads / (totals.leads + unknownLeads)) * 100) : null; // 광고 키워드를 아는 리드 비율(%)
  const target = st?.target_cpa ?? totals.cpa;
  const base = target ?? DEFAULT_CPA;
  const judge = totals.leads > 0 && (coverage ?? 0) >= 50; // 추적이 절반 이상 될 때만 '0건' 판단
  for (const r of list) {
    r.flag = r.leads === 0 ? (judge && r.clicks >= MIN_CLICKS && r.cost >= Math.max(MIN_WASTE, base * 1.5) ? 'waste' : null)
      : target && r.leads >= 2 && r.cpa! <= target * 0.7 ? 'good' : target && r.cpa! >= target * 2 ? 'high' : null;
  }
  const order = { waste: 0, high: 1, good: 2 } as Record<string, number>;
  list.sort((a, b) => (order[a.flag ?? ''] ?? 3) - (order[b.flag ?? ''] ?? 3) || b.cost - a.cost || b.leads - a.leads);
  return { days, from, canEdit: isAdmin(u), totals, unknown, coverage, judge,
    target: { cpa: target ?? null, custom: st?.target_cpa != null, avg: totals.cpa },
    tracking: { beacon: beacon.length > 0, naverIds: beacon.some((b) => b.provider === 'naver' && b.keyword_id), calls: calls.some((c) => c.ad_keyword) },
    rows: list.slice(0, 150) };
}

export const targetCpaInput = z.object({ cpa: z.number().int().min(1000).max(10_000_000).nullable() });
/** 목표 전환당 비용(원, 관리자) — null = 기간 평균 */
export async function setTargetCpa(u: SessionUser, i: z.infer<typeof targetCpaInput>) {
  await assertSpace(u, 'marketing');
  if (!isAdmin(u)) throw forbidden('목표 전환당 비용은 관리자가 정합니다');
  const t = tenantOf(u);
  await db()`insert into mkt_settings (tenant, target_cpa) values (${t}, ${i.cpa}) on conflict (tenant) do update set target_cpa = excluded.target_cpa`;
  await audit(db(), u.id, 'mkt_ads.target_cpa', 'tenant', null, { cpa: i.cpa }).catch(() => {});
  return { ok: true, cpa: i.cpa };
}
