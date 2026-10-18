import { z } from 'zod';
import { createHmac } from 'node:crypto';
import { db } from './db';
import { isAdmin } from './access';
import { assertSpace } from './spaces';
import { HttpError, badRequest, forbidden, notFound } from './errors';
import { decrypt, encrypt, newToken } from './crypto';
import { audit, logError } from './log';
import { appUrl } from './mail';
import { zUuid } from './api';
import { tenantOf, type SessionUser } from './types';

/**
 * V41 4-2 광고 성과 읽기 — 회사별 직접 연결(F-5, Windsor 등 중개 없음). 읽기 전용: 광고를 바꾸는 기능은 없다.
 * - 네이버 검색광고: 회사가 API 라이선스(액세스 라이선스·비밀키·CUSTOMER_ID)를 넣음 → 암호화 보관, 서명 요청.
 * - Meta(페이스북·인스타 광고): META_APP_ID/SECRET(우리 앱 1개) + 회사별 OAuth(ads_read). 다른 회사 계정은 앱 심사 뒤.
 * - Google Ads: GOOGLE_ADS_DEVELOPER_TOKEN(우리 것 1개)·GOOGLE_ADS_CLIENT_ID/SECRET + 회사별 OAuth(adwords), LOGIN_CUSTOMER_ID 는 선택.
 * - 하루 한 번(tick) 최근 7일을 다시 읽어 캠페인×날짜 표에 덮어씀(전환은 늦게 잡히므로). ADS_TEST_BASE 가 있으면 모든 주소를 시험 서버로.
 */
export type AdProvider = 'naver' | 'google' | 'meta';
export const AD_PROVIDERS: Record<AdProvider, string> = { naver: '네이버 검색광고', google: 'Google Ads', meta: 'Meta 광고(페이스북·인스타그램)' };
const T = () => process.env.ADS_TEST_BASE?.replace(/\/$/, '');
const NAVER = () => (T() ? `${T()}/naver` : 'https://api.searchad.naver.com');
const GRAPH = () => (T() ? `${T()}/graph` : 'https://graph.facebook.com/v21.0');
const FB_DIALOG = () => (T() ? `${T()}/fbdialog` : 'https://www.facebook.com/v21.0/dialog/oauth');
// Google Ads API 버전: 종료된 버전은 HTML 404 → 상수 하나(env GOOGLE_ADS_API_VERSION 로 바꿀 수 있음), 404 면 최신→예전 순서로 찾아 기억
const GADS_VERSIONS = ['v24', 'v23', 'v22', 'v21', 'v20'];
let gadsVersion: string | null = null;
const GADS = (v = gadsVersion ?? process.env.GOOGLE_ADS_API_VERSION ?? GADS_VERSIONS[0]) => (T() ? `${T()}/gads/${v}` : `https://googleads.googleapis.com/${v}`);
const G_AUTH = () => (T() ? `${T()}/goauth/auth` : 'https://accounts.google.com/o/oauth2/v2/auth');
const G_TOKEN = () => (T() ? `${T()}/goauth/token` : 'https://oauth2.googleapis.com/token');
export const providerReady = (p: AdProvider) => p === 'naver' ? true
  : p === 'meta' ? !!(process.env.META_APP_ID && process.env.META_APP_SECRET)
  : !!(process.env.GOOGLE_ADS_DEVELOPER_TOKEN && process.env.GOOGLE_ADS_CLIENT_ID && process.env.GOOGLE_ADS_CLIENT_SECRET);
const callback = (p: AdProvider) => `${appUrl()}/api/marketing/ads/callback/${p}`;
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
const daysBack = (n: number) => Array.from({ length: n }, (_, k) => ymd(new Date(Date.now() - (n - 1 - k) * 864e5)));
const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let j: any = null; try { j = JSON.parse(text); } catch { /* 본문이 JSON 이 아님 */ }
  if (!r.ok) {
    // HTML 오류 페이지는 그대로 보이지 않고 상태·경로만(토큰·쿼리 제외)
    const path = (() => { try { const x = new URL(url); return `${x.host}${x.pathname}`; } catch { return ''; } })();
    const msg = j ? String(j?.error?.message ?? j?.error?.status ?? j?.title ?? j?.message ?? '').slice(0, 200) : (/<html|<!doctype/i.test(text) ? '(HTML 오류 페이지 — 주소·API 버전 확인)' : text.slice(0, 120));
    throw new HttpError(502, 'ads_upstream', `광고 API 오류 ${r.status} ${path} ${msg}`.trim(), { status: r.status });
  }
  return j;
}

