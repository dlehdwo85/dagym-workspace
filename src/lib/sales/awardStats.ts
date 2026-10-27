import { db } from '../db';
import { forbidden } from '../errors';
import { assertSpace } from '../spaces';
import { tenantOf, type SessionUser } from '../types';
import { corpName, isOurs, ourIdentity } from './bidTasks';
import { passPrefs, prefsOf } from './digest';
import { salesBidsOn } from './options';
import { sidoIn } from './region';

/**
 * 226차 #497 R21-4(21라인 레퍼런스 '낙찰 결과·낙찰가·경쟁업체 분석'): 관련 공고(맞춤 조건 — 업종 적합·관심 검색어·지역 등)의 낙찰 결과를 업체별로 묶음.
 * 업체 = 법인 표시(㈜·주식회사 등)를 뺀 이름 · 낙찰 건수·낙찰금액 합·평균 낙찰률·평균 참가 업체·주 지역·최근 낙찰 · 우리 회사(회사 정보 이름·사업자번호) · 유찰(낙찰자 없음).
 * 원천 = 수집한 결과(K-apt 입찰결과·나라장터 낙찰정보 등) — 원천에 없는 칸(낙찰률·참가 수·금액)은 비움(평균에서 뺌).
 */
export const AWARD_DAYS = [30, 90, 180, 365] as const;
type Rec = { id: string; title: string; date: string | null; amount: number | null; rate: number | null; bidders: number | null; region: string | null; issuer: string | null; url: string | null };
const num = (v: unknown) => { if (v == null || v === '') return null; const x = Number(String(v).replace(/[,원%\s]/g, '')); return Number.isFinite(x) && x > 0 ? x : null; };
const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const regionOf = (r: Record<string, any>) => { const v = String(r.region ?? '').trim(); return (v && v !== '-' ? sidoIn(v) ?? v : null) ?? sidoIn(r.region_restriction, r.issuer, r.demand_agency, r.office_address, r.facility_name, r.title); };

export async function awardStats(u: SessionUser, days0: number) {
  await assertSpace(u, 'sales'); const t = tenantOf(u);
  if (!(await salesBidsOn(t))) throw forbidden('입찰·공고를 쓰지 않는 회사입니다');
  const days = (AWARD_DAYS as readonly number[]).includes(days0) ? days0 : 90;
  const since = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - days * 864e5));
  const sql = db();
  const rows = await sql<{ id: string; row: Record<string, any> }[]>`select src_id as id, row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and not gone
      and (coalesce(row->>'current_status', '') ~ '낙찰|유찰' or coalesce(row->>'winner_name', '') <> '')
      and coalesce(nullif(row->>'award_date', ''), nullif(row->>'posted_date', ''), to_char(synced_at at time zone 'Asia/Seoul', 'YYYY-MM-DD')) >= ${since}
    limit 5000`;
  const p = await prefsOf(t); const me = await ourIdentity(sql, t);
  const groups = new Map<string, { names: Map<string, number>; latest: Map<string, string>; ours: boolean; recs: Rec[] }>();
  let total = 0, failed = 0;
  for (const { id, row: r } of rows) {
    if (!passPrefs(r, p).ok) continue;
    total++;
    const name = String(r.winner_name ?? r.award_company ?? r.successful_bidder ?? '').trim();
    if (!name) { failed++; continue; }
    const key = corpName(name) || name.toLowerCase();
    const g = groups.get(key) ?? { names: new Map<string, number>(), latest: new Map<string, string>(), ours: false, recs: [] as Rec[] }; groups.set(key, g);
    const day = String(r.award_date ?? r.posted_date ?? '').slice(0, 10);
    g.names.set(name, (g.names.get(name) ?? 0) + 1); if (day > (g.latest.get(name) ?? '')) g.latest.set(name, day);
    if (!g.ours && isOurs({ name, biz: r.winner_biz_no }, me)) g.ours = true;
    const rate = num(r.winner_rate);
    g.recs.push({ id: String(r.id ?? id), title: String(r.title ?? '').trim(), date: day || null, amount: num(r.winner_amount ?? r.award_amount),
      rate: rate != null && rate <= 200 ? rate : null, bidders: num(r.bidders), region: regionOf(r), issuer: String(r.issuer ?? r.demand_agency ?? r.facility_name ?? '').trim() || null, url: String(r.source_url ?? '').trim() || null });
  }
  const list = [...groups.entries()].map(([key, g]) => {
    const recs = g.recs.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    const amounts = recs.map((x) => x.amount).filter((x): x is number => x != null);
    const regions = new Map<string, number>(); for (const x of recs) if (x.region) regions.set(x.region, (regions.get(x.region) ?? 0) + 1);
    return { key, name: [...g.names].sort((a, b) => b[1] - a[1] || (g.latest.get(b[0]) ?? '').localeCompare(g.latest.get(a[0]) ?? ''))[0][0] /* 가장 많이 쓴 이름, 같으면 최근 이름 */, ours: g.ours, wins: recs.length, amount: amounts.length ? amounts.reduce((a, b) => a + b, 0) : null,
      rate: avg(recs.map((x) => x.rate).filter((x): x is number => x != null)), bidders: avg(recs.map((x) => x.bidders).filter((x): x is number => x != null)),
      regions: [...regions].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k), last: recs[0]?.date ?? null, recent: recs.slice(0, 5) };
  }).sort((a, b) => b.wins - a.wins || (b.amount ?? 0) - (a.amount ?? 0) || a.name.localeCompare(b.name, 'ko')).map((x, i) => ({ ...x, rank: i + 1 }));
  const awarded = total - failed;
  const shown = list.slice(0, 30); for (const x of list) if (x.ours && !shown.includes(x)) shown.push(x); // 우리 회사는 30위 밖이어도 보임
  return { days, since, total, awarded, failed, companies: list.length, ours: list.filter((x) => x.ours).reduce((s, x) => s + x.wins, 0),
    top5Share: awarded ? Math.round((list.slice(0, 5).reduce((s, x) => s + x.wins, 0) / awarded) * 100) : 0, items: shown };
}
