'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AlarmClock, X } from 'lucide-react';
import { api } from '@/components/client';
import { cx, toast } from '@/components/ui';

/** 로컬 10/20(대표): 웹은 전체 화면 알람이 없어 — 알람처럼 울리는 알림(일정·마감)이 오면 화면 맨 위 고정 띠 + 반복 소리, [해제][10분 뒤][열기] */
export type AlarmItem = { id: string; type: string; title: string; body: string | null; link: string; actions: { id: string; label: string }[] };

export function AlarmBar({ items, onChange }: { items: AlarmItem[]; onChange: (id: string) => void }) {
  const [muted, setMuted] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  // 소리: 1초마다 삐-삐(웹 오디오, 파일 없이). 사용자가 끄거나 알람이 없어지면 멈춤. 처음 사용자 동작 전엔 브라우저가 소리를 막을 수 있어 실패는 조용히
  useEffect(() => {
    if (!items.length || muted) return;
    let alive = true;
    const beep = () => {
      try {
        ctx.current ??= new (window.AudioContext || (window as any).webkitAudioContext)();
        const c = ctx.current; if (c.state === 'suspended') void c.resume();
        for (const [t0, f] of [[0, 880], [0.18, 1175]] as const) {
          const o = c.createOscillator(), g = c.createGain();
          o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, c.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.25, c.currentTime + t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + 0.15);
          o.connect(g).connect(c.destination); o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + 0.16);
        }
      } catch { /* 소리 못 냄 */ }
    };
    beep();
    const t = setInterval(() => alive && beep(), 1500);
    return () => { alive = false; clearInterval(t); };
  }, [items.length, muted]);
  if (!items.length) return null;
  async function act(n: AlarmItem, action: string) {
    setBusy(n.id + action);
    try { await api(`/api/notifications/${n.id}/action`, { body: { action } }); toast.ok(action === 'snooze' ? '10분 뒤 다시 알립니다' : '알람을 해제했습니다'); } catch (e: any) { toast.error(e.message); }
    finally { setBusy(null); onChange(n.id); }
  }
  return (
    <div className="sticky top-0 z-[60] border-b-2 border-red-500 bg-red-50 px-3 py-2 text-sm shadow-sm sm:px-6" role="alert" aria-live="assertive" data-testid="alarm-bar">
      {items.map((n) => (
        <div key={n.id} className="flex flex-wrap items-center gap-2 py-1" data-testid="alarm-item">
          <AlarmClock className="size-5 shrink-0 animate-pulse text-red-600" aria-hidden />
          <div className="min-w-0 flex-1"><b className="block truncate text-red-900">{n.title}</b>{n.body && <span className="block truncate text-xs text-red-800/80">{n.body}</span>}</div>
          <div className="flex shrink-0 gap-1.5">
            <button type="button" onClick={() => act(n, 'dismiss')} disabled={busy === n.id + 'dismiss'} className="min-h-[36px] rounded-input bg-red-600 px-3 text-sm font-semibold text-white active:bg-red-700" data-testid="alarm-dismiss">해제</button>
            <button type="button" onClick={() => act(n, 'snooze')} disabled={busy === n.id + 'snooze'} className="min-h-[36px] rounded-input border border-red-300 bg-white px-3 text-sm font-medium text-red-800" data-testid="alarm-snooze">10분 뒤</button>
            <Link href={n.link} onClick={() => { setMuted(true); }} className="inline-flex min-h-[36px] items-center rounded-input border border-red-300 bg-white px-3 text-sm font-medium text-red-800" data-testid="alarm-open">열기</Link>
          </div>
        </div>))}
      <button type="button" onClick={() => setMuted(!muted)} className={cx('absolute right-1 top-1 rounded-full p-1 text-[11px] text-red-700', muted && 'line-through')} aria-label={muted ? '소리 켜기' : '소리 끄기'} data-testid="alarm-mute"><X className="size-3.5" aria-hidden /></button>
    </div>
  );
}
