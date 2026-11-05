// 376차(로컬 11/06 02:40 KG2B 점검: 싱가포르 sin1 → www.kg2b.com:443 연결 8초 넘음 · 서울 icn1 → 4ms 연결·목록 200): KG2B 는 해외 IP 를 받지 않음.
// 정기 실행·사람 요청은 대부분 싱가포르 함수에서 돌므로, 한국 IP 만 받는 곳은 서울 지역 중계 주소(/api/internal/kr-fetch, CRON_SECRET)로 대신 받는다.
// 메일 발송(/api/mail/run)과 같은 방식. 중계는 허용한 곳(KG2B)만 · 리다이렉트는 따라가지 않고 그대로 돌려줌 · 서울에서 도는 함수나 시험 서버는 바로 받음
import { appUrl } from './mail';

const KR_HOSTS = /(^|\.)kg2b\.com$/i;
const testKg2b = () => { const t = process.env.SALES_COLLECT_TEST_BASE?.replace(/\/$/, ''); return t ? `${t}/kg2b` : null; };
/** 한국 IP 만 받는 곳인가 — KG2B(시험: SALES_COLLECT_TEST_BASE/kg2b) */
export function needsKr(url: string) {
  const t = testKg2b(); if (t && url.startsWith(`${t}/`)) return true;
  try { return KR_HOSTS.test(new URL(url).hostname); } catch { return false; }
}
/** 지금 함수가 서울 밖(Vercel 다른 지역)이면 중계 — 시험은 KR_RELAY=force 일 때만 */
export function relayOn() {
  if (!process.env.CRON_SECRET) return false;
  if (process.env.KR_RELAY === 'off') return false;
  if (process.env.KR_RELAY === 'force') return true;
  return !!process.env.VERCEL && process.env.VERCEL_REGION !== 'icn1';
}
type Init = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: RequestRedirect };
function plainHeaders(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) return Object.fromEntries(h.entries());
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}
/** fetch 와 같은 모양 — 한국 IP 만 받는 곳이고 서울 밖이면 서울 중계로, 아니면 그대로 fetch */
export async function krFetch(input: string | URL, init: RequestInit = {}, hops = 0): Promise<Response> {
  const url = String(input);
  if (!needsKr(url) || !relayOn()) return fetch(url, init);
  const body: Init & { url: string } = { url, method: init.method ?? 'GET', headers: plainHeaders(init.headers), body: typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : undefined, redirect: init.redirect };
  const r = await fetch(`${appUrl()}/api/internal/kr-fetch`, { method: 'POST', headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: init.signal ?? AbortSignal.timeout(55_000), redirect: 'manual' });
  if (r.status === 401 || r.status === 403 || r.status === 404 || !r.headers.get('x-kr-status')) {
    const t = await r.text().catch(() => ''); throw new Error(`서울 중계 실패(${r.status}): ${t.slice(0, 160)}`);
  }
  const status = Number(r.headers.get('x-kr-status'));
  if (status === 599) { const j = await r.json().catch(() => ({})) as { error?: string }; throw new Error(`서울 중계에서도 받지 못함: ${j.error ?? r.status}`); }
  const h = new Headers();
  for (const k of ['content-type', 'content-length', 'content-disposition', 'last-modified']) { const v = r.headers.get(`x-kr-h-${k}`); if (v) h.set(k, v); }
  const loc = r.headers.get('x-kr-h-location'); if (loc) h.set('location', loc);
  // 중계는 리다이렉트를 따라가지 않음 → 호출 쪽이 따라가길 바랐으면(기본) 여기서 3번까지, 허용한 곳으로만
  if (status >= 300 && status < 400 && loc && init.redirect !== 'manual' && hops < 3) {
    await r.body?.cancel().catch(() => {});
    const next = new URL(loc, url).toString();
    if (!needsKr(next)) throw new Error(`서울 중계: 허용하지 않은 곳으로 넘어감(${new URL(next).hostname})`);
    return krFetch(next, { ...init, method: status === 307 || status === 308 ? init.method : 'GET', body: status === 307 || status === 308 ? init.body : undefined }, hops + 1);
  }
  for (const c of JSON.parse(r.headers.get('x-kr-set-cookie') || '[]') as string[]) h.append('set-cookie', c);
  h.set('x-kr-relay', r.headers.get('x-kr-region') ?? 'relay');
  const nullBody = status === 204 || status === 304 || (status >= 100 && status < 200);
  const res = new Response(nullBody ? null : r.body, { status: status >= 200 && status <= 599 ? status : 502, headers: h });
  Object.defineProperty(res, 'url', { value: r.headers.get('x-kr-url') ?? url }); // 호출 쪽이 res.url 을 볼 때(최종 주소)
  return res;
}
/** 중계 주소가 받을 수 있는 곳인지(서울 쪽 검사) */
export const relayAllowed = (url: string) => needsKr(url) && /^https?:\/\//i.test(url) && (url.startsWith('https://') || !!testKg2b());
