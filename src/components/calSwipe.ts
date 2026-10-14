'use client';
import { useEffect, type RefObject } from 'react';

type Api = { next: () => void; prev: () => void };
/**
 * V14 36번: 캘린더 좌우로 밀어 기간 이동 — 손가락을 따라 화면이 움직이고, 놓으면 슬라이드로 넘어감(짧게 밀면 제자리).
 * - 가로 이동량이 세로보다 확실히 클 때만(세로 스크롤과 충돌 없음), 일정 블록 위에서 시작하거나 꾹 누른 뒤(블록 끌기·시간 선택)는 무시
 * - PC: 트랙패드 가로 스크롤로 이전/다음
 */
export function useCalendarSwipe(wrap: RefObject<HTMLElement | null>, api: () => Api | null | undefined, enabled: boolean) {
  useEffect(() => {
    const root = wrap.current;
    if (!root) return;
    const pane = () => root.querySelector<HTMLElement>('.fc-view-harness');
    let st: { x: number; y: number; t: number; lock: 'x' | 'y' | null; w: number } | null = null;
    let busy = false;
    const set = (el: HTMLElement, x: number, ms = 0) => { el.style.transition = ms ? `transform ${ms}ms ease-out` : 'none'; el.style.transform = x ? `translateX(${x}px)` : ''; };
    const slide = (dir: 1 | -1) => { // dir 1 = 다음(왼쪽으로 밀기)
      const el = pane(); const a = api(); if (!el || !a) return;
      busy = true;
      const w = el.offsetWidth;
      set(el, -dir * w, 200);
      setTimeout(() => {
        if (dir === 1) a.next(); else a.prev();
        const el2 = pane(); if (!el2) { busy = false; return; }
        set(el2, dir * w * 0.6); void el2.offsetWidth; // 반대쪽에서 들어오기
        set(el2, 0, 220);
        setTimeout(() => { el2.style.transition = ''; busy = false; }, 240);
      }, 200);
    };
    const start = (e: TouchEvent) => {
      if (!enabled || busy || e.touches.length !== 1) { st = null; return; }
      const t = e.target as HTMLElement;
      if (t.closest('.fc-event, .fc-event-mirror, input, select, textarea, button, a')) { st = null; return; }
      st = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), lock: null, w: root.offsetWidth };
    };
    const move = (e: TouchEvent) => {
      if (!st || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - st.x, dy = e.touches[0].clientY - st.y;
      if (!st.lock) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // 꾹 누른 뒤 움직이면(시간 선택·블록 끌기) 넘기지 않음
        st.lock = Date.now() - st.t < 350 && Math.abs(dx) > Math.abs(dy) * 1.3 ? 'x' : 'y';
        if (root.querySelector('.fc-event-mirror, .fc-event-dragging')) st.lock = 'y';
      }
      if (st.lock !== 'x') return;
      e.preventDefault(); // 가로로 미는 동안은 세로 스크롤·브라우저 뒤로가기 제스처 막음
      const el = pane(); if (el) set(el, dx);
    };
    const end = (e: TouchEvent) => {
      const s = st; st = null;
      if (!s || s.lock !== 'x') return;
      const dx = (e.changedTouches[0]?.clientX ?? s.x) - s.x;
      const fast = Math.abs(dx) / Math.max(1, Date.now() - s.t) > 0.5 && Math.abs(dx) > 40;
      if (Math.abs(dx) > s.w * 0.22 || fast) slide(dx < 0 ? 1 : -1);
      else { const el = pane(); if (el) { set(el, 0, 180); setTimeout(() => { el.style.transition = ''; }, 200); } }
    };
    let acc = 0, cool = 0, reset: ReturnType<typeof setTimeout> | undefined;
    const wheel = (e: WheelEvent) => {
      if (enabled || Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Date.now() < cool) return;
      e.preventDefault();
      acc += e.deltaX; clearTimeout(reset); reset = setTimeout(() => { acc = 0; }, 250);
      if (Math.abs(acc) > 120) { const a = api(); if (a) { if (acc > 0) a.next(); else a.prev(); } acc = 0; cool = Date.now() + 700; }
    };
    root.addEventListener('touchstart', start, { passive: true });
    root.addEventListener('touchmove', move, { passive: false });
    root.addEventListener('touchend', end);
    root.addEventListener('touchcancel', () => { st = null; const el = pane(); if (el) set(el, 0); });
    root.addEventListener('wheel', wheel, { passive: false });
    return () => {
      root.removeEventListener('touchstart', start); root.removeEventListener('touchmove', move); root.removeEventListener('touchend', end);
      root.removeEventListener('wheel', wheel); clearTimeout(reset);
    };
  }, [wrap, api, enabled]);
}
