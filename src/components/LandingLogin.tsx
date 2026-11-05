'use client';
import { useEffect, useState } from 'react';
import { SIGNED_MARK } from '@/lib/hostSplit';

/**
 * 362차 #978(대표 승인, 주소 분리 A안): 소개 사이트 머리줄 오른쪽 — 처음엔 [로그인](app./login),
 * 이 브라우저에서 로그인한 적이 있으면(표시 쿠키 wi_signed=1, 값 없이 '로그인함'만) 같은 자리에 [내 업무로 가기](app./).
 * 쿠키는 화면이 뜬 뒤에 읽는다(소개 화면은 미리 만들어 두는 페이지라 서버에서 사람마다 다르게 그리지 않음).
 */
export function LandingLogin({ app }: { app: string }) {
  const [signed, setSigned] = useState(false);
  useEffect(() => { try { setSigned(new RegExp(`(?:^|;\\s*)${SIGNED_MARK}=1(?:;|$)`).test(document.cookie)); } catch { /* 쿠키 막힘 → 로그인 */ } }, []);
  const cls = 'rounded-input px-3 py-2 font-semibold text-ink-2 hover:bg-slate-100';
  return signed
    ? <a href={`${app}/`} className={cls} data-testid="landing-app">내 업무로 가기</a>
    : <a href={`${app}/login`} className={cls} data-testid="landing-login">로그인</a>;
}
