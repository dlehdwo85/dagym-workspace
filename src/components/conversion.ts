'use client';
/**
 * 가입 전환 태그(마케팅 요청): Meta 픽셀 · Google 태그(GA4 / Ads 전환) · 네이버 프리미엄로그분석.
 * - ID: 플랫폼 운영 › 가입 전환 태그(#449, 가입 화면이 GET /api/auth/signup 으로 받음) > 빌드 환경변수(NEXT_PUBLIC_*) — 비어 있으면 아무것도 불러오지 않는다.
 * - 가입할 때 "광고 효과 측정" 선택 동의를 한 브라우저에서만, 가입 완료(회사 생성) 순간 한 번 불러와 전환을 보낸다.
 *   앱 화면 전체에는 넣지 않는다(업무 내용이 광고 회사로 가지 않게).
 * - 광고 클릭 id(gclid·fbclid)는 첫 화면에서 이 브라우저에만 적어 두고(어디에도 보내지 않음), 동의 뒤 전환을 보낼 때만
 *   Google(_gcl_aw)·Meta(_fbc) 표준 쿠키로 넘긴다 — 태그를 소개 화면에 미리 깔지 않아도 광고 클릭과 가입이 이어지게.
 */
type Tags = { googleAds: string; ga4: string; metaPixel: string; naverWa: string };
let tags: Tags = {
  googleAds: process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP ?? '', // 예: AW-123456789/AbCdEf (전환 ID/라벨)
  ga4: process.env.NEXT_PUBLIC_GA4_ID ?? '', metaPixel: process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '', naverWa: process.env.NEXT_PUBLIC_NAVER_WA ?? '',
};
const CONSENT_KEY = 'wos_ads_consent';
const CLICK_KEY = 'wos_click';

/** #449 서버(플랫폼 운영) 값 — 빈 칸은 빌드 값 그대로 */
export function setConversionTags(t?: Partial<Tags> | null) {
  if (!t) return;
  tags = { googleAds: t.googleAds || tags.googleAds, ga4: t.ga4 || tags.ga4, metaPixel: t.metaPixel || tags.metaPixel, naverWa: t.naverWa || tags.naverWa };
}
export const conversionTagsConfigured = () => !!(tags.metaPixel || tags.ga4 || tags.googleAds || tags.naverWa);
export function setAdsConsent(on: boolean) { try { on ? localStorage.setItem(CONSENT_KEY, '1') : localStorage.removeItem(CONSENT_KEY); } catch {} }
const consented = () => { try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; } };

