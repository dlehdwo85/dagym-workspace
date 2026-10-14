'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

const BUILD = process.env.NEXT_PUBLIC_BUILD_COMMIT ?? '';
/** 입력 중인지(입력칸에 글자가 있거나 초점이 있으면 자동 새로고침하지 않는다) */
const typing = () => {
  const el = document.activeElement as HTMLElement | null;
  if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return true;
  return [...document.querySelectorAll<HTMLTextAreaElement>('textarea')].some((x) => x.value.trim());
};

/**
 * V14 21번: 오래 열어 둔 창(PC 설치 앱·휴대폰 앱 WebView 포함)이 옛 화면을 쓰지 않게.
 * 5분마다·창으로 돌아올 때 서버 커밋과 비교 → 다르면 "새 버전" 띠, 입력 중이 아니면 다음 화면 이동 때 자동 새로고침. 서비스 워커도 갱신 확인.
 */
export function VersionWatch() {
  const [stale, setStale] = useState(false);
  const path = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (!BUILD) return; // 개발·시험 빌드(커밋 없음)는 건너뜀
    const check = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        const j = await r.json();
        if (j?.commit && j.commit !== BUILD) setStale(true);
        navigator.serviceWorker?.getRegistration().then((g) => g?.update()).catch(() => {});
      } catch {}
    };
    const t = setInterval(check, 5 * 60 * 1000);
    const vis = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('focus', check); document.addEventListener('visibilitychange', vis);
    check();
    return () => { clearInterval(t); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', vis); };
  }, []);
  // 화면 이동 때 자동 새로고침(입력 중이면 띠만)
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (stale && !typing()) location.reload();
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!stale) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-brand-700 px-3 py-1.5 pt-[calc(var(--sat)+0.375rem)] text-sm text-white shadow-pop" data-testid="new-version">
      새 버전이 있어요
      <button onClick={() => location.reload()} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-0.5 font-semibold hover:bg-white/25"><RefreshCw className="size-3.5" />새로고침</button>
    </div>
  );
}
