'use client';
import { useEffect } from 'react';
import { captureUtm } from './conversion';

/**
 * 소개 사이트(대표 10/20 16:45) 이벤트: UTM 첫 방문 기억 + 방문·버튼 클릭(무료로 시작·앱 다운로드·전화·메일) 측정.
 * #627(SEO_AUDIT 2-1 '전환·분석 태그 전부 없음'): 측정 ID 는 플랫폼 운영 › 가입 전환 태그(저장값) > 빌드 환경변수 — 소개 화면(홈·/landing/*)에만
 *   GA4 페이지 보기 + Google Ads 사이트 태그(광고가 방문을 배우게) + 네이버 프리미엄로그분석 공통 스크립트(방문). 아무것도 없으면 아무것도 싣지 않는다.
 * 가입 완료(sign_up·CompleteRegistration·네이버 전환)는 가입 화면에서 동의한 브라우저만 보낸다(conversion.ts). 전화 클릭은 Meta 'Contact' — 광고 동의가 있을 때만.
 * 업무 화면에는 어떤 태그도 넣지 않는다.
 */
const GA = process.env.NEXT_PUBLIC_GA4_ID ?? '';
const ADS = process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP ?? '';
const NAVER = process.env.NEXT_PUBLIC_NAVER_WA ?? '';
const META = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '';
const ID_RE = /^[A-Za-z0-9_-]{4,40}$/;
export function LandingEvents({ ga4, ads, naverWa }: { ga4?: string | null; ads?: string | null; naverWa?: string | null } = {}) {
  useEffect(() => {
    captureUtm();
    const w = window as any;
    const g = (ga4 || GA).trim(); const a = (ads || ADS).trim().split('/')[0]; const n = (naverWa || NAVER).trim(); // Ads 는 AW-… 만(전환 라벨 없이)
    if ((ID_RE.test(g) || ID_RE.test(a)) && !w.__wosGa) {
      w.__wosGa = true; w.dataLayer = w.dataLayer || []; w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
      w.gtag('js', new Date());
      if (ID_RE.test(g)) w.gtag('config', g, { page_title: 'landing' });
      if (ID_RE.test(a)) w.gtag('config', a);
      const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ID_RE.test(g) ? g : a)}`; document.head.appendChild(s);
    }
    if (ID_RE.test(n) && !w.__wosNaver) {
      w.__wosNaver = true; w.wcs_add = w.wcs_add || {}; w.wcs_add.wa = n;
      const s = document.createElement('script'); s.async = true; s.src = 'https://wcs.naver.net/wcslog.js'; s.onload = () => { try { if (!w._nasa) w._nasa = {}; w.wcs_do?.(w._nasa); } catch { /* 없음 */ } }; document.head.appendChild(s);
    }
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-track]'); if (!el) return;
      const kind = el.dataset.track!;
      try { w.dataLayer?.push({ event: 'landing_cta', kind }); } catch { /* 없음 */ }
      if (w.__wosGa && w.gtag) w.gtag('event', kind === 'tel' ? 'tel' : 'landing_cta', { kind, link: el.getAttribute('href') ?? '' });
      let consent = false; try { consent = localStorage.getItem('wos_ads_consent') === '1'; } catch { /* 없음 */ }
      if (META && consent && w.fbq && kind === 'tel') w.fbq('track', 'Contact');
      document.dispatchEvent(new CustomEvent('wos:landing', { detail: { kind } })); // 시험용
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [ga4, ads, naverWa]);
  return null;
}