function load(src: string) {
  return new Promise<void>((res) => { const s = document.createElement('script'); s.async = true; s.src = src; s.onload = () => res(); s.onerror = () => res(); document.head.appendChild(s); });
}
const ID_RE = /^[A-Za-z0-9_-]{8,200}$/;
function readClick(): { gclid?: string; fbclid?: string; at: number } | undefined {
  try {
    const r = JSON.parse(localStorage.getItem(CLICK_KEY) ?? 'null');
    if (!r || Date.now() - (r.at ?? 0) > 90 * 86400_000) return undefined; // Google 기본 전환 기간 90일
    return { gclid: ID_RE.test(r.gclid ?? '') ? r.gclid : undefined, fbclid: ID_RE.test(r.fbclid ?? '') ? r.fbclid : undefined, at: Number(r.at) };
  } catch { return undefined; }
}
const setCookie = (k: string, v: string) => { document.cookie = `${k}=${v}; path=/; max-age=${90 * 86400}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; };

/** 가입 완료(회사 생성) 전환 — 동의·ID 가 없으면 바로 끝. 최대 1.5초만 기다린다(첫 화면 이동을 늦추지 않게) */
export async function fireSignupConversion() {
  if (typeof window === 'undefined' || !conversionTagsConfigured() || !consented()) return;
  // 같은 브라우저에서 두 번(다시 제출·뒤로 가기) 세지 않음 — 서버 응답은 계정 유무를 숨기려고 늘 같으므로 여기서 한 번만
  try { if (localStorage.getItem('wos_conv_done')) return; localStorage.setItem('wos_conv_done', String(Date.now())); } catch { /* 저장소 막힘이면 그대로 보냄 */ }
  const w = window as any;
  const jobs: Promise<void>[] = [];
  const click = readClick();
  if (click?.gclid && tags.googleAds && !document.cookie.includes('_gcl_aw=')) setCookie('_gcl_aw', `GCL.${Math.floor(click.at / 1000)}.${click.gclid}`);
  if (click?.fbclid && tags.metaPixel && !document.cookie.includes('_fbc=')) setCookie('_fbc', `fb.1.${click.at}.${click.fbclid}`);
  if (tags.metaPixel) {
    if (!w.fbq) { const f: any = (w.fbq = function (...a: any[]) { f.callMethod ? f.callMethod(...a) : f.queue.push(a); }); f.queue = []; f.loaded = true; f.version = '2.0'; w._fbq = f; }
    w.fbq('init', tags.metaPixel); w.fbq('track', 'CompleteRegistration');
    jobs.push(load('https://connect.facebook.net/en_US/fbevents.js'));
  }
  const gid = tags.ga4 || tags.googleAds.split('/')[0];
  if (gid) {
    w.dataLayer = w.dataLayer || []; w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    if (tags.ga4) { w.gtag('config', tags.ga4, { send_page_view: false }); w.gtag('event', 'sign_up', { method: 'email' }); }
    if (tags.googleAds) { w.gtag('config', tags.googleAds.split('/')[0]); w.gtag('event', 'conversion', { send_to: tags.googleAds }); }
    jobs.push(load(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gid)}`));
  }
  if (tags.naverWa) {
    jobs.push(load('https://wcs.naver.net/wcslog.js').then(() => {
      if (!w.wcs) return;
      w.wcs_add = w.wcs_add || {}; w.wcs_add.wa = tags.naverWa;
      const nasa: any = {}; nasa.cnv = w.wcs.cnv('2', '1'); // 2 = 회원가입
      w.wcs_do(nasa);
    }));
  }
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 1500))]);
}

/** 유입 경로(UTM): 첫 방문 값을 30일 기억 → 가입할 때 회사에 남긴다(마케팅 퍼널 출처별 집계, 개인정보 아님) */
const UTM_KEY = 'wos_utm';
export function captureUtm() {
  if (typeof window === 'undefined') return;
  const q = new URLSearchParams(location.search);
  // #449 광고 클릭 id: 마지막 클릭 기준으로 덮어씀(이 브라우저에만, 전환은 동의한 경우에만 씀)
  const gclid = q.get('gclid') ?? ''; const fbclid = q.get('fbclid') ?? '';
  if (ID_RE.test(gclid) || ID_RE.test(fbclid)) { try { localStorage.setItem(CLICK_KEY, JSON.stringify({ ...(ID_RE.test(gclid) ? { gclid } : {}), ...(ID_RE.test(fbclid) ? { fbclid } : {}), at: Date.now() })); } catch {} }
  const v = { source: q.get('utm_source') ?? '', medium: q.get('utm_medium') ?? '', campaign: q.get('utm_campaign') ?? '' };
  if (!v.source && !v.medium && !v.campaign) return;
  try { if (!readUtm()) localStorage.setItem(UTM_KEY, JSON.stringify({ ...v, at: Date.now() })); } catch {}
}
export function readUtm(): { source?: string; medium?: string; campaign?: string } | undefined {
  try {
    const r = JSON.parse(localStorage.getItem(UTM_KEY) ?? 'null');
    if (!r || Date.now() - (r.at ?? 0) > 30 * 86400_000) return undefined;
    const clip = (s: unknown, n: number) => (typeof s === 'string' && s ? s.slice(0, n) : undefined);
    return { source: clip(r.source, 80), medium: clip(r.medium, 80), campaign: clip(r.campaign, 120) };
  } catch { return undefined; }
}

/** V32 3 가입 단계별 이탈률: 브라우저 임의 id + 단계만(개인정보 없음), 실패해도 무시 */
export function signupStep(step: 'account_view' | 'company_view') {
  try {
    let anon = localStorage.getItem('wos_anon');
    if (!anon) { anon = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join(''); localStorage.setItem('wos_anon', anon); }
    fetch('/api/public/signup-step', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anon, step }), keepalive: true }).catch(() => {});
  } catch { /* 저장소 막힘 등 */ }
}
