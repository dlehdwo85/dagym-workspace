'use client';
import { useEffect, useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import { isInApp } from './inApp';
import { APP_GET_PATH } from '@/lib/storeLinks';

/**
 * 휴대폰 브라우저로 소개·로그인 화면에 온 사람에게 맨 위 작은 띠 한 줄(대표 11/20): "앱으로 쓰면 알림을 받습니다 [앱 받기]" → 앱 받기 화면(/app).
 * 보이지 않는 곳: 앱 안 · 앱이 띄운 로그인 창(표시 쿠키) · 홈 화면에 추가해 연 웹앱 · PC · 닫은 뒤 30일. 스토어 심사(앱 안에 스토어·가입 길 없음)는 그대로 지킨다.
 * 아이폰은 App Store 주소가 생기기 전까지 '홈 화면에 추가' 방법으로 안내한다(appstore=false). 첫 그림에는 그리지 않아 서버 그림과 어긋나지 않는다.
 */
const KEY = 'wos_appbar_x';
const HIDE_MS = 30 * 86400_000;
export function AppGetBar({ appstore, base = '' }: { appstore: boolean; base?: string }) {
  const [os, setOs] = useState<null | 'android' | 'ios'>(null);
  useEffect(() => {
    try {
      if (isInApp()) return;
      if (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone) return;
      const x = Number(localStorage.getItem(KEY) ?? 0);
      if (x && Date.now() - x < HIDE_MS) return;
      const ua = navigator.userAgent;
      if (/Android/i.test(ua)) setOs('android'); else if (/iPhone|iPod/i.test(ua)) setOs('ios');
    } catch { /* 저장소를 못 쓰는 브라우저 — 띠 없이 */ }
  }, []);
  if (!os) return null;
  const store = os === 'android' || appstore;
  const close = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* 이번 화면에서만 닫힘 */ } setOs(null); };
  return (
    <div className="flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-3 py-2 text-sm text-ink" role="region" aria-label="앱 안내" data-testid="app-get-bar" data-os={os}>
      <Smartphone className="size-4 shrink-0 text-brand-700" aria-hidden />
      <p className="min-w-0 flex-1 leading-snug">{store ? '앱으로 쓰면 알림을 받습니다' : '홈 화면에 추가하면 앱처럼 씁니다'}</p>
      <a href={`${base}${APP_GET_PATH}`} className="inline-flex min-h-[36px] shrink-0 items-center rounded-input bg-brand-600 px-3 text-sm font-semibold text-white" data-testid="app-get-bar-go">{store ? '앱 받기' : '방법 보기'}</a>
      <button type="button" onClick={close} className="-mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-input text-ink-3 hover:text-ink" aria-label="앱 안내 닫기" data-testid="app-get-bar-close"><X className="size-4" /></button>
    </div>
  );
}
