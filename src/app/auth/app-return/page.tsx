'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * 앱 소셜 로그인: 시스템 브라우저에서 로그인이 끝나면 앱으로 돌려보낸다(workos://). 단추는 처음부터 보임.
 * #1107: 안드로이드는 intent://(패키지 지정)가 더 확실히 앱을 엶 — 보통은 콜백이 바로 intent 로 넘기고, 이 화면은 그게 안 됐을 때의 대체 화면
 */
const ANDROID_APP_ID = 'kr.co.dagym.workos';
function Back() {
  const sp = useSearchParams();
  const q = sp.toString();
  const [url, setUrl] = useState(`workos://open/auth/app?${q}`);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    const u = /Android/i.test(navigator.userAgent) ? `intent://open/auth/app?${q}#Intent;scheme=workos;package=${ANDROID_APP_ID};end` : `workos://open/auth/app?${q}`;
    setUrl(u); location.href = u;
    const t = setTimeout(() => setTried(true), 1200); return () => clearTimeout(t);
  }, [q]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-bold">워크인 앱으로 돌아갑니다</p>
      <p className="text-sm text-ink-2">{sp.get('error') ?? '로그인을 마쳤습니다.'}</p>
      <a href={url} className="inline-flex h-12 w-full items-center justify-center rounded-input bg-brand-600 text-base font-semibold text-white" data-testid="app-return">워크인 앱으로 돌아가기</a>
      {tried && <p className="text-xs text-ink-3">앱이 열리지 않으면 이 단추를 누르거나, 이 창을 닫고 앱에서 다시 시도해 주세요.</p>}
    </main>
  );
}
export default function Page() { return <Suspense><Back /></Suspense>; }
