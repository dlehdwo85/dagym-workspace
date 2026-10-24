'use client';
import { RoleBadge } from '@/components/RoleBadge';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowLeft, AtSign, BarChart3, CalendarPlus, Check, ChevronLeft, ChevronRight, Headphones, MapPin, Mic, Pencil, Play, Bell, BellOff, Camera, Image as ImageIcon, ChevronDown, ChevronUp, CornerUpLeft, Download, FileText, Forward, Hash, Info, Link2, Loader2, LogOut, Maximize2, MessageCircle, MoreHorizontal, Paperclip, Pin, PinOff, Plus, Search, Send, SmilePlus, SquarePen, Sticker as StickerIcon, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { api, broadcastRefresh, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { cameBack } from '@/components/urlState';
import { DropZone, UploadProgress, putFile } from '@/components/upload';
import { Avatar, Button, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { QuickAddTask } from '@/components/QuickAddTask';
import { VoiceButton } from '@/components/voice';
import { hearOnce, keepScreenOn, speak, stopSpeaking, yesNo } from '@/components/speak';
import { ALL_ID, POLL_MAX, POLL_MIN, REACTIONS, STICKERS, stickerOf, whenText } from '@/lib/chatShared';
import { useSheetBack } from '@/components/backClose';
import { parseTaskText } from '@/lib/nlparse';

/**
 * V14 25번 메신저 — /messages 화면과 오른쪽 아래 패널이 같은 컴포넌트를 쓴다.
 * 목록(검색·＋새 대화·탭·아바타·미리보기·안 읽음·고정) / 대화방(연속 묶기·날짜 구분·읽음·이미지/파일 카드·답장 인용·반응·hover 메뉴) / 입력(자동 높이·📎📷😊@·붙여넣기·끌어 놓기)
 */
export type RoomRow = { id: string; kind: 'dm' | 'group' | 'company' | 'task' | 'team'; name: string | null; task_id: string | null; muted: boolean; pinned: boolean; unread: number; member_count: number;
  last_body: string | null; last_file: string | null; last_author: string | null; last_deleted: boolean; last_message_at: string | null; other_id: string | null; last_mime?: string | null; last_kind?: string | null };
type Reaction = { emoji: string; n: number; mine: boolean; names: string[] };
export type Msg = { id: string; room_id: string; author_id: string | null; author_name: string | null; created_at: string; edited_at: string | null; pinned_at: string | null;
  body: string; deleted: boolean; file_name: string | null; file_mime: string | null; file_size: number | null; task_id: string | null; mine: boolean;
  reply_to?: string | null; reply?: { author: string | null; body: string; file: string | null; deleted: boolean } | null; reactions?: Reaction[];
  kind?: 'text' | 'system' | 'forward' | 'poll' | 'event' | 'sticker'; forward_of?: string | null; unread?: number;
  /** 메신저 2차: 사진 묶음·스티커·투표·일정 카드 */
  batch_id?: string | null; sticker?: string | null; poll?: Poll | null; event?: EventCard | null };
type Poll = { question: string; options: string[]; multi: boolean; anonymous: boolean; closes_at: string | null; closed: boolean; counts: number[]; mine: number[]; voters: number; names: Record<string, string[]> | null };
type EventCard = { id: string; title: string; start_at: string; end_at: string; all_day: boolean; location: string; cancelled: boolean; going: number; invited: number; response: string | null };
export const KIND_LABEL = { dm: '1:1', group: '그룹', company: '회사 전체', task: '업무', team: '팀' } as const;
// B10 이모지 패널(자주 쓰는 것은 이 기기에 기억)
const INSERT_EMOJI = ['😀', '😂', '😊', '😍', '🥰', '😎', '🤔', '😅', '😢', '😭', '😡', '😴', '🙏', '👍', '👎', '👏', '🙌', '💪', '👌', '✌️', '🤝', '🎉', '🔥', '✅',
  '❗', '❓', '💯', '❤️', '💙', '⭐', '☕', '🍚', '🍺', '🎂', '📌', '📎', '📅', '⏰', '📞', '💰', '🚗', '✈️', '🏢', '🏠', '☀️', '🌧️', '❄️', '🌙'];
const EMOJI_KEY = 'wos_emoji_freq';
const readFreq = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(EMOJI_KEY) || '{}'); } catch { return {}; } };
const bumpFreq = (e: string) => { try { const f = readFreq(); f[e] = (f[e] ?? 0) + 1; localStorage.setItem(EMOJI_KEY, JSON.stringify(f)); } catch { /* 저장 못 해도 됨 */ } };
const uuid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)));
const isImage = (m: Pick<Msg, 'file_name' | 'file_mime'>) => !!m.file_name && /^image\/(png|jpe?g|gif|webp)$/.test(m.file_mime ?? '');
const isVideo = (m: Pick<Msg, 'file_name' | 'file_mime'>) => !!m.file_name && /^video\//.test(m.file_mime ?? '');
const isAudio = (m: Pick<Msg, 'file_name' | 'file_mime'>) => !!m.file_name && /^audio\//.test(m.file_mime ?? '');
const fileUrl = (id: string, inline = true) => `/api/chat/messages/${id}/file${inline ? '?inline=1' : ''}`;
/** 긴 글: 600자 또는 15줄 넘으면 접고 [전체 보기] */
const isLong = (b: string) => b.length > 600 || b.split('\n').length > 15;
/** 목록 미리보기: 사진·영상·스티커·투표·일정은 종류로 */
const lastPreview = (r: RoomRow) => {
  if (r.last_kind === 'sticker') return `(스티커) ${r.last_body ?? ''}`;
  if (r.last_kind === 'poll') return `📊 투표: ${r.last_body ?? ''}`;
  if (r.last_file && !plain(r.last_body)) return /^image\//.test(r.last_mime ?? '') ? '📷 사진' : /^video\//.test(r.last_mime ?? '') ? '🎬 동영상' : `📎 ${r.last_file}`;
  return plain(r.last_body);
};
const TZ = 'Asia/Seoul';
const dayKey = (s: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(s));
const timeOf = (s: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(s));
export const shortTime = (s: string | null) => {
  if (!s) return '';
  return dayKey(s) === dayKey(new Date().toISOString()) ? timeOf(s) : new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, month: 'numeric', day: 'numeric' }).format(new Date(s));
};
const dayLabel = (s: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: TZ, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(s));
const plain = (s: string | null) => (s ?? '').replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1');
const fmtSize = (n: number | null) => (!n ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${(n / 1024 / 1024).toFixed(1)}MB`);
const render = (body: string) => body.split(/(@\[[^\]]+\]\([0-9a-f-]{36}\)|https?:\/\/[^\s<]+)/g).map((p, i) => {
  const m = /^@\[([^\]]+)\]\(([0-9a-f-]{36})\)$/.exec(p);
  if (m) return <span key={i} className="rounded bg-black/10 px-0.5 font-medium">@{m[1]}</span>;
  if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all underline">{p}</a>;
  return p;
});

/** 실시간 연결: SSE(약 50초마다 다시 연결), 실패하면 5초 폴링. 구독자에게 새 메시지·입력 중·읽음 전달 */
type LiveEvt = { messages?: Msg[]; typing?: { room_id: string; name: string }[]; reads?: { room_id: string; user_id: string; last_read_id: string }[] };
export type Live = { subscribe: (f: (e: LiveEvt) => void) => () => void; mode: 'sse' | 'poll' };
export function useLive(): Live {
  const subs = useRef(new Set<(e: LiveEvt) => void>());
  const [mode, setMode] = useState<'sse' | 'poll'>('sse');
  useEffect(() => {
    const emit = (e: LiveEvt) => subs.current.forEach((f) => f(e));
    let es: EventSource | null = null; let timer: ReturnType<typeof setInterval> | null = null; let fails = 0;
    let since = ''; let t = Date.now();
    const startPoll = () => {
      setMode('poll');
      timer = setInterval(async () => {
        try { const r = await api(`/api/chat/poll?${new URLSearchParams({ ...(since ? { since } : {}), t: String(t) })}`); since = r.latest; t = r.now; emit(r); } catch { /* 다음 차례에 */ }
      }, 5000);
    };
    // 10/21 DB 쿼터 장애: 탭이 가려지면 SSE·폴링을 멈추고(DB 가 잠들 수 있게), 다시 보이면 마지막 id 부터 이어 받는다
    const openSse = () => {
      es = new EventSource(`/api/chat/stream${since ? `?since=${since}` : ''}`);
      es.addEventListener('ready', (e) => { fails = 0; since = (e as MessageEvent).lastEventId || since; });
      es.addEventListener('messages', (e) => { const m = JSON.parse((e as MessageEvent).data); since = (e as MessageEvent).lastEventId || since; emit({ messages: m }); });
      es.addEventListener('typing', (e) => emit({ typing: JSON.parse((e as MessageEvent).data) }));
      es.addEventListener('reads', (e) => emit({ reads: JSON.parse((e as MessageEvent).data) }));
      es.onerror = () => { if (++fails >= 3 && es) { es.close(); es = null; startPoll(); } };
    };
    const stopAll = () => { es?.close(); es = null; if (timer) { clearInterval(timer); timer = null; } };
    const startAll = () => { if (es || timer) return; if (typeof EventSource === 'undefined') startPoll(); else openSse(); };
    const onVis = () => { if (document.visibilityState === 'hidden') stopAll(); else startAll(); };
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') startAll();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); stopAll(); };
  }, []);
  const subscribe = useCallback((f: (e: LiveEvt) => void) => { subs.current.add(f); return () => { subs.current.delete(f); }; }, []);
  return useMemo(() => ({ subscribe, mode }), [subscribe, mode]);
}

function RoomIcon({ r, size = 40 }: { r: Pick<RoomRow, 'kind' | 'other_id' | 'name'>; size?: number }) {
  if (r.kind === 'dm') return <Avatar id={r.other_id} name={r.name} size={size} badge={false} />;
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-2xl', r.kind === 'company' ? 'bg-teal-700 text-white' : r.kind === 'task' ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700')} style={{ width: size, height: size }}>
      {r.kind === 'company' ? <Hash className="size-5" /> : r.kind === 'task' ? <SquarePen className="size-5" /> : <Users className="size-5" />}
    </span>
  );
}

/**
 * C13 휴대폰 방 목록: 줄을 왼쪽으로 밀면 [고정][알림][나가기](그룹만). 화면 폭 640 미만에서만, 세로 스크롤은 그대로(touch-action: pan-y).
 * 손가락(터치)·마우스 모두 pointer 이벤트로 — 민 뒤에는 그 줄 누름(방 열기)을 막는다
 */
function SwipeRow({ r, open, setOpen, onPin, onMute, onLeave, children }: { r: RoomRow; open: boolean; setOpen: (o: boolean) => void; onPin: () => void; onMute: () => void; onLeave: () => void; children: React.ReactNode }) {
  const W = r.kind === 'group' ? 204 : 136;
  const st = useRef<{ x: number; y: number; lock: 'x' | 'y' | null; id: number } | null>(null);
  const moved = useRef(false);
  const [dx, setDx] = useState<number | null>(null);
  const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches;
  const x = dx !== null ? Math.max(-W - 24, Math.min(0, (open ? -W : 0) + dx)) : open ? -W : 0;
  const btn = 'flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold text-white';
  return (
    <li className="group relative overflow-hidden" data-testid="room-row">
      <div className="absolute inset-y-0 right-0 flex" style={{ width: W }} aria-hidden={!open} data-testid="room-swipe-actions">
        <button type="button" tabIndex={open ? 0 : -1} className={cx(btn, 'bg-slate-500')} onClick={onPin} data-testid="swipe-pin">{r.pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}{r.pinned ? '고정 해제' : '고정'}</button>
        <button type="button" tabIndex={open ? 0 : -1} className={cx(btn, 'bg-amber-500')} onClick={onMute} data-testid="swipe-mute">{r.muted ? <Bell className="size-4" /> : <BellOff className="size-4" />}{r.muted ? '알림 켜기' : '알림 끄기'}</button>
        {r.kind === 'group' && <button type="button" tabIndex={open ? 0 : -1} className={cx(btn, 'bg-red-500')} onClick={onLeave} data-testid="swipe-leave"><LogOut className="size-4" />나가기</button>}
      </div>
      <div className={cx('relative bg-white', dx === null && 'transition-transform duration-200')} style={{ transform: `translateX(${x}px)`, touchAction: 'pan-y' }}
        onPointerDown={(e) => { if (!narrow() || (e.pointerType === 'mouse' && e.button !== 0)) return; st.current = { x: e.clientX, y: e.clientY, lock: null, id: e.pointerId }; moved.current = false; }}
        onPointerMove={(e) => {
          const s = st.current; if (!s || s.id !== e.pointerId) return;
          const ddx = e.clientX - s.x, ddy = e.clientY - s.y;
          if (!s.lock && (Math.abs(ddx) > 8 || Math.abs(ddy) > 8)) { s.lock = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y'; if (s.lock === 'x') { moved.current = true; try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 없음 */ } } }
          if (s.lock === 'x') setDx(ddx);
        }}
        onPointerUp={(e) => { const s = st.current; st.current = null; if (s?.lock === 'x') { const d = e.clientX - s.x; setOpen(open ? d < 20 : d < -48); } setDx(null); }}
        onPointerCancel={() => { st.current = null; setDx(null); }}
        onClickCapture={(e) => { if (moved.current) { e.preventDefault(); e.stopPropagation(); moved.current = false; return; } if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }}>
        {children}
      </div>
    </li>
  );
}

const TABS = [['all', '전체'], ['unread', '안 읽음'], ['dm', '1:1'], ['group', '그룹'], ['task', '업무']] as const;
type Tab = (typeof TABS)[number][0];

/** 대화방 목록 */
export function RoomList({ activeId, onOpen, live, compact }: { activeId?: string | null; onOpen: (id: string) => void; live: Live; compact?: boolean }) {
  const { user, dir } = useSession();
  const rooms = useApi<{ rooms: RoomRow[]; unread: number }>('/api/chat/rooms');
  const [newOpen, setNewOpen] = useState(false);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [results, setResults] = useState<any[] | null>(null);
  useEffect(() => live.subscribe((e) => { if (e.messages?.length) rooms.reload(); }), [live, rooms.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const title = (id: string | null) => dir.users.find((x) => x.id === id)?.title ?? null;
  const list = (rooms.data?.rooms ?? []).filter((r) => (tab === 'all' || (tab === 'unread' ? r.unread > 0 : tab === 'group' ? r.kind === 'group' || r.kind === 'team' || r.kind === 'company' : r.kind === tab))
    && (!q || (r.name ?? '').includes(q) || plain(r.last_body).includes(q)));
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return setResults(null);
    try { setResults((await api(`/api/chat/search?q=${encodeURIComponent(q.trim())}`)).results); } catch (er: any) { toast.error(er.message); }
  }
  async function pin(r: RoomRow) {
    try { await api(`/api/chat/rooms/${r.id}`, { method: 'PATCH', body: { pinned: !r.pinned } }); rooms.reload(); } catch (e: any) { toast.error(e.message); }
  }
  // C13 휴대폰 방 목록 왼쪽으로 밀기 → [고정][알림][나가기]
  const [swiped, setSwiped] = useState<string | null>(null);
  async function mute(r: RoomRow) {
    setSwiped(null);
    try { await api(`/api/chat/rooms/${r.id}`, { method: 'PATCH', body: { muted: !r.muted } }); rooms.reload(); toast.ok(r.muted ? '알림을 켰습니다' : '알림을 껐습니다'); } catch (e: any) { toast.error(e.message); }
  }
  async function leave(r: RoomRow) {
    setSwiped(null);
    if (!confirm(`"${r.name ?? '대화방'}"에서 나갈까요?`)) return;
    try { await api(`/api/chat/rooms/${r.id}`, { method: 'DELETE' }); rooms.reload(); broadcastRefresh(); toast.ok('대화방에서 나갔습니다'); } catch (e: any) { toast.error(e.message); }
  }
  const noChats = rooms.data && !rooms.data.rooms.some((r) => r.last_message_at);
  const suggest = dir.users.filter((x) => x.id !== user.id).slice(0, 6);
  const startDm = async (userId: string) => { try { const r = await api('/api/chat/rooms', { body: { kind: 'dm', userId } }); rooms.reload(); onOpen(r.id); } catch (e: any) { toast.error(e.message); } };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cx('space-y-2 border-b border-line', compact ? 'p-2' : 'p-3')}>
        <div className="flex items-center gap-1.5">
          <form onSubmit={search} className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input className={cx(inputCls, 'h-9 pl-8')} placeholder="대화방·메시지 검색" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setResults(null); }} aria-label="메시지 검색" />
          </form>
          <Button size="sm" className="h-9 shrink-0" onClick={() => setNewOpen(true)} data-testid="chat-new" aria-label="새 대화"><Plus />{!compact && '새 대화'}</Button>
        </div>
        <div className="scrollbar-thin flex gap-1 overflow-x-auto" role="tablist" aria-label="대화방 종류">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={cx('shrink-0 rounded-full px-2.5 py-1 text-xs', tab === k ? 'bg-teal-700 font-semibold text-white' : 'bg-slate-100 text-ink-2 hover:bg-slate-200')}>
              {label}{k === 'unread' && !!rooms.data?.unread && <span className="ml-1">{rooms.data.unread}</span>}
            </button>
          ))}
        </div>
      </div>
      {results ? (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto" data-testid="chat-search-results">
          <li className="px-3 py-1.5 text-[11px] text-ink-3">메시지 검색 결과 · <button className="underline" onClick={() => { setResults(null); setQ(''); }}>지우기</button></li>
          {results.map((m) => (
            <li key={m.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { onOpen(m.room_id); setResults(null); setQ(''); }}>
              <div className="text-xs text-ink-3">{m.room_name ?? KIND_LABEL[m.room_kind as 'dm']} · {m.author_name} · {shortTime(m.created_at)}</div>
              <div className="truncate">{plain(m.body) || m.file_name}</div></button></li>
          ))}
          {!results.length && <li className="px-3 py-3 text-sm text-ink-3">찾는 메시지가 없습니다</li>}
        </ul>
      ) : rooms.loading && !rooms.data ? <div className="p-3"><Skeleton rows={5} /></div> : (
        <ul className="min-h-0 flex-1 overflow-y-auto" data-testid="chat-rooms">
          {list.map((r) => (
            <SwipeRow key={r.id} r={r} open={swiped === r.id} setOpen={(o) => setSwiped(o ? r.id : null)} onPin={() => { setSwiped(null); pin(r); }} onMute={() => mute(r)} onLeave={() => leave(r)}>
              <button onClick={() => onOpen(r.id)} className={cx('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-50', activeId === r.id && 'bg-teal-50')} data-room={r.kind}>
                <RoomIcon r={r} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{r.name ?? KIND_LABEL[r.kind]}</span>
                    {r.kind === 'dm' && title(r.other_id) && <span className="shrink-0 text-[11px] text-ink-3">{title(r.other_id)}</span>}
                    {r.kind !== 'dm' && <span className="shrink-0 text-[11px] text-ink-3">{r.kind === 'task' ? '업무' : r.member_count}</span>}
                    {r.pinned && <Pin className="size-3 shrink-0 text-teal-700" aria-label="고정됨" />}
                    {r.muted && <BellOff className="size-3 shrink-0 text-ink-3" aria-label="알림 꺼짐" />}
                    <span className="ml-auto shrink-0 text-[11px] text-ink-3">{shortTime(r.last_message_at)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                      {r.last_deleted ? '삭제된 메시지' : r.last_body || r.last_file ? `${r.kind !== 'dm' && r.last_author ? r.last_author + ': ' : ''}${lastPreview(r)}` : '아직 메시지가 없습니다'}</span>
                    {r.unread > 0 && <span className={cx('shrink-0 rounded-full px-1.5 text-[11px] font-bold leading-5 text-white', r.muted ? 'bg-slate-400' : 'bg-red-500')} data-testid="room-unread">{r.unread > 99 ? '99+' : r.unread}</span>}
                  </span>
                </span>
              </button>
              <button onClick={() => pin(r)} className="absolute right-2 top-1 hidden rounded p-1 text-ink-3 hover:bg-white hover:text-ink sm:group-hover:block" aria-label={r.pinned ? '고정 해제' : '위에 고정'} title={r.pinned ? '고정 해제' : '위에 고정'}>
                {r.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</button>
            </SwipeRow>
          ))}
          {!list.length && <li className="px-3 py-6 text-center text-sm text-ink-3">{tab === 'unread' ? '안 읽은 대화가 없습니다' : '대화방이 없습니다'}</li>}
          {noChats && !!suggest.length && (
            <li className="border-t border-line p-3" data-testid="chat-suggest">
              <p className="mb-2 text-xs font-semibold text-ink-2">이 사람들과 대화를 시작해 보세요</p>
              <div className="grid grid-cols-3 gap-2">
                {suggest.map((x) => (
                  <button key={x.id} onClick={() => startDm(x.id)} className="flex flex-col items-center gap-1 rounded-card p-2 text-xs hover:bg-slate-50" aria-label={`${x.name}와 대화`}>
                    <Avatar id={x.id} name={x.name} size={36} badge={false} /><span className="w-full truncate text-center font-medium">{x.name}</span>{x.title && <span className="w-full truncate text-center text-[10px] text-ink-3">{x.title}</span>}
                  </button>
                ))}
              </div>
            </li>
          )}
        </ul>
      )}
      <NewRoom open={newOpen} onClose={() => setNewOpen(false)} onOpen={(id) => { setNewOpen(false); rooms.reload(); onOpen(id); }} />
    </div>
  );
}

type Member = { id: string; name: string; title?: string | null; phone?: string | null; role?: string; last_read_id: string; is_owner?: boolean; joined_at?: string };
type RoomData = { room: { id: string; kind: RoomRow['kind']; name: string; taskId: string | null; muted: boolean; canRename?: boolean; ownerId?: string | null; canManage?: boolean; historyVisible?: boolean; canMentionAll?: boolean };
  messages: Msg[]; members: Member[]; pinned: Msg[]; hasOlder?: boolean; hasNewer?: boolean; lastRead?: string; quickReactions?: string[] };

/** 132차 확인 후속(로컬 10/24 ⑧): 주소를 새로 열어 다른 화면에 갔다가 브라우저 뒤로가기로 이 페이지를 다시 연 경우(전체 새로고침) — 그때 처음 여는 방만 '돌아옴'으로 */
let firstRoom = true;
const loadedBack = () => { if (!firstRoom) return false; firstRoom = false; try { return performance.now() < 8000 && (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'back_forward'; } catch { return false; } }; // 페이지를 연 직후에 여는 방만

/** 대화방 */
export function ChatRoom({ id, live, onRead, onBack, compact, onExpand, onClose, backAlways }: { id: string; live: Live; onRead: () => void; onBack: () => void; compact?: boolean; onExpand?: () => void; onClose?: () => void; backAlways?: boolean }) {
  const { user, dir } = useSession();
  const { data, error, loading, reload } = useApi<RoomData>(`/api/chat/rooms/${id}`);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [nameDraft, setNameDraft] = useState<string | null>(null); // 대화방 이름 바꾸기 입력 중
  const [typing, setTyping] = useState<string[]>([]);
  const [reads, setReads] = useState<Record<string, string>>({});
  const [prog, setProg] = useState<{ name: string; pct: number; error?: string }[]>([]);
  const [toTask, setToTask] = useState<{ msg: Msg; title: string; dueDate: string | null; assigneeId: string | null; description: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [active, setActive] = useState<string | null>(null); // 휴대폰: 누른 메시지의 메뉴
  const [menu, setMenu] = useState<{ id: string; kind: 'react' | 'more' } | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [older, setOlder] = useState(false);
  // 메신저 1차(10/20): 방 정보·전달·공지 바 펼침·안 읽은 사람 이름
  const [info, setInfo] = useState(false);
  const [fwd, setFwd] = useState<Msg | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [whoUnread, setWhoUnread] = useState<{ id: string; names: string[] } | null>(null);
  // 메신저 2차(10/24): 사진 뷰어·긴 글·[+] 메뉴·투표·일정·스티커·답장 원문 이동·여기까지 읽음
  const [viewer, setViewer] = useState<string | null>(null);
  const [longText, setLongText] = useState<Msg | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [emojiTab, setEmojiTab] = useState<'emoji' | 'sticker'>('emoji');
  const [pollOpen, setPollOpen] = useState(false);
  const [eventDraft, setEventDraft] = useState<{ title: string; date: string; time: string | null; fromMessage?: string } | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [detached, setDetached] = useState(false); // 답장 원문으로 옮겨 가 최신 메시지가 아닌 구간을 보는 중
  const detachedRef = useRef(false); detachedRef.current = detached;
  const [flash, setFlash] = useState<string | null>(null);
  const readMark = useRef<string | null>(null); // 방을 열 때 내가 읽은 마지막 메시지(그 뒤에 '여기까지 읽었습니다')
  const pendingJump = useRef<string | null>(null);
  const forceBottom = useRef(false);
  const keepPos = useRef(false);
  const loadingNewer = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null); // #109 갤러리 사진·영상
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  // V38 3 음성 모드(운전 중): 새 메시지를 소리로 읽어 주고, 말로 보내기(읽어 주고 "보낼까요?" → 보내/취소 확인). 방마다 이 기기에 기억
  const [voice, setVoice] = useState(() => { try { return localStorage.getItem(`wos_voice_${id}`) === '1'; } catch { return false; } });
  const [vPhase, setVPhase] = useState<'idle' | 'listen' | 'confirm' | 'sending'>('idle');
  const [heard, setHeard] = useState('');
  const voiceRef = useRef(voice); voiceRef.current = voice;
  const vPhaseRef = useRef(vPhase); vPhaseRef.current = vPhase;
  const spoken = useRef(new Set<string>());
  const sayQ = useRef<Promise<void>>(Promise.resolve());
  const say = (t: string) => { sayQ.current = sayQ.current.then(() => speak(t)); return sayQ.current; };
  useEffect(() => {
    if (!data) return;
    for (const m of data.messages) spoken.current.add(m.id);
    if (readMark.current === null) readMark.current = data.lastRead ?? null;
    setMsgs(data.messages); setHasOlder(data.hasOlder ?? data.messages.length >= 60); setDetached(false);
    setReads(Object.fromEntries(data.members.map((m) => [m.id, m.last_read_id])));
  }, [data]);
  const markRead = useCallback(async () => { try { await api(`/api/chat/rooms/${id}/read`, { body: {} }); onRead(); } catch { /* 다음에 */ } }, [id, onRead]);
  useEffect(() => { if (data) markRead(); }, [data, markRead]);
  // V38 1 흔들림 방지: 대화 칸만 움직인다(scrollIntoView 는 화면 전체를 끌어 올려 위아래로 튐).
  // 맨 아래를 보고 있을 때·내가 보낸 때만 따라가고, 위로 올려 보는 중이면 그 자리 유지 + "새 메시지 n ↓"
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const edge = useRef<{ first?: string; last?: string; height: number; top: number }>({ height: 0, top: 0 });
  const [unseen, setUnseen] = useState(0);
  const toBottom = useCallback(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; atBottom.current = true; setUnseen(0); }, []);
  // #242 2단계: 대화에서 업무·링크를 열었다 뒤로가기로 오면 보던 자리로(맨 아래가 아니었을 때만, 이 창 동안) — 예전엔 늘 맨 아래로
  const posKey = `wos_chat_pos:${id}`; const fromBottom = useRef(0); const back = useRef<boolean | null>(null);
  if (back.current === null) back.current = cameBack() || loadedBack();
  // 방을 닫을 때 + 주소를 새로 열어 페이지를 떠날 때(pagehide — 이때는 React 정리가 안 돎) 보던 자리를 적어 둠
  useEffect(() => {
    const save = () => { try { if (atBottom.current) sessionStorage.removeItem(posKey); else sessionStorage.setItem(posKey, String(Math.round(fromBottom.current))); } catch { /* 저장 못 해도 됨 */ } };
    window.addEventListener('pagehide', save);
    return () => { window.removeEventListener('pagehide', save); save(); };
  }, [posKey]);
  const onScroll = () => {
    const el = listRef.current; if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    fromBottom.current = el.scrollHeight - el.scrollTop;
    if (atBottom.current && detachedRef.current) { loadNewer(); return; } // 지난 구간을 보다 아래 끝 → 다음 메시지 이어서
    if (atBottom.current) setUnseen(0);
  };
  /** 그 메시지가 화면 위쪽 1/3 쯤 오게 + 잠깐 강조 */
  const reveal = useCallback((mid: string) => {
    const el = listRef.current; const t = el?.querySelector<HTMLElement>(`[data-msg-id="${mid}"]`) ?? el?.querySelector<HTMLElement>(`[data-batch-ids~="${mid}"]`); if (!el || !t) return false; // 묶음 둘째 장 = 묶음 칸
    el.scrollTop += t.getBoundingClientRect().top - el.getBoundingClientRect().top - el.clientHeight / 3;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    const hid = t.dataset.msgId ?? mid; setFlash(hid); setTimeout(() => setFlash((f) => (f === hid ? null : f)), 1800);
    return true;
  }, []);
  useLayoutEffect(() => {
    const el = listRef.current; if (!el || !msgs.length) return;
    const first = msgs[0].id, last = msgs[msgs.length - 1].id, prev = edge.current;
    const done = () => { edge.current = { first, last, height: el.scrollHeight, top: el.scrollTop }; };
    if (pendingJump.current) { const j = pendingJump.current; pendingJump.current = null; reveal(j); return done(); } // 답장 원문으로 옮겨 감
    if (forceBottom.current) { forceBottom.current = false; toBottom(); return done(); } // [최신 메시지로]
    if (keepPos.current) { keepPos.current = false; return done(); } // 아래로 이어 불러옴 → 자리 그대로
    let saved = 0; if (!prev.last && back.current) try { saved = Number(sessionStorage.getItem(posKey)) || 0; } catch { /* 없음 */ }
    const line = !prev.last ? el.querySelector<HTMLElement>('[data-testid="chat-read-line"]') : null;
    if (!prev.last && saved > el.clientHeight) { el.scrollTop = Math.max(0, el.scrollHeight - saved); atBottom.current = false; fromBottom.current = saved; } // 뒤로가기로 돌아옴 → 보던 자리
    else if (line && line.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop > el.scrollHeight - el.clientHeight) toBottom(); // 안 읽은 것이 한 화면 안 → 맨 아래
    else if (line) { el.scrollTop += line.getBoundingClientRect().top - el.getBoundingClientRect().top - 8; atBottom.current = false; } // B11 안 읽은 것이 많으면 '여기까지 읽었습니다' 선부터
    else if (!prev.last) toBottom(); // 처음 열 때
    else if (first !== prev.first && last === prev.last) el.scrollTop = prev.top + (el.scrollHeight - prev.height); // 이전 메시지 불러옴 → 보던 자리 유지
    else if (last !== prev.last) {
      const added = msgs.filter((m) => BigInt(m.id) > BigInt(prev.last!));
      if (atBottom.current || added.some((m) => m.mine)) toBottom();
      else setUnseen((n) => n + added.filter((m) => !m.mine).length);
    }
    done();
  }, [msgs, toBottom, posKey, reveal]);
  // 사진이 늦게 뜨거나 키보드가 열려 칸 높이가 바뀌어도 맨 아래를 보던 중이면 맨 아래 유지
  useEffect(() => {
    const keep = () => { if (atBottom.current) { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; } };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', keep);
    const ro = typeof ResizeObserver !== 'undefined' && listRef.current ? new ResizeObserver(keep) : null;
    if (ro && listRef.current) { ro.observe(listRef.current); if (listRef.current.firstElementChild) ro.observe(listRef.current.firstElementChild); }
    return () => { vv?.removeEventListener('resize', keep); ro?.disconnect(); };
  }, [data]);
  useEffect(() => { const el = inputRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 128)}px`; } }, [text]);
  const lastId = useRef('0'); lastId.current = msgs[msgs.length - 1]?.id ?? '0';
  useEffect(() => live.subscribe((e) => {
    if (e.messages?.some((m) => m.room_id === id)) {
      // 지난 구간을 보는 중(detached)이면 새 메시지는 붙이지 않고 '새 메시지 n' 만 — 고친 것·반응·투표는 그대로 반영
      if (detachedRef.current) setUnseen((n) => n + e.messages!.filter((x) => x.room_id === id && !x.mine && BigInt(x.id) > BigInt(lastId.current)).length);
      setMsgs((cur) => {
        const map = new Map(cur.map((m) => [m.id, m]));
        for (const m of e.messages!.filter((x) => x.room_id === id)) { if (detachedRef.current && !map.has(m.id)) continue; map.set(m.id, { ...map.get(m.id), ...m }); }
        return [...map.values()].sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
      });
      if (document.visibilityState === 'visible') markRead();
      // 음성 모드: 남이 보낸 새 메시지만 "이름: 내용"으로 읽어 줌(파일은 "파일을 보냈습니다")
      for (const m of e.messages.filter((x) => x.room_id === id)) {
        if (spoken.current.has(m.id)) continue;
        spoken.current.add(m.id);
        if (!voiceRef.current || m.mine || m.author_id === user.id || m.deleted) continue;
        say(`${m.author_name ?? '알 수 없음'}: ${plain(m.body) || (m.file_name ? `파일을 보냈습니다. ${m.file_name}` : '')}`);
      }
    }
    if (e.typing) setTyping(e.typing.filter((x) => x.room_id === id).map((x) => x.name));
    if (e.reads) setReads((r) => ({ ...r, ...Object.fromEntries(e.reads!.filter((x) => x.room_id === id).map((x) => [x.user_id, x.last_read_id])) }));
  }), [live, id, markRead, user.id]);
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, [menu]);

  const members = data?.members ?? [];
  const toWire = (s: string) => members.filter((m) => m.id !== user.id).reduce((acc, m) => acc.split(`@${m.name}`).join(`@[${m.name}](${m.id})`),
    data?.room.canMentionAll ? s.replace(/(^|\s)@전체(?=$|[\s.,!?~])/g, `$1@[전체](${ALL_ID})`) : s); // B11 @전체
  const mergeMine = (mid: string, p: Partial<Msg>) => setMsgs((cur) => cur.some((m) => m.id === mid) ? cur : [...cur, { id: mid, room_id: id, author_id: user.id, author_name: user.name, created_at: new Date().toISOString(),
    edited_at: null, pinned_at: null, body: '', deleted: false, file_name: null, file_mime: null, file_size: null, task_id: null, mine: true, reactions: [], ...p }]);
  /** 최신 메시지로(지난 구간을 보던 중이면 새로 불러와 맨 아래) */
  const goLatest = () => { forceBottom.current = true; setUnseen(0); reload(); };
  /** 보낸 직후: 지난 구간을 보던 중이면 최신으로 옮겨 가서, 아니면 바로 붙임 */
  const afterSend = (mid: string, p: Partial<Msg>) => { if (detachedRef.current) goLatest(); else mergeMine(mid, p); };
  async function loadNewer() {
    if (loadingNewer.current || !msgs.length) return;
    loadingNewer.current = true;
    try {
      const r = await api(`/api/chat/rooms/${id}?after=${msgs[msgs.length - 1].id}`);
      keepPos.current = true;
      setMsgs((c) => [...c, ...r.messages.filter((m: Msg) => !c.some((x) => x.id === m.id))]);
      if (!r.hasNewer) { setDetached(false); setUnseen(0); }
    } catch (e: any) { toast.error(e.message); } finally { loadingNewer.current = false; }
  }
  /** B11 답장 원문 눌러 이동: 화면에 있으면 바로, 없으면 그 앞뒤를 불러와서 */
  async function jumpTo(mid: string) {
    if (reveal(mid)) return;
    try {
      const r = await api(`/api/chat/rooms/${id}?around=${mid}`);
      if (!r.messages.some((m: Msg) => m.id === mid)) { toast.error('원래 메시지를 찾을 수 없습니다(초대 전 메시지이거나 지워짐)'); return; }
      pendingJump.current = mid;
      setMsgs(r.messages); setHasOlder(!!r.hasOlder); setDetached(!!r.hasNewer);
    } catch (e: any) { toast.error(e.message); }
  }
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    const body = toWire(text); const rep = replyTo; setText(''); setReplyTo(null);
    try {
      const r = await api(`/api/chat/rooms/${id}/messages`, { body: { body, ...(rep ? { replyTo: rep.id } : {}) } });
      spoken.current.add(r.id);
      afterSend(r.id, { body, reply_to: rep?.id ?? null, reply: rep ? { author: rep.author_name, body: rep.body.slice(0, 120), file: rep.file_name, deleted: false } : null });
    } catch (er: any) { setText(text); setReplyTo(rep); toast.error(er.message); }
  }
  // ---- V38 3 음성 모드 ----
  async function sendSpoken(t: string) {
    setVPhase('sending');
    try {
      const body = toWire(t);
      const r = await api(`/api/chat/rooms/${id}/messages`, { body: { body } });
      spoken.current.add(r.id); afterSend(r.id, { body });
      setVPhase('idle'); setHeard(''); await say('보냈습니다');
    } catch (er: any) { setVPhase('confirm'); toast.error(er.message); await say('보내지 못했습니다'); }
  }
  function cancelSpoken() { stopSpeaking(); setVPhase('idle'); setHeard(''); }
  const talking = useRef(false);
  async function talk() {
    if (talking.current) return;
    talking.current = true; stopSpeaking();
    try {
      setVPhase('listen'); setHeard('');
      const t = await hearOnce();
      if (!t) { setVPhase('idle'); await say('못 들었어요. 다시 눌러 말씀해 주세요'); return; }
      setHeard(t); setVPhase('confirm');
      await say(`${t}. 보낼까요? 보내, 또는 취소라고 말해 주세요`);
      if (vPhaseRef.current !== 'confirm') return; // 그사이 화면에서 처리
      const a = yesNo(await hearOnce());
      if (vPhaseRef.current !== 'confirm') return;
      if (a === true) await sendSpoken(t);
      else if (a === false) { cancelSpoken(); await say('취소했습니다'); }
      else await say('화면에서 보내기나 취소를 눌러 주세요');
    } finally { talking.current = false; }
  }
  function toggleVoice() {
    const on = !voice;
    setVoice(on); try { localStorage.setItem(`wos_voice_${id}`, on ? '1' : '0'); } catch {}
    keepScreenOn(on);
    if (on) say('음성 모드를 켰습니다. 새 메시지를 읽어 드리고, 큰 마이크를 누르면 음성으로 보낼 수 있습니다');
    else { stopSpeaking(); setVPhase('idle'); setHeard(''); }
  }
  useEffect(() => { if (voice) keepScreenOn(true); return () => { keepScreenOn(false); stopSpeaking(); }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function upload(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 30);
    if (!list.length) return;
    // B8 사진·영상을 여러 장 고르면 한 묶음(대화창 한 칸·알림 1번·안 읽은 수 1)
    const media = list.filter((f) => /^(image|video)\//.test(f.type));
    const batch = media.length > 1 ? uuid() : null;
    setProg(list.map((f) => ({ name: f.name, pct: 0 })));
    for (const [n, f] of list.entries()) {
      try {
        const name = f.name || `붙여넣은 이미지.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
        const t = await api(`/api/chat/rooms/${id}/files`, { body: { fileName: name, mime: f.type || 'application/octet-stream', size: f.size } });
        const { uploadId } = await putFile(t.upload, f, (pct) => setProg((x) => x.map((y, j) => (j === n ? { ...y, pct } : y))));
        const file = { key: t.key, name, mime: f.type || 'application/octet-stream', size: f.size, ...(uploadId ? { uploadId } : {}) }; // #109: 영상 조각 업로드면 서버가 합침
        const inBatch = batch && media.includes(f);
        const r = await api(`/api/chat/rooms/${id}/messages`, { body: { body: '', file, ...(inBatch ? { batch, batchSize: media.length } : {}) } });
        afterSend(r.id, { file_name: name, file_mime: file.mime, file_size: f.size, batch_id: inBatch ? batch : null });
      } catch (er: any) { setProg((x) => x.map((y, j) => (j === n ? { ...y, error: er.message } : y))); }
    }
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
    if (galleryRef.current) galleryRef.current.value = '';
    setTimeout(() => setProg((x) => (x.some((y) => y.error) ? x : [])), 1200);
  }
  function onType(v: string) {
    setText(v);
    if (v && Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); api(`/api/chat/rooms/${id}/typing`, { body: {} }).catch(() => {}); }
  }
  const insert = (s: string) => { setText((c) => c + s); setTimeout(() => inputRef.current?.focus(), 0); };
  /** B10 스티커 보내기 */
  async function sendSticker(code: string) {
    setEmojiOpen(false); setPlusOpen(false);
    const st = stickerOf(code); if (!st) return;
    try { const r = await api(`/api/chat/rooms/${id}/messages`, { body: { sticker: code } }); spoken.current.add(r.id); afterSend(r.id, { body: st.text, sticker: code, kind: 'sticker' }); }
    catch (e: any) { toast.error(e.message); }
  }
  async function act(m: Msg, what: 'pin' | 'unpin' | 'delete' | 'task' | 'event', run?: Msg[]) {
    setMenu(null); setActive(null);
    try {
      if (what === 'delete') {
        const ids = (run ?? [m]).filter((x) => x.mine && !x.deleted).map((x) => x.id); // 사진 묶음은 한 번에
        if (!confirm(ids.length > 1 ? `사진·영상 ${ids.length}개를 모두 지울까요? ("삭제된 메시지"로 표시됩니다)` : '이 메시지를 지울까요? ("삭제된 메시지"로 표시됩니다)')) return;
        for (const x of ids) await api(`/api/chat/messages/${x}`, { method: 'DELETE' });
        setMsgs((c) => c.map((x) => (ids.includes(x.id) ? { ...x, deleted: true, body: '' } : x)));
      }
      else if (what === 'event') { // B9 메시지 → 일정(날짜·시각은 글에서 읽어 미리 채움)
        const today = dayKey(new Date().toISOString());
        const p = parseTaskText(plain(m.body), dir.users, today);
        setEventDraft({ title: (p.title || plain(m.body).split('\n')[0]).slice(0, 100), date: p.dueDate ?? today, time: p.dueTime, fromMessage: m.id });
      }
      else if (what === 'task') { const s = await api(`/api/chat/messages/${m.id}/to-task`, { body: {} }); setToTask({ msg: m, ...s }); }
      else { await api(`/api/chat/messages/${m.id}/pin`, { body: { pin: what === 'pin' } }); reload(); }
    } catch (e: any) { toast.error(e.message); }
  }
  async function react(m: Msg, emoji: string) {
    setMenu(null); setActive(null);
    setMsgs((c) => c.map((x) => {
      if (x.id !== m.id) return x;
      const rs = [...(x.reactions ?? [])]; const i = rs.findIndex((r) => r.emoji === emoji);
      if (i >= 0 && rs[i].mine) { rs[i] = { ...rs[i], n: rs[i].n - 1, mine: false, names: rs[i].names.filter((n) => n !== user.name) }; if (!rs[i].n) rs.splice(i, 1); }
      else if (i >= 0) rs[i] = { ...rs[i], n: rs[i].n + 1, mine: true, names: [...rs[i].names, user.name] };
      else rs.push({ emoji, n: 1, mine: true, names: [user.name] });
      return { ...x, reactions: rs };
    }));
    try { await api(`/api/chat/messages/${m.id}/react`, { body: { emoji } }); } catch (e: any) { toast.error(e.message); reload(); }
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); if (!editing?.body.trim()) return;
    try { await api(`/api/chat/messages/${editing.id}`, { method: 'PATCH', body: { body: toWire(editing.body) } }); setMsgs((c) => c.map((x) => (x.id === editing.id ? { ...x, body: toWire(editing.body), edited_at: new Date().toISOString() } : x))); setEditing(null); }
    catch (er: any) { toast.error(er.message); }
  }
  async function loadOlder() {
    if (!msgs.length) return;
    setOlder(true);
    try { const r = await api(`/api/chat/rooms/${id}?before=${msgs[0].id}`); setMsgs((c) => [...r.messages.filter((m: Msg) => !c.some((x) => x.id === m.id)), ...c]); setHasOlder(r.hasOlder ?? r.messages.length >= 60); } catch (e: any) { toast.error(e.message); } finally { setOlder(false); }
  }
  async function toggleMute() {
    try { await api(`/api/chat/rooms/${id}`, { method: 'PATCH', body: { muted: !data!.room.muted } }); reload(); onRead(); } catch (e: any) { toast.error(e.message); }
  }
  if (error) return <div className="p-6 text-sm"><p className="font-semibold">대화방을 열 수 없습니다</p><p className="mt-1 text-ink-2">{error.message}</p><Button className="mt-3" variant="secondary" onClick={onBack}>목록으로</Button></div>;
  if (loading && !data) return <div className="p-3"><Skeleton rows={6} /></div>;
  const room = data!.room;
  const other = room.kind === 'dm' ? members.find((x) => x.id !== user.id) : null;
  const quick = data!.quickReactions?.length ? data!.quickReactions : REACTIONS.slice(0, 6);
  const mediaList = msgs.filter((m) => !m.deleted && (isImage(m) || isVideo(m)));
  // B11 '여기까지 읽었습니다': 방을 열 때 읽은 마지막 메시지 다음(남이 보낸 것) — 읽은 메시지가 화면에 하나는 있어야 선을 그음
  const mark = readMark.current;
  const readLine = mark && mark !== '0' && msgs.some((m) => BigInt(m.id) <= BigInt(mark)) ? msgs.find((m) => BigInt(m.id) > BigInt(mark) && !m.mine)?.id ?? null : null;
  const readBy = (m: Msg) => members.filter((x) => x.id !== m.author_id && BigInt(reads[x.id] ?? '0') >= BigInt(m.id)).length;
  const others = members.filter((x) => x.id !== user.id).length;
  // B7: 카톡처럼 '안 읽은 수'(실시간 읽음 반영) — 누르면 안 읽은 사람 이름
  const unreadOf = (m: Msg) => Math.max(0, others - readBy(m));
  async function showUnread(m: Msg) {
    if (whoUnread?.id === m.id) { setWhoUnread(null); return; }
    try { const r = await api(`/api/chat/messages/${m.id}/unread`); setWhoUnread({ id: m.id, names: r.names }); } catch (e: any) { toast.error(e.message); }
  }
  const mention = /(^|\s)@([^\s@]*)$/.exec(text);
  const mentionList = mention ? members.filter((m) => m.id !== user.id && m.name.includes(mention[2])).slice(0, 6) : [];
  const mentionAll = !!mention && !!room.canMentionAll && '전체'.startsWith(mention[2]); // B11 @전체(1:1 제외, 회사 전체방은 대표·관리자)
  const iconBtn = 'inline-flex size-8 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100';
  async function saveName() {
    if (nameDraft === null) return; // Enter 뒤 blur 로 두 번 불리지 않게
    const n = nameDraft.trim();
    setNameDraft(null);
    if (n === room.name) return;
    try { await api(`/api/chat/rooms/${id}`, { method: 'PATCH', body: { name: n } }); broadcastRefresh(); onRead(); /* 머리줄·대화 목록 모두 새 이름 */ toast.ok(n ? `대화방 이름을 "${n}"(으)로 바꿨습니다` : '업무 제목으로 되돌렸습니다'); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-room">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button className={cx(iconBtn, !backAlways && 'sm:hidden')} onClick={onBack} aria-label="목록으로"><ArrowLeft className="size-5" /></button>
        <RoomIcon r={{ kind: room.kind, other_id: other?.id ?? null, name: room.name }} size={compact ? 30 : 36} />
        <div className="min-w-0 flex-1">
          {nameDraft !== null ? (
            <input autoFocus className={cx(inputCls, 'h-7 px-2 text-sm font-semibold')} value={nameDraft} maxLength={50} onChange={(e) => setNameDraft(e.target.value)} aria-label="대화방 이름" data-testid="chat-room-name-input"
              placeholder={room.kind === 'task' ? '비우면 업무 제목' : '대화방 이름'} onBlur={saveName}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); saveName(); } else if (e.key === 'Escape') { e.stopPropagation(); setNameDraft(null); } }} />
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-sm font-semibold" data-testid="chat-room-name">{room.name}</span>
              {room.canRename && <button type="button" onClick={() => setNameDraft(room.name)} className="shrink-0 rounded p-0.5 text-ink-3 hover:bg-slate-100 hover:text-ink" aria-label="대화방 이름 바꾸기" title="대화방 이름 바꾸기" data-testid="chat-room-rename"><Pencil className="size-3.5" /></button>}
            </div>
          )}
          <div className="truncate text-[11px] text-ink-3">{room.kind === 'dm' ? dir.users.find((x) => x.id === other?.id)?.title ?? '1:1' : `${KIND_LABEL[room.kind]} · ${members.length}명`}
            {room.taskId && <> · <Link href={`/tasks/${room.taskId}`} className="text-accent-600 underline">업무 보기</Link></>}{live.mode === 'poll' && ' · 5초마다 새로 고침'}</div>
        </div>
        <button className={cx(iconBtn, voice && 'bg-accent-600 text-white hover:bg-accent-700')} onClick={toggleVoice} aria-pressed={voice} aria-label={voice ? '음성 모드 끄기' : '음성 모드(운전 중) 켜기'} title={voice ? '음성 모드 끄기' : '음성 모드 — 새 메시지 읽어 주기·음성으로 보내기'} data-testid="chat-voice"><Headphones className="size-4" /></button>
        <button className={iconBtn} onClick={toggleMute} aria-label={room.muted ? '알림 켜기' : '알림 끄기'} title={room.muted ? '알림 켜기' : '알림 끄기'} data-testid="chat-mute">{room.muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}</button>
        <button className={iconBtn} onClick={() => setInfo(true)} aria-label="방 정보" title="방 정보 — 참여자·초대·사진/파일/링크" data-testid="chat-info"><Info className="size-4" /></button>
        {!compact && user.role === 'owner' && <a className={iconBtn} href={`/api/chat/rooms/${id}/export`} aria-label="대화 내보내기(감사용)" title="대화 내보내기(감사용, 기록 남음)"><Download className="size-4" /></a>}
        {onExpand && <button className={iconBtn} onClick={onExpand} aria-label="크게 보기" title="크게 보기"><Maximize2 className="size-4" /></button>}
        {onClose && <button className={iconBtn} onClick={onClose} aria-label="닫기"><X className="size-4" /></button>}
      </header>
      {data!.pinned.length > 0 && (
        <div className="border-b border-line bg-amber-50 text-xs text-amber-900" data-testid="chat-pinned">
          <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-left" onClick={() => setNoticeOpen((v) => !v)} aria-expanded={noticeOpen} data-testid="chat-notice-toggle">
            <Pin className="size-3.5 shrink-0" /><span className={cx('min-w-0 flex-1', noticeOpen ? 'whitespace-pre-wrap break-words' : 'truncate')}><b>공지</b> · {data!.pinned[0].author_name}: {plain(data!.pinned[0].body) || data!.pinned[0].file_name}</span>
            {data!.pinned.length > 1 && !noticeOpen && <span className="shrink-0">외 {data!.pinned.length - 1}개</span>}
            {noticeOpen ? <ChevronUp className="size-3.5 shrink-0" /> : <ChevronDown className="size-3.5 shrink-0" />}
          </button>
          {noticeOpen && data!.pinned.length > 1 && (
            <ul className="space-y-1 border-t border-amber-200/70 px-3 py-1.5" data-testid="chat-notice-history">
              {data!.pinned.slice(1).map((p) => <li key={p.id} className="truncate text-amber-800/80">{p.author_name}: {plain(p.body) || p.file_name} <span className="text-amber-700/60">· {shortTime(p.created_at)}</span></li>)}
            </ul>
          )}
        </div>
      )}
      <DropZone onFiles={upload} label="놓으면 이 대화방에 보냅니다" testid="chat-drop" className="flex min-h-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={listRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50/60 px-3 py-2 [overflow-anchor:none]" data-testid="chat-messages" onClick={() => setActive(null)}>
          {hasOlder && <div className="text-center"><Button size="sm" variant="ghost" onClick={loadOlder} disabled={older} data-testid="chat-older">{older ? <Loader2 className="animate-spin" /> : null}이전 메시지</Button></div>}
          {!msgs.length && <p className="py-10 text-center text-sm text-ink-3">첫 메시지를 보내 보세요</p>}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            // B8 사진 묶음: 같은 사람이 한 번에 보낸 사진·영상은 첫 장 칸에 함께(둘째 장부터는 따로 그리지 않음)
            if (m.batch_id && prev?.batch_id === m.batch_id && prev.author_id === m.author_id) return null;
            let j = i; while (m.batch_id && msgs[j + 1]?.batch_id === m.batch_id && msgs[j + 1].author_id === m.author_id) j++;
            const run = msgs.slice(i, j + 1), lastOf = run[run.length - 1], next = msgs[j + 1];
            const album = run.filter((x) => !x.deleted && (isImage(x) || isVideo(x)));
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            const head = newDay || prev.author_id !== m.author_id || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60_000;
            const tail = !next || next.author_id !== m.author_id || dayKey(next.created_at) !== dayKey(lastOf.created_at) || timeOf(next.created_at) !== timeOf(lastOf.created_at);
            const st = stickerOf(m.sticker);
            const img = isImage(m), vid = isVideo(m), aud = isAudio(m);
            const gone = run.every((x) => x.deleted);
            const isText = (m.kind ?? 'text') === 'text' || (m.kind === 'forward' && !st && !m.event);
            const bare = !!st || album.length > 1 || ((img || vid) && !m.body) || !!m.poll || !!m.event; // 말풍선 없이(스티커·사진·카드)
            const showMenu = active === m.id || menu?.id === m.id;
            const dateLine = newDay && <div className="my-3 flex items-center gap-2 text-[11px] text-ink-3" data-testid="chat-date"><span className="h-px flex-1 bg-line" />{dayLabel(m.created_at)}<span className="h-px flex-1 bg-line" /></div>;
            // B11 '여기까지 읽었습니다' — 방을 열 때 읽은 곳 바로 다음
            const readLineEl = readLine === m.id && <div className="my-3 flex items-center gap-2 text-[11px] font-semibold text-teal-700" data-testid="chat-read-line"><span className="h-px flex-1 bg-teal-600/40" />여기까지 읽었습니다<span className="h-px flex-1 bg-teal-600/40" /></div>;
            if (m.kind === 'system') return (
              <div key={m.id} data-msg-id={m.id}>
                {dateLine}{readLineEl}
                <div className="my-1.5 text-center"><span className="inline-block rounded-full bg-slate-200/70 px-3 py-0.5 text-[11px] text-ink-2" data-testid="chat-system">{m.body}</span></div>
              </div>
            );
            const un = unreadOf(lastOf);
            const u0 = dir.users.find((x) => x.id === m.author_id);
            return (
              <div key={m.id} data-msg-id={m.id} data-batch-ids={run.length > 1 ? run.map((x) => x.id).join(' ') : undefined}>
                {dateLine}{readLineEl}
                <div className={cx('group relative flex gap-2 rounded-xl transition-colors duration-500', m.mine && 'flex-row-reverse', head ? 'mt-2.5' : 'mt-0.5', flash === m.id && 'bg-amber-100/80')} data-testid="chat-message" data-mine={m.mine ? '1' : '0'}>
                  {!m.mine && (head ? <Avatar id={m.author_id} name={m.author_name} size={compact ? 30 : 34} badge={false} /> : <span className={cx('shrink-0', compact ? 'w-[30px]' : 'w-[34px]')} />)}
                  <div className={cx('flex min-w-0 max-w-[78%] flex-col', m.mine ? 'items-end' : 'items-start')}>
                    {head && !m.mine && <div className="mb-0.5 flex items-center gap-1 text-xs font-medium text-ink-2">{m.author_name}<RoleBadge role={u0?.role} guest={u0?.is_demo} />{u0?.title && <span className="font-normal text-ink-3">{u0.title}</span>}</div>}
                    <div className={cx('flex items-end gap-1.5', m.mine && 'flex-row-reverse')}>
                      {editing?.id === m.id ? (
                        <form onSubmit={saveEdit} className="flex gap-1"><input autoFocus className={cx(inputCls, 'h-8')} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }} aria-label="메시지 고치기" /><Button size="sm">저장</Button></form>
                      ) : gone ? <span className="rounded-2xl bg-slate-100 px-3 py-1.5 text-sm italic text-ink-3">삭제된 메시지</span> : (
                        <div onClick={(e) => { e.stopPropagation(); setActive(active === m.id ? null : m.id); }}
                          className={cx('min-w-0 whitespace-pre-wrap break-words text-left text-sm', bare ? '' : cx('rounded-2xl px-3 py-1.5', m.mine ? 'rounded-tr-md bg-teal-700 text-white' : 'rounded-tl-md border border-line bg-white text-ink'), m.pinned_at && 'rounded-2xl ring-2 ring-amber-300')}>
                          {m.kind === 'forward' && <div className={cx('mb-0.5 flex items-center gap-1 text-[11px]', m.mine && !bare ? 'text-white/75' : 'text-ink-3')} data-testid="chat-forwarded"><Forward className="size-3" />전달된 메시지</div>}
                          {m.reply && (
                            <button type="button" onClick={(e) => { e.stopPropagation(); if (m.reply_to) jumpTo(m.reply_to); }} title="원래 메시지로 가기"
                              className={cx('mb-1 block w-full border-l-2 pl-2 text-left text-xs hover:opacity-80', m.mine ? 'border-white/60 text-white/80' : 'border-teal-600 text-ink-2')} data-testid="chat-reply-quote">
                              <b>{m.reply.author ?? '알 수 없음'}</b><div className="line-clamp-2">{m.reply.deleted ? '삭제된 메시지' : plain(m.reply.body) || `📎 ${m.reply.file}`}</div>
                            </button>
                          )}
                          {st ? <StickerView s={st} />
                            : m.poll ? <PollCard m={m} canClose={m.mine || !!room.canManage} onChanged={(p) => setMsgs((c) => c.map((x) => (x.id === m.id ? { ...x, poll: p } : x)))} />
                            : m.event ? <EventCardView ev={m.event} onChanged={(ev) => setMsgs((c) => c.map((x) => (x.id === m.id ? { ...x, event: ev } : x)))} />
                            : album.length > 1 ? <Album items={album} onOpen={setViewer} />
                            : m.file_name && (img
                              ? <button type="button" onClick={(e) => { e.stopPropagation(); setViewer(m.id); }} aria-label={`${m.file_name} 크게 보기`} data-testid="chat-image"><img src={fileUrl(m.id)} alt={m.file_name} loading="lazy" className="h-48 w-auto max-w-full rounded-xl border border-line bg-slate-100 object-cover" /></button>
                              : vid ? <span className="block" onClick={(e) => e.stopPropagation()}><video src={fileUrl(m.id)} controls playsInline preload="metadata" className="max-h-64 w-auto max-w-full rounded-xl bg-black" data-testid="chat-video" /><button type="button" className="mt-0.5 text-[11px] text-ink-3 underline" onClick={() => setViewer(m.id)}>크게 보기</button></span>
                              : aud ? <audio src={fileUrl(m.id)} controls preload="none" className="w-60 max-w-full" onClick={(e) => e.stopPropagation()} data-testid="chat-audio" />
                              : <span className={cx('flex items-center gap-2 rounded-xl p-2', m.mine ? 'bg-white/15' : 'bg-slate-50')} data-testid="chat-file-card">
                                  <span className={cx('inline-flex size-9 shrink-0 flex-col items-center justify-center rounded-lg text-[9px] font-bold', m.mine ? 'bg-white/20' : 'bg-teal-50 text-teal-700')}><FileText className="size-4" />{(m.file_name.split('.').pop() ?? '').slice(0, 4).toUpperCase()}</span>
                                  <span className="min-w-0"><span className="block truncate font-medium">{m.file_name}</span>
                                    <span className={cx('flex gap-2 text-[11px]', m.mine ? 'text-white/70' : 'text-ink-3')}>{fmtSize(m.file_size)}
                                      <a href={fileUrl(m.id, false)} onClick={(e) => e.stopPropagation()} className="underline">내려받기</a>
                                      {/\.pdf$/i.test(m.file_name) && <a href={fileUrl(m.id)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="underline" data-testid="chat-file-preview">미리보기</a>}</span></span>
                                </span>)}
                          {m.body && isText && (isLong(m.body)
                            ? <><div className="line-clamp-[12]" data-testid="msg-long">{render(m.body)}</div><button type="button" onClick={(e) => { e.stopPropagation(); setLongText(m); }} className={cx('mt-1 block text-xs font-semibold underline', m.mine ? 'text-white/90' : 'text-teal-700')} data-testid="msg-long-more">전체 보기</button></>
                            : render(m.body))}
                        </div>
                      )}
                      {tail || (others > 0 && (un > 0 || m.mine)) ? (
                        <span className="shrink-0 text-[10px] leading-tight text-ink-3">
                          {others > 0 && !gone && (un > 0 ? (
                            <button type="button" className="relative z-20 block text-amber-600 hover:underline" onClick={(e) => { e.stopPropagation(); showUnread(lastOf); }} title="안 읽은 사람 보기" data-testid="msg-unread">{un}</button>
                          ) : m.mine ? <span className="block text-teal-700">읽음</span> : null)}
                          {tail && timeOf(lastOf.created_at)}{m.edited_at && !m.deleted && ' · 수정'}
                        </span>
                      ) : null}
                    </div>
                    {!!m.reactions?.length && (
                      <div className="mt-0.5 flex flex-wrap gap-1" data-testid="chat-reactions">
                        {m.reactions.map((r) => (
                          <button key={r.emoji} onClick={(e) => { e.stopPropagation(); react(m, r.emoji); }} title={r.names.join(', ')}
                            className={cx('rounded-full border px-1.5 text-xs leading-5', r.mine ? 'border-teal-600 bg-teal-50' : 'border-line bg-white')}>{r.emoji} {r.n}</button>
                        ))}
                      </div>
                    )}
                    {whoUnread?.id === lastOf.id && <div className="mt-0.5 rounded-input border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-900" data-testid="msg-unread-names">안 읽음: {whoUnread.names.length ? whoUnread.names.join(', ') : '없음'}</div>}
                    {m.task_id && <Link href={`/tasks/${m.task_id}`} className="mt-0.5 inline-block text-xs text-accent-600 underline">→ 업무로 만듦</Link>}
                  </div>
                  {/* hover(휴대폰은 누르면) 메뉴 — 메시지마다 글자 링크를 늘어놓지 않는다 */}
                  {!gone && editing?.id !== m.id && (
                    <div className={cx('absolute -top-3 z-10 items-center gap-0.5 rounded-full border border-line bg-white px-1 py-0.5 shadow-card', m.mine ? 'right-2' : 'left-12', showMenu ? 'flex' : 'hidden sm:group-hover:flex')} data-testid="msg-menu" onClick={(e) => e.stopPropagation()}>
                      {quick.slice(0, 3).map((em) => <button key={em} className="rounded-full px-1 text-sm hover:bg-slate-100" onClick={() => react(m, em)} aria-label={`${em} 반응`}>{em}</button>)}
                      <button className="rounded-full p-1 text-ink-2 hover:bg-slate-100" onClick={() => setMenu(menu?.id === m.id && menu.kind === 'react' ? null : { id: m.id, kind: 'react' })} aria-label="반응 더 보기" data-testid="msg-react-more"><SmilePlus className="size-4" /></button>
                      <button className="rounded-full p-1 text-ink-2 hover:bg-slate-100" onClick={() => { setReplyTo(m); setActive(null); inputRef.current?.focus(); }} aria-label="답장" data-testid="msg-reply"><CornerUpLeft className="size-4" /></button>
                      <button className="rounded-full p-1 text-ink-2 hover:bg-slate-100" onClick={() => setMenu(menu?.id === m.id && menu.kind === 'more' ? null : { id: m.id, kind: 'more' })} aria-label="더 보기" data-testid="msg-more"><MoreHorizontal className="size-4" /></button>
                      {menu?.id === m.id && menu.kind === 'react' && (
                        // B10 자주 쓰는 반응 6개(내가 많이 쓴 순) + 나머지
                        <div className={cx('absolute top-full z-20 mt-1 w-[13.5rem] rounded-card border border-line bg-white p-1.5 shadow-pop', m.mine ? 'right-0' : 'left-0')} data-testid="msg-react-panel">
                          <div className="mb-0.5 px-0.5 text-[10px] font-semibold text-ink-3">자주 쓰는 반응</div>
                          <div className="flex gap-0.5">{quick.map((em) => <button key={em} className="rounded-full px-1 text-lg hover:bg-slate-100" onClick={() => react(m, em)} aria-label={`${em} 반응`} data-testid="react-quick">{em}</button>)}</div>
                          <div className="mt-1 grid grid-cols-8 gap-0.5 border-t border-line pt-1">{REACTIONS.filter((em) => !quick.includes(em)).map((em) => <button key={em} className="rounded px-0.5 text-base hover:bg-slate-100" onClick={() => react(m, em)} aria-label={`${em} 반응`}>{em}</button>)}</div>
                        </div>
                      )}
                      {menu?.id === m.id && menu.kind === 'more' && (
                        <ul className={cx('absolute top-full z-20 mt-1 w-44 overflow-hidden rounded-card border border-line bg-white py-1 text-sm shadow-pop', m.mine ? 'right-0' : 'left-0')} role="menu">
                          {m.kind !== 'poll' && album.length <= 1 && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { setFwd(m); setMenu(null); setActive(null); }} data-testid="msg-forward">전달</button></li>}
                          {album.length > 1 && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { setViewer(album[0].id); setMenu(null); setActive(null); }}>크게 보기·저장</button></li>}
                          {isText && m.body && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => act(m, 'task')} data-testid="msg-to-task">업무로 만들기</button></li>}
                          {isText && m.body && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => act(m, 'event')} data-testid="msg-to-event">일정으로 만들기</button></li>}
                          <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => act(m, m.pinned_at ? 'unpin' : 'pin')} data-testid="msg-notice">{m.pinned_at ? '공지 해제' : '공지 등록'}</button></li>
                          {m.body && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { navigator.clipboard?.writeText(plain(m.body)); setMenu(null); toast.ok('복사했습니다'); }}>복사</button></li>}
                          {m.mine && m.body && isText && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { setEditing({ id: m.id, body: plain(m.body) }); setMenu(null); setActive(null); }}>수정</button></li>}
                          {m.mine && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50" onClick={() => act(m, 'delete', run)} data-testid="msg-delete">{album.length > 1 ? `${album.length}개 모두 삭제` : '삭제'}</button></li>}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
        {(unseen > 0 || detached) && <button type="button" onClick={detached ? goLatest : toBottom} className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-pop" data-testid="chat-new-below">{unseen > 0 ? `새 메시지 ${unseen} ↓` : '최신 메시지로 ↓'}</button>}
        </div>
        <div className="h-5 bg-slate-50/60 px-3 text-xs text-ink-3" aria-live="polite" data-testid="chat-typing">{typing.length ? `${typing.join(', ')} 님이 입력 중…` : ''}</div>
        <UploadProgress items={prog} />
        {replyTo && (
          <div className="flex items-center gap-2 border-t border-line bg-teal-50/60 px-3 py-1.5 text-xs" data-testid="chat-replying">
            <CornerUpLeft className="size-3.5 shrink-0 text-teal-700" /><span className="min-w-0 flex-1 truncate"><b>{replyTo.author_name}</b>에게 답장: {plain(replyTo.body) || replyTo.file_name}</span>
            <button onClick={() => setReplyTo(null)} aria-label="답장 취소" className="text-ink-3"><X className="size-4" /></button>
          </div>
        )}
        {voice && (
          // 운전 중: 큰 마이크 하나 — 말하면 읽어 주고 "보낼까요?" 음성 확인, 화면 버튼으로도
          <div className="flex flex-col items-center gap-2 border-t border-line bg-accent-50/60 px-3 py-3" data-testid="chat-voice-panel">
            {vPhase === 'confirm' || vPhase === 'sending' ? (
              <>
                <p className="w-full rounded-input bg-white px-3 py-2 text-base font-medium text-ink shadow-card" data-testid="chat-voice-heard">“{heard}”</p>
                <div className="grid w-full grid-cols-3 gap-2">
                  <Button className="h-12 text-base" disabled={vPhase === 'sending'} onClick={() => sendSpoken(heard)} data-testid="chat-voice-send">보내기</Button>
                  <Button variant="secondary" className="h-12 text-base" onClick={() => { cancelSpoken(); talk(); }}>다시 말하기</Button>
                  <Button variant="ghost" className="h-12 text-base" onClick={cancelSpoken}>취소</Button>
                </div>
              </>
            ) : (
              <button type="button" onClick={talk} disabled={vPhase === 'listen'} aria-label="음성으로 보내기" data-testid="chat-voice-talk"
                className={cx('flex size-20 items-center justify-center rounded-full text-white shadow-pop transition active:scale-95', vPhase === 'listen' ? 'animate-pulse bg-red-500' : 'bg-accent-600')}>
                <Mic className="size-9" />
              </button>
            )}
            <p className="text-sm font-medium text-ink-2" data-testid="chat-voice-state">{vPhase === 'listen' ? '듣고 있어요… 말을 멈추면 읽어 드려요' : vPhase === 'confirm' ? '“보내” 또는 “취소”라고 말하거나 눌러 주세요' : vPhase === 'sending' ? '보내는 중…' : '새 메시지를 읽어 드려요 · 마이크를 누르고 말하세요'}</p>
          </div>
        )}
        <form onSubmit={send} className="relative flex items-end gap-1 border-t border-line bg-white p-2 pb-[calc(0.5rem+var(--sab))] sm:pb-2">
          {(mentionList.length > 0 || mentionAll) && (
            <ul role="listbox" aria-label="멘션 자동완성" className="absolute bottom-full left-2 z-20 mb-1 w-56 overflow-hidden rounded-card border border-line bg-white shadow-pop" data-testid="chat-mentions">
              {mentionAll && <li><button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setText((c) => c.replace(/@[^\s@]*$/, '@전체 '))} data-testid="mention-all">
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-teal-100 text-teal-800"><Users className="size-3" /></span>전체<span className="text-xs text-ink-3">· 이 방 모두에게 알림</span></button></li>}
              {mentionList.map((m) => {
                const t = dir.users.find((x) => x.id === m.id)?.title;
                return <li key={m.id}><button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setText((c) => c.replace(/@[^\s@]*$/, `@${m.name} `))}><Avatar id={m.id} name={m.name} size={20} badge={false} />{m.name}{t && <span className="text-xs text-ink-3">· {t}</span>}</button></li>;
              })}
            </ul>
          )}
          {emojiOpen && <EmojiPanel tab={emojiTab} setTab={setEmojiTab} onEmoji={(em) => { insert(em); bumpFreq(em); setEmojiOpen(false); }} onSticker={sendSticker} />}
          {plusOpen && (
            // C13 입력창 [+]: 사진·카메라·파일·투표·일정·업무·스티커·음성 모드(휴대폰은 여기서, PC 는 📎·😊·@ 도 그대로)
            <div className="absolute bottom-full left-2 right-2 z-20 mb-1 grid grid-cols-4 gap-1 rounded-card border border-line bg-white p-2 shadow-pop sm:right-auto sm:w-80" data-testid="chat-plus-panel" onClick={() => setPlusOpen(false)}>
              {([
                ['photo', '사진·영상', ImageIcon, () => galleryRef.current?.click(), 'bg-sky-50 text-sky-700'],
                ['camera', '카메라', Camera, () => camRef.current?.click(), 'bg-teal-50 text-teal-700'],
                ['file', '파일', Paperclip, () => fileRef.current?.click(), 'bg-slate-100 text-slate-700'],
                ['poll', '투표', BarChart3, () => setPollOpen(true), 'bg-violet-50 text-violet-700'],
                ['event', '일정', CalendarPlus, () => { const today = dayKey(new Date().toISOString()); setEventDraft({ title: '', date: today, time: null }); }, 'bg-amber-50 text-amber-700'],
                ['task', '업무', SquarePen, () => setNewTask(true), 'bg-rose-50 text-rose-700'],
                ['sticker', '스티커', StickerIcon, () => { setEmojiTab('sticker'); setEmojiOpen(true); }, 'bg-emerald-50 text-emerald-700'],
                ['voice', voice ? '음성 모드 끄기' : '음성 모드', Headphones, toggleVoice, 'bg-indigo-50 text-indigo-700'],
              ] as const).map(([k, label, Icon, run, tone]) => (
                <button key={k} type="button" onClick={run} className="flex flex-col items-center gap-1 rounded-input px-1 py-2 text-[11px] text-ink-2 hover:bg-slate-50" data-testid={`plus-${k}`}>
                  <span className={cx('inline-flex size-10 items-center justify-center rounded-2xl', tone)}><Icon className="size-5" /></span>{label}
                </button>
              ))}
            </div>
          )}
          <button type="button" className={iconBtn} onClick={() => { setPlusOpen((v) => !v); setEmojiOpen(false); }} aria-label="더 보내기(사진·파일·투표·일정·업무)" aria-expanded={plusOpen} title="사진·파일·투표·일정·업무" data-testid="chat-plus"><Plus className={cx('size-[18px] transition-transform', plusOpen && 'rotate-45')} /></button>
          <button type="button" className={cx(iconBtn, 'hidden sm:inline-flex')} onClick={() => fileRef.current?.click()} aria-label="파일 보내기" title="파일 보내기"><Paperclip className="size-[18px]" /></button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} data-testid="chat-file" />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
          <input ref={galleryRef} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} data-testid="chat-gallery-input" />
          <VoiceButton small value={text} onChange={(v) => onType(v)} label="음성 입력" />
          <textarea ref={inputRef} rows={1} className={cx(inputCls, 'max-h-32 min-h-9 min-w-0 flex-1 resize-none py-1.5')} placeholder="메시지 입력" title="Enter 보내기 · Shift+Enter 줄바꿈 · @ 멘션 · 이미지 붙여넣기" value={text}
            onChange={(e) => onType(e.target.value)} aria-label="메시지" data-testid="chat-input"
            onFocus={() => { setPlusOpen(false); setTimeout(() => { if (!detachedRef.current) toBottom(); inputRef.current?.scrollIntoView({ block: 'nearest' }); }, 80); }} // 핫픽스: 키보드가 열리며 칸이 줄어들면 맨 아래·입력창이 보이게
            onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); upload(fs); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } if (e.key === 'Escape') { setReplyTo(null); setPlusOpen(false); setEmojiOpen(false); } }} />
          <button type="button" className={iconBtn} onClick={() => { setEmojiOpen((v) => !v); setPlusOpen(false); }} aria-label="이모지·스티커" title="이모지·스티커" aria-expanded={emojiOpen} data-testid="chat-emoji-open"><SmilePlus className="size-[18px]" /></button>
          <button type="button" className={cx(iconBtn, 'hidden', !compact && 'sm:inline-flex')} onClick={() => insert(text && !text.endsWith(' ') ? ' @' : '@')} aria-label="사람 언급" title="사람 언급(@)"><AtSign className="size-[18px]" /></button>
          <Button type="submit" className="h-9 shrink-0 bg-teal-700 hover:bg-teal-800" disabled={!text.trim()} aria-label="보내기" data-testid="chat-send"><Send /></Button>
        </form>
      </DropZone>
      {toTask && <ToTask s={toTask} roomName={room.name} onClose={() => setToTask(null)} onDone={() => { setToTask(null); reload(); }} />}
      {info && <RoomInfo data={data!} onClose={() => setInfo(false)} onChanged={() => { reload(); broadcastRefresh(); onRead(); }} onLeft={() => { setInfo(false); broadcastRefresh(); onBack(); }} />}
      {fwd && <ForwardModal msg={fwd} fromRoom={id} onClose={() => setFwd(null)} />}
      {viewer && <MediaViewer items={mediaList} start={viewer} onClose={() => setViewer(null)} onForward={(m) => { setViewer(null); setFwd(m); }} />}
      {longText && (
        <Modal open onClose={() => setLongText(null)} title="전체 보기">
          <div className="space-y-3" data-testid="msg-long-modal">
            <p className="text-xs text-ink-3">{longText.author_name} · {fmtDateTime(longText.created_at)}</p>
            <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed">{render(longText.body)}</div>
            <div className="flex justify-end"><Button size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(plain(longText.body)); toast.ok('복사했습니다'); }}>복사</Button></div>
          </div>
        </Modal>
      )}
      {pollOpen && <PollModal roomId={id} onClose={() => setPollOpen(false)} onSent={afterSend} />}
      {eventDraft && <EventModal roomId={id} draft={eventDraft} members={members} me={user.id} onClose={() => setEventDraft(null)} onSent={afterSend} />}
      {newTask && <QuickAddTask open onClose={() => setNewTask(false)} defaults={{ description: `메신저 "${room.name}"에서 만든 업무` }}
        onCreated={async (tid) => {
          setNewTask(false);
          // [+] 업무: 만든 업무를 방에 알리고(메시지 → 업무 연결) 모두가 바로 열 수 있게
          try {
            const t = await api(`/api/tasks/${tid}`); const title = t?.task?.title ?? t?.title ?? '새 업무';
            const r = await api(`/api/chat/rooms/${id}/messages`, { body: { body: `📌 새 업무: ${title}` } });
            await api(`/api/chat/messages/${r.id}/link`, { body: { taskId: tid } });
            afterSend(r.id, { body: `📌 새 업무: ${title}`, task_id: tid });
          } catch (e: any) { toast.error(e.message); }
        }} />}
    </div>
  );
}

/** B10 회사 기본 스티커 — 그림 파일 없이 이모지 + 짧은 말 */
const STICKER_TONE = { teal: 'bg-teal-50 text-teal-900 ring-teal-200', amber: 'bg-amber-50 text-amber-900 ring-amber-200', violet: 'bg-violet-50 text-violet-900 ring-violet-200',
  sky: 'bg-sky-50 text-sky-900 ring-sky-200', slate: 'bg-slate-100 text-slate-800 ring-slate-200', rose: 'bg-rose-50 text-rose-900 ring-rose-200' } as const;
function StickerView({ s, small }: { s: NonNullable<ReturnType<typeof stickerOf>>; small?: boolean }) {
  return (
    <span className={cx('inline-flex flex-col items-center justify-center rounded-3xl text-center ring-1', STICKER_TONE[s.tone], small ? 'size-[72px] gap-0.5' : 'size-28 gap-1')} data-testid="chat-sticker" data-sticker={s.code}>
      <span className={small ? 'text-2xl leading-none' : 'text-[40px] leading-none'} aria-hidden>{s.emoji}</span>
      <span className={cx('px-1 font-bold leading-tight', small ? 'text-[10px]' : 'text-[13px]')}>{s.text}</span>
    </span>
  );
}

/** B8 사진 묶음: 2·4장은 2칸, 나머지는 3칸, 9장 넘으면 마지막 칸에 +n — 누르면 좌우 넘기기 뷰어 */
function Album({ items, onOpen }: { items: Msg[]; onOpen: (id: string) => void }) {
  const show = items.slice(0, 9); const more = items.length - show.length;
  return (
    <div className={cx('grid w-[264px] max-w-full gap-0.5 overflow-hidden rounded-xl bg-slate-100', items.length === 2 || items.length === 4 ? 'grid-cols-2' : 'grid-cols-3')} data-testid="chat-album" data-count={items.length}>
      {show.map((x, k) => (
        <button key={x.id} type="button" className="relative aspect-square overflow-hidden" onClick={(e) => { e.stopPropagation(); onOpen(x.id); }} aria-label={`${k + 1}번째 ${isVideo(x) ? '영상' : '사진'} 크게 보기`} data-testid="album-item">
          {isVideo(x) ? <video src={fileUrl(x.id)} preload="metadata" muted playsInline className="size-full object-cover" /> : <img src={fileUrl(x.id)} alt={x.file_name ?? ''} loading="lazy" className="size-full object-cover" />}
          {isVideo(x) && <span className="absolute inset-0 m-auto flex size-8 items-center justify-center rounded-full bg-black/55 text-white"><Play className="size-4" /></span>}
          {k === show.length - 1 && more > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-lg font-bold text-white">+{more}</span>}
        </button>
      ))}
    </div>
  );
}

/** B8 사진·영상 뷰어: 방의 사진·영상을 좌우로 넘기기(← → 키·밀기), 저장(내려받기)·전달 */
function MediaViewer({ items, start, onClose, onForward }: { items: Msg[]; start: string; onClose: () => void; onForward: (m: Msg) => void }) {
  const [i, setI] = useState(() => Math.max(0, items.findIndex((x) => x.id === start)));
  const go = useCallback((d: number) => setI((k) => Math.min(items.length - 1, Math.max(0, k + d))), [items.length]);
  useSheetBack(true, onClose); // 앱 뒤로 버튼 = 뷰어만 닫힘
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [go, onClose]);
  const sx = useRef<number | null>(null);
  const m = items[i];
  if (!m || typeof document === 'undefined') return null;
  const nav = 'absolute top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25';
  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-black/95 text-white" role="dialog" aria-modal="true" aria-label="사진·영상 크게 보기" data-testid="chat-viewer">
      <div className="flex items-center gap-1 px-3 pb-2 pt-[calc(0.5rem+var(--sat))]">
        <div className="min-w-0 flex-1 text-sm"><div className="truncate font-semibold">{m.author_name ?? ''}</div><div className="text-xs text-white/70">{fmtDateTime(m.created_at)}</div></div>
        <span className="px-2 text-xs tabular-nums text-white/80" data-testid="viewer-count">{i + 1} / {items.length}</span>
        <a href={fileUrl(m.id, false)} className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/10" aria-label="저장(내려받기)" title="저장(내려받기)" data-testid="viewer-save"><Download className="size-5" /></a>
        <button type="button" className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/10" onClick={() => onForward(m)} aria-label="전달" title="전달"><Forward className="size-5" /></button>
        <button type="button" className="inline-flex size-9 items-center justify-center rounded-full hover:bg-white/10" onClick={onClose} aria-label="닫기" data-testid="viewer-close"><X className="size-5" /></button>
      </div>
      <div className="relative flex min-h-0 flex-1 select-none items-center justify-center px-2 pb-[var(--sab)]" style={{ touchAction: 'pan-y' }}
        onPointerDown={(e) => { sx.current = e.clientX; }}
        onPointerUp={(e) => { if (sx.current === null) return; const d = e.clientX - sx.current; sx.current = null; if (d > 50) go(-1); else if (d < -50) go(1); }}>
        {isVideo(m)
          ? <video key={m.id} src={fileUrl(m.id)} controls playsInline className="max-h-full max-w-full" data-testid="viewer-video" />
          : <img key={m.id} src={fileUrl(m.id)} alt={m.file_name ?? ''} draggable={false} className="max-h-full max-w-full object-contain" data-testid="viewer-image" />}
        {i > 0 && <button type="button" className={cx(nav, 'left-2')} onClick={() => go(-1)} aria-label="이전" data-testid="viewer-prev"><ChevronLeft className="size-6" /></button>}
        {i < items.length - 1 && <button type="button" className={cx(nav, 'right-2')} onClick={() => go(1)} aria-label="다음" data-testid="viewer-next"><ChevronRight className="size-6" /></button>}
      </div>
    </div>, document.body);
}

/** B10 이모지·스티커 패널 — 이모지는 '자주 쓰는'(이 기기 기억)이 먼저 */
function EmojiPanel({ tab, setTab, onEmoji, onSticker }: { tab: 'emoji' | 'sticker'; setTab: (t: 'emoji' | 'sticker') => void; onEmoji: (e: string) => void; onSticker: (code: string) => void }) {
  const freq = useMemo(() => Object.entries(readFreq()).sort((a, b) => b[1] - a[1]).map(([e]) => e).filter((e) => INSERT_EMOJI.includes(e)).slice(0, 8), []);
  const tabCls = (on: boolean) => cx('rounded-full px-2.5 py-0.5 text-xs', on ? 'bg-teal-700 font-semibold text-white' : 'text-ink-2 hover:bg-slate-100');
  return (
    <div className="absolute bottom-full left-2 right-2 z-20 mb-1 rounded-card border border-line bg-white p-2 shadow-pop sm:left-auto sm:w-80" data-testid="chat-emoji">
      <div className="mb-1.5 flex gap-1" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'emoji'} className={tabCls(tab === 'emoji')} onClick={() => setTab('emoji')} data-testid="emoji-tab">이모지</button>
        <button type="button" role="tab" aria-selected={tab === 'sticker'} className={tabCls(tab === 'sticker')} onClick={() => setTab('sticker')} data-testid="sticker-tab">스티커</button>
      </div>
      {tab === 'emoji' ? (
        <div className="max-h-56 overflow-y-auto">
          {freq.length > 0 && <><div className="px-0.5 text-[10px] font-semibold text-ink-3">자주 쓰는</div><div className="mb-1 grid grid-cols-8 gap-0.5">{freq.map((em) => <button type="button" key={`f-${em}`} className="rounded p-0.5 text-lg hover:bg-slate-100" onClick={() => onEmoji(em)}>{em}</button>)}</div></>}
          <div className="grid grid-cols-8 gap-0.5">{INSERT_EMOJI.map((em) => <button type="button" key={em} className="rounded p-0.5 text-lg hover:bg-slate-100" onClick={() => onEmoji(em)}>{em}</button>)}</div>
        </div>
      ) : (
        <div className="grid max-h-60 grid-cols-4 gap-1.5 overflow-y-auto" data-testid="sticker-grid">
          {STICKERS.map((st) => <button type="button" key={st.code} onClick={() => onSticker(st.code)} className="rounded-2xl p-0.5 hover:bg-slate-50" aria-label={`스티커 ${st.text}`} data-testid={`sticker-${st.code}`}><StickerView s={st} small /></button>)}
        </div>
      )}
    </div>
  );
}

/** B9 투표 카드: 누르면 바로 투표(하나만이면 바꾸기·다시 누르면 취소), 막대·표 수, 익명 아니면 '누가 골랐나', 만든 사람·방장은 [투표 마감] */
function PollCard({ m, canClose, onChanged }: { m: Msg; canClose: boolean; onChanged: (p: Poll) => void }) {
  const p = m.poll!;
  const [busy, setBusy] = useState(false);
  const [showNames, setShowNames] = useState(false);
  const max = Math.max(0, ...p.counts);
  async function vote(k: number) {
    if (p.closed || busy) return;
    const next = p.multi ? (p.mine.includes(k) ? p.mine.filter((x) => x !== k) : [...p.mine, k].sort((a, b) => a - b)) : p.mine.includes(k) ? [] : [k];
    const counts = p.counts.map((c, x) => c - (p.mine.includes(x) ? 1 : 0) + (next.includes(x) ? 1 : 0));
    const voters = p.voters + (!p.mine.length && next.length ? 1 : 0) - (p.mine.length && !next.length ? 1 : 0);
    onChanged({ ...p, mine: next, counts, voters });
    setBusy(true);
    try { await api(`/api/chat/messages/${m.id}/poll`, { body: { vote: next } }); } catch (e: any) { toast.error(e.message); onChanged(p); } finally { setBusy(false); }
  }
  async function close() {
    if (!confirm('투표를 마감할까요? 마감하면 더 투표할 수 없습니다')) return;
    try { await api(`/api/chat/messages/${m.id}/poll`, { body: { close: true } }); onChanged({ ...p, closed: true }); } catch (e: any) { toast.error(e.message); }
  }
  return (
    <div className="w-64 max-w-full rounded-2xl border border-line bg-white p-3 text-ink shadow-card" data-testid="chat-poll" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-700"><BarChart3 className="size-3.5" />투표
        {p.closed && <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-2" data-testid="poll-closed">마감</span>}</div>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold" data-testid="poll-question">{p.question}</p>
      <p className="mt-0.5 text-[11px] text-ink-3">{[p.multi ? '여러 개 선택' : '하나만 선택', p.anonymous ? '익명' : null, p.closes_at && !p.closed ? `${fmtDateTime(p.closes_at)} 마감` : null].filter(Boolean).join(' · ')}</p>
      <ul className="mt-2 space-y-1.5">
        {p.options.map((o, k) => {
          const mine = p.mine.includes(k); const pct = p.voters ? Math.round((p.counts[k] / p.voters) * 100) : 0;
          return (
            <li key={k}>
              <button type="button" disabled={p.closed || busy} onClick={() => vote(k)} aria-pressed={mine} data-testid="poll-option"
                className={cx('relative w-full overflow-hidden rounded-input border px-2.5 py-1.5 text-left text-sm disabled:cursor-default', mine ? 'border-teal-600' : 'border-line', !p.closed && 'hover:border-teal-500')}>
                <span className={cx('absolute inset-y-0 left-0', p.closed && max > 0 && p.counts[k] === max ? 'bg-amber-100' : mine ? 'bg-teal-100' : 'bg-slate-100')} style={{ width: `${pct}%` }} aria-hidden />
                <span className="relative flex items-center gap-2">
                  <span className={cx('inline-flex size-4 shrink-0 items-center justify-center border', p.multi ? 'rounded' : 'rounded-full', mine ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white')}>{mine && <Check className="size-3" />}</span>
                  <span className="min-w-0 flex-1 break-words">{o}</span><span className="shrink-0 text-xs tabular-nums text-ink-2" data-testid="poll-count">{p.counts[k]}</span>
                </span>
              </button>
              {showNames && !!p.names?.[k]?.length && <p className="mt-0.5 px-1 text-[11px] text-ink-3" data-testid="poll-names-line">{p.names[k].join(', ')}</p>}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-3">
        {!p.anonymous && p.voters > 0 ? <button type="button" className="underline" onClick={() => setShowNames((v) => !v)} data-testid="poll-names">{p.voters}명 참여 · {showNames ? '이름 숨기기' : '누가 골랐나'}</button>
          : <span data-testid="poll-voters">{p.voters}명 참여</span>}
        {canClose && !p.closed && <button type="button" className="ml-auto rounded-input border border-line px-2 py-0.5 text-ink-2 hover:bg-slate-50" onClick={close} data-testid="poll-close">투표 마감</button>}
      </div>
    </div>
  );
}

/** B9 일정 카드: 제목·시각·장소·참석 수, 내가 참석자면 [참석][불참], 캘린더로 */
function EventCardView({ ev, onChanged }: { ev: EventCard; onChanged: (e: EventCard) => void }) {
  async function respond(r: 'accepted' | 'declined') {
    if (ev.response === r) return;
    onChanged({ ...ev, response: r, going: ev.going + (r === 'accepted' ? 1 : 0) - (ev.response === 'accepted' ? 1 : 0) });
    try { await api(`/api/events/${ev.id}/respond`, { body: { response: r } }); } catch (e: any) { toast.error(e.message); onChanged(ev); }
  }
  const btn = (on: boolean) => cx('rounded-input border px-2 py-1 text-xs font-medium', on ? 'border-teal-700 bg-teal-700 text-white' : 'border-line text-ink-2 hover:bg-slate-50');
  return (
    <div className="w-64 max-w-full rounded-2xl border border-line bg-white p-3 text-ink shadow-card" data-testid="chat-event" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700"><CalendarPlus className="size-3.5" />일정
        {ev.cancelled && <span className="ml-auto rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-2">취소됨</span>}</div>
      <p className={cx('mt-1 break-words text-sm font-semibold', ev.cancelled && 'text-ink-3 line-through')} data-testid="event-title">{ev.title}</p>
      <p className="mt-0.5 text-xs text-ink-2" data-testid="event-when">{whenText(new Date(ev.start_at), new Date(ev.end_at), ev.all_day)}</p>
      {ev.location && <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-2"><MapPin className="size-3 shrink-0" />{ev.location}</p>}
      <p className="mt-1 text-[11px] text-ink-3" data-testid="event-going">참석 {ev.going}명 · 초대 {ev.invited}명</p>
      {!ev.cancelled && ev.response && (
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button type="button" className={btn(ev.response === 'accepted')} aria-pressed={ev.response === 'accepted'} onClick={() => respond('accepted')} data-testid="event-accept">참석</button>
          <button type="button" className={btn(ev.response === 'declined')} aria-pressed={ev.response === 'declined'} onClick={() => respond('declined')} data-testid="event-decline">불참</button>
        </div>
      )}
      <Link href={`/calendar?event=${ev.id}`} className="mt-2 block text-center text-xs text-accent-600 underline">캘린더에서 보기</Link>
    </div>
  );
}

/** B9 투표 만들기: 질문·보기 2~10개·여러 개 선택·익명·마감(서울 시각) */
function PollModal({ roomId, onClose, onSent }: { roomId: string; onClose: () => void; onSent: (id: string, p: Partial<Msg>) => void }) {
  const [q, setQ] = useState('');
  const [opts, setOpts] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [anon, setAnon] = useState(false);
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    const options = opts.map((o) => o.trim()).filter(Boolean);
    if (!q.trim()) return toast.error('질문을 입력하세요');
    if (options.length < POLL_MIN) return toast.error(`보기를 ${POLL_MIN}개 이상 넣으세요`);
    setBusy(true);
    try {
      const closesAt = due ? new Date(`${due}:00+09:00`).toISOString() : null;
      const r = await api(`/api/chat/rooms/${roomId}/messages`, { body: { poll: { question: q.trim(), options, multi, anonymous: anon, closesAt } } });
      onSent(r.id, { kind: 'poll', body: q.trim(), poll: { question: q.trim(), options, multi, anonymous: anon, closes_at: closesAt, closed: false, counts: options.map(() => 0), mine: [], voters: 0, names: anon ? null : {} } });
      onClose();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="투표 만들기">
      <div className="space-y-3 text-sm" data-testid="poll-modal">
        <Field label="질문"><input autoFocus className={inputCls} value={q} maxLength={200} onChange={(e) => setQ(e.target.value)} placeholder="예: 회식 날짜 정해요" data-testid="poll-q" /></Field>
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-ink-2">보기</div>
          {opts.map((o, k) => (
            <div key={k} className="flex items-center gap-1.5">
              <input className={inputCls} value={o} maxLength={80} onChange={(e) => setOpts((c) => c.map((x, j) => (j === k ? e.target.value : x)))} placeholder={`보기 ${k + 1}`} data-testid="poll-opt" />
              {opts.length > POLL_MIN && <button type="button" className="rounded p-1 text-ink-3 hover:bg-slate-100" onClick={() => setOpts((c) => c.filter((_, j) => j !== k))} aria-label={`보기 ${k + 1} 빼기`}><Trash2 className="size-4" /></button>}
            </div>
          ))}
          {opts.length < POLL_MAX && <button type="button" className="text-xs font-semibold text-teal-700" onClick={() => setOpts((c) => [...c, ''])} data-testid="poll-add-opt">+ 보기 추가</button>}
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} data-testid="poll-multi" />여러 개 선택</label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} data-testid="poll-anon" />익명 투표</label>
        </div>
        <Field label="마감(선택)"><input type="datetime-local" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} data-testid="poll-due" /></Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button disabled={busy} onClick={go} data-testid="poll-go">투표 올리기</Button></div>
      </div>
    </Modal>
  );
}

/** B9 일정 잡기: 캘린더 일정(참석자 = 방 참여자, 뺄 수 있음) + 방에 일정 카드. 메시지에서 열면 글의 날짜·시각을 미리 채움 */
function EventModal({ roomId, draft, members, me, onClose, onSent }: { roomId: string; draft: { title: string; date: string; time: string | null; fromMessage?: string }; members: Member[]; me: string; onClose: () => void; onSent: (id: string, p: Partial<Msg>) => void }) {
  const nextHour = () => { const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(new Date())); return `${String(Math.min(23, h + 1)).padStart(2, '0')}:00`; };
  const plus1 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(h >= 23 ? 59 : m).padStart(2, '0')}`; };
  const [title, setTitle] = useState(draft.title);
  const [date, setDate] = useState(draft.date);
  const [allDay, setAllDay] = useState(false);
  const [start, setStart] = useState(draft.time ?? nextHour());
  const [end, setEnd] = useState(plus1(draft.time ?? nextHour()));
  const [loc, setLoc] = useState('');
  const others = members.filter((x) => x.id !== me);
  const [pick, setPick] = useState<string[]>(others.map((x) => x.id));
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!title.trim()) return toast.error('제목을 입력하세요');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast.error('날짜를 고르세요');
    const s = allDay ? `${date}T00:00:00+09:00` : `${date}T${start}:00+09:00`;
    const e = allDay ? new Date(Date.parse(`${date}T00:00:00+09:00`) + 864e5).toISOString() : `${date}T${end}:00+09:00`;
    if (!allDay && Date.parse(e) <= Date.parse(s)) return toast.error('끝 시각이 시작 시각보다 늦어야 합니다');
    setBusy(true);
    try {
      const r = await api(`/api/chat/rooms/${roomId}/event`, { body: { title: title.trim(), start: s, end: e, allDay, location: loc.trim() || undefined, attendeeIds: pick, ...(draft.fromMessage ? { fromMessage: draft.fromMessage } : {}) } });
      onSent(r.id, { kind: 'event', body: `📅 ${title.trim()}`, event: { id: r.eventId, title: title.trim(), start_at: new Date(s).toISOString(), end_at: new Date(e).toISOString(), all_day: allDay, location: loc.trim(), cancelled: false, going: 1, invited: pick.length + 1, response: 'accepted' } });
      toast.ok(pick.length ? `일정을 잡고 ${pick.length}명을 초대했습니다` : '일정을 잡았습니다');
      onClose();
    } catch (er: any) { toast.error(er.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="일정 잡기">
      <div className="space-y-3 text-sm" data-testid="event-modal">
        <Field label="제목"><input autoFocus className={inputCls} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="예: 주간 회의" data-testid="event-title-input" /></Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="날짜"><input type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} data-testid="event-date" /></Field>
          <label className="mt-6 inline-flex items-center gap-1.5"><input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} data-testid="event-allday" />하루 종일</label>
        </div>
        {!allDay && (
          <div className="grid grid-cols-2 gap-2">
            <Field label="시작"><input type="time" className={inputCls} value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value >= end) setEnd(plus1(e.target.value)); }} data-testid="event-start" /></Field>
            <Field label="끝"><input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} data-testid="event-end" /></Field>
          </div>
        )}
        <Field label="장소(선택)"><input className={inputCls} value={loc} maxLength={300} onChange={(e) => setLoc(e.target.value)} placeholder="예: 3층 회의실" data-testid="event-loc" /></Field>
        {others.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-ink-2">참석자 {pick.length + 1}명(나 포함)
              <button type="button" className="font-normal text-teal-700 underline" onClick={() => setPick(pick.length === others.length ? [] : others.map((x) => x.id))}>{pick.length === others.length ? '모두 빼기' : '모두 넣기'}</button></div>
            <ul className="max-h-36 overflow-y-auto rounded-input border border-line p-1" data-testid="event-people">
              {others.map((x) => <li key={x.id}><label className="flex items-center gap-2 px-1 py-0.5"><input type="checkbox" checked={pick.includes(x.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, x.id] : p.filter((y) => y !== x.id)))} aria-label={`${x.name} 참석`} />{x.name}{x.title && <span className="text-xs text-ink-3">· {x.title}</span>}</label></li>)}
            </ul>
          </div>
        )}
        <p className="text-xs text-ink-3">내 캘린더에 일정이 생기고, 참석자에게 &lsquo;일정 초대&rsquo; 알림이 갑니다.</p>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>취소</Button><Button disabled={busy} onClick={go} data-testid="event-go">일정 잡기</Button></div>
      </div>
    </Modal>
  );
}

