'use client';
import { useRef } from 'react';

/**
 * V3 7번: 행·카드 아무 곳이나 눌러 상세 열기. 동그라미·칩·버튼·링크·입력, 칩에서 연 선택 창(포털)은 제외.
 * 0.4초 넘게 누른 뒤(꾹 눌러 순서 끌기)나 6px 넘게 움직인 뒤(밀기·끌기)의 클릭, 글자 선택 중에는 열지 않는다.
 */
const NO_OPEN = 'button, a, input, select, textarea, label, [role=dialog], [role=menu], [data-no-open]';
export function useRowOpen(id: string, open: (id: string) => void) {
  const down = useRef<{ x: number; y: number; at: number } | null>(null);
  return {
    onPointerDownCapture: (e: React.PointerEvent<HTMLElement>) => { down.current = { x: e.clientX, y: e.clientY, at: Date.now() }; },
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      const t = e.target as HTMLElement;
      const hit = t.closest(NO_OPEN);
      if (!e.currentTarget.contains(t) || (hit && e.currentTarget.contains(hit))) return; // 칩·버튼, 또는 포털로 뜬 선택 창
      const d = down.current; down.current = null;
      if (d && (Date.now() - d.at > 400 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6)) return;
      if (window.getSelection()?.toString()) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey) { window.open(`/tasks/${id}`, '_blank'); return; }
      open(id);
    },
  };
}
