import { db } from './db';
import { assertSpace } from './spaces';
import { tenantOf, type SessionUser } from './types';
import { adCampaignBrands, campBrandExpr, campBrandJoin } from './adBrand';
import { addDays, todaySeoul } from './time';

/**
 * 399차 #1025(대표 11/13 "현재 네이버 하이링크 광고 현황 및 보완점 좀 알려 주세요. 워크인에서 보기가 어렵네요. 한눈에 보기 쉽게"):
 * 사업(브랜드)별 한 장 요약 — "얼마 썼고, 뭐가 잘 되고, 뭘 고쳐야 하나"를 한 카드에.
 *  이번 달 비용/계획 · 노출·클릭·클릭률·클릭당 비용 · 문의·신청(광고 키워드로 확인된 것) · 전화 기록 · 잔액·남은 날 ·
 *  잘 되는 검색어 3(문의가 확인된 것) · 돈만 쓰는 검색어 3(비용은 썼는데 문의 0 · 노출만 있고 클릭 0) · 할 일 3. 한 검색어가 두 칸에 같이 나오지 않는다.
 *  문의 추적이 절반도 안 되면(judge=false) '문의 0'을 판단할 수 없으므로 왼쪽은 클릭 많은 검색어, 오른쪽은 노출만 있고 클릭 없는 검색어만.
 * 숫자는 이미 모아 둔 광고 성과(mkt_ad_stats·mkt_ad_items)·문의 집계(adLeads)·잔액(mktRecharge)·사업별 월 계획(광고 점검 설정)에서만 — 바깥 호출 없음.
 */
export type BriefKw = { keyword: string; campaign: string; impressions: number; clicks: number; cost: number; leads: number; why?: string };
export type BrandBrief = { brandId: string | null; name: string; color: string | null;
  cost: number; plan: number | null; planPct: number | null; impressions: number; clicks: number; ctr: number | null; cpc: number | null;
  leads: number; calls: number; balance: { krw: number; days: number | null; level: 'ok' | 'warn' | 'action' } | null;
  good: BriefKw[]; waste: BriefKw[]; todos: string[] };
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const daysIn = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };

