'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/** 앱 소셜 로그인: 시스템 브라우저에서 로그인이 끝나면 앱으로 돌려보낸다(workos://). 자동으로 안 열리면 버튼 */
function Back() {
  const sp = useSearchParams();
  const url = `workos://open/auth/app?${sp.toString()}`;
  const [tried, setTried] = useState(false);
  useEffect(() => { location.href = url; const t = setTimeout(() => setTried(true), 1200); return () => clearTimeout(t); }, [url]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-lg font-bold">워크인 앱으로 돌아갑니다</p>
      <p className="text-sm text-ink-2">{sp.get('error') ?? '로그인을 마쳤습니다.'}</p>
      <a href={url} className="inline-flex h-11 w-full items-center justify-center rounded-input bg-brand-600 font-semibold text-white" data-testid="app-return">워크인 앱으로 돌아가기</a>
      {tried && <p className="text-xs text-ink-3">앱이 열리지 않으면 이 창을 닫고 앱에서 다시 시도해 주세요.</p>}
    </main>
  );
}
export default function Page() { return <Suspense><Back /></Suspense>; }
