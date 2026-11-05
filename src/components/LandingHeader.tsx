import Link from 'next/link';
import { hostSplit } from '@/lib/hostSplit';
import { LandingLogin } from './LandingLogin';

/** 소개 사이트 공통 머리줄(#627: 키워드 소개 페이지 /landing/* 도 같은 머리). home = 홈이면 같은 화면 안 구역으로, 아니면 홈의 구역으로 */
export function LandingHeader({ home = false }: { home?: boolean }) {
  const to = (hash: string) => (home ? `#${hash}` : `/#${hash}`);
  const h = hostSplit(); const app = h.on ? `https://${h.app}` : ''; // 362차 #978: 주소 분리를 켜면 [로그인]은 app. 로 바로(www → app. 한 번 더 건너지 않게)
  return (
    <header className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
      <Link href="/" aria-label="워크인"><img src="/brand/lockup-light.svg" alt="WorkIn 워크인" className="h-8 w-auto" width={160} height={48} /></Link>
      <nav className="ml-auto flex items-center gap-1.5 text-sm">
        <a href={to('spaces')} className="hidden px-2 text-ink-2 hover:text-ink sm:inline">기능</a>
        <a href={to('pricing')} className="hidden px-2 text-ink-2 hover:text-ink sm:inline">요금</a>
        <a href={to('contact')} className="hidden px-2 text-ink-2 hover:text-ink sm:inline">문의</a>
        <LandingLogin app={app} />
        <Link href="/signup" className="rounded-input bg-brand-600 px-3 py-2 font-semibold text-white hover:bg-brand-700" data-track="start-top">체험 신청</Link>
      </nav>
    </header>
  );
}