// ---------------- 네이버 검색광고 ----------------
type NaverSecret = { apiKey: string; secretKey: string };
async function naver(path: string, s: NaverSecret, customerId: string, query = '') {
  const ts = String(Date.now());
  const sig = createHmac('sha256', s.secretKey).update(`${ts}.GET.${path}`).digest('base64');
  return getJson(`${NAVER()}${path}${query}`, { headers: { 'X-Timestamp': ts, 'X-API-KEY': s.apiKey, 'X-Customer': customerId, 'X-Signature': sig } });
}
async function naverStats(customerId: string, s: NaverSecret, days: string[]) {
  const camps: { nccCampaignId: string; name: string }[] = await naver('/ncc/campaigns', s, customerId);
  if (!camps?.length) return [];
  const names = new Map(camps.map((c) => [c.nccCampaignId, c.name]));
  const rows = [];
  for (const day of days) {
    const q = `?ids=${encodeURIComponent(camps.map((c) => c.nccCampaignId).join(','))}&fields=${encodeURIComponent('["impCnt","clkCnt","salesAmt","ccnt"]')}&timeRange=${encodeURIComponent(JSON.stringify({ since: day, until: day }))}`;
    const r = await naver('/stats', s, customerId, q);
    for (const d of r?.data ?? []) rows.push({ day, campaign_id: String(d.id), campaign_name: names.get(d.id) ?? '', impressions: num(d.impCnt), clicks: num(d.clkCnt), cost: num(d.salesAmt), conversions: num(d.ccnt), currency: 'KRW' });
  }
  return rows;
}

// ---------------- Meta ----------------
const META_CONV = new Set(['lead', 'purchase', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead', 'offsite_conversion.fb_pixel_purchase', 'complete_registration']);
async function metaStats(actId: string, token: string, days: string[]) {
  const rows = [];
  let url: string | null = `${GRAPH()}/act_${actId}/insights?${new URLSearchParams({ level: 'campaign', time_increment: '1', time_range: JSON.stringify({ since: days[0], until: days.at(-1) }),
    fields: 'campaign_id,campaign_name,impressions,clicks,spend,actions,account_currency', limit: '500', access_token: token })}`;
  for (let page = 0; url && page < 20; page++) {
    const r: any = await getJson(url);
    for (const d of r?.data ?? []) rows.push({ day: d.date_start, campaign_id: String(d.campaign_id), campaign_name: d.campaign_name ?? '', impressions: num(d.impressions), clicks: num(d.clicks), cost: num(d.spend),
      conversions: (d.actions ?? []).filter((a: any) => META_CONV.has(a.action_type)).reduce((s: number, a: any) => s + num(a.value), 0), currency: d.account_currency ?? 'KRW' });
    url = r?.paging?.next ?? null;
  }
  return rows;
}

// ---------------- Google Ads ----------------
async function googleAccess(refresh: string) {
  const r = await getJson(G_TOKEN(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: process.env.GOOGLE_ADS_CLIENT_ID!, client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET! }) });
  return String(r.access_token);
}
const gHeaders = (access: string) => ({ authorization: `Bearer ${access}`, 'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!, 'content-type': 'application/json',
  ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { 'login-customer-id': process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/\D/g, '') } : {}) });
