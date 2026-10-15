'use client';
/**
 * 가입 전환 태그(마케팅 요청): Meta 픽셀 · Google 태그(GA4 / Ads 전환) · 네이버 프리미엄로그분석.
 * - ID 는 빌드 환경변수(NEXT_PUBLIC_*) — 비어 있으면 아무것도 불러오지 않는다.
 * - 가입할 때 "광고 효과 측정" 선택 동의를 한 브라우저에서만, 가입 완료(이메일 확인) 순간 한 번 불러와 전환을 보낸다.
 *   앱 화면 전체에는 넣지 않는다(업무 내용이 광고 회사로 가지 않게).
 */
const META = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '';
const GA = process.env.NEXT_PUBLIC_GA4_ID ?? '';
const GADS = process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP ?? ''; // 예: AW-123456789/AbCdEf (전환 ID/라벨)
const NAVER = process.env.NEXT_PUBLIC_NAVER_WA ?? '';
const CONSENT_KEY = 'wos_ads_consent';

export const conversionTagsConfigured = () => !!(META || GA || GADS || NAVER);
export function setAdsConsent(on: boolean) { try { on ? localStorage.setItem(CONSENT_KEY, '1') : localStorage.removeItem(CONSENT_KEY); } catch {} }
const consented = () => { try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; } };

function load(src: string) {
  return new Promise<void>((res) => { const s = document.createElement('script'); s.async = true; s.src = src; s.onload = () => res(); s.onerror = () => res(); document.head.appendChild(s); });
}

/** 가입 완료 전환 — 동의·ID 가 없으면 바로 끝. 최대 1.5초만 기다린다(첫 화면 이동을 늦추지 않게) */
export async function fireSignupConversion() {
  if (typeof window === 'undefined' || !conversionTagsConfigured() || !consented()) return;
  const w = window as any;
  const jobs: Promise<void>[] = [];
  if (META) {
    if (!w.fbq) { const f: any = (w.fbq = function (...a: any[]) { f.callMethod ? f.callMethod(...a) : f.queue.push(a); }); f.queue = []; f.loaded = true; f.version = '2.0'; w._fbq = f; }
    w.fbq('init', META); w.fbq('track', 'CompleteRegistration');
    jobs.push(load('https://connect.facebook.net/en_US/fbevents.js'));
  }
  const gid = GA || GADS.split('/')[0];
  if (gid) {
    w.dataLayer = w.dataLayer || []; w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    if (GA) { w.gtag('config', GA, { send_page_view: false }); w.gtag('event', 'sign_up', { method: 'email' }); }
    if (GADS) { w.gtag('config', GADS.split('/')[0]); w.gtag('event', 'conversion', { send_to: GADS }); }
    jobs.push(load(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gid)}`));
  }
  if (NAVER) {
    jobs.push(load('https://wcs.naver.net/wcslog.js').then(() => {
      if (!w.wcs) return;
      w.wcs_add = w.wcs_add || {}; w.wcs_add.wa = NAVER;
      const nasa: any = {}; nasa.cnv = w.wcs.cnv('2', '1'); // 2 = 회원가입
      w.wcs_do(nasa);
    }));
  }
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 1500))]);
}
