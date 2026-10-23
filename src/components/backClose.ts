'use client';
import { useEffect, useRef } from 'react';

/**
 * V14 39번: 뒤로가기 = 직전 화면.
 * - useBackClose: 화면 안에서 여는 상세(오버레이·패널)는 history 에 한 칸 쌓는다 → 브라우저·앱 뒤로가기는 오버레이만 닫고 화면(캘린더 날짜·보기·스크롤)은 그대로.
 *   버튼으로 닫으면 쌓은 칸을 되돌린다(뒤로가기 두 번 누를 필요 없게).
 * - useSheetBack: 모달·시트는 앱 하드웨어 뒤로 버튼이 먼저 닫는다(시트 → history → 홈 순서, native.ts).
 */
export function useBackClose(open: boolean, onClose: () => void, param?: [string, string]) {
  const close = useRef(onClose); close.current = onClose;
  const [key, val] = param ?? [];
  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    // #535(대표 10/24 '승인 대기 상세 → 뒤로가기 → 마케팅 홈'): param 이 있으면 주소에도 ?key=val 을 남김(새로 고침·공유해도 같은 창)
    // 링크로 바로 들어와 이미 ?key=val 인 창은 기록을 더 쌓지 않음 — 뒤로가기는 들어오기 전 화면, 닫기 단추는 key 만 지움
    const url = new URL(window.location.href);
    const y0 = window.scrollY, path0 = url.pathname; // #535(로컬 10/24 08:23): 닫으면 목록을 연 자리로
    const direct = !!key && url.searchParams.get(key) === val;
    if (!direct) { if (key && val) url.searchParams.set(key, val); window.history.pushState({ ...(window.history.state ?? {}), __overlay: id }, '', key ? url.toString() : undefined); }
    let popped = false;
    const onPop = () => {
      if (!direct && window.history.state?.__overlay === id) return;
      popped = true;
      close.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      keepScroll(y0, path0);
      if (popped) return;
      if (direct) { // 닫기 단추: 주소에서 key 만 지움(기록은 그대로)
        const u = new URL(window.location.href);
        if (key && u.searchParams.get(key) === val) { u.searchParams.delete(key); window.history.replaceState(window.history.state, '', u.toString()); }
        return;
      }
      // 버튼으로 닫음: 아직 우리 칸 위에 있으면 한 칸 되돌림 (다른 화면으로 이동해 닫힌 경우는 그대로)
      if (window.history.state?.__overlay === id) window.history.back();
    };
  }, [open, key, val]);
}

/**
 * #535(로컬 10/24 08:23 '목록을 내린 뒤 상세를 열고 뒤로가기 → 맨 위'): 덮어 연 창을 닫은 뒤 스크롤을 연 자리로 되돌린다.
 * 닫는 동안 화면이 다시 그려지며(라우터 복원·목록 새로 고침) 위치가 바뀌는 경우까지 0.7초쯤 몇 번 맞춤 — 사람이 그사이 스크롤하거나 다른 화면으로 가면 멈춤
 */
export function keepScroll(y: number, path = window.location.pathname) {
  if (!(y > 0)) return;
  let n = 0, stop = false;
  const evs = ['wheel', 'touchstart', 'keydown'] as const;
  const user = () => { stop = true; };
  evs.forEach((e) => window.addEventListener(e, user, { passive: true, capture: true }));
  const tick = () => {
    if (stop || window.location.pathname !== path) { evs.forEach((e) => window.removeEventListener(e, user, { capture: true })); return; }
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
    if (++n < 8) setTimeout(tick, n < 3 ? 30 : 110); else evs.forEach((e) => window.removeEventListener(e, user, { capture: true }));
  };
  requestAnimationFrame(tick);
}

const sheets: { id: number; close: () => void }[] = [];
let seq = 0;
export function useSheetBack(open: boolean, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = ++seq;
    sheets.push({ id, close: () => close.current() });
    return () => { const i = sheets.findIndex((s) => s.id === id); if (i >= 0) sheets.splice(i, 1); };
  }, [open]);
}
/** 앱 뒤로 버튼: 열린 시트가 있으면 맨 위 것을 닫고 true */
export function closeTopSheet() {
  const top = sheets.pop();
  if (!top) return false;
  top.close();
  return true;
}
