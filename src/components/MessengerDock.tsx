'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Maximize2, MessageCircle, X } from 'lucide-react';
import { useApi } from './client';
import { ChatRoom, RoomList, useLive } from './messenger/Messenger';
import { dockHideCls, useDockHide } from './useDockHide';

/** R-16 2번 · V14 25번: PC 오른쪽 아래 메신저 패널(380×560) — /messages 와 같은 목록·대화방 컴포넌트, 목록↔방 전환, 크게 보기. 휴대폰은 하단 탭의 메시지로 */
export function MessengerDock({ aiOpen }: { aiOpen: boolean }) {
  const dockHidden = useDockHide();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<string | null>(null);
  const unread = useApi<{ unread: number }>('/api/chat/unread');
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState !== 'hidden') unread.reload(); }, 60000); return () => clearInterval(t); }, [unread]); // 10/21: 30초 → 60초, 가려진 탭 제외
  if (path.startsWith('/messages') || path.startsWith('/assistant')) return null; // 메시지·AI 비서 화면은 아래 오른쪽에 보내기 버튼이 있어 겹치지 않게
  const n = unread.data?.unread ?? 0;
  const expand = () => { setOpen(false); router.push(room ? `/messages?room=${room}` : '/messages'); };
  return (
    <>
      {!open && !aiOpen && (
        <button onClick={() => setOpen(true)} aria-label={`메신저 열기${n ? ` (안 읽은 ${n})` : ''}`} data-testid="msg-dock-open"
          className={`fixed bottom-6 right-[5.5rem] z-40 hidden size-12 items-center justify-center rounded-full bg-teal-700 text-white shadow-pop transition-[transform,opacity] duration-200 hover:bg-teal-800 sm:flex ${dockHideCls(dockHidden)}`}>
          <MessageCircle className="size-6" />
          {n > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[11px] font-bold leading-5 text-white" data-testid="msg-dock-badge">{n > 99 ? '99+' : n}</span>}
        </button>
      )}
      {open && <DockPanel room={room} setRoom={setRoom} onClose={() => { setOpen(false); setRoom(null); unread.reload(); }} onExpand={expand} onRead={unread.reload} />}
    </>
  );
}

function DockPanel({ room, setRoom, onClose, onExpand, onRead }: { room: string | null; setRoom: (id: string | null) => void; onClose: () => void; onExpand: () => void; onRead: () => void }) {
  const live = useLive();
  return (
    <section role="dialog" aria-label="메신저" data-testid="msg-dock"
      className="fixed bottom-6 right-6 z-50 hidden h-[560px] w-[380px] flex-col overflow-hidden rounded-card border border-line bg-white shadow-pop sm:flex">
      {room ? (
        <ChatRoom key={room} id={room} live={live} onRead={onRead} onBack={() => setRoom(null)} compact backAlways onExpand={onExpand} onClose={onClose} />
      ) : (
        <>
          <header className="flex items-center gap-1.5 border-b border-line px-3 py-2">
            <MessageCircle className="size-4 text-teal-700" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">메신저</span>
            <button onClick={onExpand} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="크게 보기" title="크게 보기"><Maximize2 className="size-4" /></button>
            <button onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="닫기"><X className="size-4" /></button>
          </header>
          <RoomList onOpen={setRoom} live={live} compact />
        </>
      )}
    </section>
  );
}
