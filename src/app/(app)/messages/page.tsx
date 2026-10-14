'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BellOff, Bell, Download, FileText, Hash, Loader2, MessageCircle, Paperclip, Pin, Plus, Search, Send, SquarePen, Users } from 'lucide-react';
import { api, useApi } from '@/components/client';
import { useSession } from '@/components/session';
import { DropZone, UploadProgress, putFile } from '@/components/upload';
import { Avatar, Button, Empty, Field, Modal, PageHeader, Skeleton, cx, fmtDateTime, inputCls, toast } from '@/components/ui';
import { QuickAddTask } from '@/components/QuickAddTask';

type RoomRow = { id: string; kind: 'dm' | 'group' | 'company' | 'task' | 'team'; name: string | null; task_id: string | null; muted: boolean; unread: number; member_count: number;
  last_body: string | null; last_file: string | null; last_author: string | null; last_deleted: boolean; last_message_at: string | null; other_id: string | null };
type Msg = { id: string; room_id: string; author_id: string | null; author_name: string | null; created_at: string; edited_at: string | null; pinned_at: string | null;
  body: string; deleted: boolean; file_name: string | null; file_mime: string | null; file_size: number | null; task_id: string | null; mine: boolean };
const KIND_LABEL = { dm: '1:1', group: '그룹', company: '회사 전체', task: '업무', team: '팀' } as const;
const shortTime = (s: string | null) => {
  if (!s) return '';
  const d = new Date(s); const now = new Date();
  return d.toDateString() === now.toDateString() ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', minute: '2-digit' }).format(d)
    : new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(d);
};
const render = (body: string) => body.split(/(@\[[^\]]+\]\([0-9a-f-]{36}\)|https?:\/\/[^\s<]+)/g).map((p, i) => {
  const m = /^@\[([^\]]+)\]\(([0-9a-f-]{36})\)$/.exec(p);
  if (m) return <span key={i} className="rounded bg-accent-50 px-0.5 font-medium text-accent-700">@{m[1]}</span>;
  if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noreferrer" className="break-all underline">{p}</a>;
  return p;
});

/** V13 10번 사내 메신저: 왼쪽 대화방 목록 · 오른쪽 대화 (휴대폰은 한 화면씩) */
export default function MessagesPage() {
  return <Suspense fallback={<Skeleton rows={6} />}><Messenger /></Suspense>;
}

