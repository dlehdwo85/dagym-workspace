import { z } from 'zod';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { forbidden } from './errors';
import { audit } from './log';
import { notify } from './notifications';
import { appUrl, sendMail } from './mail';
import { addDays, todaySeoul } from './time';
import { tenantOf, type SessionUser } from './types';
import { adCampaignBrands, campBrandExpr, campBrandJoin } from './adBrand';

/**
 * 363차 #981(대표 11/05 B4 — "노트북이 꺼지면 안 돌아가니 클라우드가 맞다"): 서버 광고 점검.
 * - 매일(서울 9시 뒤 첫 정기 실행) 어제까지의 숫자로 이상을 찾아 회사 대표에게 워크인 알림 1건:
 *   ① 키워드 kwDays일 비용 kwCost 원 이상인데 문의·신청 0 → 입찰가 내림 제안, 그 기간이 pauseWeeks 번 연속이면 중지 제안
 *   ② 사업(브랜드)별 어제 비용이 그 사업 하루 계획(월 계획 ÷ 그 달 날 수)의 dayRatio 배를 넘으면 그날 확인
 *   ③ 회사 이번 달 누적이 월 광고비 상한의 capPct % 이상이면 대표 보고(알림 + 메일, 달마다 한 번)
 * - 월요일(서울 9시 뒤 첫 정기 실행): 지난주(월~일) 사업별 비용·클릭·문의/신청·전환당 비용·이번 달 계획 대비 표 → 알림 + 메일.
 * - 입찰가·켜기/끄기는 바꾸지 않는다. 제안만 하고, 사람이 광고 집행 화면에서 실행한다(돈이 드는 일은 사람 확인 뒤).
 * - 기준 5개와 사업별 월 계획은 광고 집행 화면 '광고 점검'에서 고친다. 처음 값은 AD_BUDGET_PLAN_2026-11 7·8번(마이그레이션 249).
 * - 문의 0 판단은 키워드를 아는 문의·신청만 셈 — 추적 장치가 꺼져 있으면 '0'이 실제 0인지 모른다는 문장을 같이 보냄(caveat).
 * - 시험 서버는 AD_WATCH=off(tests/helpers.mjs), 'any' 는 시각·요일과 상관없이(하루·한 주 한 번은 그대로).
 */
