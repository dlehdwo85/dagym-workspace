'use client';
import { useEffect } from 'react';
import { captureUtm } from './conversion';

/**
 * 소개 사이트(대표 10/20 16:45) 이벤트: UTM 첫 방문 기억 + GA4(설정돼 있을 때만) 페이지 보기·버튼 클릭(무료로 시작·앱 다운로드·전화·메일).
 * 가입 완료(sign_up·CompleteRegistration)는 가입 화면에서 동의한 브라우저만 보낸다(conversion.ts). 전화 클릭은 Meta 'Contact' — 광고 동의가 있을 때만.
 * 업무 화면에는 어떤 태그도 넣지 않는다.
 */
const GA = process.env.NEXT_PUBLIC_GA4_ID ?? '';
const META = process.env.NEXT_PUBLIC_META_PIXEL_ID ?? '';
export function LandingEvents() {
  useEffect(() => {
    captureUtm();
    const w = window as any;
    if (GA && !w.__wosGa) {
      w.__wosGa = true; w.dataLayer = w.dataLayer || []; w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
      w.gtag('js', new Date()); w.gtag('config', GA, { page_title: 'landing' });
      const s = document.createElement('script'); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA)}`; document.head.appendChild(s);
    }
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-track]'); if (!el) return;
      const kind = el.dataset.track!;
      try { w.dataLayer?.push({ event: 'landing_cta', kind }); } catch { /* 없음 */ }
      if (GA && w.gtag) w.gtag('event', kind === 'tel' ? 'tel' : 'landing_cta', { kind, link: el.getAttribute('href') ?? '' });
      let consent = false; try { consent = localStorage.getItem('wos_ads_consent') === '1'; } catch { /* 없음 */ }
      if (META && consent && w.fbq && kind === 'tel') w.fbq('track', 'Contact');
      document.dispatchEvent(new CustomEvent('wos:landing', { detail: { kind } })); // 시험용
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
  return null;
}