function Messenger() {
  const sp = useSearchParams();
  const router = useRouter();
  const roomId = sp.get('room');
  const rooms = useApi<{ rooms: RoomRow[]; unread: number }>('/api/chat/rooms');
  const [newOpen, setNewOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const live = useLive();
  // 다른 방에 새 메시지가 오면 목록(안 읽은 수) 갱신
  useEffect(() => live.subscribe(() => rooms.reload()), [live, rooms.reload]); // eslint-disable-line react-hooks/exhaustive-deps
  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return setResults(null);
    try { setResults((await api(`/api/chat/search?q=${encodeURIComponent(q.trim())}`)).results); } catch (er: any) { toast.error(er.message); }
  }
  const open = (id: string) => router.push(`/messages?room=${id}`);
  return (
    <div className="space-y-3">
      <div className={cx(roomId && 'hidden sm:block')}>
        <PageHeader title="메시지" icon={MessageCircle} sub="1:1 · 그룹 · 회사 전체 · 업무별 대화" actions={<Button onClick={() => setNewOpen(true)} data-testid="chat-new"><Plus />새 대화</Button>} />
      </div>
      <div className="grid gap-3 sm:grid-cols-[300px_minmax(0,1fr)]">
        <aside className={cx('min-w-0 space-y-2', roomId && 'hidden sm:block')}>
          <form onSubmit={search} className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input className={cx(inputCls, 'pl-9')} placeholder="메시지 검색" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setResults(null); }} aria-label="메시지 검색" />
          </form>
          {results ? (
            <ul className="divide-y divide-line rounded-card border border-line bg-white" data-testid="chat-search-results">
              {results.map((m) => (
                <li key={m.id}><button className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => { open(m.room_id); setResults(null); setQ(''); }}>
                  <div className="text-xs text-ink-3">{m.room_name ?? KIND_LABEL[m.room_kind as 'dm']} · {m.author_name} · {shortTime(m.created_at)}</div>
                  <div className="truncate">{m.body || m.file_name}</div></button></li>
              ))}
              {!results.length && <li className="px-3 py-3 text-sm text-ink-3">찾는 메시지가 없습니다</li>}
            </ul>
          ) : rooms.loading && !rooms.data ? <Skeleton rows={5} /> : (
            <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white shadow-card" data-testid="chat-rooms">
              {rooms.data?.rooms.map((r) => (
                <li key={r.id}>
                  <button onClick={() => open(r.id)} className={cx('flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50', roomId === r.id && 'bg-brand-50')} data-room={r.kind}>
                    {r.kind === 'dm' ? <Avatar id={r.other_id} name={r.name} size={36} /> : (
                      <span className={cx('inline-flex size-9 shrink-0 items-center justify-center rounded-full', r.kind === 'company' ? 'bg-brand-600 text-white' : r.kind === 'task' ? 'bg-amber-100 text-amber-700' : 'bg-violet-100 text-violet-700')}>
                        {r.kind === 'company' ? <Hash className="size-4" /> : r.kind === 'task' ? <SquarePen className="size-4" /> : <Users className="size-4" />}</span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5"><span className="truncate text-sm font-semibold">{r.name ?? KIND_LABEL[r.kind]}</span>
                        {r.kind !== 'dm' && <span className="shrink-0 text-[11px] text-ink-3">{r.kind === 'task' ? '업무' : r.member_count}</span>}
                        {r.muted && <BellOff className="size-3 shrink-0 text-ink-3" aria-label="알림 꺼짐" />}
                        <span className="ml-auto shrink-0 text-[11px] text-ink-3">{shortTime(r.last_message_at)}</span></span>
                      <span className="flex items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                        {r.last_deleted ? '삭제된 메시지' : r.last_body || r.last_file ? `${r.kind !== 'dm' && r.last_author ? r.last_author + ': ' : ''}${(r.last_body ?? '').replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1') || '📎 ' + r.last_file}` : '아직 메시지가 없습니다'}</span>
                        {r.unread > 0 && <span className={cx('shrink-0 rounded-full px-1.5 text-[11px] font-bold text-white', r.muted ? 'bg-slate-400' : 'bg-red-500')} data-testid="room-unread">{r.unread}</span>}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
        <section className={cx('min-w-0', !roomId && 'hidden sm:block')}>
          {roomId ? <Room key={roomId} id={roomId} live={live} onRead={rooms.reload} onBack={() => router.push('/messages')} />
            : <div className="hidden h-full items-center justify-center rounded-card border border-dashed border-line p-10 sm:flex"><Empty title="대화를 고르세요" icon={MessageCircle}>왼쪽에서 대화방을 고르거나 새 대화를 시작하세요.</Empty></div>}
        </section>
      </div>
      <NewRoom open={newOpen} onClose={() => setNewOpen(false)} onOpen={(id) => { setNewOpen(false); rooms.reload(); open(id); }} />
    </div>
  );
}

/** 실시간 연결: SSE(약 50초마다 다시 연결), 실패하면 5초 폴링. 구독자에게 새 메시지·입력 중·읽음 전달 */
type LiveEvt = { messages?: Msg[]; typing?: { room_id: string; name: string }[]; reads?: { room_id: string; user_id: string; last_read_id: string }[] };
function useLive() {
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

function Room({ id, live, onRead, onBack }: { id: string; live: ReturnType<typeof useLive>; onRead: () => void; onBack: () => void }) {
  const { user, dir } = useSession();
  const { data, error, loading, reload } = useApi<{ room: { id: string; kind: RoomRow['kind']; name: string; taskId: string | null; muted: boolean }; messages: Msg[]; members: { id: string; name: string; last_read_id: string }[]; pinned: Msg[] }>(`/api/chat/rooms/${id}`);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  useEffect(() => { if (!text) document.querySelector<HTMLTextAreaElement>('[data-testid=chat-input]')?.style.removeProperty('height'); }, [text]); // 보낸 뒤 입력칸 높이 원래대로
  const [typing, setTyping] = useState<string[]>([]);
  const [reads, setReads] = useState<Record<string, string>>({});
  const [prog, setProg] = useState<{ name: string; pct: number; error?: string }[]>([]);
  const [toTask, setToTask] = useState<{ msg: Msg; title: string; dueDate: string | null; assigneeId: string | null; description: string } | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [older, setOlder] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const lastTyping = useRef(0);
  useEffect(() => { if (data) { setMsgs(data.messages); setReads(Object.fromEntries(data.members.map((m) => [m.id, m.last_read_id]))); } }, [data]);
  const markRead = useCallback(async () => { try { await api(`/api/chat/rooms/${id}/read`, { body: {} }); onRead(); } catch { /* 다음에 */ } }, [id, onRead]);
  useEffect(() => { if (data) markRead(); }, [data, markRead]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [msgs.length]);
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

  const members = data?.members ?? [];
  // @멘션: 입력창에는 @이름, 보낼 때 내부 표기로
  const toWire = (s: string) => members.filter((m) => m.id !== user.id).reduce((acc, m) => acc.split(`@${m.name}`).join(`@[${m.name}](${m.id})`), s);
  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!text.trim()) return;
    const body = toWire(text); setText('');
    try { const r = await api(`/api/chat/rooms/${id}/messages`, { body: { body } }); mergeMine(r.id, { body }); } catch (er: any) { setText(text); toast.error(er.message); }
  }
  const mergeMine = (mid: string, p: Partial<Msg>) => setMsgs((cur) => cur.some((m) => m.id === mid) ? cur : [...cur, { id: mid, room_id: id, author_id: user.id, author_name: user.name, created_at: new Date().toISOString(),
    edited_at: null, pinned_at: null, body: '', deleted: false, file_name: null, file_mime: null, file_size: null, task_id: null, mine: true, ...p }]);
  async function upload(files: FileList | File[]) {
    const list = Array.from(files).slice(0, 10);
    setProg(list.map((f) => ({ name: f.name, pct: 0 })));
    for (const [n, f] of list.entries()) {
      try {
        const t = await api(`/api/chat/rooms/${id}/files`, { body: { fileName: f.name, mime: f.type || 'application/octet-stream', size: f.size } });
        await putFile(t.upload, f, (pct) => setProg((x) => x.map((y, j) => (j === n ? { ...y, pct } : y))));
        const file = { key: t.key, name: f.name, mime: f.type || 'application/octet-stream', size: f.size };
        const r = await api(`/api/chat/rooms/${id}/messages`, { body: { body: '', file } });
        mergeMine(r.id, { file_name: f.name, file_mime: file.mime, file_size: f.size });
      } catch (er: any) { setProg((x) => x.map((y, j) => (j === n ? { ...y, error: er.message } : y))); }
    }
    if (fileRef.current) fileRef.current.value = '';
    setTimeout(() => setProg((x) => (x.some((y) => y.error) ? x : [])), 1200);
  }
  function onType(v: string) {
    setText(v);
    if (v && Date.now() - lastTyping.current > 3000) { lastTyping.current = Date.now(); api(`/api/chat/rooms/${id}/typing`, { body: {} }).catch(() => {}); }
  }
  async function act(m: Msg, what: 'pin' | 'unpin' | 'delete' | 'task') {
    try {
      if (what === 'delete') { if (!confirm('이 메시지를 지울까요? ("삭제된 메시지"로 표시됩니다)')) return; await api(`/api/chat/messages/${m.id}`, { method: 'DELETE' }); setMsgs((c) => c.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '' } : x))); }
      else if (what === 'task') { const s = await api(`/api/chat/messages/${m.id}/to-task`, { body: {} }); setToTask({ msg: m, ...s }); }
      else { await api(`/api/chat/messages/${m.id}/pin`, { body: { pin: what === 'pin' } }); reload(); }
    } catch (e: any) { toast.error(e.message); }
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
  if (error) return <div className="rounded-card border border-line bg-white p-6 text-sm"><p className="font-semibold">대화방을 열 수 없습니다</p><p className="mt-1 text-ink-2">{error.message}</p><Button className="mt-3" variant="secondary" onClick={onBack}>목록으로</Button></div>;
  if (loading && !data) return <Skeleton rows={6} />;
  const room = data!.room;
  const readBy = (m: Msg) => members.filter((x) => x.id !== m.author_id && BigInt(reads[x.id] ?? '0') >= BigInt(m.id)).length;
  const others = members.filter((x) => x.id !== user.id).length;
  const mention = /(^|\s)@([^\s@]*)$/.exec(text);
  const mentionList = mention ? members.filter((m) => m.id !== user.id && m.name.includes(mention[2])).slice(0, 6) : [];
  return (
    <div className="flex h-[calc(100dvh-9rem-var(--sab))] min-h-[420px] flex-col overflow-hidden rounded-card border border-line bg-white shadow-card sm:h-[calc(100dvh-10rem)]" data-testid="chat-room">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <button className="inline-flex size-8 items-center justify-center rounded-input hover:bg-slate-100 sm:hidden" onClick={onBack} aria-label="목록으로"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold" data-testid="chat-room-name">{room.name}</div>
          <div className="truncate text-xs text-ink-3">{KIND_LABEL[room.kind]} · {members.length}명{room.taskId && <> · <Link href={`/tasks/${room.taskId}`} className="text-accent-600 underline">업무 보기</Link></>}{live.mode === 'poll' && ' · 5초마다 새로 고침'}</div>
        </div>
        <button className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" onClick={toggleMute} aria-label={room.muted ? '알림 켜기' : '알림 끄기'} title={room.muted ? '알림 켜기' : '알림 끄기'} data-testid="chat-mute">{room.muted ? <BellOff className="size-4" /> : <Bell className="size-4" />}</button>
        {user.role === 'owner' && <a className="inline-flex size-8 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" href={`/api/chat/rooms/${id}/export`} aria-label="대화 내보내기(감사용)" title="대화 내보내기(감사용, 기록 남음)"><Download className="size-4" /></a>}
      </header>
      {data!.pinned.length > 0 && (
        <div className="flex items-center gap-2 border-b border-line bg-amber-50 px-3 py-1.5 text-xs text-amber-900" data-testid="chat-pinned">
          <Pin className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate"><b>{data!.pinned[0].author_name}</b>: {data!.pinned[0].body || data!.pinned[0].file_name}</span>
          {data!.pinned.length > 1 && <span className="shrink-0">외 {data!.pinned.length - 1}개</span>}
        </div>
      )}
      <DropZone onFiles={upload} label="놓으면 이 대화방에 보냅니다" testid="chat-drop" className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3" data-testid="chat-messages">
          {msgs.length >= 60 && <div className="text-center"><Button size="sm" variant="ghost" onClick={loadOlder} disabled={older}>{older ? <Loader2 className="animate-spin" /> : null}이전 메시지</Button></div>}
          {!msgs.length && <p className="py-10 text-center text-sm text-ink-3">첫 메시지를 보내 보세요</p>}
          {msgs.map((m, i) => {
            const head = i === 0 || msgs[i - 1].author_id !== m.author_id || new Date(m.created_at).getTime() - new Date(msgs[i - 1].created_at).getTime() > 5 * 60_000;
            const img = m.file_name && /^image\/(png|jpe?g|gif|webp)$/.test(m.file_mime ?? '');
            return (
              <div key={m.id} className={cx('group flex gap-2', m.mine && 'flex-row-reverse')} data-testid="chat-message" data-mine={m.mine ? '1' : '0'}>
                {!m.mine && (head ? <Avatar id={m.author_id} name={m.author_name} size={30} /> : <span className="w-[30px] shrink-0" />)}
                <div className={cx('min-w-0 max-w-[78%]', m.mine && 'items-end text-right')}>
                  {head && !m.mine && <div className="mb-0.5 text-xs font-medium text-ink-2">{m.author_name}</div>}
                  <div className={cx('flex items-end gap-1.5', m.mine && 'flex-row-reverse')}>
                    {editing?.id === m.id ? (
                      <form onSubmit={saveEdit} className="flex gap-1"><input autoFocus className={cx(inputCls, 'h-8')} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null); }} aria-label="메시지 고치기" /><Button size="sm">저장</Button></form>
                    ) : m.deleted ? <span className="rounded-2xl bg-slate-100 px-3 py-1.5 text-sm italic text-ink-3">삭제된 메시지</span> : (
                      <div className={cx('inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-left text-sm', m.mine ? 'bg-brand-600 text-white' : 'bg-slate-100 text-ink', m.pinned_at && 'ring-2 ring-amber-300')}>
                        {m.file_name && (img ? <a href={`/api/chat/messages/${m.id}/file?inline=1`} target="_blank" rel="noreferrer"><img src={`/api/chat/messages/${m.id}/file?inline=1`} alt={m.file_name} className="max-h-60 rounded-lg" /></a>
                          : <a href={`/api/chat/messages/${m.id}/file`} className="inline-flex items-center gap-1.5 underline"><FileText className="size-4" />{m.file_name}</a>)}
                        {m.body && render(m.body)}
                      </div>
                    )}
                    <span className="shrink-0 text-[10px] leading-tight text-ink-3">
                      {m.mine && others > 0 && !m.deleted && (readBy(m) >= others ? <span className="block text-accent-600">읽음</span> : room.kind !== 'dm' && readBy(m) > 0 ? <span className="block">{readBy(m)}명 읽음</span> : null)}
                      {shortTime(m.created_at)}{m.edited_at && !m.deleted && ' · 수정'}
                    </span>
                  </div>
                  {m.task_id && <Link href={`/tasks/${m.task_id}`} className="mt-0.5 inline-block text-xs text-accent-600 underline">→ 업무로 만듦</Link>}
                  {!m.deleted && editing?.id !== m.id && (
                    <div className={cx('mt-0.5 flex gap-1 text-[11px] text-ink-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100', m.mine && 'justify-end')}>
                      <button className="rounded px-1 hover:bg-slate-100 hover:text-ink" onClick={() => act(m, 'task')} data-testid="msg-to-task">업무로 만들기</button>
                      <button className="rounded px-1 hover:bg-slate-100 hover:text-ink" onClick={() => act(m, m.pinned_at ? 'unpin' : 'pin')}>{m.pinned_at ? '고정 해제' : '고정'}</button>
                      {m.mine && m.body && <button className="rounded px-1 hover:bg-slate-100 hover:text-ink" onClick={() => setEditing({ id: m.id, body: m.body.replace(/@\[([^\]]+)\]\([0-9a-f-]{36}\)/g, '@$1') })}>수정</button>}
                      {m.mine && <button className="rounded px-1 hover:bg-red-50 hover:text-red-600" onClick={() => act(m, 'delete')}>삭제</button>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
        <div className="h-5 px-3 text-xs text-ink-3" aria-live="polite" data-testid="chat-typing">{typing.length ? `${typing.join(', ')} 님이 입력 중…` : ''}</div>
        <UploadProgress items={prog} />
        <form onSubmit={send} className="relative flex items-end gap-1.5 border-t border-line p-2">
          {mentionList.length > 0 && (
            <ul role="listbox" aria-label="멘션 자동완성" className="absolute bottom-full left-10 z-20 mb-1 w-56 overflow-hidden rounded-card border border-line bg-white shadow-pop">
              {mentionList.map((m) => {
                const t = dir.users.find((x) => x.id === m.id)?.title;
                return <li key={m.id}><button type="button" role="option" aria-selected={false} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50" onClick={() => setText((c) => c.replace(/@[^\s@]*$/, `@${m.name} `))}><Avatar id={m.id} name={m.name} size={20} />{m.name}{t && <span className="text-xs text-ink-3">· {t}</span>}</button></li>;
              })}
            </ul>
          )}
          <button type="button" className="inline-flex size-9 shrink-0 items-center justify-center rounded-input text-ink-2 hover:bg-slate-100" onClick={() => fileRef.current?.click()} aria-label="파일 보내기"><Paperclip className="size-5" /></button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} data-testid="chat-file" />
          <textarea rows={1} className={cx(inputCls, 'max-h-32 min-h-9 resize-none py-1.5')} placeholder="메시지 입력" title="Enter 보내기 · Shift+Enter 줄바꿈 · @ 멘션" value={text}
            onChange={(e) => { onType(e.target.value); const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 128)}px`; }} aria-label="메시지" data-testid="chat-input"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
          <Button type="submit" disabled={!text.trim()} aria-label="보내기" data-testid="chat-send"><Send /></Button>
        </form>
      </DropZone>
      {toTask && <ToTask s={toTask} roomName={room.name} onClose={() => setToTask(null)} onDone={() => { setToTask(null); reload(); }} />}
    </div>
  );
}

function NewRoom({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (id: string) => void }) {
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
          {(['dm', 'group'] as const).map((k) => <button key={k} role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setPicked([]); }} className={cx('rounded-full border px-3 py-1 text-sm', kind === k ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700' : 'border-line text-ink-2')}>{k === 'dm' ? '1:1 대화' : '그룹 대화'}</button>)}
        </div>
        {kind === 'group' && <Field label="대화방 이름"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 강남점 오픈 준비" /></Field>}
        <input className={inputCls} placeholder="이름·직책으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} aria-label="사람 찾기" />
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-input border border-line">
          {people.map((u) => (
            <li key={u.id}>
              <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm hover:bg-slate-50">
                {kind === 'group' && <input type="checkbox" checked={picked.includes(u.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, u.id] : p.filter((x) => x !== u.id)))} />}
                <Avatar id={u.id} name={u.name} size={26} />
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