export const WATCH_DEFAULT = { kwCost: 10000, kwDays: 7, pauseWeeks: 2, dayRatio: 1.5, capPct: 80 };
export type WatchSettings = typeof WATCH_DEFAULT & { enabled: boolean; exists: boolean; brandPlans: Record<string, number> };
export type WatchFinding = { kind: 'kw_bid_down' | 'kw_pause' | 'brand_day' | 'cap'; title: string; detail: string; key?: string; brandId?: string | null; planId?: string | null; cost?: number; weeks?: number };
const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`;
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const daysIn = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const weekMonday = (day: string) => { const d = new Date(`${day}T00:00:00Z`); return addDays(day, -((d.getUTCDay() + 6) % 7)); };
const WORKIN_TENANT = 'default';
const WORKIN_BRAND = /워크\s*인|work-?in/i;
function kstParts(now: Date) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.find((x) => x.type === 'weekday')?.value ?? ''), hour: Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24 };
}
const plansOf = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v as Record<string, unknown> : {}).filter(([, n]) => Number(n) > 0).map(([k, n]) => [k, Math.round(Number(n))]));

export async function watchSettings(t: string): Promise<WatchSettings> {
  const [r] = await db()<any[]>`select enabled, kw_cost, kw_days, pause_weeks, day_ratio::float8 as day_ratio, cap_pct, brand_plans from mkt_ad_watch where tenant = ${t}`;
  if (!r) return { exists: false, enabled: false, ...WATCH_DEFAULT, brandPlans: {} }; // 행이 없는 회사는 꺼짐(화면에서 켬) — 워크인 운영 회사는 마이그레이션 249 가 켠 채로 만듦
  return { exists: true, enabled: r.enabled, kwCost: r.kw_cost, kwDays: r.kw_days, pauseWeeks: r.pause_weeks, dayRatio: Number(r.day_ratio), capPct: r.cap_pct, brandPlans: plansOf(r.brand_plans) };
}

/** 지금 숫자로 점검(알림 없음) — 매일 점검과 화면이 같이 씀. 키워드·사업별 하루 비용은 어제까지(광고 성과는 하루 한 번 새벽에 읽어 옴) */
export async function watchCheck(t: string, now = new Date(), s?: WatchSettings) {
  const st = s ?? await watchSettings(t);
  const sql = db(); const today = todaySeoul(now); const yday = addDays(today, -1); const ym = yday.slice(0, 7);
  const { leadsRange } = await import('./adLeads');
  // ① 키워드: kwDays 일씩 끊은 구간을 pauseWeeks 개(가장 최근 = 어제까지) — 구간마다 같은 키워드(매체:키워드 id)가 걸렸는지
  const wins = [];
  for (let w = 0; w < st.pauseWeeks; w++) { const to = addDays(yday, -w * st.kwDays); wins.push(await leadsRange(t, addDays(to, -(st.kwDays - 1)), to, { limit: 5000 })); }
  const hit = wins.map((L) => new Map(L.rows.filter((r) => r.itemId && !r.paused && r.cost >= st.kwCost && r.leads === 0).map((r) => [r.key, r])));
  const findings: WatchFinding[] = [];
  const kw = [...hit[0].values()].sort((a, b) => b.cost - a.cost);
  for (const r of kw) {
    let streak = 1; while (streak < hit.length && hit[streak].has(r.key)) streak++;
    const pause = streak >= st.pauseWeeks;
    const where = `${r.keyword || r.itemId}${r.campaign ? ` (${r.campaign})` : ''}`;
    findings.push({ kind: pause ? 'kw_pause' : 'kw_bid_down', key: r.key, planId: r.planId, cost: r.cost, weeks: streak,
      title: `${pause ? '중지 제안' : '입찰가 내림 제안'}: ${where}`,
      detail: `${st.kwDays}일 비용 ${won(r.cost)} · 클릭 ${r.clicks} · 문의·신청 0${pause ? ` — ${st.kwDays}일씩 ${streak}번 연속` : ''}` });
  }
  const cur = wins[0];
  const caveat = cur.coverage === null || cur.coverage < 50
    ? `광고 키워드를 아는 문의·신청이 ${cur.coverage ?? 0}%입니다${!cur.tracking.beacon || !cur.tracking.naverIds || !cur.tracking.calls ? `(꺼진 추적: ${[!cur.tracking.beacon && '사이트 전화·문의 단추', !cur.tracking.naverIds && '네이버 자동 추적 주소', !cur.tracking.calls && '전화 기록의 광고 키워드'].filter(Boolean).join('·')})` : ''}. 문의 0이 실제로 0인지 모르니 입찰가를 내리거나 끄기 전에 확인하세요.`
    : null;
  // ② 사업별: 이번 달(어제가 속한 달) 1일~어제 비용 — 캠페인 단위 브랜드(221차 #531)
  const brands = await sql<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${t} and not test_mode order by ad_priority nulls last, name`;
  const cb = await adCampaignBrands(sql, t);
  const spend = await sql<{ brand_id: string | null; day: string; cost: number; clicks: number }[]>`select ${campBrandExpr(sql)} as brand_id, to_char(s.day, 'YYYY-MM-DD') as day, sum(s.cost_krw)::float8 cost, sum(s.clicks)::float8 clicks
    from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id ${campBrandJoin(sql, cb)} where a.tenant = ${t} and s.day >= ${`${ym}-01`}::date and s.day <= ${yday}::date group by 1, 2`;
  const dim = daysIn(ym); const ids = new Set(brands.map((b) => b.id));
  const sum = (rows: { day: string; cost: number }[], day?: string) => Math.round(rows.filter((x) => !day || x.day === day).reduce((a, x) => a + x.cost, 0));
  const brandRows = brands.map((b) => {
    const rows = spend.filter((x) => x.brand_id === b.id); const plan = st.brandPlans[b.id] ?? null; const mtd = sum(rows);
    return { brandId: b.id, name: b.name, plan, dailyPlan: plan ? Math.round(plan / dim) : null, yesterday: sum(rows, yday), mtd, planPct: plan ? Math.round((mtd / plan) * 100) : null };
  });
  const other = spend.filter((x) => !x.brand_id || !ids.has(x.brand_id));
  for (const b of brandRows) if (b.dailyPlan && b.yesterday > b.dailyPlan * st.dayRatio) findings.push({ kind: 'brand_day', brandId: b.brandId, cost: b.yesterday,
    title: `하루 비용 확인: ${b.name}`, detail: `${md(yday)} ${won(b.yesterday)} — 하루 계획 ${won(b.dailyPlan)}의 ${(b.yesterday / b.dailyPlan).toFixed(1)}배(기준 ${st.dayRatio}배) · 이번 달 ${won(b.mtd)} / 계획 ${won(b.plan!)}` });
  // ③ 회사 월 상한(모든 매체 합계, 광고 집행 화면의 상한과 같은 값)
  const { capOf, monthSpend } = await import('./adOps');
  const [cap, spendM] = await Promise.all([capOf(t), monthSpend(t)]);
  const nowYm = today.slice(0, 7); const elapsedPct = Math.round((Number(today.slice(8, 10)) / daysIn(nowYm)) * 100);
  const capInfo = cap ? { cap: cap.monthlyCap, spend: Math.round(spendM), pct: Math.round((spendM / cap.monthlyCap) * 100), threshold: st.capPct, elapsedPct, month: nowYm } : null;
  if (capInfo && capInfo.pct >= st.capPct) findings.push({ kind: 'cap', cost: capInfo.spend, title: `월 광고비 상한 ${st.capPct}% 넘음`,
    detail: `이번 달 ${won(capInfo.spend)} / 상한 ${won(capInfo.cap)} (${capInfo.pct}%) · 이번 달 ${elapsedPct}% 지남${capInfo.pct >= 100 ? ' · 상한에 닿아 워크인이 켠 광고는 자동으로 꺼집니다' : ''}` });
  return { at: now.toISOString(), day: today, checkedDay: yday, month: ym,
    settings: { enabled: st.enabled, kwCost: st.kwCost, kwDays: st.kwDays, pauseWeeks: st.pauseWeeks, dayRatio: st.dayRatio, capPct: st.capPct },
    findings, counts: { bidDown: findings.filter((f) => f.kind === 'kw_bid_down').length, pause: findings.filter((f) => f.kind === 'kw_pause').length, brandDay: findings.filter((f) => f.kind === 'brand_day').length, cap: findings.filter((f) => f.kind === 'cap').length },
    brands: brandRows, unbranded: { mtd: sum(other), yesterday: sum(other, yday) }, cap: capInfo,
    tracking: { coverage: cur.coverage, ...cur.tracking, window: { from: cur.from, to: cur.to } }, caveat };
}
export type WatchCheck = Awaited<ReturnType<typeof watchCheck>>;

