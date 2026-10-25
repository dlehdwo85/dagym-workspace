'use client';
import { useEffect } from 'react';

/**
 * 149차(#599 시뮬레이션에서 발견): 실행 애니메이션 덮개(#wos-intro)는 서버 HTML 의 작은 스크립트가 재생(wi-play) 뒤 1.3초에 스스로 지운다.
 * 그런데 React 가 덮개를 다시 그리면(수화 오류 #418 복구·router.refresh 로 레이아웃 다시 받기) innerHTML 로 놓여 스크립트가 돌지 않아
 * 영영 안 걷혔다(새 회사 첫 로그인·온보딩 끝난 직후 = 흰 화면 + 로고). 마운트 때 재생 표시가 없으면 스크립트가 안 돈 것이니 바로 지우고,
 * 재생 중이면 1.6초 뒤 남아 있을 때만 지운다(마운트는 늘 HTML 파싱보다 뒤). 안전장치일 뿐 보이는 동작은 그대로.
 */
export function IntroGuard() {
  useEffect(() => {
    const done = () => { document.documentElement.classList.add('wi-done'); document.getElementById('wos-intro')?.remove(); }; // html.wi-done = 다시 그려 넣어도 CSS 로 안 보임
    const e = document.getElementById('wos-intro');
    if (document.documentElement.classList.contains('wi-done') || (e && !e.classList.contains('wi-play'))) { done(); return; }
    const t = setTimeout(done, 1600);
    return () => clearTimeout(t);
  }, []);
  return null;
}
