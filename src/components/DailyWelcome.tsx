'use client';
import { useEffect, useState } from 'react';
import { todayStr } from './ui';

/**
 * #483(대표 10/23 "웹·앱 진입 환영 문구 — 가볍게"): 하루 첫 진입에 0.8초만 보이는 인사 한 줄(S3 로고 + 시간대 인사 + 이름 + 오늘 날짜).
 * - 사람·기기마다 하루 1번(localStorage wos_welcome_<user> = 오늘 날짜, Asia/Seoul) · 실행 애니메이션(#443)이 끝난 뒤 시작 · 화면 조작을 막지 않음(pointer-events: none)
 * - 동작 줄이기(prefers-reduced-motion)면 움직임 없이 나타났다 사라짐(motion-reduce) · 저장소를 못 쓰는 브라우저(시크릿 등)는 아예 안 보임(매번 뜨지 않게)
 */
const greet = (hour: number) => (hour >= 5 && hour < 12 ? '좋은 아침입니다' : hour >= 12 && hour < 18 ? '좋은 오후입니다' : '좋은 저녁입니다');
const SHOW_MS = 800, FADE_MS = 300;

export function DailyWelcome({ userId, name }: { userId: string; name: string }) {
  const [state, setState] = useState<'hidden' | 'in' | 'out'>('hidden');
  const [line, setLine] = useState<{ hello: string; date: string } | null>(null);
  useEffect(() => {
    const today = todayStr();
    const key = `wos_welcome_${userId}`;
    try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch { return; }
    const now = new Date();
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(now)) % 24;
    setLine({ hello: greet(hour), date: new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(now) });
    let t: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      // #443 실행 애니메이션이 아직 그려지는 중이면 끝난 뒤에(겹치지 않게)
      if (document.getElementById('wos-intro') && !document.documentElement.classList.contains('wi-done')) { t = setTimeout(start, 150); return; }
      setState('in');
      t = setTimeout(() => { setState('out'); t = setTimeout(() => setState('hidden'), FADE_MS); }, SHOW_MS);
    };
    t = setTimeout(start, 50);
    return () => { if (t) clearTimeout(t); };
  }, [userId]);
  if (state === 'hidden' || !line) return null;
  return (
    <div role="status" aria-live="polite" data-testid="daily-welcome" data-state={state} style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      className={`pointer-events-none fixed inset-x-0 z-[80] flex justify-center px-4 transition-opacity duration-300 motion-reduce:transition-none${state === 'out' ? ' opacity-0' : ''}`}>
      <style>{'@keyframes wosWelcomePop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.08);opacity:1}100%{transform:scale(1)}}'}</style>
      <div className="flex max-w-full items-center gap-3 rounded-full border border-line bg-white/95 py-2 pl-2.5 pr-4 shadow-pop backdrop-blur animate-fade-up motion-reduce:animate-none">
        <img src="/icon.svg" alt="" width={32} height={32} className="size-8 shrink-0 animate-[wosWelcomePop_.44s_cubic-bezier(.34,1.56,.64,1)_both] motion-reduce:animate-none" data-testid="daily-welcome-icon" />
        <div className="min-w-0 leading-tight"><div className="truncate text-sm font-semibold text-ink">{line.hello}, {name}님</div><div className="text-[11px] text-ink-3">{line.date}</div></div>
      </div>
    </div>
  );
}