async function ownersOf(t: string) {
  return db()<{ id: string; email: string | null }[]>`select id, email from users where tenant = ${t} and status = 'active' and not is_demo and role = 'owner' order by created_at`;
}
const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 매일 점검 1회: 결과 저장 → 이상이 있으면 회사 대표에게 알림 1건(하루 1번) · 상한 % 는 달마다 한 번 알림 + 메일 */
export async function runDaily(t: string, now = new Date()) {
  const sql = db();
  const [acc] = await sql<{ n: number }[]>`select count(*)::int n from mkt_ad_accounts where tenant = ${t} and status <> 'disconnected'`;
  if (!acc.n) return { tenant: t, skipped: 'no_accounts' };
  const r = await watchCheck(t, now);
  await sql`update mkt_ad_watch set last_daily = ${sql.json(r as never)} where tenant = ${t}`;
  const owners = await ownersOf(t); const ids = owners.map((o) => o.id);
  const main = r.findings.filter((f) => f.kind !== 'cap');
  let notified = 0, capSent = false;
  if (main.length && ids.length) {
    const kwN = r.counts.bidDown + r.counts.pause;
    const title = `광고 점검: 확인할 것 ${main.length}건 (${md(r.checkedDay)})`;
    const body = [main.slice(0, 3).map((f) => f.title).join(' · ') + (main.length > 3 ? ` 외 ${main.length - 3}건` : ''), kwN && r.caveat ? '문의 추적이 덜 돼 있어 문의 0은 확인이 필요합니다.' : '', '입찰가·켜기/끄기는 바꾸지 않았습니다 — 광고 집행 화면에서 확인 뒤 실행하세요.'].filter(Boolean).join(' ');
    await notify(sql, { userIds: ids, type: 'usage_alert', title, body, link: '/s/marketing/ad-ops#ad-watch', space: 'marketing', dedupeKey: `adwatch:${t}:${r.day}` }).catch(() => {});
    notified = ids.length;
  }
  const capF = r.findings.find((f) => f.kind === 'cap');
  if (capF && r.cap && ids.length) {
    const got = await sql`update mkt_ad_watch set cap_month = ${r.cap.month} where tenant = ${t} and (cap_month is null or cap_month <> ${r.cap.month}) returning tenant`;
    if (got.length) {
      const title = `${capF.title} — 대표 확인`;
      await notify(sql, { userIds: ids, type: 'usage_alert', title, body: capF.detail, link: '/s/marketing/ad-ops#ad-watch', space: 'marketing', dedupeKey: `adwatchcap:${t}:${r.cap.month}` }).catch(() => {});
      const lines = r.brands.filter((b) => b.mtd || b.plan).map((b) => `- ${b.name}: 이번 달 ${won(b.mtd)}${b.plan ? ` / 계획 ${won(b.plan)} (${b.planPct}%)` : ' · 계획 없음'}`);
      for (const o of owners) if (o.email) await sendMail(o.email, `[워크인] ${title}`, [capF.detail, '', '사업별:', ...(lines.length ? lines : ['- 기록 없음']), '', `상한을 넘으면 워크인이 켠 광고는 자동으로 꺼집니다. 상한·기준은 광고 집행 화면에서 바꿀 수 있습니다: ${appUrl()}/s/marketing/ad-ops#ad-watch`].join('\n')).catch(() => {});
      capSent = true;
    }
  }
  return { tenant: t, findings: r.findings.length, notified, capSent };
}

