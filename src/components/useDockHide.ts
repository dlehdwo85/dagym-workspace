'use client';
import { useEffect, useState } from 'react';

/**
 * 로컬 검수 10/19: PC 오른쪽 아래 떠 있는 메신저·AI 버튼이 스크롤 중 목록 줄(마감일 칩)을 가림 →
 * 아래로 스크롤하는 동안 숨기고, 위로 올리거나 맨 아래 근처·맨 위에서는 다시 보임.
 */
export function useDockHide() {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const on = () => {
      const y = window.scrollY;
      const nearEnd = window.innerHeight + y >= document.documentElement.scrollHeight - 120;
      if (y < 80 || nearEnd || y < last - 4) setHidden(false);
      else if (y > last + 4) setHidden(true);
      last = y;
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return hidden;
}

/** 숨길 때 버튼에 붙일 클래스(아래로 내려가며 사라짐, 눌림 막음) */
export const dockHideCls = (hidden: boolean) => (hidden ? 'pointer-events-none translate-y-20 opacity-0' : 'translate-y-0 opacity-100');