/** listAccessibleCustomers(GET) — 버전이 종료돼 404 면 다른 버전으로 다시(찾은 버전은 이 서버 동안 기억) */
async function gadsList(access: string) {
  const tried = gadsVersion ? [gadsVersion] : [...new Set([process.env.GOOGLE_ADS_API_VERSION, ...GADS_VERSIONS].filter(Boolean) as string[])];
  let last: unknown;
  for (const v of tried) {
    try { const r = await getJson(`${GADS(v)}/customers:listAccessibleCustomers`, { headers: gHeaders(access) }); gadsVersion = v; return r; }
    catch (e: any) { last = e; if ((e as HttpError)?.detail && (e.detail as any).status !== 404) throw e; if (!(e instanceof HttpError)) throw e; }
  }
  throw last;
}
async function googleStats(cid: string, refresh: string, days: string[]) {
  const access = await googleAccess(refresh);
  if (!gadsVersion) await gadsList(access).catch(() => {}); // 쓸 수 있는 버전 먼저 찾기
  const rows = [];
  const query = `SELECT segments.date, campaign.id, campaign.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, customer.currency_code FROM campaign WHERE segments.date BETWEEN '${days[0]}' AND '${days.at(-1)}'`;
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r: any = await getJson(`${GADS()}/customers/${cid}/googleAds:search`, { method: 'POST', headers: gHeaders(access), body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }) });
    for (const d of r?.results ?? []) rows.push({ day: d.segments?.date, campaign_id: String(d.campaign?.id), campaign_name: d.campaign?.name ?? '', impressions: num(d.metrics?.impressions), clicks: num(d.metrics?.clicks),
      cost: num(d.metrics?.costMicros) / 1e6, conversions: num(d.metrics?.conversions), currency: d.customer?.currencyCode ?? 'KRW' });
    pageToken = r?.nextPageToken; if (!pageToken) break;
  }
  return rows;
}