/** 지난주(월~일) 사업별 표 — 비용·클릭(캠페인 단위 브랜드)·문의(전화 기록 + 홈페이지 문의)·신청(워크인 체험 신청)·전환당 비용·이번 달 계획 대비 */
export async function weeklyTable(t: string, now = new Date(), s?: WatchSettings) {
  const st = s ?? await watchSettings(t);
  const sql = db(); const today = todaySeoul(now); const mon = weekMonday(today); const from = addDays(mon, -7), to = addDays(mon, -1);
  const fromTs = `${from}T00:00:00+09:00`, toTs = `${mon}T00:00:00+09:00`;
  const yday = addDays(today, -1); const ym = yday.slice(0, 7); const dim = daysIn(ym);
  const brands = await sql<{ id: string; name: string }[]>`select id, name from mkt_brands where tenant = ${t} and not test_mode order by ad_priority nulls last, name`;
  const cb = await adCampaignBrands(sql, t);
  const [week, month, calls, inq, signups] = await Promise.all([
    sql<{ brand_id: string | null; cost: number; clicks: number }[]>`select ${campBrandExpr(sql)} as brand_id, sum(s.cost_krw)::float8 cost, sum(s.clicks)::float8 clicks
      from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id ${campBrandJoin(sql, cb)} where a.tenant = ${t} and s.day between ${from}::date and ${to}::date group by 1`,
    sql<{ brand_id: string | null; cost: number }[]>`select ${campBrandExpr(sql)} as brand_id, sum(s.cost_krw)::float8 cost
      from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id ${campBrandJoin(sql, cb)} where a.tenant = ${t} and s.day between ${`${ym}-01`}::date and ${yday}::date group by 1`,
    sql<{ brand_id: string | null; n: number }[]>`select brand_id, count(*)::int n from mkt_calls where tenant = ${t} and status <> 'excluded' and called_at >= ${fromTs}::timestamptz and called_at < ${toTs}::timestamptz group by brand_id`,
    sql<{ site: string; n: number }[]>`select site, count(*)::int n from inquiries where tenant = ${t} and created_at >= ${fromTs}::timestamptz and created_at < ${toTs}::timestamptz group by site`,
    t !== WORKIN_TENANT ? Promise.resolve([{ n: 0 }]) : sql<{ n: number }[]>`select count(*)::int n from tenants where kind = 'company' and id not in ('default', 'demo') and status not in ('deleted', 'blocked') and signup_status <> 'rejected' and not is_test
      and created_at >= ${fromTs}::timestamptz and created_at < ${toTs}::timestamptz`,
  ]);
  const { brandOfSite } = await import('./mktSites');
  const workinId = t === WORKIN_TENANT ? brands.find((b) => WORKIN_BRAND.test(b.name))?.id ?? null : null;
  const row = (id: string | null, name: string) => {
    const w = week.filter((x) => (id ? x.brand_id === id : !x.brand_id || !brands.some((b) => b.id === x.brand_id)));
    const cost = Math.round(w.reduce((a, x) => a + x.cost, 0)), clicks = Math.round(w.reduce((a, x) => a + x.clicks, 0));
    const callsN = calls.filter((c) => (id ? c.brand_id === id : !c.brand_id)).reduce((a, c) => a + c.n, 0);
    const inqN = inq.filter((i) => (brandOfSite(i.site, brands) ?? null) === id).reduce((a, i) => a + i.n, 0);
    const sign = id && id === workinId ? signups[0]?.n ?? 0 : 0;
    const leads = callsN + inqN + sign; const plan = id ? st.brandPlans[id] ?? null : null;
    const mtd = Math.round(month.filter((x) => (id ? x.brand_id === id : !x.brand_id || !brands.some((b) => b.id === x.brand_id))).reduce((a, x) => a + x.cost, 0));
    return { brandId: id, name, cost, clicks, calls: callsN, inquiries: inqN, signups: sign, leads, cpa: leads ? Math.round(cost / leads) : null, plan, mtd, planPct: plan ? Math.round((mtd / plan) * 100) : null };
  };
  const rows = [...brands.map((b) => row(b.id, b.name)), row(null, '(사업 없음)')].filter((r) => r.brandId ? r.cost || r.leads || r.plan || r.mtd : r.cost || r.leads || r.mtd);
  const total = rows.reduce((a, r) => ({ ...a, cost: a.cost + r.cost, clicks: a.clicks + r.clicks, calls: a.calls + r.calls, inquiries: a.inquiries + r.inquiries, signups: a.signups + r.signups, leads: a.leads + r.leads, mtd: a.mtd + r.mtd, plan: a.plan + (r.plan ?? 0) }),
    { cost: 0, clicks: 0, calls: 0, inquiries: 0, signups: 0, leads: 0, mtd: 0, plan: 0 });
  return { from, to, month: ym, pacePct: Math.round((Number(yday.slice(8, 10)) / dim) * 100), rows, total: { ...total, cpa: total.leads ? Math.round(total.cost / total.leads) : null, planPct: total.plan ? Math.round((total.mtd / total.plan) * 100) : null } };
}

