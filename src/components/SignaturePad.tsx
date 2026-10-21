'use client';
// #116 전자계약서 서명 칸: 손가락·마우스로 그리기 또는 도장 이미지 올리기 → PNG data URL
import { useEffect, useRef, useState } from 'react';
import { Eraser, Stamp } from 'lucide-react';
import { cx } from './ui';

export function SignaturePad({ onChange, className }: { onChange: (png: string | null, method: 'draw' | 'stamp') => void; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'draw' | 'stamp'>('draw');
  const [has, setHas] = useState(false);
  const drawing = useRef(false); const last = useRef<{ x: number; y: number } | null>(null);
  const size = () => { const c = ref.current!; const r = c.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); if (c.width !== Math.round(r.width * dpr)) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); } return dpr; };
  useEffect(() => { size(); }, []);
  const pos = (e: React.PointerEvent) => { const c = ref.current!; const r = c.getBoundingClientRect(); const dpr = c.width / r.width; return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr }; };
  const emit = () => { const c = ref.current!; onChange(c.toDataURL('image/png'), mode); };
  const down = (e: React.PointerEvent) => { if (mode !== 'draw') return; e.preventDefault(); drawing.current = true; last.current = pos(e); (e.target as Element).setPointerCapture?.(e.pointerId); };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return; e.preventDefault();
    const c = ref.current!; const g = c.getContext('2d')!; const p = pos(e); const dpr = c.width / c.getBoundingClientRect().width;
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#111827'; g.lineWidth = 2.2 * dpr;
    g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke(); last.current = p; if (!has) setHas(true);
  };
  const up = () => { if (!drawing.current) return; drawing.current = false; last.current = null; emit(); };
  const clear = () => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); setHas(false); onChange(null, mode); };
  const stamp = (file: File) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = ref.current!; size(); const g = c.getContext('2d')!; g.clearRect(0, 0, c.width, c.height);
      const sc = Math.min((c.width * 0.6) / img.width, (c.height * 0.9) / img.height); const w = img.width * sc, h = img.height * sc;
      g.drawImage(img, (c.width - w) / 2, (c.height - h) / 2, w, h); URL.revokeObjectURL(url); setHas(true); setMode('stamp'); onChange(c.toDataURL('image/png'), 'stamp');
    };
    img.src = url;
  };
  return (
    <div className={cx('space-y-1.5', className)} data-testid="signature-pad">
      <div className="flex items-center gap-2 text-xs">
        <button type="button" onClick={() => { setMode('draw'); clear(); }} className={cx('rounded-full border px-2.5 py-1', mode === 'draw' ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line text-ink-2')} data-testid="sig-draw">직접 그리기</button>
        <label className={cx('inline-flex cursor-pointer items-center gap-1 rounded-full border px-2.5 py-1', mode === 'stamp' ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line text-ink-2')}><Stamp className="size-3.5" />도장 이미지<input type="file" accept="image/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) stamp(f); e.target.value = ''; }} data-testid="sig-stamp" /></label>
        <button type="button" onClick={clear} className="ml-auto inline-flex items-center gap-1 text-ink-3 hover:text-ink" data-testid="sig-clear"><Eraser className="size-3.5" />지우기</button>
      </div>
      <div className="relative">
        <canvas ref={ref} className="h-40 w-full touch-none rounded-input border-2 border-dashed border-slate-300 bg-white" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} data-testid="sig-canvas" aria-label="서명 칸" />
        {!has && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-3">{mode === 'draw' ? '여기에 서명을 그려 주세요' : '도장 이미지를 올려 주세요'}</span>}
      </div>
    </div>
  );
}
