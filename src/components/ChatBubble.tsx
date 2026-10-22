'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { MessageCircle, Sparkles } from 'lucide-react';
import { api } from '@/components/client';
import { cx } from '@/components/ui';

const KEY = 'wos_chat_bubble'; // '1' = 이 기기에서 켬(설정 › 말풍선 버튼). 대표 10/22(#422): 하단 탭에 '메시지'가 생겨 기본 끔(AI 버튼과 겹쳤음)
const LONG_PRESS = 500;
export const chatBubbleOn = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
export const setChatBubbleOn = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 무시 */ } window.dispatchEvent(new Event('wos-chat-bubble')); };

/**
 * 대표 10/20 16:20 (#106) 휴대폰 오른쪽 아래 말풍선 버튼 — 누르면 메신저 최근 대화방으로(없으면 목록), 안 읽은 수 배지, 길게 누르면 AI 비서(옆 작은 AI 버튼도).
 * 하단 탭 위(safe-area 포함)에 띄우고, 메신저·AI 비서 화면·대화방 안(html[data-chat-room])·키보드가 열렸을 때·알람 띠가 떠 있을 때는 숨긴다. 설정 › 말풍선 버튼에서 끌 수 있음(이 기기).
 */
export function ChatBubble({ unread, ai, alarm }: { unread: number; ai: boolean; alarm: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const [on, setOn] = useState(false);
  const [kb, setKb] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);
  useEffect(() => {
    const sync = () => setOn(chatBubbleOn()); sync();
    window.addEventListener('wos-chat-bubble', sync); window.addEventListener('storage', sync);
    // 키보드가 열리면(보이는 높이가 창보다 150px 넘게 줄면) 숨김
    const vv = window.visualViewport;
    const onVv = () => { if (vv) setKb(window.innerHeight - vv.height > 150); };
    vv?.addEventListener('resize', onVv); onVv();
    return () => { window.removeEventListener('wos-chat-bubble', sync); window.removeEventListener('storage', sync); vv?.removeEventListener('resize', onVv); };
  }, []);
  // 메신저(목록·대화방)·AI 비서 화면에서는 입력창·보내기 버튼을 가리지 않게 숨김
  if (!on || kb || alarm || path.startsWith('/messages') || path.startsWith('/assistant')) return null;
  const openChat = async () => {
    if (busy) return; setBusy(true);
    try {
      // 최근 대화 = 마지막 메시지가 가장 최근인 방(안 읽은 방 우선) → 그 방으로. 방이 없으면 메신저 목록
      const r = await api<{ rooms: { id: string; last_message_at: string | null; unread: number; muted: boolean }[] }>('/api/chat/rooms');
      const rooms = [...(r.rooms ?? [])].sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || (Date.parse(b.last_message_at ?? '') || 0) - (Date.parse(a.last_message_at ?? '') || 0));
      router.push(rooms[0] ? `/messages?room=${rooms[0].id}` : '/messages');
    } catch { router.push('/messages'); } finally { setBusy(false); }
  };
  const start = () => { longFired.current = false; if (!ai) return; timer.current = setTimeout(() => { longFired.current = true; try { navigator.vibrate?.(15); } catch { /* 무시 */ } router.push('/assistant'); }, LONG_PRESS); };
  const end = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  return (
    <div className="fixed right-4 z-[39] flex flex-col items-end gap-2 sm:hidden [[data-chat-room]_&]:hidden" style={{ bottom: 'calc(52px + var(--sab) + 14px)' }} data-testid="chat-bubble-wrap">
      {ai && <button type="button" onClick={() => router.push('/assistant')} aria-label="AI 비서" data-testid="chat-bubble-ai"
        className="flex size-9 items-center justify-center rounded-full border border-line bg-white text-violet-700 shadow-card active:scale-95"><Sparkles className="size-4" /></button>}
      <button type="button" onClick={() => { if (longFired.current) return; openChat(); }} onTouchStart={start} onTouchEnd={end} onTouchCancel={end} onMouseDown={start} onMouseUp={end} onMouseLeave={end}
        onContextMenu={(e) => e.preventDefault()} aria-label={`메신저${unread ? ` · 안 읽음 ${unread}` : ''}${ai ? ' (길게 누르면 AI 비서)' : ''}`} data-testid="chat-bubble"
        className={cx('relative flex size-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg active:scale-95', busy && 'opacity-70')}>
        <MessageCircle className="size-7" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[20px] rounded-full bg-red-500 px-1.5 text-center text-[11px] font-bold leading-5 ring-2 ring-white" data-testid="chat-bubble-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
    </div>
  );
}

/** 설정 › 말풍선 버튼 (휴대폰, 이 기기) */
export function ChatBubbleToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => { setOn(chatBubbleOn()); }, []);
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" role="switch" className="mt-0.5 size-4" checked={on} aria-label="말풍선 버튼" data-testid="chat-bubble-toggle" onChange={(e) => { setOn(e.target.checked); setChatBubbleOn(e.target.checked); }} />
      <span><b className="font-semibold">말풍선 버튼 (휴대폰, 이 기기)</b><span className="block text-xs text-ink-2">오른쪽 아래 말풍선을 누르면 최근 대화방으로 바로 갑니다. 안 읽은 메시지 수가 붙고, 길게 누르면 AI 비서. 대화방 안·키보드가 열렸을 때·알람 띠가 떠 있을 때는 숨겨집니다.</span></span>
    </label>
  );
}
