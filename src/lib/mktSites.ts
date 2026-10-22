import { z } from 'zod';
import { db } from './db';
import { sha256 } from './crypto';
import { HttpError, unauthorized } from './errors';
import { assertSpace } from './spaces';
import { tenantOf, type SessionUser } from './types';
import { adAttrib, isTelLabel, kwKey } from './adAttrib';

/**
 * 대표 10/20 14:10 ①: 사이트별 운영 집계 — 브랜드(사이트)마다 주 단위로 방문자·CTA 클릭·게시·광고(비용·클릭)·문의를 한 표에, 이번 주 요약 한 줄(주간 보고용).
 * 방문·CTA 는 브랜드 사이트에 심는 비콘(POST /api/public/site-event?k=연동토큰)이 보냄 — 설치 전에는 '미연결'. 게시·광고·문의는 워크인 기록에서.
 */
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
export const siteEventInput = z.object({ event: z.enum(['visit', 'cta']), site: z.string().trim().max(40).optional(), label: z.string().trim().max(60).optional(), path: z.string().trim().max(200).optional(),
  landing: z.string().trim().max(2000).optional() }); // 광고 최적화 1차 ③ 그 방문자가 처음 들어온 주소(광고면 n_*·utm·gclid 가 붙어 있음)
/** 비콘 수신: 연동 토큰(문의 연동과 같은 토큰) → tenant·site. 한 토큰 시간당 5,000건 넘으면 429 */
export async function recordSiteEvent(rawToken: string, i: z.infer<typeof siteEventInput>) {
  if (!rawToken) throw unauthorized('연동 토큰이 필요합니다');
  const sql = db();
  const [t] = await sql<{ id: string; tenant: string; site: string }[]>`select id, tenant, site from integration_tokens where token_hash = ${sha256(`inquiry:${rawToken}`)} and revoked_at is null`;
  if (!t) throw unauthorized('연동 토큰이 올바르지 않습니다');
  const site = (i.site || t.site).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || t.site;
  const label = i.event === 'cta' ? (i.label || i.path || '').slice(0, 60) : '';
  const [{ n }] = await sql<{ n: number }[]>`select coalesce(sum(n), 0)::int n from mkt_site_events where tenant = ${t.tenant} and site = ${site} and day = ${ymd(new Date())}::date`;
  if (n >= 200_000) throw new HttpError(429, 'too_many', '오늘 집계 한도를 넘었습니다');
  await sql`insert into mkt_site_events (tenant, site, day, event, label, n) values (${t.tenant}, ${site}, ${ymd(new Date())}::date, ${i.event}, ${label}, 1)
    on conflict (tenant, site, day, event, label) do update set n = mkt_site_events.n + 1`;
  // 광고 최적화 1차 ③ 광고로 들어온 사람의 전화·버튼 클릭은 키워드별로도 셈(광고가 아닌 유입은 세지 않음)
  const at = i.event === 'cta' && i.landing ? adAttrib({ landing: i.landing }) : null;
  if (at) await sql`insert into mkt_ad_leads (tenant, day, provider, keyword_key, keyword_id, kind, keyword, n) values (${t.tenant}, ${ymd(new Date())}::date, ${at.provider}, ${kwKey(at.keyword)}, ${at.keywordId},
    ${isTelLabel(label) ? 'tel' : 'cta'}, ${at.keyword}, 1) on conflict (tenant, day, provider, keyword_key, keyword_id, kind) do update set n = mkt_ad_leads.n + 1, keyword = excluded.keyword`;
  return { ok: true };
}
/** 사이트 키 ↔ 브랜드 이름(문의 연동 site 키와 브랜드 이름이 다르므로 이름 규칙으로) */
const SITE_BRAND: [RegExp, RegExp][] = [[/^dagym|다짐/i, /다짐|dagym/i], [/^hilink|hi-?link|하이링크/i, /하이\s*-?\s*링크|hi-?link/i], [/^workin|work-?in|워크인/i, /워크\s*인|work-?in/i], [/^bodylab|body-?lab|바디랩/i, /바디\s*랩|body\s*lab/i]];
export function brandOfSite(site: string, brands: { id: string; name: string }[]): string | null {
  for (const [sr, br] of SITE_BRAND) if (sr.test(site)) { const b = brands.find((x) => br.test(x.name)); if (b) return b.id; }
  const b = brands.find((x) => x.name.toLowerCase().replace(/\s/g, '') === site.toLowerCase()); return b?.id ?? null;
}
export async function sitesView(u: SessionUser, weeks = 4) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u); const n = Math.min(12, Math.max(1, weeks));
  const brands = await sql<{ id: string; name: string; color: string }[]>`select id, name, color from mkt_brands where tenant = ${t} order by name`;
  // 주 경계(KST 월~일): 이번 주 월요일부터 n 주
  const today = ymd(new Date()); const dow = (new Date(`${today}T12:00:00+09:00`).getUTCDay() + 6) % 7; const monday = new Date(Date.parse(`${today}T12:00:00+09:00`) - dow * 864e5);
  const wk = Array.from({ length: n }, (_, i) => { const from = new Date(monday.getTime() - i * 7 * 864e5); return { from: ymd(from), to: ymd(new Date(from.getTime() + 6 * 864e5)) }; });
  const from0 = wk[wk.length - 1].from, to0 = wk[0].to;
  const ev = await sql<{ site: string; day: string; event: string; n: number }[]>`select site, to_char(day, 'YYYY-MM-DD') as day, event, sum(n)::int n from mkt_site_events where tenant = ${t} and day between ${from0}::date and ${to0}::date group by site, day, event`;
  const posts = await sql<{ brand_id: string | null; day: string; n: number }[]>`select brand_id, to_char((coalesce(published_at, scheduled_at) at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') as day, count(*)::int n from mkt_contents where tenant = ${t} and not is_test and status = 'published' and (coalesce(published_at, scheduled_at) at time zone 'Asia/Seoul')::date between ${from0}::date and ${to0}::date group by brand_id, 2`;
  const ads = await sql<{ brand_id: string | null; day: string; cost: number; clicks: number }[]>`select a.brand_id, to_char(s.day, 'YYYY-MM-DD') as day, sum(s.cost_krw)::float8 cost, sum(s.clicks)::float8 clicks from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day between ${from0}::date and ${to0}::date group by a.brand_id, s.day`;
  const calls = await sql<{ brand_id: string | null; day: string; n: number }[]>`select brand_id, to_char((called_at at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') as day, count(*)::int n from mkt_calls where tenant = ${t} and status <> 'excluded' and (called_at at time zone 'Asia/Seoul')::date between ${from0}::date and ${to0}::date group by brand_id, 2`;
  const inq = await sql<{ site: string; day: string; n: number }[]>`select site, to_char((created_at at time zone 'Asia/Seoul')::date, 'YYYY-MM-DD') as day, count(*)::int n from inquiries where tenant = ${t} and (created_at at time zone 'Asia/Seoul')::date between ${from0}::date and ${to0}::date group by site, 2`;
  const sites = [...new Set([...ev.map((e) => e.site), ...inq.map((i) => i.site)])];
  type W = { from: string; to: string; visits: number | null; cta: number | null; posts: number; adCost: number; clicks: number; inquiries: number };
  const rows = [...brands.map((b) => ({ brandId: b.id as string | null, name: b.name, color: b.color, sites: sites.filter((s) => brandOfSite(s, brands) === b.id) })), { brandId: null as string | null, name: '(브랜드 없음)', color: '#9ca3af', sites: sites.filter((s) => !brandOfSite(s, brands)) }]
    .map((r) => {
      const inWeek = (day: string, w: { from: string; to: string }) => day >= w.from && day <= w.to;
      const connected = r.sites.some((s) => ev.some((e) => e.site === s));
      const weeksOut: W[] = wk.map((w) => ({ ...w,
        visits: connected ? ev.filter((e) => r.sites.includes(e.site) && e.event === 'visit' && inWeek(e.day, w)).reduce((s, e) => s + e.n, 0) : null,
        cta: connected ? ev.filter((e) => r.sites.includes(e.site) && e.event === 'cta' && inWeek(e.day, w)).reduce((s, e) => s + e.n, 0) : null,
        posts: posts.filter((p) => p.brand_id === r.brandId && inWeek(p.day, w)).reduce((s, p) => s + p.n, 0),
        adCost: Math.round(ads.filter((a) => a.brand_id === r.brandId && inWeek(a.day, w)).reduce((s, a) => s + a.cost, 0)), clicks: Math.round(ads.filter((a) => a.brand_id === r.brandId && inWeek(a.day, w)).reduce((s, a) => s + a.clicks, 0)),
        inquiries: calls.filter((c) => c.brand_id === r.brandId && inWeek(c.day, w)).reduce((s, c) => s + c.n, 0) + inq.filter((i) => r.sites.includes(i.site) && inWeek(i.day, w)).reduce((s, i) => s + i.n, 0) }));
      return { ...r, connected, weeks: weeksOut };
    }).filter((r) => r.brandId || r.sites.length);
  const won = (v: number) => (v >= 1e4 ? `${Math.round(v / 1e4).toLocaleString('ko-KR')}만원` : `${v.toLocaleString('ko-KR')}원`);
  const d = (a: number | null, b: number | null) => (a == null || b == null ? '' : b === 0 ? (a ? ' (지난주 0)' : '') : ` (지난주 대비 ${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)}%)`);
  const summary = rows.map((r) => { const [c, p] = r.weeks; return `${r.name}: ${r.connected ? `방문 ${c.visits}${d(c.visits, p?.visits ?? null)} · CTA ${c.cta}${d(c.cta, p?.cta ?? null)} · ` : '방문·CTA 미연결 · '}게시 ${c.posts}${d(c.posts, p?.posts ?? null)} · 광고 ${won(c.adCost)}/클릭 ${c.clicks}${d(c.clicks, p?.clicks ?? null)} · 문의 ${c.inquiries}${d(c.inquiries, p?.inquiries ?? null)}`; });
  return { weeks: wk, rows, summary, thisWeek: wk[0], sites, beaconUrl: `${(process.env.APP_URL ?? 'https://work-in.dev').replace(/\/$/, '')}/api/public/site-event` };
}
