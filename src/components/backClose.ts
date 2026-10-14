'use client';
import { useEffect, useRef } from 'react';

/**
 * V14 39번: 뒤로가기 = 직전 화면.
 * - useBackClose: 화면 안에서 여는 상세(오버레이·패널)는 history 에 한 칸 쌓는다 → 브라우저·앱 뒤로가기는 오버레이만 닫고 화면(캘린더 날짜·보기·스크롤)은 그대로.
 *   버튼으로 닫으면 쌓은 칸을 되돌린다(뒤로가기 두 번 누를 필요 없게).
 * - useSheetBack: 모달·시트는 앱 하드웨어 뒤로 버튼이 먼저 닫는다(시트 → history → 홈 순서, native.ts).
 */
export function useBackClose(open: boolean, onClose: () => void) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = Math.random().toString(36).slice(2);
    window.history.pushState({ ...(window.history.state ?? {}), __overlay: id }, '');
    let popped = false;
    const onPop = () => {
      if (window.history.state?.__overlay === id) return;
      popped = true;
      close.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // 버튼으로 닫음: 아직 우리 칸 위에 있으면 한 칸 되돌림 (다른 화면으로 이동해 닫힌 경우는 그대로)
      if (!popped && window.history.state?.__overlay === id) window.history.back();
    };
  }, [open]);
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
