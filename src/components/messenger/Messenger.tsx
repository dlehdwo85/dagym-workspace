'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AtSign, Bell, BellOff, Camera, CornerUpLeft, Download, FileText, Hash, Loader2, Maximize2, MessageCircle, MoreHorizontal, Paperclip, Pin, PinOff, Plus, Search, Send, SmilePlus, SquarePen, Users, X } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { DropZone, UploadProgress, putFile } from '@/components/upload';
import { Avatar, Button, Field, Modal, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { QuickAddTask } from '@/components/QuickAddTask';

/**
 * V14 25번 메신저 — /messages 화면과 오른쪽 아래 패널이 같은 컴포넌트를 쓴다.
 * 목록(검색·＋새 대화·탭·아바타·미리보기·안 읽음·고정) / 대화방(연속 묶기·날짜 구분·읽음·이미지/파일 카드·답장 인용·반응·hover 메뉴) / 입력(자동 높이·📎📷😊@·붙여넣기·끌어 놓기)
 */
export type RoomRow = { id: string; kind: 'dm' | 'group' | 'company' | 'task' | 'team'; name: string | null; task_id: string | null; muted: boolean; pinned: boolean; unread: number; member_count: number;
  last_body: string | null; last_file: string | null; last_author: string | null; last_deleted: boolean; last_message_at: string | null; other_id: string | null };
type Reaction = { emoji: string; n: number; mine: boolean; names: string[] };
export type Msg = { id: string; room_id: string; author_id: string | null; author_name: string | null; created_at: string; edited_at: string | null; pinned_at: string | null;
  body: string; deleted: boolean; file_name: string | null; file_mime: string | null; file_size: number | null; task_id: string | null; mine: boolean;
  reply_to?: string | null; reply?: { author: string | null; body: string; file: string | null; deleted: boolean } | null; reactions?: Reaction[] };
export const KIND_LABEL = { dm: '1:1', group: '그룹', company: '회사 전체', task: '업무', team: '팀' } as const;
const EMOJI = ['👍', '❤️', '😂', '😮', '🙏', '✅'];
const INSERT_EMOJI = ['😀', '😂', '😊', '😍', '🙏', '👍', '👏', '🎉', '🔥', '✅', '❗', '❓', '💪', '😢', '😅', '🙌'];
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
    if (typeof EventSource === 'undefined') startPoll();
    else {
      es = new EventSource('/api/chat/stream');
      es.addEventListener('ready', (e) => { fails = 0; since = (e as MessageEvent).lastEventId || since; });
      es.addEventListener('messages', (e) => { const m = JSON.parse((e as MessageEvent).data); since = (e as MessageEvent).lastEventId || since; emit({ messages: m }); });
      es.addEventListener('typing', (e) => emit({ typing: JSON.parse((e as MessageEvent).data) }));
      es.addEventListener('reads', (e) => emit({ reads: JSON.parse((e as MessageEvent).data) }));
      es.onerror = () => { if (++fails >= 3 && es) { es.close(); es = null; startPoll(); } };
    }
    return () => { es?.close(); if (timer) clearInterval(timer); };
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
            <li key={r.id} className="group relative">
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
                      {r.last_deleted ? '삭제된 메시지' : r.last_body || r.last_file ? `${r.kind !== 'dm' && r.last_author ? r.last_author + ': ' : ''}${plain(r.last_body) || '📎 ' + r.last_file}` : '아직 메시지가 없습니다'}</span>
                    {r.unread > 0 && <span className={cx('shrink-0 rounded-full px-1.5 text-[11px] font-bold leading-5 text-white', r.muted ? 'bg-slate-400' : 'bg-red-500')} data-testid="room-unread">{r.unread > 99 ? '99+' : r.unread}</span>}
                  </span>
                </span>
              </button>
              <button onClick={() => pin(r)} className="absolute right-2 top-1 hidden rounded p-1 text-ink-3 hover:bg-white hover:text-ink group-hover:block" aria-label={r.pinned ? '고정 해제' : '위에 고정'} title={r.pinned ? '고정 해제' : '위에 고정'}>
                {r.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}</button>
            </li>
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

type RoomData = { room: { id: string; kind: RoomRow['kind']; name: string; taskId: string | null; muted: boolean }; messages: Msg[]; members: { id: string; name: string; last_read_id: string }[]; pinned: Msg[] };

/** 대화방 */
export function ChatRoom({ id, live, onRead, onBack, compact, onExpand, onClose, backAlways }: { id: string; live: Live; onRead: () => void; onBack: () => void; compact?: boolean; onExpand?: () => void; onClose?: () => void; backAlways?: boolean }) {
  const { user, dir } = useSession();
  const { data, error, loading, reload } = useApi<RoomData>(`/api/chat/rooms/${id}`);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
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
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  useEffect(() => { if (data) { setMsgs(data.messages); setReads(Object.fromEntries(data.members.map((m) => [m.id, m.last_read_id]))); } }, [data]);
  const markRead = useCallback(async () => { try { await api(`/api/chat/rooms/${id}/read`, { body: {} }); onRead(); } catch { /* 다음에 */ } }, [id, onRead]);
  useEffect(() => { if (data) markRead(); }, [data, markRead]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
  useEffect(() => { const el = inputRef.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 128)}px`; } }, [text]);
  useEffect(() => live.subscribe((e) => {
    if (e.messages?.some((m) => m.room_id === id)) {
      setMsgs((cur) => {
        const map = new Map(cur.map((m) => [m.id, m]));
        for (const m of e.messages!.filter((x) => x.room_id === id)) map.set(m.id, { ...map.get(m.id), ...m });
        return [...map.values()].sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
      });
      if (document.visibilityState === 'visible') markRead();
    }
    if (e.typing) setTyping(e.typing.filter((x) => x.room_id === id).map((x) => x.name));
    if (e.reads) setReads((r) => ({ ...r, ...Object.fromEntries(e.reads!.filter((x) => x.room_id === id).map((x) => [x.user_id, x.last_read_id])) }));
  }), [live, id, markRead]);
  useEffect(() => { if (!menu) return; const close = () => setMenu(null); window.addEventListener('click', close); return () => window.removeEventListener('click', close); }, [menu]);

  const members = data?.members ?? [];
  const toWire = (s: string) => members.filter((m) => m.id !== user.id).reduce((acc, m) => acc.split(`@${m.name}`).join(`@[${m.name}](${m.id})`), s);
  const mergeMine = (mid: string, p: Partial<Msg>) => setMsgs((cur) => cur.some((m) => m.id === mid) ? cur : [...cur, { id: mid, room_id: id, author_id: user.id, author_name: user.name, created_at: new Date().toISOString(),
    edited_at: null, pinned_at: null, body: '', deleted: false, file_name: null, file_mime: null, file_size: null, task_id: null, mine: true, reactions: [], ...p }]);
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    const body = toWire(text); const rep = replyTo; setText(''); setReplyTo(null);
    try {
      const r = await api(`/api/chat/rooms/${id}/messages`, { body: { body, ...(rep ? { replyTo: rep.id } : {}) } });
      mergeMine(r.id, { body, reply_to: rep?.id ?? null, reply: rep ? { author: rep.author_name, body: rep.body.slice(0, 120), file: rep.file_name, deleted: false } : null });
    } catch (er: any) { setText(text); setReplyTo(rep); toast.error(er.message); }
  }
  async function upload(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 10);
    if (!list.length) return;
    setProg(list.map((f) => ({ name: f.name, pct: 0 })));
    for (const [n, f] of list.entries()) {
      try {
        const name = f.name || `붙여넣은 이미지.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
        const t = await api(`/api/chat/rooms/${id}/files`, { body: { fileName: name, mime: f.type || 'application/octet-stream', size: f.size } });
        await putFile(t.upload, f, (pct) => setProg((x) => x.map((y, j) => (j === n ? { ...y, pct } : y))));
        const file = { key: t.key, name, mime: f.type || 'application/octet-stream', size: f.size };
        const r = await api(`/api/chat/rooms/${id}/messages`, { body: { body: '', file } });
        mergeMine(r.id, { file_name: name, file_mime: file.mime, file_size: f.size });
      } catch (er: any) { setProg((x) => x.map((y, j) => (j === n ? { ...y, error: er.message } : y))); }
    }
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
    setTimeout(() => setProg((x) => (x.some((y) => y.error) ? x : [])), 1200);
  }
  function onType(v: string) {
    setText(v);
    if (v && Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); api(`/api/chat/rooms/${id}/typing`, { body: {} }).catch(() => {}); }
  }
  const insert = (s: string) => { setText((c) => c + s); setTimeout(() => inputRef.current?.focus(), 0); };
  async function act(m: Msg, what: 'pin' | 'unpin' | 'delete' | 'task') {
    setMenu(null); setActive(null);
    try {
      if (what === 'delete') { if (!confirm('이 메시지를 지울까요? ("삭제된 메시지"로 표시됩니다)')) return; await api(`/api/chat/messages/${m.id}`, { method: 'DELETE' }); setMsgs((c) => c.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '' } : x))); }
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
    try { const r = await api(`/api/chat/rooms/${id}?before=${msgs[0].id}`); setMsgs((c) => [...r.messages.filter((m: Msg) => !c.some((x) => x.id === m.id)), ...c]); } catch (e: any) { toast.error(e.message); } finally { setOlder(false); }
  }
  async function toggleMute() {
    try { await api(`/api/chat/rooms/${id}`, { method: 'PATCH', body: { muted: !data!.room.muted } }); reload(); onRead(); } catch (e: any) { toast.error(e.message); }
  }
  if (error) return <div className="p-6 text-sm"><p className="font-semibold">대화방을 열 수 없습니다</p><p className="mt-1 text-ink-2">{error.message}</p><Button className="mt-3" variant="secondary" onClick={onBack}>목록으로</Button></div>;
  if (loading && !data) return <div className="p-3"><Skeleton rows={6} /></div>;
  const room = data!.room;
  const other = room.kind === 'dm' ? members.find((x) => x.id !== user.id) : null;
  const readBy = (m: Msg) => members.filter((x) => x.id !== m.author_id && BigInt(reads[x.id] ?? '0') >= BigInt(m.id)).length;
  const others = members.filter((x) => x.id !== user.id).length;
  const mention = /(^|\s)@([^\s@]*)$/.exec(text);
  const mentionList = mention ? members.filter((m) => m.id !== user.id && m.name.includes(mention[2])).slice(0, 6) : [];
  const iconBtn = 'inline-flex size-8 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100';
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-room">
      <header className="flex items-center gap-2 border-b border-line px-2 py-2">
        <button className={cx(iconBtn, !backAlways && 'sm:hidden')} onClick={onBack} aria-label="목록으로"><ArrowLeft className="size-5" /></button>
        <RoomIcon r={{ kind: room.kind, other_id: other?.id ?? null, name: room.name }} size={compact ? 30 : 36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold" data-testid="chat-room-name">{room.name}</div>
          <div className="truncate text-[11px] text-ink-3">{room.kind === 'dm' ? dir.users.find((x) => x.id === other?.id)?.title ?? '1:1' : `${KIND_LABEL[room.kind]} · ${members.length}명`}
            {room.taskId && <> · <Link href={`/tasks/${room.taskId}`} className="text-accent-600 underline">업무 보기</Link></>}{live.mode === 'poll' && ' · 5초마다 새로 고침'}</div>
        </div>
        <button className={iconBtn} onClick={toggleMute} aria-label={room.muted ? '알림 켜기' : '알림 끄기'} title={room.muted ? '알림 켜기' : '알림 끄기'} data-testid="chat-mute">{room.muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}</button>
        {!compact && user.role === 'owner' && <a className={iconBtn} href={`/api/chat/rooms/${id}/export`} aria-label="대화 내보내기(감사용)" title="대화 내보내기(감사용, 기록 남음)"><Download className="size-4" /></a>}
        {onExpand && <button className={iconBtn} onClick={onExpand} aria-label="크게 보기" title="크게 보기"><Maximize2 className="size-4" /></button>}
        {onClose && <button className={iconBtn} onClick={onClose} aria-label="닫기"><X className="size-4" /></button>}
      </header>
      {data!.pinned.length > 0 && (
        <div className="flex items-center gap-2 border-b border-line bg-amber-50 px-3 py-1.5 text-xs text-amber-900" data-testid="chat-pinned">
          <Pin className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate"><b>{data!.pinned[0].author_name}</b>: {plain(data!.pinned[0].body) || data!.pinned[0].file_name}</span>
          {data!.pinned.length > 1 && <span className="shrink-0">외 {data!.pinned.length - 1}개</span>}
        </div>
      )}
      <DropZone onFiles={upload} label="놓으면 이 대화방에 보냅니다" testid="chat-drop" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/60 px-3 py-2" data-testid="chat-messages" onClick={() => setActive(null)}>
          {msgs.length >= 60 && <div className="text-center"><Button size="sm" variant="ghost" onClick={loadOlder} disabled={older}>{older ? <Loader2 className="animate-spin" /> : null}이전 메시지</Button></div>}
          {!msgs.length && <p className="py-10 text-center text-sm text-ink-3">첫 메시지를 보내 보세요</p>}
          {msgs.map((m, i) => {
            const prev = msgs[i - 1], next = msgs[i + 1];
            const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
            const head = newDay || prev.author_id !== m.author_id || new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() > 5 * 60_000;
            const tail = !next || next.author_id !== m.author_id || dayKey(next.created_at) !== dayKey(m.created_at) || timeOf(next.created_at) !== timeOf(m.created_at);
            const img = m.file_name && /^image\/(png|jpe?g|gif|webp)$/.test(m.file_mime ?? '');
            const n = readBy(m);
            const showMenu = active === m.id || menu?.id === m.id;
            return (
              <div key={m.id}>
                {newDay && <div className="my-3 flex items-center gap-2 text-[11px] text-ink-3" data-testid="chat-date"><span className="h-px flex-1 bg-line" />{dayLabel(m.created_at)}<span className="h-px flex-1 bg-line" /></div>}
                <div className={cx('group relative flex gap-2', m.mine && 'flex-row-reverse', head ? 'mt-2.5' : 'mt-0.5')} data-testid="chat-message" data-mine={m.mine ? '1' : '0'}>
                  {!m.mine && (head ? <Avatar id={m.author_id} name={m.author_name} size={compact ? 30 : 34} badge={false} /> : <span className={cx('shrink-0', compact ? 'w-[30px]' : 'w-[34px]')} />)}
                  <div className={cx('flex min-w-0 max-w-[78%] flex-col', m.mine ? 'items-end' : 'items-start')}>
                    {head && !m.mine && <div className="mb-0.5 text-xs font-medium text-ink-2">{m.author_name}{dir.users.find((x) => x.id === m.author_id)?.title && <span className="ml-1 font-normal text-ink-3">{dir.users.find((x) => x.id === m.author_id)?.title}</span>}</div>}
                    <div className={cx('flex items-end gap-1.5', m.mine && 'flex-row-reverse')}>
                      {editing?.id === m.id ? (
                        <form onSubmit={saveEdit} className="flex gap-1"><input autoFocus className={cx(inputCls, 'h-8')} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }} aria-label="메시지 고치기" /><Button size="sm">저장</Button></form>
                      ) : m.deleted ? <span className="rounded-2xl bg-slate-100 px-3 py-1.5 text-sm italic text-ink-3">삭제된 메시지</span> : (
                        <div onClick={(e) => { e.stopPropagation(); setActive(active === m.id ? null : m.id); }}
                          className={cx('min-w-0 whitespace-pre-wrap break-words text-left text-sm', img && !m.body ? '' : cx('rounded-2xl px-3 py-1.5', m.mine ? 'rounded-tr-md bg-teal-700 text-white' : 'rounded-tl-md border border-line bg-white text-ink'), m.pinned_at && 'ring-2 ring-amber-300')}>
                          {m.reply && (
                            <div className={cx('mb-1 border-l-2 pl-2 text-xs', m.mine ? 'border-white/60 text-white/80' : 'border-teal-600 text-ink-2')} data-testid="chat-reply-quote">
                              <b>{m.reply.author ?? '알 수 없음'}</b><div className="line-clamp-2">{m.reply.deleted ? '삭제된 메시지' : plain(m.reply.body) || `📎 ${m.reply.file}`}</div>
                            </div>
                          )}
                          {m.file_name && (img
                            ? <a href={`/api/chat/messages/${m.id}/file?inline=1`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><img src={`/api/chat/messages/${m.id}/file?inline=1`} alt={m.file_name} className="max-h-60 max-w-full rounded-xl border border-line" /></a>
                            : <a href={`/api/chat/messages/${m.id}/file`} onClick={(e) => e.stopPropagation()} className={cx('flex items-center gap-2 rounded-xl p-2 no-underline', m.mine ? 'bg-white/15' : 'bg-slate-50')} data-testid="chat-file-card">
                                <span className={cx('inline-flex size-9 shrink-0 items-center justify-center rounded-lg', m.mine ? 'bg-white/20' : 'bg-teal-50 text-teal-700')}><FileText className="size-5" /></span>
                                <span className="min-w-0"><span className="block truncate font-medium">{m.file_name}</span><span className={cx('text-[11px]', m.mine ? 'text-white/70' : 'text-ink-3')}>{fmtSize(m.file_size)} · 내려받기</span></span>
                              </a>)}
                          {m.body && render(m.body)}
                        </div>
                      )}
                      {tail || (m.mine && others > 0) ? (
                        <span className="shrink-0 text-[10px] leading-tight text-ink-3">
                          {m.mine && others > 0 && !m.deleted && (n >= others ? <span className="block text-teal-700">읽음</span> : room.kind !== 'dm' && n > 0 ? <span className="block">{n}명 읽음</span> : <span className="block text-amber-600">{others - n}</span>)}
                          {tail && timeOf(m.created_at)}{m.edited_at && !m.deleted && ' · 수정'}
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
                    {m.task_id && <Link href={`/tasks/${m.task_id}`} className="mt-0.5 inline-block text-xs text-accent-600 underline">→ 업무로 만듦</Link>}
                  </div>
                  {/* hover(휴대폰은 누르면) 메뉴 — 메시지마다 글자 링크를 늘어놓지 않는다 */}
                  {!m.deleted && editing?.id !== m.id && (
                    <div className={cx('absolute -top-3 z-10 items-center gap-0.5 rounded-full border border-line bg-white px-1 py-0.5 shadow-card', m.mine ? 'right-2' : 'left-12', showMenu ? 'flex' : 'hidden sm:group-hover:flex')} data-testid="msg-menu" onClick={(e) => e.stopPropagation()}>
                      {EMOJI.slice(0, 3).map((em) => <button key={em} className="rounded-full px-1 text-sm hover:bg-slate-100" onClick={() => react(m, em)} aria-label={`${em} 반응`}>{em}</button>)}
                      <button className="rounded-full p-1 text-ink-2 hover:bg-slate-100" onClick={() => setMenu(menu?.id === m.id && menu.kind === 'react' ? null : { id: m.id, kind: 'react' })} aria-label="반응 더 보기"><SmilePlus className="size-4" /></button>
                      <button className="rounded-full p-1 text-ink-2 hover:bg-slate-100" onClick={() => { setReplyTo(m); setActive(null); inputRef.current?.focus(); }} aria-label="답장" data-testid="msg-reply"><CornerUpLeft className="size-4" /></button>
                      <button className="rounded-full p-1 text-ink-2 hover:bg-slate-100" onClick={() => setMenu(menu?.id === m.id && menu.kind === 'more' ? null : { id: m.id, kind: 'more' })} aria-label="더 보기" data-testid="msg-more"><MoreHorizontal className="size-4" /></button>
                      {menu?.id === m.id && menu.kind === 'react' && (
                        <div className={cx('absolute top-full mt-1 flex gap-0.5 rounded-full border border-line bg-white p-1 shadow-pop', m.mine ? 'right-0' : 'left-0')}>
                          {EMOJI.map((em) => <button key={em} className="rounded-full px-1 text-base hover:bg-slate-100" onClick={() => react(m, em)} aria-label={`${em} 반응`}>{em}</button>)}
                        </div>
                      )}
                      {menu?.id === m.id && menu.kind === 'more' && (
                        <ul className={cx('absolute top-full z-20 mt-1 w-40 overflow-hidden rounded-card border border-line bg-white py-1 text-sm shadow-pop', m.mine ? 'right-0' : 'left-0')} role="menu">
                          <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => act(m, 'task')} data-testid="msg-to-task">업무로 만들기</button></li>
                          <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => act(m, m.pinned_at ? 'unpin' : 'pin')}>{m.pinned_at ? '고정 해제' : '공지로 고정'}</button></li>
                          {m.body && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { navigator.clipboard?.writeText(plain(m.body)); setMenu(null); toast.ok('복사했습니다'); }}>복사</button></li>}
                          {m.mine && m.body && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left hover:bg-slate-50" onClick={() => { setEditing({ id: m.id, body: plain(m.body) }); setMenu(null); setActive(null); }}>수정</button></li>}
                          {m.mine && <li><button role="menuitem" className="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50" onClick={() => act(m, 'delete')}>삭제</button></li>}
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
        <div className="h-5 bg-slate-50/60 px-3 text-xs text-ink-3" aria-live="polite" data-testid="chat-typing">{typing.length ? `${typing.join(', ')} 님이 입력 중…` : ''}</div>
        <UploadProgress items={prog} />
        {replyTo && (
          <div className="flex items-center gap-2 border-t border-line bg-teal-50/60 px-3 py-1.5 text-xs" data-testid="chat-replying">
            <CornerUpLeft className="size-3.5 shrink-0 text-teal-700" /><span className="min-w-0 flex-1 truncate"><b>{replyTo.author_name}</b>에게 답장: {plain(replyTo.body) || replyTo.file_name}</span>
            <button onClick={() => setReplyTo(null)} aria-label="답장 취소" className="text-ink-3"><X className="size-4" /></button>
          </div>
        )}
        <form onSubmit={send} className="relative flex items-end gap-1 border-t border-line bg-white p-2">
          {mentionList.length > 0 && (
            <ul role="listbox" aria-label="멘션 자동완성" className="absolute bottom-full left-2 z-20 mb-1 w-56 overflow-hidden rounded-card border border-line bg-white shadow-pop">
              {mentionList.map((m) => {
                const t = dir.users.find((x) => x.id === m.id)?.title;
                return <li key={m.id}><button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setText((c) => c.replace(/@[^\s@]*$/, `@${m.name} `))}><Avatar id={m.id} name={m.name} size={20} badge={false} />{m.name}{t && <span className="text-xs text-ink-3">· {t}</span>}</button></li>;
              })}
            </ul>
          )}
          {emojiOpen && (
            <div className="absolute bottom-full left-2 z-20 mb-1 grid w-60 grid-cols-8 gap-0.5 rounded-card border border-line bg-white p-1.5 shadow-pop" data-testid="chat-emoji">
              {INSERT_EMOJI.map((em) => <button type="button" key={em} className="rounded p-0.5 text-lg hover:bg-slate-100" onClick={() => { insert(em); setEmojiOpen(false); }}>{em}</button>)}
            </div>
          )}
          <button type="button" className={iconBtn} onClick={() => fileRef.current?.click()} aria-label="파일 보내기" title="파일 보내기"><Paperclip className="size-[18px]" /></button>
          <button type="button" className={iconBtn} onClick={() => camRef.current?.click()} aria-label="사진 보내기" title="사진 보내기"><Camera className="size-[18px]" /></button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} data-testid="chat-file" />
          <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
          <textarea ref={inputRef} rows={1} className={cx(inputCls, 'max-h-32 min-h-9 min-w-0 flex-1 resize-none py-1.5')} placeholder="메시지 입력" title="Enter 보내기 · Shift+Enter 줄바꿈 · @ 멘션 · 이미지 붙여넣기" value={text}
            onChange={(e) => onType(e.target.value)} aria-label="메시지" data-testid="chat-input"
            onPaste={(e) => { const fs = Array.from(e.clipboardData.files); if (fs.length) { e.preventDefault(); upload(fs); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } if (e.key === 'Escape') setReplyTo(null); }} />
          <button type="button" className={cx(iconBtn, compact && 'hidden')} onClick={() => setEmojiOpen((v) => !v)} aria-label="이모지" title="이모지"><SmilePlus className="size-[18px]" /></button>
          <button type="button" className={cx(iconBtn, compact && 'hidden')} onClick={() => insert(text && !text.endsWith(' ') ? ' @' : '@')} aria-label="사람 언급" title="사람 언급(@)"><AtSign className="size-[18px]" /></button>
          <Button type="submit" className="h-9 shrink-0 bg-teal-700 hover:bg-teal-800" disabled={!text.trim()} aria-label="보내기" data-testid="chat-send"><Send /></Button>
        </form>
      </DropZone>
      {toTask && <ToTask s={toTask} roomName={room.name} onClose={() => setToTask(null)} onDone={() => { setToTask(null); reload(); }} />}
    </div>
  );
}

export function NewRoom({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const { user, dir } = useSession();
  const [kind, setKind] = useState<'dm' | 'group'>('dm');
  const [name, setName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const people = dir.users.filter((u) => u.id !== user.id && (!q || u.name.includes(q) || (u.title ?? '').includes(q)));
  async function go(userId?: string) {
    try {
      const r = kind === 'dm' || userId ? await api('/api/chat/rooms', { body: { kind: 'dm', userId: userId ?? picked[0] } })
        : await api('/api/chat/rooms', { body: { kind: 'group', name: name.trim() || dir.users.filter((u) => picked.includes(u.id)).map((u) => u.name).slice(0, 3).join(', '), userIds: picked } });
      setPicked([]); setName(''); setQ(''); onOpen(r.id);
    } catch (e: any) { toast.error(e.message); }
  }
  return (
    <Modal open={open} onClose={onClose} title="새 대화">
      <div className="space-y-3" data-testid="chat-new-modal">
        <div className="flex gap-1.5" role="tablist">
          {(['dm', 'group'] as const).map((k) => <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setPicked([]); }} className={cx('rounded-full border px-3 py-1 text-sm', kind === k ? 'border-teal-700 bg-teal-50 font-semibold text-teal-800' : 'border-line text-ink-2')}>{k === 'dm' ? '1:1 대화' : '그룹 대화'}</button>)}
        </div>
        {kind === 'group' && <Field label="대화방 이름"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 강남점 오픈 준비" /></Field>}
        <input className={inputCls} placeholder="이름·직책으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="사람 찾기" />
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-input border border-line">
          {people.map((u) => (
            <li key={u.id}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50">
                {kind === 'group' && <input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} />}
                <Avatar id={u.id} name={u.name} size={28} badge={false} />
                <span className="flex-1">{u.name}{u.title && <span className="text-ink-3"> · {u.title}</span>}</span>
                {kind === 'dm' && <Button size="sm" variant="secondary" onClick={() => go(u.id)} aria-label={`${u.name}와 대화`}>대화</Button>}
              </label>
            </li>
          ))}
        </ul>
        {kind === 'group' && <div className="flex justify-end"><Button disabled={!picked.length} onClick={() => go()} data-testid="chat-group-create">{picked.length}명과 대화 시작</Button></div>}
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
