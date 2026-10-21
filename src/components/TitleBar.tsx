'use client';
import { useEffect, useState } from 'react';

/** 대표 10/20 14:10 ⑤ PWA 제목줄(Window Controls Overlay): 설치된 앱(Windows·Chrome/Edge)에서 창 제어 버튼 옆 빈 띠를 앱 제목줄로 — 로고·제목, 끌어서 창 이동. 미지원·브라우저 탭에서는 아무것도 안 그림 */
export function TitleBar({ title }: { title?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const w = (navigator as any).windowControlsOverlay; if (!w) return;
    const apply = () => { const vis = !!w.visible; setOn(vis); const r = vis && typeof w.getTitlebarAreaRect === 'function' ? w.getTitlebarAreaRect() : null;
      document.documentElement.style.setProperty('--wco-h', vis ? `${Math.round(r?.height || 33)}px` : '0px'); document.documentElement.toggleAttribute('data-wco', vis); };
    apply(); w.addEventListener('geometrychange', apply); return () => w.removeEventListener('geometrychange', apply);
  }, []);
  if (!on) return null;
  return (
    <div className="fixed z-[60] flex select-none items-center gap-2 bg-brand-700 px-3 text-xs font-semibold text-white" data-testid="pwa-titlebar"
      style={{ top: 'env(titlebar-area-y, 0px)', left: 'env(titlebar-area-x, 0px)', width: 'env(titlebar-area-width, 100%)', height: 'env(titlebar-area-height, 33px)', WebkitAppRegion: 'drag' } as React.CSSProperties}>
      <img src="/icon.svg" alt="" className="size-4 rounded" /><span className="truncate">워크인{title ? ` · ${title}` : ''}</span>
    </div>
  );
}
