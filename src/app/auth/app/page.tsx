'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { closeSystemBrowser, takeOAuthVerifier } from '@/components/native';

/** 앱 WebView 에서: 시스템 브라우저 로그인 결과(1회용 표) → 세션 → 홈. 처음 가입이면 회사 만들기, 오류면 로그인 화면 */
function Finish() {
  const sp = useSearchParams(); const router = useRouter();
  const [msg, setMsg] = useState('로그인하는 중…');
  useEffect(() => {
    closeSystemBrowser();
    const t = sp.get('t'), pending = sp.get('pending'), error = sp.get('error');
    if (error) { router.replace(`/login?oauth_error=${encodeURIComponent(error)}`); return; }
    if (pending) { router.replace(`/signup/social?t=${encodeURIComponent(pending)}`); return; }
    if (!t) { router.replace('/login'); return; }
    const v = takeOAuthVerifier();
    fetch('/api/auth/oauth/app-exchange', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t, v: v ?? '' }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j?.error?.message); location.replace(j.mfa ? '/login?mfa=1' : '/'); })
      .catch((e) => { setMsg(e?.message || '로그인하지 못했습니다'); setTimeout(() => router.replace('/login'), 2500); });
  }, [sp, router]);
  return <main className="flex min-h-dvh items-center justify-center p-6 text-sm text-ink-2" data-testid="app-finish">{msg}</main>;
}
export default function Page() { return <Suspense><Finish /></Suspense>; }