// ---------------- 동기화 ----------------
type Acc = { id: string; tenant: string; provider: AdProvider; external_id: string; secret_enc: string | null };
export async function syncAccount(a: Acc, days = daysBack(7)) {
  const sql = db();
  try {
    const sec = a.secret_enc ? JSON.parse(decrypt(a.secret_enc)) : {};
    const rows = a.provider === 'naver' ? await naverStats(a.external_id, sec, days) : a.provider === 'meta' ? await metaStats(a.external_id, sec.token, days) : await googleStats(a.external_id, sec.refresh, days);
    for (const r of rows.filter((x) => x.day && x.campaign_id)) {
      await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw, conversions, currency)
        values (${a.id}, ${r.day}, ${r.campaign_id}, ${r.campaign_name}, ${r.impressions}, ${r.clicks}, ${r.cost}, ${r.conversions}, ${r.currency})
        on conflict (account_id, day, campaign_id) do update set campaign_name = excluded.campaign_name, impressions = excluded.impressions, clicks = excluded.clicks,
          cost_krw = excluded.cost_krw, conversions = excluded.conversions, currency = excluded.currency, updated_at = now()`;
    }
    await sql`update mkt_ad_accounts set status = 'active', last_sync_at = now(), last_error = null where id = ${a.id}`;
    return { id: a.id, rows: rows.length };
  } catch (e: any) {
    await sql`update mkt_ad_accounts set status = 'error', last_sync_at = now(), last_error = ${String(e?.message ?? e).slice(0, 300)} where id = ${a.id}`;
    return { id: a.id, error: String(e?.message ?? e).slice(0, 200) };
  }
}
/** tick: 오늘(서울) 아직 안 읽은 계정 5개씩 */
export async function adsSyncDue() {
  const due = await db()<Acc[]>`select id, tenant, provider, external_id, secret_enc from mkt_ad_accounts
    where status <> 'disconnected' and (last_sync_at is null or last_sync_at < ((now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul')) order by last_sync_at nulls first limit 5`;
  const out = [];
  for (const a of due) out.push(await syncAccount(a));
  return { synced: out.length, errors: out.filter((x) => 'error' in x).length };
}

// ---------------- 화면·API ----------------
function adminOnly(u: SessionUser) { if (!isAdmin(u)) throw forbidden('광고 계정 연결은 관리자가 합니다'); }

export async function adsOverview(u: SessionUser, q: { days?: number }) {
  await assertSpace(u, 'marketing');
  const sql = db(); const t = tenantOf(u);
  const n = [7, 14, 30, 90].includes(Number(q.days)) ? Number(q.days) : 7;
  const from = daysBack(n)[0];
  const accounts = await sql`select a.id, a.provider, a.external_id, a.label, a.status, a.last_sync_at, a.last_error, b.name as brand from mkt_ad_accounts a left join mkt_brands b on b.id = a.brand_id
    where a.tenant = ${t} order by a.provider, a.label`;
  const base = () => sql`from mkt_ad_stats s join mkt_ad_accounts a on a.id = s.account_id where a.tenant = ${t} and s.day >= ${from}`;
  const [tot] = await sql`select coalesce(sum(impressions), 0)::float8 impressions, coalesce(sum(clicks), 0)::float8 clicks, coalesce(sum(cost_krw), 0)::float8 cost, coalesce(sum(conversions), 0)::float8 conversions ${base()}`;
  const campaigns = await sql`select a.id as account_id, a.provider, a.label, s.campaign_id, max(s.campaign_name) campaign_name, max(s.currency) currency,
      sum(impressions)::float8 impressions, sum(clicks)::float8 clicks, sum(cost_krw)::float8 cost, sum(conversions)::float8 conversions ${base()}
    group by a.id, a.provider, a.label, s.campaign_id order by sum(cost_krw) desc limit 200`;
  const daily = await sql`select to_char(s.day, 'YYYY-MM-DD') as day, sum(clicks)::float8 clicks, sum(cost_krw)::float8 cost, sum(conversions)::float8 conversions ${base()} group by s.day order by s.day`;
  return { days: n, from, accounts, totals: tot, campaigns, daily, providers: (Object.keys(AD_PROVIDERS) as AdProvider[]).map((p) => ({ key: p, label: AD_PROVIDERS[p], ready: providerReady(p) })), canEdit: isAdmin(u),
    // 로컬 검수: 콘솔에 등록할 콜백 주소를 화면에 그대로(APP_URL 기준 — 도메인 바꾸면 이 주소도 바뀜)
    callbacks: isAdmin(u) ? { meta: callback('meta'), google: callback('google') } : null };
}

export const naverInput = z.object({ customerId: z.string().trim().regex(/^\d{3,12}$/, 'CUSTOMER_ID 는 숫자입니다(광고 시스템 › 도구 › API 사용 관리)'), apiKey: z.string().trim().min(10).max(200), secretKey: z.string().trim().min(10).max(200),
  label: z.string().trim().min(1).max(60), brandId: zUuid.nullable().optional() });
export async function connectNaver(u: SessionUser, i: z.infer<typeof naverInput>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const s = { apiKey: i.apiKey, secretKey: i.secretKey };
  try { await naver('/ncc/campaigns', s, i.customerId); } catch (e: any) { throw badRequest(`네이버 검색광고 연결 확인 실패 — 라이선스·비밀키·CUSTOMER_ID 를 확인해 주세요 (${String(e.message).slice(0, 120)})`); }
  const [a] = await db()<Acc[]>`insert into mkt_ad_accounts (tenant, provider, external_id, label, brand_id, secret_enc, created_by) values (${tenantOf(u)}, 'naver', ${i.customerId}, ${i.label}, ${i.brandId ?? null}, ${encrypt(JSON.stringify(s))}, ${u.id})
    on conflict (tenant, provider, external_id) do update set label = excluded.label, brand_id = excluded.brand_id, secret_enc = excluded.secret_enc, status = 'active', last_error = null
    returning id, tenant, provider, external_id, secret_enc`;
  await audit(db(), u.id, 'mkt_ads.connect', 'mkt_ad_account', a.id, { provider: 'naver' }).catch(() => {});
  const r = await syncAccount(a);
  return { id: a.id, sync: r };
}

export const accountPatch = z.object({ label: z.string().trim().min(1).max(60).optional(), brandId: zUuid.nullable().optional() });
export async function updateAccount(u: SessionUser, id: string, i: z.infer<typeof accountPatch>) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!z.string().uuid().safeParse(id).success) throw notFound();
  const [a] = await db()`update mkt_ad_accounts set label = coalesce(${i.label ?? null}, label), brand_id = ${i.brandId === undefined ? db()`brand_id` : i.brandId} where id = ${id} and tenant = ${tenantOf(u)} returning id`;
  if (!a) throw notFound();
  return { ok: true };
}
/** 연결 끊기: 비밀값 지우고 모은 성과도 함께 지움 */
export async function removeAccount(u: SessionUser, id: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (!z.string().uuid().safeParse(id).success) throw notFound();
  const [a] = await db()`delete from mkt_ad_accounts where id = ${id} and tenant = ${tenantOf(u)} returning id, provider`;
  if (!a) throw notFound();
  await audit(db(), u.id, 'mkt_ads.disconnect', 'mkt_ad_account', id, { provider: a.provider }).catch(() => {});
  return { ok: true };
}
export async function syncNow(u: SessionUser) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  const accs = await db()<Acc[]>`select id, tenant, provider, external_id, secret_enc from mkt_ad_accounts where tenant = ${tenantOf(u)} and status <> 'disconnected' order by last_sync_at nulls first limit 10`;
  const out = [];
  for (const a of accs) out.push(await syncAccount(a));
  return { results: out };
}

// ---------------- OAuth(Meta·Google) ----------------
export async function oauthStart(u: SessionUser, p: string) {
  await assertSpace(u, 'marketing'); adminOnly(u);
  if (p !== 'meta' && p !== 'google') throw notFound();
  if (!providerReady(p)) throw new HttpError(409, 'ads_not_ready', `${AD_PROVIDERS[p]} 연결은 아직 준비 중입니다(워크인 앱 등록·심사 대기)`);
  const state = newToken(24);
  await db()`insert into mkt_ad_oauth_states (state, user_id, tenant, provider) values (${state}, ${u.id}, ${tenantOf(u)}, ${p})`;
  if (p === 'meta') return `${FB_DIALOG()}?${new URLSearchParams({ client_id: process.env.META_APP_ID!, redirect_uri: callback('meta'), state, scope: 'ads_read', response_type: 'code' })}`;
  return `${G_AUTH()}?${new URLSearchParams({ client_id: process.env.GOOGLE_ADS_CLIENT_ID!, redirect_uri: callback('google'), state, response_type: 'code', scope: 'https://www.googleapis.com/auth/adwords', access_type: 'offline', prompt: 'consent' })}`;
}

/** 콜백: 코드 → 토큰 → 접근 가능한 광고 계정 모두 등록(라벨은 계정 이름, 나중에 바꿀 수 있음) */
export async function oauthCallback(u: SessionUser, p: string, code: string, state: string) {
  if (p !== 'meta' && p !== 'google') throw notFound();
  const sql = db();
  const [st] = await sql`delete from mkt_ad_oauth_states where state = ${state} and created_at > now() - interval '15 minutes' returning user_id, tenant, provider`;
  if (!st || st.user_id !== u.id || st.provider !== p || st.tenant !== tenantOf(u)) throw badRequest('연결 요청이 만료됐습니다. 다시 시도해 주세요');
  await assertSpace(u, 'marketing'); adminOnly(u);
  const found: { id: string; name: string; secret: object }[] = [];
  try {
    if (p === 'meta') {
      const short = await getJson(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri: callback('meta'), code })}`);
      const long = await getJson(`${GRAPH()}/oauth/access_token?${new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: short.access_token })}`);
      const token = String(long.access_token ?? short.access_token);
      const accs = await getJson(`${GRAPH()}/me/adaccounts?${new URLSearchParams({ fields: 'account_id,name', limit: '50', access_token: token })}`);
      for (const a of accs?.data ?? []) found.push({ id: String(a.account_id), name: String(a.name ?? a.account_id), secret: { token } });
    } else {
      const tok = await getJson(G_TOKEN(), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback('google'), client_id: process.env.GOOGLE_ADS_CLIENT_ID!, client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET! }) });
      if (!tok.refresh_token) throw badRequest('Google 에서 갱신 토큰을 받지 못했습니다. 다시 연결해 주세요');
      const list = await gadsList(String(tok.access_token));
      for (const rn of list?.resourceNames ?? []) { const id = String(rn).split('/')[1]; if (id) found.push({ id, name: `Google Ads ${id.replace(/(\d{3})(\d{3})(\d+)/, '$1-$2-$3')}`, secret: { refresh: tok.refresh_token } }); }
    }
  } catch (e) { await logError('mkt-ads-oauth', e, { provider: p }).catch(() => {}); throw e instanceof HttpError ? e : badRequest('연결에 실패했습니다'); }
  if (!found.length) throw badRequest('이 계정으로 볼 수 있는 광고 계정이 없습니다');
  const ids: string[] = [];
  for (const f of found.slice(0, 30)) {
    const [a] = await sql<Acc[]>`insert into mkt_ad_accounts (tenant, provider, external_id, label, secret_enc, created_by) values (${tenantOf(u)}, ${p}, ${f.id}, ${f.name.slice(0, 60)}, ${encrypt(JSON.stringify(f.secret))}, ${u.id})
      on conflict (tenant, provider, external_id) do update set secret_enc = excluded.secret_enc, status = 'active', last_error = null returning id, tenant, provider, external_id, secret_enc`;
    ids.push(a.id);
    await syncAccount(a);
  }
  await audit(db(), u.id, 'mkt_ads.connect', 'mkt_ad_account', null, { provider: p, count: ids.length }).catch(() => {});
  return { count: ids.length };
}
