'use client';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { holdScreen } from './awake';

const MAX_WAIT_MS = 20 * 60_000;

/**
 * 대표 10/27(아이폰에서 사진 147장 '안 보내짐'): 아이폰은 사진을 많이 고르면 [추가]를 누른 뒤 휴대폰이 사진을 넘겨줄 준비를 하는 동안
 * (애플 쪽 문제 — 60장에 2분 남짓, 장수에 비례) 화면에 아무 표시가 없어 멈춘 것처럼 보인다.
 * 고르기 창을 열 때 '준비 중' 띠를 깔아 두고(창에 가려 있다가 [추가]를 누르면 보임) 파일이 들어오면(stop) 진행 표시로 넘기고,
 * 고르기를 취소하면(input 'cancel', iOS 16.4+·Chrome 113+) 걷는다. 그동안 화면이 꺼지지 않게 잡는다(꺼지면 앱이 멈춰 준비가 끊길 수 있음).
 * 쓰는 쪽: const pick = usePickWait(); 단추 = pick.open(inputRef) · onChange 맨 앞 pick.stop() · 화면에 {pick.node}
 */
export function usePickWait() {
  const [on, setOn] = useState(false);
  const [since, setSince] = useState(0); const [, tick] = useState(0); // 지난 시간(멈춘 게 아님을 보이게)
  const hold = useRef<Promise<() => void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    setOn(false);
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const h = hold.current; hold.current = null; h?.then((release) => release());
  }, []);
  const open = useCallback((ref: RefObject<HTMLInputElement | null>) => {
    if (!ref.current) return;
    setOn(true); setSince(Date.now());
    hold.current ??= holdScreen();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(stop, MAX_WAIT_MS);
    ref.current.addEventListener('cancel', stop, { once: true });
    ref.current.click();
  }, [stop]);
  useEffect(() => stop, [stop]); // 화면을 떠나면 놓음
  useEffect(() => { if (!on) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [on]);
  const sec = on && since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0;
  const node = on ? (
    <div className="flex items-start gap-2 rounded-input border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900" role="status" data-testid="pick-wait">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
      <p className="min-w-0 flex-1"><b>고른 사진을 휴대폰이 준비하는 중입니다.</b> 사진이 많으면 몇 분 걸릴 수 있으니 앱을 닫지 말고 기다려 주세요 — 준비가 끝나면 바로 올라가기 시작합니다.</p>
      <span className="shrink-0 tabular-nums text-sky-700" data-testid="pick-wait-time">{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, '0')}</span>
      <button type="button" className="shrink-0 underline" onClick={stop} data-testid="pick-wait-close">닫기</button>
    </div>
  ) : null;
  return { open, stop, node, on };
}
