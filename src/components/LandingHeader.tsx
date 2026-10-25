import Link from 'next/link';

/** 소개 사이트 공통 머리줄(#627: 키워드 소개 페이지 /landing/* 도 같은 머리). home = 홈이면 같은 화면 안 구역으로, 아니면 홈의 구역으로 */
export function LandingHeader({ home = false }: { home?: boolean }) {
  const to = (hash: string) => (home ? `#${hash}` : `/#${hash}`);
  return (
    <header className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
      <Link href="/" aria-label="워크인"><img src="/brand/lockup-light.svg" alt="WorkIn 워크인" className="h-8 w-auto" width={160} height={48} /></Link>
      <nav className="ml-auto flex items-center gap-1.5 text-sm">
        <a href={to('spaces')} className="hidden px-2 text-ink-2 hover:text-ink sm:inline">기능</a>
        <a href={to('pricing')} className="hidden px-2 text-ink-2 hover:text-ink sm:inline">요금</a>
        <a href={to('contact')} className="hidden px-2 text-ink-2 hover:text-ink sm:inline">문의</a>
        <Link href="/login" className="rounded-input px-3 py-2 font-semibold text-ink-2 hover:bg-slate-100" data-testid="landing-login">로그인</Link>
        <Link href="/signup" className="rounded-input bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-700" data-track="start-top">무료로 시작</Link>
      </nav>
    </header>
  );
}