/** 월요일 주간 보고 1회: 표 저장 → 회사 대표에게 알림 + 메일 */
export async function runWeekly(t: string, now = new Date()) {
  const sql = db();
  const [acc] = await sql<{ n: number }[]>`select count(*)::int n from mkt_ad_accounts where tenant = ${t} and status <> 'disconnected'`;
  if (!acc.n) return { tenant: t, skipped: 'no_accounts' };
  const w = await weeklyTable(t, now);
  const [row] = await sql<{ last_daily: WatchCheck | null }[]>`select last_daily from mkt_ad_watch where tenant = ${t}`;
  const d = row?.last_daily ?? null;
  const report = { at: now.toISOString(), ...w, daily: d ? { day: d.checkedDay, counts: d.counts, top: d.findings.filter((f) => f.kind !== 'cap').slice(0, 5).map((f) => f.title), caveat: d.caveat } : null };
  await sql`update mkt_ad_watch set last_weekly = ${sql.json(report as never)} where tenant = ${t}`;
  const owners = await ownersOf(t); if (!owners.length) return { tenant: t, rows: w.rows.length, notified: 0 };
  const T = w.total; const range = `${md(w.from)}~${md(w.to)}`;
  const title = `광고 주간 보고 (${range}): 광고비 ${won(T.cost)} · 문의·신청 ${T.leads}건`;
  const body = `클릭 ${T.clicks.toLocaleString('ko-KR')}${T.cpa ? ` · 전환당 ${won(T.cpa)}` : ''}${T.plan ? ` · 이번 달 계획 대비 ${T.planPct}%(달 ${w.pacePct}% 지남)` : ''}${d && d.counts.bidDown + d.counts.pause ? ` · 키워드 제안 ${d.counts.bidDown + d.counts.pause}건` : ''}`;
  await notify(sql, { userIds: owners.map((o) => o.id), type: 'usage_alert', title, body, link: '/s/marketing/ad-ops#ad-watch', space: 'marketing', dedupeKey: `adweekly:${t}:${w.from}` }).catch(() => {});
  const fmt = (r: (typeof w.rows)[number] | (typeof T & { name: string })) => [r.name, won(r.cost), r.clicks.toLocaleString('ko-KR'), `${r.leads}(전화 ${r.calls}·문의 ${r.inquiries}${r.signups ? `·신청 ${r.signups}` : ''})`, r.cpa ? won(r.cpa) : '-', r.plan ? `${won(r.mtd)} / ${won(r.plan)} (${r.planPct}%)` : `${won(r.mtd)} / 계획 없음`];
  const head = ['사업', '광고비', '클릭', '문의·신청', '전환당 비용', '이번 달 / 계획'];
  const all = [...w.rows.map(fmt), fmt({ ...T, name: '합계' })];
  const text = [`지난주(${w.from}~${w.to}) 사업별 광고 결과입니다. 이번 달은 ${w.pacePct}% 지났습니다.`, '', ...all.map((c) => c.join(' | ')),
    '', ...(d ? [`매일 점검(${d.checkedDay} 기준): 입찰가 내림 제안 ${d.counts.bidDown} · 중지 제안 ${d.counts.pause} · 하루 비용 확인 ${d.counts.brandDay}`, ...(report.daily?.top ?? []).map((x) => `- ${x}`), ...(d.caveat ? [d.caveat] : []), ''] : []),
    '문의 = 전화 기록 + 홈페이지 문의, 신청 = 워크인 체험 신청. 입찰가·켜기/끄기는 바꾸지 않았습니다.', `광고 집행 화면: ${appUrl()}/s/marketing/ad-ops#ad-watch`].join('\n');
  const html = `<div style="font-family:Pretendard,Apple SD Gothic Neo,sans-serif;font-size:14px;line-height:1.6;color:#1e293b"><p>지난주(${esc(w.from)}~${esc(w.to)}) 사업별 광고 결과입니다. 이번 달은 ${w.pacePct}% 지났습니다.</p>
    <table style="border-collapse:collapse;font-size:13px"><tr>${head.map((h, i) => `<th align="${i ? 'right' : 'left'}" style="padding:3px 8px;border-bottom:1px solid #e2e8f0">${h}</th>`).join('')}</tr>
    ${all.map((c, j) => `<tr${j === all.length - 1 ? ' style="font-weight:600"' : ''}>${c.map((v, i) => `<td align="${i ? 'right' : 'left'}" style="padding:3px 8px;border-bottom:1px solid #f1f5f9">${esc(String(v))}</td>`).join('')}</tr>`).join('')}</table>
    ${d ? `<p style="margin-top:12px">매일 점검(${esc(d.checkedDay)} 기준): 입찰가 내림 제안 ${d.counts.bidDown} · 중지 제안 ${d.counts.pause} · 하루 비용 확인 ${d.counts.brandDay}</p>${(report.daily?.top ?? []).length ? `<ul style="margin:0;padding-left:18px">${report.daily!.top.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${d.caveat ? `<p style="color:#92400e">${esc(d.caveat)}</p>` : ''}` : ''}
    <p style="color:#64748b;font-size:12px">문의 = 전화 기록 + 홈페이지 문의, 신청 = 워크인 체험 신청. 입찰가·켜기/끄기는 바꾸지 않았습니다.</p>
    <p><a href="${appUrl()}/s/marketing/ad-ops#ad-watch">광고 집행 화면 열기</a></p></div>`;
  for (const o of owners) if (o.email) await sendMail(o.email, `[워크인] ${title}`, text, html).catch(() => {});
  return { tenant: t, rows: w.rows.length, notified: owners.length };
}

/** 정기 실행: 서울 9시 뒤 첫 실행에 회사마다 매일 점검 1번, 월요일에는 이어서 주간 보고 1번(점검을 켠 회사만) */
export async function adWatchTick(now = new Date()) {
  const gate = process.env.AD_WATCH ?? 'on';
  if (gate === 'off') return { skipped: 'off' };
  const any = gate === 'any'; const { dow, hour } = kstParts(now);
  if (!any && hour < 9) return { skipped: 'hour' };
  const sql = db(); const today = todaySeoul(now); const mon = weekMonday(today);
  const ts = await sql<{ tenant: string }[]>`select tenant from mkt_ad_watch where enabled order by tenant limit 50`;
  const daily = [], weekly = [];
  for (const { tenant: t } of ts) {
    const d = await sql`update mkt_ad_watch set daily_on = ${today}::date where tenant = ${t} and enabled and (daily_on is null or daily_on < ${today}::date) returning tenant`;
    if (d.length) daily.push(await runDaily(t, now).catch((e) => ({ tenant: t, error: String(e?.message ?? e).slice(0, 200) })));
    if (!any && dow !== 1) continue;
    const w = await sql`update mkt_ad_watch set weekly_on = ${mon}::date where tenant = ${t} and enabled and (weekly_on is null or weekly_on < ${mon}::date) returning tenant`;
    if (w.length) weekly.push(await runWeekly(t, now).catch((e) => ({ tenant: t, error: String(e?.message ?? e).slice(0, 200) })));
  }
  return { tenants: ts.length, daily, weekly };
}

// ---------------- 화면·API ----------------
const nInt = (min: number, max: number) => z.number().int().min(min).max(max);
export const watchInput = z.object({
  enabled: z.boolean().optional(),
  kwCost: nInt(1000, 10_000_000).optional(),
  kwDays: nInt(3, 30).optional(),
  pauseWeeks: nInt(1, 8).optional(),
  dayRatio: z.number().min(1).max(10).optional(),
  capPct: nInt(10, 100).optional(),
  brandPlans: z.record(z.string().uuid(), nInt(0, 1_000_000_000).nullable()).optional(),
});
export const watchAction = z.object({ action: z.enum(['daily', 'weekly']) });

export async function watchView(u: SessionUser) {
  await assertSpace(u, 'marketing');
  const t = tenantOf(u); const sql = db();
  const s = await watchSettings(t);
  const [row] = await sql<{ last_daily: any; last_weekly: any; daily_on: string | null; weekly_on: string | null }[]>`select last_daily, last_weekly, daily_on::text, weekly_on::text from mkt_ad_watch where tenant = ${t}`;
  const live = await watchCheck(t, new Date(), s);
  return { canEdit: isAdmin(u), settings: s, defaults: WATCH_DEFAULT, live, lastDaily: row?.last_daily ?? null, lastWeekly: row?.last_weekly ?? null, dailyOn: row?.daily_on ?? null, weeklyOn: row?.weekly_on ?? null,
    schedule: '매일 서울 9시 뒤 첫 정기 실행(어제까지의 숫자) · 월요일 같은 때 지난주 보고 · 받는 사람: 회사 대표' };
}

export async function setWatch(u: SessionUser, i: z.infer<typeof watchInput>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('광고 점검 기준은 관리자가 정합니다');
  const t = tenantOf(u); const sql = db(); const cur = await watchSettings(t);
  let plans = cur.brandPlans;
  if (i.brandPlans) {
    const ok = new Set((await sql<{ id: string }[]>`select id from mkt_brands where tenant = ${t}`).map((b) => b.id)); // 다른 회사 브랜드 id 는 무시
    plans = { ...plans };
    for (const [id, v] of Object.entries(i.brandPlans)) { if (!ok.has(id)) continue; if (v && v > 0) plans[id] = v; else delete plans[id]; }
  }
  const next = { enabled: i.enabled ?? (cur.exists ? cur.enabled : true), kwCost: i.kwCost ?? cur.kwCost, kwDays: i.kwDays ?? cur.kwDays, pauseWeeks: i.pauseWeeks ?? cur.pauseWeeks, dayRatio: Math.round((i.dayRatio ?? cur.dayRatio) * 100) / 100, capPct: i.capPct ?? cur.capPct };
  await sql`insert into mkt_ad_watch (tenant, enabled, kw_cost, kw_days, pause_weeks, day_ratio, cap_pct, brand_plans, updated_by, updated_at)
    values (${t}, ${next.enabled}, ${next.kwCost}, ${next.kwDays}, ${next.pauseWeeks}, ${next.dayRatio}, ${next.capPct}, ${sql.json(plans)}, ${u.id}, now())
    on conflict (tenant) do update set enabled = excluded.enabled, kw_cost = excluded.kw_cost, kw_days = excluded.kw_days, pause_weeks = excluded.pause_weeks, day_ratio = excluded.day_ratio,
      cap_pct = excluded.cap_pct, brand_plans = excluded.brand_plans, updated_by = excluded.updated_by, updated_at = now()`;
  await audit(sql as never, u.id, 'mkt_ads.watch', 'tenant', null, { before: { ...cur, exists: undefined }, after: { ...next, brandPlans: plans } }).catch(() => {});
  return { ok: true, settings: await watchSettings(t) };
}

/** [지금 점검 보내기]·[주간 보고 지금 보내기](관리자): 정기 실행을 기다리지 않고 한 번 — 같은 날·같은 주 알림은 중복 키로 한 번만 */
export async function runWatchNow(u: SessionUser, i: z.infer<typeof watchAction>) {
  await assertSpace(u, 'marketing'); if (!isAdmin(u)) throw forbidden('관리자만');
  const t = tenantOf(u);
  return i.action === 'daily' ? runDaily(t) : runWeekly(t);
}
