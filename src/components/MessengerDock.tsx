'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowLeft, Maximize2, MessageCircle, Send, X } from 'lucide-react';
import { api, useApi } from './client';
import { Button, cx, inputCls, toast } from './ui';

type Room = { id: string; kind: string; name: string | null; unread: number; muted: boolean; last_body: string | null; last_file: string | null; last_author: string | null; last_message_at: string | null };
type Msg = { id: string; author_name: string | null; body: string; deleted: boolean; file_name: string | null; mine: boolean; created_at: string };
const clean = (s: string | null) => (s ?? '').replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1');

/** R-16 2번: PC 오른쪽 아래 AI 비서 버튼 옆 메신저 버튼(안 읽은 수) → 작은 패널(최근 대화방·바로 답장). 휴대폰은 하단 탭의 메시지로 */
export function MessengerDock({ aiOpen }: { aiOpen: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const unread = useApi<{ unread: number }>('/api/chat/unread');
  useEffect(() => { const t = setInterval(() => unread.reload(), 30000); return () => clearInterval(t); }, [unread]);
  if (path.startsWith('/messages')) return null;
  const n = unread.data?.unread ?? 0;
  return (
    <>
      {!open && !aiOpen && (
        <button onClick={() => setOpen(true)} aria-label={`메신저 열기${n ? ` (안 읽은 ${n})` : ''}`} data-testid="msg-dock-open"
          className="fixed bottom-6 right-[5.5rem] z-40 hidden size-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-pop hover:bg-brand-700 sm:flex">
          <MessageCircle className="size-6" />
          {n > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-center text-[11px] font-bold leading-5 text-white" data-testid="msg-dock-badge">{n > 99 ? '99+' : n}</span>}
        </button>
      )}
      {open && (
        <section role="dialog" aria-label="메신저" data-testid="msg-dock"
          className="fixed bottom-6 right-6 z-50 hidden h-[520px] w-[360px] flex-col rounded-card border border-line bg-white shadow-pop sm:flex">
          <header className="flex items-center gap-1.5 border-b border-line px-3 py-2">
            {room && <button onClick={() => setRoom(null)} className="inline-flex size-8 items-center justify-center rounded-input hover:bg-slate-100" aria-label="대화방 목록"><ArrowLeft className="size-4" /></button>}
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{room ? room.name ?? '대화' : '메신저'}</span>
            <Link href={room ? `/messages?room=${room.id}` : '/messages'} onClick={() => setOpen(false)} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="메시지 화면으로"><Maximize2 className="size-4" /></Link>
            <button onClick={() => { setOpen(false); setRoom(null); unread.reload(); }} className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" aria-label="닫기"><X className="size-4" /></button>
          </header>
          {room ? <MiniRoom room={room} onRead={() => unread.reload()} /> : <RoomList onPick={setRoom} />}
        </section>
      )}
    </>
  );
}

function RoomList({ onPick }: { onPick: (r: Room) => void }) {
  const { data } = useApi<{ rooms: Room[] }>('/api/chat/rooms');
  return (
    <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto" data-testid="msg-dock-rooms">
      {data?.rooms.slice(0, 30).map((r) => (
        <li key={r.id}><button onClick={() => onPick(r)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{r.name ?? '대화'}</div>
            <div className="truncate text-xs text-ink-3">{r.last_author ? `${r.last_author}: ` : ''}{r.last_file ? `📎 ${r.last_file}` : clean(r.last_body) || '메시지 없음'}</div></div>
          {r.unread > 0 && !r.muted && <span className="rounded-full bg-red-500 px-1.5 text-[11px] font-bold leading-5 text-white">{r.unread}</span>}
        </button></li>
      ))}
      {data && !data.rooms.length && <li className="p-4 text-center text-sm text-ink-3">대화방이 없습니다</li>}
    </ul>
  );
}

function MiniRoom({ room, onRead }: { room: Room; onRead: () => void }) {
  const { data, reload } = useApi<{ messages: Msg[] }>(`/api/chat/rooms/${room.id}`);
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { const t = setInterval(reload, 5000); return () => clearInterval(t); }, [reload]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [data]);
  useEffect(() => { if (data) api(`/api/chat/rooms/${room.id}/read`, { body: {} }).then(onRead).catch(() => {}); }, [data, room.id, onRead]);
  async function send(e: React.FormEvent) {
    e.preventDefault(); const b = text.trim(); if (!b) return;
    setText('');
    try { await api(`/api/chat/rooms/${room.id}/messages`, { body: { body: b } }); reload(); } catch (er: any) { setText(b); toast.error(er.message); }
  }
  return (
    <>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3" data-testid="msg-dock-chat">
        {data?.messages.slice(-40).map((m) => (
          <div key={m.id} className={cx('flex', m.mine ? 'justify-end' : 'justify-start')}>
            <div className={cx('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm', m.mine ? 'bg-brand-600 text-white' : 'bg-slate-100')}>
              {!m.mine && <div className="text-[11px] font-semibold text-ink-2">{m.author_name}</div>}
              {m.deleted ? <i className="opacity-70">삭제된 메시지</i> : m.file_name ? `📎 ${m.file_name}` : clean(m.body)}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <form onSubmit={send} className="flex gap-1.5 border-t border-line p-2">
        <input className={cx(inputCls, 'h-9')} value={text} onChange={(e) => setText(e.target.value)} placeholder="바로 답장" aria-label="바로 답장" data-testid="msg-dock-input" />
        <Button type="submit" disabled={!text.trim()} aria-label="보내기"><Send /></Button>
      </form>
    </>
  );
}