export async function brandBriefs(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const today = todaySeoul(); const ym = today.slice(0, 7); const from = `${ym}-01`;
  const elapsedPct = Math.round((Number(today.slice(8, 10)) / daysIn(ym)) * 100);
  const brands = await sql<{ id: string; name: string; color: string | null }[]>`select id, name, color from mkt_brands where tenant = ${t} and not test_mode order by ad_priority nulls last, name`;
  const cb = await adCampaignBrands(sql, t); const EB = campBrandExpr(sql);
  const [tot, kws, accs, callRows, st, L, balances] = await Promise.all([
    sql<{ brand_id: string | null; impressions: number; clicks: number; cost: number }[]>`select ${EB} as brand_id, coalesce(sum(s.impressions), 0)::float8 impressions, coalesce(sum(s.clicks), 0)::float8 clicks, coalesce(sum(s.cost_krw), 0)::float8 cost
      from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id ${campBrandJoin(sql, cb)} where a.tenant = ${t} and s.day between ${from}::date and ${today}::date group by 1`,
    sql<{ brand_id: string | null; provider: string; item_id: string; keyword: string; campaign: string; impressions: number; clicks: number; cost: number }[]>`select ${EB} as brand_id, a.provider, s.item_id, max(s.item_name) as keyword, max(s.campaign_name) as campaign,
        sum(s.impressions)::float8 impressions, sum(s.clicks)::float8 clicks, sum(s.cost_krw)::float8 cost
      from mkt_ad_items s join mkt_ad_accounts a on a.id = s.account_id ${campBrandJoin(sql, cb)} where a.tenant = ${t} and s.kind = 'keyword' and s.day between ${from}::date and ${today}::date group by 1, 2, 3`,
    sql<{ brand_id: string | null; account_id: string }[]>`select distinct ${EB} as brand_id, a.id as account_id
      from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id ${campBrandJoin(sql, cb)} where a.tenant = ${t} and s.day >= ${addDays(today, -30)}::date`,
    sql<{ brand_id: string | null; n: number }[]>`select brand_id, count(*)::int n from mkt_calls where tenant = ${t} and status <> 'excluded' and called_at >= ${`${from}T00:00:00+09:00`}::timestamptz group by 1`,
    (await import('./adWatch')).watchSettings(t),
    (await import('./adLeads')).leadsRange(t, from, today, { limit: 5000 }).catch(() => null),
    (await import('./mktRecharge')).balancesView(t).catch(() => []),
  ]);
  const leadsOf = new Map((L?.rows ?? []).map((r) => [r.key, r.leads]));
  const tracked = !!L && (L.tracking.beacon || L.tracking.naverIds || L.tracking.calls);
  const judge = !!L && L.totals.leads > 0 && (L.coverage ?? 0) >= 50; // 광고 키워드 표(adLeads)와 같은 기준 — 추적이 절반 이상 될 때만 '문의 0' 판단
  const card = (id: string | null, name: string, color: string | null): BrandBrief => {
    const x = tot.find((r) => (r.brand_id ?? null) === id); const cost = Math.round(x?.cost ?? 0), impressions = Math.round(x?.impressions ?? 0), clicks = Math.round(x?.clicks ?? 0);
    const plan = id ? st.brandPlans[id] ?? null : null; const planPct = plan ? Math.round((cost / plan) * 100) : null;
    const mine = kws.filter((k) => (k.brand_id ?? null) === id).map((k): BriefKw => ({ keyword: String(k.keyword || k.item_id), campaign: String(k.campaign ?? ''), impressions: Math.round(k.impressions), clicks: Math.round(k.clicks), cost: Math.round(k.cost), leads: leadsOf.get(`${k.provider}:${k.item_id}`) ?? 0 }));
    const leads = mine.reduce((a, k) => a + k.leads, 0); const calls = callRows.find((r) => (r.brand_id ?? null) === id)?.n ?? 0;
    const good = judge ? mine.filter((k) => k.leads > 0).sort((a, b) => b.leads - a.leads || a.cost - b.cost).slice(0, 3)
      : mine.filter((k) => k.clicks > 0).sort((a, b) => b.clicks - a.clicks || a.cost - b.cost).slice(0, 3);
    const waste = [
      ...(judge ? mine.filter((k) => k.cost > 0 && k.leads === 0 && k.clicks > 0).sort((a, b) => b.cost - a.cost).slice(0, 3).map((k) => ({ ...k, why: `${won(k.cost)} · 클릭 ${k.clicks} · 문의 0` })) : []),
      ...mine.filter((k) => k.clicks === 0 && k.impressions >= 100).sort((a, b) => b.impressions - a.impressions).slice(0, 3).map((k) => ({ ...k, why: `노출 ${k.impressions.toLocaleString('ko-KR')} · 클릭 0` })),
    ].sort((a, b) => b.cost - a.cost || b.impressions - a.impressions).slice(0, 3);
    // 잔액: 이 사업이 최근 30일 쓴 광고 계정의 잔액(계정을 여러 사업이 같이 쓰면 같은 잔액) — 남은 날이 가장 짧은 것
    const myAcc = new Set(accs.filter((a) => (a.brand_id ?? null) === id).map((a) => a.account_id));
    const bal = (balances as any[]).filter((b) => b.account_id && myAcc.has(b.account_id) && b.provider !== 'higgsfield').sort((a, b) => (a.days ?? 9e9) - (b.days ?? 9e9))[0] ?? null;
    const ctr = impressions ? Math.round((clicks / impressions) * 1000) / 10 : null; const cpc = clicks ? Math.round(cost / clicks) : null;
    const todos: string[] = [];
    if (bal && bal.level !== 'ok' && bal.days !== null) todos.push(`광고 잔액 충전 — 지금 속도로 약 ${bal.days}일분(${won(bal.balance)})`);
    if (id && cost > 0 && !plan) todos.push('이번 달 계획(예산)이 없습니다 — 광고 집행 › 광고 점검에서 사업별 월 계획을 정해 주세요');
    if (planPct !== null && planPct - elapsedPct >= 15) todos.push(`비용이 계획보다 빠릅니다 — 계획의 ${planPct}%를 썼고 이번 달은 ${elapsedPct}% 지났습니다`);
    const w1 = judge ? waste.find((k) => k.cost >= 10000) : undefined; if (w1) todos.push(`'${w1.keyword}' 입찰가 내리기·중지 검토 — ${won(w1.cost)} 쓰고 문의 0`);
    const z1 = waste.find((k) => k.clicks === 0 && k.impressions >= 300); if (z1) todos.push(`'${z1.keyword}' 광고 문구·순위 확인 — 노출 ${z1.impressions.toLocaleString('ko-KR')}번에 클릭 0`);
    if (ctr !== null && impressions >= 1000 && ctr < 1) todos.push(`클릭률 ${ctr}% — 광고 문구와 검색어를 손봐 주세요`);
    if (cost > 0 && leads === 0) todos.push(!tracked ? '문의 추적이 꺼져 있어 광고 문의를 셀 수 없습니다 — 사이트 전화·문의 단추 추적을 켜 주세요'
      : judge ? '이번 달 광고로 확인된 문의·신청 0 — 랜딩 화면과 문의 단추를 확인해 주세요' : '광고로 온 문의인지 확인된 것이 없습니다 — 전화·문의가 어느 검색어에서 왔는지 추적을 확인해 주세요');
    if (!id && cost > 0) todos.unshift('브랜드가 정해지지 않은 캠페인입니다 — 광고 성과에서 캠페인에 사업을 지정해 주세요');
    if (cost === 0 && id) todos.push('이번 달 광고 집행이 없습니다');
    return { brandId: id, name, color, cost, plan, planPct, impressions, clicks, ctr, cpc, leads, calls, balance: bal ? { krw: Math.round(bal.balance), days: bal.days, level: bal.level } : null, good, waste, todos: todos.slice(0, 3) };
  };
  const cards = brands.map((b) => card(b.id, b.name, b.color));
  const known = new Set(brands.map((b) => b.id));
  const otherCost = tot.filter((r) => !r.brand_id || !known.has(r.brand_id)).reduce((a, r) => a + r.cost, 0);
  const unbranded = otherCost > 0 ? card(null, '(브랜드 없음)', null) : null;
  return { month: ym, day: today, elapsedPct, tracked, judge, coverage: L?.coverage ?? null, brands: cards.sort((a, b) => b.cost - a.cost), unbranded };
}