export function NewRoom({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const { user, dir } = useSession();
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  // A1: 최근 대화 상대(1:1 방이 있는 사람)를 먼저, 나머지는 부서별로 묶어서. 이름·부서·직급으로 찾기
  const { data: recent } = useApi<{ rooms: RoomRow[] }>(open ? '/api/chat/rooms' : null);
  const recentIds = useMemo(() => (recent?.rooms ?? []).filter((r) => r.kind === 'dm' && r.other_id).map((r) => r.other_id as string), [recent]);
  const unitName = (id: string) => dir.orgUnits.find((o) => o.id === id)?.name ?? '';
  const unitsOf = (u: { org_unit_ids: string[] }) => u.org_unit_ids.map(unitName).filter(Boolean);
  const needle = q.trim();
  const people = dir.users.filter((u) => u.id !== user.id && (!needle || u.name.includes(needle) || (u.title ?? '').includes(needle) || unitsOf(u).some((n) => n.includes(needle))));
  const groups = useMemo(() => {
    const out: { label: string; users: typeof people }[] = [];
    const rec = people.filter((u) => recentIds.includes(u.id)).sort((a, b) => recentIds.indexOf(a.id) - recentIds.indexOf(b.id));
    if (rec.length) out.push({ label: '최근 대화', users: rec });
    const byUnit = new Map<string, typeof people>();
    for (const u of people) { const k = unitsOf(u)[0] || '부서 없음'; byUnit.set(k, [...(byUnit.get(k) ?? []), u]); }
    for (const [label, users] of [...byUnit.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko'))) out.push({ label, users });
    return out;
  }, [people, recentIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const pickedUsers = picked.map((id) => dir.users.find((u) => u.id === id)).filter(Boolean) as typeof dir.users;
  const autoName = [user.name, ...pickedUsers.map((u) => u.name)];
  const preview = autoName.length <= 3 ? autoName.join(', ') : `${autoName.slice(0, 3).join(', ')} 외 ${autoName.length - 3}`;
  async function go(userId?: string) {
    try {
      const ids = userId ? [userId] : picked;
      const r = ids.length === 1 ? await api('/api/chat/rooms', { body: { kind: 'dm', userId: ids[0] } })
        : await api('/api/chat/rooms', { body: { kind: 'group', name: name.trim() || undefined, userIds: ids } });
      setPicked([]); setName(''); setQ(''); onOpen(r.id);
    } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="새 대화">
      <div className="space-y-3" data-testid="chat-new-modal">
        <input className={inputCls} placeholder="이름·부서·직급으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="사람 찾기" data-testid="chat-new-q" />
        {picked.length > 0 && (
          <div className="flex flex-wrap items-center gap-1" data-testid="chat-new-picked">
            {pickedUsers.map((u) => <button key={u.id} type="button" onClick={() => toggle(u.id)} className="inline-flex items-center gap-1 rounded-full border border-teal-700 bg-teal-50 px-2 py-0.5 text-xs text-teal-800" aria-label={`${u.name} 빼기`}>{u.name}<X className="size-3" /></button>)}
          </div>
        )}
        <ul className="max-h-72 overflow-y-auto rounded-input border border-line" data-testid="chat-new-list">
          {groups.map((g) => (
            <li key={g.label}>
              <div className="sticky top-0 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-ink-3">{g.label}</div>
              <ul className="divide-y divide-line">
                {g.users.map((u) => (
                  <li key={`${g.label}-${u.id}`}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} aria-label={`${u.name} 선택`} />
                      <Avatar id={u.id} name={u.name} size={28} badge={false} />
                      <span className="flex-1 truncate">{u.name} <RoleBadge role={u.role} guest={u.is_demo} />{u.title && <span className="text-ink-3"> · {u.title}</span>}{unitsOf(u)[0] && <span className="text-ink-3"> · {unitsOf(u)[0]}</span>}</span>
                      <Button size="sm" variant="secondary" onClick={(e) => { e.preventDefault(); go(u.id); }} aria-label={`${u.name}와 대화`}>대화</Button>
                    </label>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {!people.length && <li className="px-3 py-6 text-center text-sm text-ink-3">찾는 사람이 없습니다</li>}
        </ul>
        {picked.length >= 2 && <Field label="대화방 이름(비우면 자동)"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={preview} data-testid="chat-new-name" /></Field>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-3">{picked.length === 0 ? '사람을 고르세요 — 1명은 1:1, 2명 이상은 그룹' : picked.length === 1 ? '1:1 대화' : `그룹 대화 · ${picked.length + 1}명`}</span>
          <Button disabled={!picked.length} onClick={() => go()} data-testid="chat-group-create">{picked.length <= 1 ? '대화 시작' : `${picked.length}명과 대화 시작`}</Button>
        </div>
      </div>
    </Modal>
  );
}

/** A2 방 정보: 이름·참여자(직급·1:1)·[초대]·[내보내기](방장/관리자)·[나가기]·알림·고정·이전 대화 공개·사진/파일/링크 모아보기 */
function RoomInfo({ data, onClose, onChanged, onLeft }: { data: RoomData; onClose: () => void; onChanged: () => void; onLeft: () => void }) {
  const { user, dir } = useSession();
  const { room, members } = data;
  const [tab, setTab] = useState<'members' | 'media'>('members');
  const [inviting, setInviting] = useState(false);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { data: media } = useApi<{ images: { id: string; file_name: string }[]; files: { id: string; file_name: string; file_size: number | null; author_name: string | null }[]; links: { id: string; url: string; author_name: string | null }[] }>(tab === 'media' ? `/api/chat/rooms/${room.id}/media` : null);
  const { data: list } = useApi<{ rooms: RoomRow[] }>('/api/chat/rooms');
  const row = list?.rooms.find((r) => r.id === room.id);
  const isGroup = room.kind === 'group';
  const candidates = dir.users.filter((u) => u.id !== user.id && !members.some((m) => m.id === u.id));
  async function run(f: () => Promise<unknown>, done?: string) { setBusy(true); try { await f(); if (done) toast.ok(done); onChanged(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  async function dmWith(id: string) { try { const r = await api('/api/chat/rooms', { body: { kind: 'dm', userId: id } }); window.location.href = `/messages?room=${r.id}`; } catch (e: any) { toast.error(e.message); } }
  return (
    <Modal open onClose={onClose} title="방 정보">
      <div className="space-y-3 text-sm" data-testid="chat-room-info">
        <div className="flex items-center gap-3">
          <RoomIcon r={{ kind: room.kind, other_id: room.kind === 'dm' ? members.find((m) => m.id !== user.id)?.id ?? null : null, name: room.name }} size={44} />
          <div className="min-w-0 flex-1"><div className="truncate font-semibold">{room.name}</div><div className="text-xs text-ink-3">{KIND_LABEL[room.kind]} · {members.length}명{room.ownerId && <> · 방장 {members.find((m) => m.id === room.ownerId)?.name ?? ''}</>}</div></div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => run(() => api(`/api/chat/rooms/${room.id}`, { method: 'PATCH', body: { muted: !room.muted } }))} disabled={busy} data-testid="info-mute">{room.muted ? <Bell /> : <BellOff />}{room.muted ? '알림 켜기' : '알림 끄기'}</Button>
          <Button size="sm" variant="secondary" onClick={() => run(() => api(`/api/chat/rooms/${room.id}`, { method: 'PATCH', body: { pinned: !row?.pinned } }))} disabled={busy || !row} data-testid="info-pin">{row?.pinned ? <PinOff /> : <Pin />}{row?.pinned ? '목록 고정 해제' : '목록 맨 위 고정'}</Button>
          {isGroup && <Button size="sm" variant="secondary" onClick={() => setInviting((v) => !v)} data-testid="info-invite"><UserPlus />초대</Button>}
          {isGroup && room.canManage && <Button size="sm" variant="secondary" onClick={() => run(() => api(`/api/chat/rooms/${room.id}`, { method: 'PATCH', body: { historyVisible: !room.historyVisible } }), room.historyVisible ? '앞으로 초대되는 사람은 초대 뒤 대화만 봅니다' : '이전 대화를 공개했습니다')} disabled={busy} data-testid="info-history" aria-pressed={!!room.historyVisible}>{room.historyVisible ? '이전 대화 공개 중' : '이전 대화 공개'}</Button>}
          {isGroup && <Button size="sm" variant="secondary" className="text-red-600" onClick={() => { if (confirm('이 대화방에서 나갈까요?')) run(() => api(`/api/chat/rooms/${room.id}`, { method: 'DELETE' })).then(onLeft); }} disabled={busy} data-testid="info-leave"><LogOut />나가기</Button>}
        </div>
        {isGroup && !room.historyVisible && <p className="text-xs text-ink-3">초대된 사람은 초대 시점 이후 메시지만 봅니다(회사 보안). 방장이 [이전 대화 공개]를 켜면 처음부터 봅니다.</p>}
        {inviting && (
          <div className="rounded-input border border-line p-2" data-testid="info-invite-box">
            <div className="mb-1 text-xs font-semibold text-ink-2">초대할 사람</div>
            <ul className="max-h-40 overflow-y-auto">
              {candidates.map((u) => <li key={u.id}><label className="flex items-center gap-2 px-1 py-1 text-sm"><input type="checkbox" checked={pick.includes(u.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} aria-label={`${u.name} 초대 선택`} />{u.name}{u.title && <span className="text-ink-3"> · {u.title}</span>}</label></li>)}
              {!candidates.length && <li className="px-1 py-2 text-xs text-ink-3">초대할 사람이 없습니다</li>}
            </ul>
            <div className="mt-1 flex justify-end"><Button size="sm" disabled={!pick.length || busy} onClick={() => run(() => api(`/api/chat/rooms/${room.id}/members`, { body: { userIds: pick } }), `${pick.length}명을 초대했습니다`).then(() => { setPick([]); setInviting(false); })} data-testid="info-invite-go">{pick.length}명 초대</Button></div>
          </div>
        )}
        <div className="flex gap-1.5" role="tablist">
          {(['members', 'media'] as const).map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cx('rounded-full border px-3 py-1 text-xs', tab === k ? 'border-teal-700 bg-teal-50 font-semibold text-teal-800' : 'border-line text-ink-2')} data-testid={`info-tab-${k}`}>{k === 'members' ? `참여자 ${members.length}` : '사진·파일·링크'}</button>)}
        </div>
        {tab === 'members' ? (
          <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-input border border-line" data-testid="info-members">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2 px-3 py-2">
                <Avatar id={m.id} name={m.name} size={28} badge={false} />
                <span className="min-w-0 flex-1 truncate">{m.name}{m.id === user.id && <span className="text-ink-3"> (나)</span>} <RoleBadge role={dir.users.find((x) => x.id === m.id)?.role} guest={dir.users.find((x) => x.id === m.id)?.is_demo} />{m.title && <span className="text-ink-3"> · {m.title}</span>}{m.is_owner && <span className="ml-1 rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-800">방장</span>}</span>
                {m.id !== user.id && <button type="button" className="rounded-input px-1.5 py-0.5 text-xs text-teal-700 hover:bg-teal-50" onClick={() => dmWith(m.id)} aria-label={`${m.name}와 1:1 대화`}>1:1</button>}
                {isGroup && room.canManage && m.id !== user.id && <button type="button" className="rounded-input p-1 text-ink-3 hover:bg-red-50 hover:text-red-600" onClick={() => { if (confirm(`${m.name}님을 내보낼까요?`)) run(() => api(`/api/chat/rooms/${room.id}/members`, { method: 'DELETE', body: { userId: m.id } }), `${m.name}님을 내보냈습니다`); }} aria-label={`${m.name} 내보내기`} title="내보내기" data-testid={`info-remove-${m.id}`}><UserMinus className="size-4" /></button>}
              </li>
            ))}
          </ul>
        ) : !media ? <Skeleton rows={3} /> : (
          <div className="space-y-2" data-testid="info-media">
            <div><div className="mb-1 text-xs font-semibold text-ink-2">사진 {media.images.length}</div>
              {media.images.length ? <div className="grid grid-cols-4 gap-1">{media.images.map((f) => <a key={f.id} href={`/api/chat/messages/${f.id}/file?inline=1`} target="_blank" rel="noreferrer"><img src={`/api/chat/messages/${f.id}/file?inline=1`} alt={f.file_name} loading="lazy" className="aspect-square w-full rounded-lg border border-line object-cover" /></a>)}</div> : <p className="text-xs text-ink-3">없음</p>}</div>
            <div><div className="mb-1 text-xs font-semibold text-ink-2">파일 {media.files.length}</div>
              {media.files.length ? <ul className="divide-y divide-line rounded-input border border-line">{media.files.map((f) => <li key={f.id}><a href={`/api/chat/messages/${f.id}/file`} className="flex items-center gap-2 px-2 py-1.5 text-xs no-underline"><FileText className="size-4 shrink-0 text-teal-700" /><span className="min-w-0 flex-1 truncate">{f.file_name}</span><span className="text-ink-3">{fmtSize(f.file_size)} · {f.author_name}</span></a></li>)}</ul> : <p className="text-xs text-ink-3">없음</p>}</div>
            <div><div className="mb-1 text-xs font-semibold text-ink-2">링크 {media.links.length}</div>
              {media.links.length ? <ul className="divide-y divide-line rounded-input border border-line">{media.links.map((l, i) => <li key={`${l.id}-${i}`}><a href={l.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-2 py-1.5 text-xs"><Link2 className="size-4 shrink-0 text-ink-3" /><span className="min-w-0 flex-1 truncate">{l.url}</span><span className="shrink-0 text-ink-3">{l.author_name}</span></a></li>)}</ul> : <p className="text-xs text-ink-3">없음</p>}</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/** B5 전달: 여러 방을 골라 한 번에 */
function ForwardModal({ msg, fromRoom, onClose }: { msg: Msg; fromRoom: string; onClose: () => void }) {
  const { data } = useApi<{ rooms: RoomRow[] }>('/api/chat/rooms');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const rooms = (data?.rooms ?? []).filter((r) => r.id !== fromRoom && (!q || (r.name ?? '').includes(q)));
  async function go() {
    setBusy(true);
    try { const r = await api(`/api/chat/messages/${msg.id}/forward`, { body: { roomIds: pick } }); toast.ok(`${r.sent.length}개 방에 전달했습니다`); broadcastRefresh(); onClose(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title="전달">
      <div className="space-y-3 text-sm" data-testid="chat-forward">
        <div className="rounded-input border border-line bg-slate-50 px-3 py-2 text-xs"><b>{msg.author_name}</b>: <span className="line-clamp-2">{plain(msg.body) || `📎 ${msg.file_name}`}</span></div>
        <input className={inputCls} placeholder="방 이름으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="방 찾기" />
        <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-input border border-line">
          {rooms.map((r) => <li key={r.id}><label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-slate-50"><input type="checkbox" checked={pick.includes(r.id)} onChange={(e) => setPick((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} aria-label={`${r.name ?? ''} 선택`} /><RoomIcon r={r} size={28} /><span className="flex-1 truncate">{r.name}</span><span className="text-xs text-ink-3">{KIND_LABEL[r.kind]}</span></label></li>)}
          {!data && <li className="p-3"><Skeleton rows={3} /></li>}
        </ul>
        <div className="flex justify-end"><Button disabled={!pick.length || busy} onClick={go} data-testid="chat-forward-go">{pick.length}개 방에 전달</Button></div>
      </div>
    </Modal>
  );
}

/** "업무로 만들기": AI(또는 첫 줄) 제안을 채운 업무 등록 창 → 만들면 메시지에 업무 연결 */
function ToTask({ s, roomName, onClose, onDone }: { s: { msg: Msg; title: string; dueDate: string | null; assigneeId: string | null; description: string }; roomName: string; onClose: () => void; onDone: () => void }) {
  const defaults = useMemo(() => ({ title: s.title, dueDate: s.dueDate ?? undefined, assigneeId: s.assigneeId ?? undefined,
    description: `${s.description}\n\n(메신저 "${roomName}" · ${s.msg.author_name ?? ''} · ${fmtDateTime(s.msg.created_at)})` }), [s, roomName]);
  return <QuickAddTask open onClose={onClose} defaults={defaults}
    onCreated={async (tid) => { await api(`/api/chat/messages/${s.msg.id}/link`, { body: { taskId: tid } }).catch(() => {}); toast.ok('업무를 만들었습니다'); onDone(); }} />;
}

export { MessageCircle };
