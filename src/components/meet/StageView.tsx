'use client';
// 화상회의 회의 중 화면(대표 11/19: 화면 공유하면서 회의 · 줌 수준으로 · "대기실이 뭔지 모르겠다").
// 레퍼런스(docs/reference/zoom — 공개 자료만): 아래 한 줄 도구줄(휴대폰은 항상 표시) · 참가자 목록 · 회의 중 채팅 · 나란히/말하는 사람 크게 · 반응·손들기 · 대기실은 사람이 올 때 띠로 알림.
// 줌의 로고·색·아이콘·문구는 쓰지 않는다(워크인 디자인 문서 기준). 영상 연결은 StageConn(라이브킷·가짜)이 맡고 이 화면은 엔진을 모른다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ChevronLeft, ChevronRight, Copy, FileImage, Hand, LayoutGrid, Loader2, Lock, LogOut, MessageSquare, Mic, MicOff, Minus, MonitorUp, MoreHorizontal, Pin, Plus, RefreshCw, Send, Share2,
  SignalLow, Smartphone, Unlock, UserRound, Users, Video, VideoOff, Volume2, X } from 'lucide-react';
import { Button, cx, toast } from '@/components/ui';
import { nativeScreenShareAvailable, nativeScreenShareStart, nativeScreenShareStop, onNativeScreenShareStopped, shareLink } from '@/components/native';
import { call } from './api';
import { openDoc, type DocHandle } from './docShare';
import { REACTIONS, SCREEN_SUFFIX, isUuid, type StageConn, type Tile, type VideoSrc } from './stage';

export type ChatMsg = { id: string; mine: boolean; name: string; guest: boolean; text: string; at: string };
export type ChatApi = { list(after: string | null): Promise<{ messages: ChatMsg[] }>; send(text: string): Promise<unknown> };
type Wait = { id: string; name: string; guest: boolean };
type Person = { id: string; name: string; guest: boolean; role: string; state: string };
type Settings = { locked: boolean; lobby: string; share: string };
type Panel = null | 'people' | 'chat' | 'more' | 'share' | 'leave';
export type StageProps = {
  conn: StageConn; title: string; elapsed: string; selfLabel: string;
  /** 이 회의에서 내가 화면을 공유해도 되는지(회의 규칙) */
  canShare: boolean;
  /** 주최자·공동 주최자면 회의 id(대기실·설정·참가자 관리) */
  hostMeetingId: string | null; onEnded: () => void;
  chat: ChatApi; inviteUrl: string; onLeave: () => void; busy?: boolean;
  /** 시험 연결 표시(가짜 엔진) */
  engineNote?: React.ReactNode;
  /** 휴대폰 앱 화면 공유용 입장권 */
  screenTicket?: () => Promise<{ url: string; token: string }>;
};

// 대기실 — 쉬운 말로(대표 11/19 "대기실이 뭔지 모르겠다")
const LOBBY: [string, string][] = [['guests', '회사 밖 손님만 기다림(직원은 바로 들어옴)'], ['everyone', '모두 기다림(주최자가 들여보냄)'], ['invited', '초대받지 않은 사람만 기다림'], ['none', '대기실 끔(누구나 바로 들어옴)']];
const LOBBY_HELP = '대기실은 회의에 들어오기 전에 잠깐 기다리는 곳입니다. 켜 두면 주소를 아는 사람도 바로 들어오지 못하고, 주최자가 [들여보내기]를 눌러야 들어옵니다.';
const hhmm = (iso: string) => { try { return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso)); } catch { return ''; } };

/** 주최자 도구: 대기실 목록·회의 설정·참가자 관리(3초마다 새로) */
function useHost(meetingId: string | null, onEnded: () => void) {
  const [wait, setWait] = useState<Wait[]>([]); const [m, setM] = useState<Settings | null>(null); const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (!meetingId) return;
    const [l, g] = await Promise.all([call<{ waiting: Wait[] }>(`/api/meetings/${meetingId}/lobby`), call<any>(`/api/meetings/${meetingId}`)]);
    setWait(l.waiting); setM({ locked: g.meeting.locked, lobby: g.meeting.lobby, share: g.meeting.share }); setPeople(g.people ?? []);
  }, [meetingId]);
  useEffect(() => { if (!meetingId) return; void load().catch(() => {}); const h = setInterval(() => void load().catch(() => {}), 3000); return () => clearInterval(h); }, [load, meetingId]);
  if (!meetingId) return null;
  const act = async (fn: () => Promise<unknown>, done?: string) => { setBusy(true); try { await fn(); await load(); if (done) toast.ok(done); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  return {
    wait, m, people, busy,
    lobby: (action: 'admit' | 'deny' | 'admitAll', ids?: string[]) => act(() => call(`/api/meetings/${meetingId}/lobby`, { body: { action, ids } })),
    patch: (body: Record<string, unknown>, done?: string) => act(() => call(`/api/meetings/${meetingId}`, { method: 'PATCH', body }), done),
    person: (pid: string, action: 'remove' | 'cohost' | 'uncohost' | 'mute', done?: string) => act(() => call(`/api/meetings/${meetingId}/participants/${pid}`, { body: { action } }), done),
    end: async () => { if (!confirm('회의를 끝낼까요? 모두 나가게 됩니다.')) return; setBusy(true); try { await call(`/api/meetings/${meetingId}/end`, { body: {} }); onEnded(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } },
  };
}

/** 회의 중 채팅 — 서버에 남는 글을 받아 온다(새 글 신호가 오면 바로, 그 밖에는 every 마다) */
function useChat(api: ChatApi, open: boolean, every: number) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]); const [unread, setUnread] = useState(0); const [peek, setPeek] = useState<ChatMsg | null>(null);
  const last = useRef<string | null>(null); const openRef = useRef(open); openRef.current = open; const first = useRef(true); const busy = useRef(false); const again = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) { again.current = true; return; }
    busy.current = true;
    try {
      const r = await api.list(last.current);
      if (r.messages.length) {
        last.current = r.messages[r.messages.length - 1].id;
        setMsgs((m) => [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))].slice(-500));
        const theirs = r.messages.filter((x) => !x.mine);
        if (!openRef.current && !first.current && theirs.length) { setUnread((u) => u + theirs.length); setPeek(theirs[theirs.length - 1]); }
      }
      first.current = false;
    } catch { /* 다음 차례에 다시 */ } finally { busy.current = false; if (again.current) { again.current = false; void refresh(); } }
  }, [api]);
  useEffect(() => { void refresh(); const h = setInterval(() => void refresh(), every); return () => clearInterval(h); }, [refresh, every]);
  useEffect(() => { if (open) { setUnread(0); setPeek(null); } }, [open, msgs.length]);
  useEffect(() => { if (!peek) return; const h = setTimeout(() => setPeek(null), 5000); return () => clearTimeout(h); }, [peek]);
  const send = useCallback(async (text: string) => { await api.send(text); await refresh(); }, [api, refresh]);
  return { msgs, unread, peek, send, refresh };
}

export function StageView({ conn, title, elapsed, selfLabel, canShare, hostMeetingId, onEnded, chat: chatApi, inviteUrl, onLeave, busy, engineNote, screenTicket }: StageProps) {
  const host = useHost(hostMeetingId, onEnded);
  const [panel, setPanel] = useState<Panel>(null);
  const [view, setView] = useState<'gallery' | 'speaker'>('gallery');
  const [pin, setPin] = useState<string | null>(null);
  const [reacts, setReacts] = useState<Record<string, { e: string; until: number }>>({});
  const [hands, setHands] = useState<Record<string, true>>({});
  const [myHand, setMyHand] = useState(false);
  const [doc, setDoc] = useState<DocHandle | null>(null); const [docBusy, setDocBusy] = useState(false); const [, bump] = useState(0);
  const [native, setNative] = useState<{ can: boolean; on: boolean }>({ can: false, on: false });
  const fileRef = useRef<HTMLInputElement | null>(null);
  const chat = useChat(chatApi, panel === 'chat', conn.engine === 'fake' ? 3000 : 12000);

  const people = useMemo(() => conn.tiles.filter((t) => !t.screenOnly), [conn.tiles]);
  const self = people.find((t) => t.local) ?? null; const selfId = self?.identity ?? 'me';
  const n = people.length;
  const screenT = conn.tiles.find((t) => t.screen) ?? null;
  const myNativeScreen = !!screenT && screenT.identity === `${selfId}${SCREEN_SUFFIX}`;

  // 다른 사람이 보낸 신호: 반응 · 손들기 · 새 채팅
  const refreshChat = chat.refresh;
  useEffect(() => conn.onSignal((from, s) => {
    if (s.t === 'react') setReacts((r) => ({ ...r, [from]: { e: s.e, until: Date.now() + 4000 } }));
    else if (s.t === 'hand') setHands((h) => { const x = { ...h }; if (s.up) x[from] = true; else delete x[from]; return x; });
    else if (s.t === 'chat') void refreshChat();
  }), [conn.onSignal, refreshChat]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!Object.keys(reacts).length) return; const h = setInterval(() => setReacts((r) => { const now = Date.now(); const x = Object.fromEntries(Object.entries(r).filter(([, v]) => v.until > now)); return Object.keys(x).length === Object.keys(r).length ? r : x; }), 1000); return () => clearInterval(h); }, [reacts]);
  // 새로 들어온 사람도 내 손이 보이게 다시 알림
  const send = conn.send;
  useEffect(() => { if (myHand) send({ t: 'hand', up: true }); }, [n, myHand, send]);
  const react = (e: string) => { setReacts((r) => ({ ...r, [selfId]: { e, until: Date.now() + 4000 } })); conn.send({ t: 'react', e }); setPanel(null); };
  const toggleHand = () => { const up = !myHand; setMyHand(up); setHands((h) => { const x = { ...h }; if (up) x[selfId] = true; else delete x[selfId]; return x; }); conn.send({ t: 'hand', up }); if (up) toast.info('손을 들었습니다 — 다시 누르면 내립니다'); };

  // 말하는 사람 크게: 마지막으로 말한 사람을 기억(말이 끊길 때마다 칸이 바뀌지 않게)
  const lastSpeaker = useRef<string | null>(null);
  const speaking = people.find((t) => t.speaking && !t.local); if (speaking) lastSpeaker.current = speaking.key;
  const pinned = pin ? people.find((t) => t.key === pin) ?? null : null;
  const focus = screenT ? null : pinned ?? (view === 'speaker' && n > 1 ? people.find((t) => t.key === lastSpeaker.current) ?? people.find((t) => !t.local) ?? null : null);

  // 휴대폰 앱 화면 공유(앱에 기능이 들어 있을 때만 단추가 보임)
  useEffect(() => { let alive = true; let off: (() => void) | null = null;
    void nativeScreenShareAvailable().then((can) => { if (!alive || !can) return; setNative((x) => ({ ...x, can: true })); void onNativeScreenShareStopped(() => setNative((x) => ({ ...x, on: false }))).then((h) => { off = h; if (!alive) h(); }); });
    return () => { alive = false; off?.(); void nativeScreenShareStop(); }; }, []);
  async function startNative() {
    if (!screenTicket) return;
    try { const t = await screenTicket(); await nativeScreenShareStart({ url: t.url, token: t.token, title }); setNative((x) => ({ ...x, on: true })); setPanel(null); }
    catch (e: any) { toast.error(e?.message || '휴대폰 화면 공유를 시작하지 못했습니다'); }
  }
  const stopNative = () => { void nativeScreenShareStop(); setNative((x) => ({ ...x, on: false })); };

  // 자료(사진·PDF) 공유
  async function pickDoc(file: File | undefined) {
    if (!file) return;
    setDocBusy(true);
    try { const h = await openDoc(file); doc?.close(); if (conn.sharing) await conn.stopShare(); await conn.shareCanvas(h.canvas); setDoc(h); setPanel(null); }
    catch (e: any) { toast.error(e?.message || '자료 공유를 시작하지 못했습니다'); } finally { setDocBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  const stopShare = async () => { doc?.close(); setDoc(null); await conn.stopShare(); };
  useEffect(() => { if (conn.sharing !== 'doc' && doc) { doc.close(); setDoc(null); } }, [conn.sharing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => doc?.close(), [doc]);
  const page = async (d: number) => { if (!doc) return; await doc.go(doc.page + d); bump((x) => x + 1); };
  function share() {
    if (!canShare) { toast.info('이 회의는 주최자만 공유할 수 있습니다 — 주최자에게 요청해 주세요'); return; }
    setPanel(panel === 'share' ? null : 'share');
  }
  const startScreen = async () => { setPanel(null); if (doc) { doc.close(); setDoc(null); } await conn.startScreen(); };

  async function copyInvite() { try { await navigator.clipboard.writeText(inviteUrl); toast.ok('회의 주소를 복사했습니다'); } catch { toast.error('복사하지 못했습니다 — 주소를 길게 눌러 복사해 주세요'); } }
  async function shareInvite() {
    const data = { title: '워크인 화상회의', text: `${title} — 설치 없이 주소만 누르면 들어옵니다`, url: inviteUrl };
    try { if (!(await shareLink(data))) await copyInvite(); } catch (e: any) { if (e?.name !== 'AbortError' && !/cancel/i.test(String(e?.message ?? ''))) await copyInvite(); }
  }
  const toggle = (p: Exclude<Panel, null>) => setPanel((x) => (x === p ? null : p));
  const leave = () => { if (host) setPanel('leave'); else onLeave(); };
  const waitN = host?.wait.length ?? 0; const first = host?.wait[0];
  const live = conn.state === 'live';
  const handsUp = people.filter((t) => hands[t.identity]);
  const tile = (t: Tile, small?: boolean) => <PersonTile key={t.key} t={t} small={small} selfLabel={selfLabel} hand={!!hands[t.identity]} react={reacts[t.identity]?.e} pinned={pin === t.key}
    onPin={n > 1 ? () => setPin((x) => (x === t.key ? null : t.key)) : undefined} onFlip={t.local && conn.canFlip && conn.cam ? conn.flipCam : undefined} />;

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-slate-900 text-white" data-testid="meet-room" data-engine={conn.engine}>
      {/* 머리줄: 휴대폰 상태줄과 겹치지 않게 위 여백(대표 11/19 사진 — 회의 이름이 시계와 겹침) */}
      <header className="flex items-center gap-2 px-4 pb-2 text-sm" style={{ paddingTop: 'max(8px, var(--sat))' }}>
        {host?.m?.locked && <Lock className="size-3.5 shrink-0 text-amber-300" aria-label="회의 잠김" />}
        <span className="min-w-0 truncate font-semibold">{title}</span>
        <span className="tabular-nums text-slate-300" data-testid="meet-elapsed">{elapsed}</span>
        {engineNote}
        <span className={cx('shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]', !engineNote && 'ml-auto', live ? 'bg-emerald-700/70 text-emerald-50' : conn.state === 'error' ? 'bg-red-700/80' : 'bg-slate-700 text-slate-200')} data-testid="meet-live-state" data-state={conn.state}>
          {live ? `연결됨 · ${n}명` : conn.state === 'reconnecting' ? '다시 연결 중…' : conn.state === 'error' ? '연결 안 됨' : '연결 중…'}</span>
      </header>
      {conn.state === 'reconnecting' && <p className="mx-3 rounded-input bg-amber-500/20 px-3 py-1.5 text-xs text-amber-100" role="status">네트워크가 불안정해 다시 연결하고 있습니다 — 잠시만 기다려 주세요</p>}
      {conn.audioBlocked && live && <button type="button" className="mx-3 mt-1 inline-flex items-center gap-1.5 self-start rounded-input bg-brand-600 px-3 py-1.5 text-xs font-medium hover:bg-brand-700" onClick={conn.unblockAudio} data-testid="meet-audio-unblock"><Volume2 className="size-4" />소리 켜기(브라우저가 자동 재생을 막았습니다)</button>}
      {/* 대기실 띠: 기다리는 사람이 있을 때만(주최자) — 사람이 오면 여기서 바로 들여보낸다 */}
      {host && first && (
        <div className="mx-3 mt-1 flex flex-wrap items-center gap-2 rounded-input bg-brand-700/90 px-3 py-2 text-sm" role="status" data-testid="meet-wait-banner">
          <Users className="size-4 shrink-0" />
          <span className="min-w-0 flex-1"><b className="font-semibold">{first.name}{first.guest ? '(손님)' : ''}</b>{waitN > 1 ? ` 님 외 ${waitN - 1}명이` : ' 님이'} 들어오려고 기다립니다</span>
          {waitN > 1 ? <>
            <button type="button" className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50" disabled={host.busy} onClick={() => host.lobby('admitAll')} data-testid="meet-admit-all">모두 들여보내기</button>
            <button type="button" className="rounded bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25" onClick={() => setPanel('people')} data-testid="meet-wait-open">목록 보기</button></>
            : <>
            <button type="button" className="rounded bg-white px-2.5 py-1 text-xs font-semibold text-brand-700 hover:bg-brand-50" disabled={host.busy} onClick={() => host.lobby('admit', [first.id])} data-testid="meet-admit">들여보내기</button>
            <button type="button" className="rounded bg-white/15 px-2.5 py-1 text-xs font-medium hover:bg-white/25" disabled={host.busy} onClick={() => host.lobby('deny', [first.id])} data-testid="meet-deny">거절</button></>}
        </div>
      )}
      <div className="flex min-h-0 flex-1 gap-3 p-2 md:p-3">
        <section className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          {conn.state === 'connecting' && <p className="flex items-center gap-2 text-sm text-slate-300" data-testid="meet-live-connecting"><Loader2 className="size-4 animate-spin" />영상 서버에 연결하는 중…</p>}
          {conn.state === 'error' && <div className="rounded-card bg-red-900/40 p-3 text-sm" role="alert" data-testid="meet-live-error"><p>{conn.err}</p>
            <Button size="sm" variant="secondary" className="mt-2" disabled={busy} onClick={conn.retry} data-testid="meet-live-retry"><RefreshCw />다시 연결</Button></div>}
          {screenT ? <>
            <ScreenArea src={myNativeScreen ? null : screenT.screen} label={screenT.local || myNativeScreen ? '내가 공유 중' : `${screenT.name.replace(/ 화면$/, '')} 님의 화면`} mine={screenT.local || myNativeScreen}
              note={myNativeScreen ? '내 휴대폰 화면을 공유하고 있습니다. 다른 앱으로 넘어가도 참가자에게 보입니다.' : null}
              doc={screenT.local && conn.sharing === 'doc' ? doc : null} onPage={page} onPick={() => fileRef.current?.click()} onStop={myNativeScreen ? stopNative : screenT.local ? () => void stopShare() : undefined} />
            <div className="flex shrink-0 gap-2 overflow-x-auto pb-0.5" data-testid="meet-tiles">{people.map((t) => <div key={t.key} className="h-20 w-32 shrink-0 md:h-24 md:w-40">{tile(t, true)}</div>)}</div>
          </> : focus ? <>
            <div className="min-h-0 flex-1">{tile(focus)}</div>
            <div className="flex shrink-0 gap-2 overflow-x-auto pb-0.5" data-testid="meet-tiles">{people.filter((t) => t.key !== focus.key).map((t) => <div key={t.key} className="h-20 w-32 shrink-0 md:h-24 md:w-40">{tile(t, true)}</div>)}</div>
          </> : (
            <div className={cx('grid min-h-0 flex-1 auto-rows-fr gap-2 overflow-y-auto', n <= 1 ? 'grid-cols-1' : n === 2 ? 'grid-cols-1 md:grid-cols-2' : n <= 4 ? 'grid-cols-2' : n <= 9 ? 'grid-cols-2 md:grid-cols-3' : n <= 16 ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3 md:grid-cols-5')} data-testid="meet-tiles">
              {people.map((t) => <div key={t.key} className="min-h-[6.5rem]">{tile(t)}</div>)}
            </div>
          )}
          {handsUp.length > 0 && <p className="pointer-events-none absolute left-2 top-2 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-semibold text-slate-900 shadow" data-testid="meet-hands">✋ {handsUp.slice(0, 2).map((t) => (t.local ? '나' : t.name)).join(', ')}{handsUp.length > 2 ? ` 외 ${handsUp.length - 2}명` : ''}</p>}
          {chat.peek && panel !== 'chat' && <button type="button" className="absolute bottom-2 left-2 right-2 truncate rounded-input bg-slate-700/95 px-3 py-2 text-left text-xs shadow md:right-auto md:max-w-sm" onClick={() => setPanel('chat')} data-testid="meet-chat-peek"><b className="font-semibold">{chat.peek.name}</b> {chat.peek.text}</button>}
        </section>
        {panel && panel !== 'leave' && <button type="button" aria-label="닫기" className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setPanel(null)} />}
        {panel === 'people' && <Sheet title={`참가자 ${n}명`} onClose={() => setPanel(null)} testid="meet-people-panel">
          {host && <div className="mb-3 rounded-input bg-slate-700/50 p-2.5" data-testid="meet-lobby">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold"><span>들어오려고 기다리는 사람 <span data-testid="meet-wait-count">{waitN}</span>명</span>
              {waitN > 1 && <button type="button" className="ml-auto rounded bg-brand-600 px-2 py-0.5 text-xs font-medium hover:bg-brand-700" disabled={host.busy} onClick={() => host.lobby('admitAll')}>모두 들여보내기</button>}</p>
            <ul className="mt-1.5 space-y-1">{host.wait.map((w) => (
              <li key={w.id} className="flex items-center gap-1.5 rounded bg-slate-700 px-2 py-1.5 text-sm" data-testid="meet-wait-row">
                <span className="min-w-0 flex-1 truncate">{w.name}{w.guest ? '(손님)' : ''}</span>
                <button type="button" className="inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-1 text-xs font-medium hover:bg-brand-700" disabled={host.busy} onClick={() => host.lobby('admit', [w.id])}><Check className="size-3.5" />들여보내기</button>
                <button type="button" className="rounded px-2 py-1 text-xs text-slate-200 hover:bg-slate-600" disabled={host.busy} onClick={() => host.lobby('deny', [w.id])}>거절</button>
              </li>))}</ul>
            {!waitN && <p className="mt-1 text-xs text-slate-400">지금은 없습니다. 손님이 회의 주소로 들어오면 여기에 뜨고, [들여보내기]를 누르면 회의에 들어옵니다.</p>}
          </div>}
          <ul className="space-y-1" data-testid="meet-people-list">{people.map((t) => <PersonRow key={t.key} t={t} selfLabel={selfLabel} hand={!!hands[t.identity]} host={host} role={host?.people.find((x) => x.id === t.identity)?.role ?? t.role} />)}</ul>
          <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-700 pt-3">
            <button type="button" className={ghost} onClick={copyInvite} data-testid="meet-invite-copy"><Copy className="size-4" />초대 주소 복사</button>
            <button type="button" className={ghost} onClick={shareInvite} data-testid="meet-invite-share"><Share2 className="size-4" />공유</button>
            {host && <button type="button" className={ghost} disabled={host.busy} onClick={() => host.patch({ muteAll: true }, '모두의 마이크를 껐습니다 — 각자 다시 켤 수 있습니다')} data-testid="meet-mute-all"><MicOff className="size-4" />모두 마이크 끄기</button>}
          </div>
        </Sheet>}
        {panel === 'chat' && <ChatSheet chat={chat} onClose={() => setPanel(null)} onSent={() => conn.send({ t: 'chat' })} />}
        {panel === 'share' && <Sheet title="공유" onClose={() => setPanel(null)} testid="meet-share-panel">
          <div className="space-y-2">
            {conn.sharing || native.on ? <button type="button" className={cx(row, 'bg-red-600 hover:bg-red-700')} onClick={() => { if (native.on) stopNative(); else void stopShare(); setPanel(null); }} data-testid="meet-share-stop"><X className="size-5" /><span><b className="block text-sm font-semibold">공유 멈추기</b></span></button> : null}
            {conn.canScreen && <button type="button" className={row} disabled={!live} onClick={() => void startScreen()} data-testid="meet-share-screen"><MonitorUp className="size-5 shrink-0" /><span><b className="block text-sm font-semibold">화면 공유</b><span className="text-xs text-slate-300">화면 전체·창·브라우저 탭 가운데 골라 보여 줍니다. 탭을 고르면 그 탭의 소리도 함께 보낼 수 있습니다.</span></span></button>}
            {native.can && screenTicket && <button type="button" className={row} disabled={!live} onClick={() => void startNative()} data-testid="meet-share-native"><Smartphone className="size-5 shrink-0" /><span><b className="block text-sm font-semibold">휴대폰 화면 공유</b><span className="text-xs text-slate-300">지금 이 휴대폰 화면을 그대로 보여 줍니다. 알림 내용도 함께 보일 수 있으니 방해 금지를 켜 두세요.</span></span></button>}
            <button type="button" className={row} disabled={!live || docBusy} onClick={() => fileRef.current?.click()} data-testid="meet-share-doc">{docBusy ? <Loader2 className="size-5 shrink-0 animate-spin" /> : <FileImage className="size-5 shrink-0" />}<span><b className="block text-sm font-semibold">사진·PDF 보여 주기</b><span className="text-xs text-slate-300">이 기기의 사진이나 PDF 문서를 골라 보여 줍니다. 고른 파일만 보이고, 파일이 서버에 올라가지는 않습니다.</span></span></button>
            {!conn.canScreen && !native.can && <p className="rounded-input bg-slate-700/50 p-2.5 text-xs leading-relaxed text-slate-300" data-testid="meet-share-unsupported">이 기기의 브라우저는 <b className="text-white">화면 전체 공유</b>를 지원하지 않습니다(휴대폰 브라우저 공통). 사진·PDF 는 위 단추로 바로 보여 줄 수 있고, 실물은 {conn.canFlip ? <>더보기의 <b className="text-white">카메라 전환</b>으로 뒷카메라에 비춰 </> : '카메라에 비춰 '}보여 줄 수 있습니다. 화면 전체 공유는 컴퓨터 브라우저에서 됩니다.</p>}
          </div>
        </Sheet>}
        {panel === 'more' && <Sheet title="더보기" onClose={() => setPanel(null)} testid="meet-more-panel">
          <div className="space-y-4">
            <div><p className={cap}>반응</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">{REACTIONS.map((e) => <button key={e} type="button" className="flex size-10 items-center justify-center rounded-full bg-slate-700 text-xl hover:bg-slate-600" onClick={() => react(e)} aria-label={`반응 ${e}`} data-testid="meet-react">{e}</button>)}
                <button type="button" className={cx('ml-1 inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-medium', myHand ? 'bg-amber-400 text-slate-900' : 'bg-slate-700 hover:bg-slate-600')} onClick={() => { toggleHand(); setPanel(null); }} data-testid="meet-hand"><Hand className="size-4" />{myHand ? '손 내리기' : '손들기'}</button></div></div>
            <div><p className={cap}>보기</p>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                <button type="button" className={cx(seg, view === 'gallery' && !pin && segOn)} onClick={() => { setView('gallery'); setPin(null); }} data-testid="meet-view-gallery"><LayoutGrid className="size-4" />나란히 보기</button>
                <button type="button" className={cx(seg, view === 'speaker' && !pin && segOn)} onClick={() => { setView('speaker'); setPin(null); }} data-testid="meet-view-speaker"><UserRound className="size-4" />말하는 사람 크게</button></div>
              <p className="mt-1 text-xs text-slate-400">칸을 누르면 그 사람을 크게 고정합니다(다시 누르면 풀림).</p></div>
            {conn.canFlip && <button type="button" className={ghost} disabled={!conn.cam} onClick={() => { conn.flipCam(); setPanel(null); }} data-testid="meet-flip"><Camera className="size-4" />카메라 전환(앞 ↔ 뒤)</button>}
            <div><p className={cap}>초대</p>
              <p className="mt-1 select-all break-all rounded-input bg-slate-700/60 px-2.5 py-2 font-mono text-xs" data-testid="meet-invite-url">{inviteUrl}</p>
              <div className="mt-1.5 flex gap-2"><button type="button" className={ghost} onClick={copyInvite}><Copy className="size-4" />주소 복사</button><button type="button" className={ghost} onClick={shareInvite}><Share2 className="size-4" />공유</button></div>
              <p className="mt-1 text-xs text-slate-400">주소를 받은 사람은 설치 없이 들어옵니다.</p></div>
            {host?.m && <div className="space-y-2 border-t border-slate-700 pt-3" data-testid="meet-host">
              <p className={cap}>주최자 설정</p>
              <button type="button" className={cx(ghost, 'w-full justify-start')} disabled={host.busy} onClick={() => host.patch({ locked: !host.m!.locked })} data-testid="meet-lock">{host.m.locked ? <Lock className="size-4 text-amber-300" /> : <Unlock className="size-4" />}{host.m.locked ? '회의 잠김 — 풀기' : '회의 잠그기(새로 못 들어옴)'}</button>
              <label className="block text-xs text-slate-300">대기실
                <select className="mt-0.5 block w-full rounded bg-slate-700 px-2 py-2 text-sm text-white" value={host.m.lobby} disabled={host.busy} onChange={(e) => host.patch({ lobby: e.target.value })} data-testid="meet-lobby-policy">{LOBBY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                <span className="mt-1 block leading-relaxed text-slate-400" data-testid="meet-lobby-help">{LOBBY_HELP}</span></label>
              <label className="block text-xs text-slate-300">화면·자료 공유
                <select className="mt-0.5 block w-full rounded bg-slate-700 px-2 py-2 text-sm text-white" value={host.m.share} disabled={host.busy} onChange={(e) => host.patch({ share: e.target.value })} data-testid="meet-share-policy"><option value="all">누구나 공유할 수 있음</option><option value="host">주최자·공동 주최자만</option></select>
                <span className="mt-1 block text-slate-400">바꾼 규칙은 그 뒤에 들어오는 사람부터 적용됩니다.</span></label>
              <Button variant="danger" size="sm" className="w-full" disabled={host.busy} onClick={host.end} data-testid="meet-end">회의 끝내기(모두 나감)</Button>
            </div>}
          </div>
        </Sheet>}
      </div>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => void pickDoc(e.target.files?.[0])} data-testid="meet-share-file" />
      {/* 아래 도구줄 — 휴대폰에서도 항상 보임 */}
      <footer className="flex items-start justify-center gap-0.5 border-t border-slate-800 px-1 pt-1.5 sm:gap-2" style={{ paddingBottom: 'max(6px, var(--sab))' }} data-testid="meet-toolbar">
        <Tool on={conn.mic} disabled={!live} onClick={conn.toggleMic} label="마이크" aria={conn.mic ? '마이크 끄기' : '마이크 켜기'} testid="meet-mic">{conn.mic ? <Mic /> : <MicOff />}</Tool>
        <Tool on={conn.cam} disabled={!live} onClick={conn.toggleCam} label="카메라" aria={conn.cam ? '카메라 끄기' : '카메라 켜기'} testid="meet-cam">{conn.cam ? <Video /> : <VideoOff />}</Tool>
        <Tool on active={!!conn.sharing || native.on || panel === 'share'} disabled={!live} onClick={share} label={conn.sharing || native.on ? '공유 중' : '공유'} aria="공유" testid="meet-share"><MonitorUp /></Tool>
        <Tool on active={panel === 'people'} onClick={() => toggle('people')} label="참가자" aria="참가자" badge={waitN ? String(waitN) : undefined} count={n} testid="meet-people"><Users /></Tool>
        <Tool on active={panel === 'chat'} onClick={() => toggle('chat')} label="채팅" aria="채팅" badge={chat.unread ? String(Math.min(99, chat.unread)) : undefined} testid="meet-chat"><MessageSquare /></Tool>
        <Tool on active={panel === 'more' || myHand} onClick={() => toggle('more')} label="더보기" aria="더보기" testid="meet-more"><MoreHorizontal /></Tool>
        <Tool on danger onClick={leave} disabled={busy} label="나가기" aria="나가기" testid="meet-leave"><LogOut /></Tool>
      </footer>
      {panel === 'leave' && host && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-3 sm:items-center" onClick={() => setPanel(null)}>
          <div className="w-full max-w-sm space-y-2 rounded-card bg-slate-800 p-4 text-sm" style={{ marginBottom: 'var(--sab)' }} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="나가기" data-testid="meet-leave-panel">
            <p className="font-semibold">회의에서 나갈까요?</p>
            <p className="text-xs text-slate-300">나만 나가면 회의는 계속됩니다. 손님은 직원이 한 명도 없으면 새로 들어오지 못합니다.</p>
            <Button className="w-full" variant="secondary" disabled={busy} onClick={() => { setPanel(null); onLeave(); }} data-testid="meet-leave-only"><LogOut />나만 나가기</Button>
            <Button className="w-full" variant="danger" disabled={host.busy} onClick={() => { setPanel(null); void host.end(); }} data-testid="meet-leave-end">회의 끝내기(모두 나감)</Button>
            <button type="button" className="w-full rounded-input py-2 text-slate-300 hover:bg-slate-700" onClick={() => setPanel(null)}>취소</button>
          </div>
        </div>
      )}
    </main>
  );
}

const ghost = 'inline-flex items-center gap-1.5 rounded-input bg-slate-700 px-3 py-2 text-sm font-medium hover:bg-slate-600 disabled:opacity-50';
const row = 'flex w-full items-start gap-3 rounded-input bg-slate-700 p-3 text-left hover:bg-slate-600 disabled:opacity-50';
const cap = 'text-xs font-semibold text-slate-300';
const seg = 'inline-flex items-center justify-center gap-1.5 rounded-input bg-slate-700 px-2 py-2 text-sm hover:bg-slate-600';
const segOn = 'bg-brand-600 hover:bg-brand-600';

/** 옆 칸(컴퓨터) · 아래에서 올라오는 창(휴대폰) */
function Sheet({ title, onClose, children, testid, flush }: { title: string; onClose: () => void; children: React.ReactNode; testid: string; flush?: boolean }) {
  return (
    <aside className="fixed inset-x-0 bottom-0 z-30 flex max-h-[80dvh] flex-col rounded-t-2xl bg-slate-800 text-sm shadow-2xl md:static md:z-auto md:max-h-none md:w-80 md:shrink-0 md:rounded-card md:shadow-none" data-testid={testid}>
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-700 px-3 py-2.5">
        <b className="font-semibold">{title}</b>
        <button type="button" className="ml-auto rounded p-1 hover:bg-slate-700" onClick={onClose} aria-label={`${title} 닫기`} data-testid="meet-panel-close"><X className="size-4" /></button>
      </div>
      <div className={cx('min-h-0 flex-1 overflow-y-auto', !flush && 'p-3')} style={flush ? undefined : { paddingBottom: 'max(12px, var(--sab))' }}>{children}</div>
    </aside>
  );
}

function ChatSheet({ chat, onClose, onSent }: { chat: ReturnType<typeof useChat>; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const end = useRef<HTMLDivElement | null>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [chat.msgs.length]);
  async function submit() {
    const t = text.trim(); if (!t || busy) return;
    setBusy(true);
    try { await chat.send(t); setText(''); onSent(); } catch (e: any) { toast.error(e?.message || '보내지 못했습니다'); } finally { setBusy(false); }
  }
  return (
    <Sheet title="채팅" onClose={onClose} testid="meet-chat-panel" flush>
      <div className="flex h-[60dvh] flex-col md:h-full">
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="meet-chat-list">
          {!chat.msgs.length && <p className="pt-6 text-center text-xs text-slate-400">아직 글이 없습니다. 여기 쓴 글은 회의에 들어와 있는 모두에게 보입니다.</p>}
          {chat.msgs.map((m) => (
            <div key={m.id} className={cx('flex flex-col', m.mine ? 'items-end' : 'items-start')} data-testid="meet-chat-msg" data-mine={m.mine ? '1' : '0'}>
              <span className="text-[11px] text-slate-400">{m.mine ? '나' : m.name} · {hhmm(m.at)}</span>
              <span className={cx('mt-0.5 max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-1.5 text-sm', m.mine ? 'bg-brand-600' : 'bg-slate-700')}>{m.text}</span>
            </div>))}
          <div ref={end} />
        </div>
        <form className="flex shrink-0 items-end gap-2 border-t border-slate-700 p-2" style={{ paddingBottom: 'max(8px, var(--sab))' }} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <textarea className="max-h-28 min-h-[40px] flex-1 resize-none rounded-input bg-slate-700 px-3 py-2 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500" rows={1} maxLength={1000} placeholder="모두에게 보내기" value={text}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } }} aria-label="채팅 입력" data-testid="meet-chat-input" />
          <button type="submit" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-600 hover:bg-brand-700 disabled:opacity-50" disabled={busy || !text.trim()} aria-label="보내기" data-testid="meet-chat-send">{busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}</button>
        </form>
      </div>
    </Sheet>
  );
}

function PersonRow({ t, selfLabel, hand, host, role }: { t: Tile; selfLabel: string; hand: boolean; host: ReturnType<typeof useHost>; role: string }) {
  const [open, setOpen] = useState(false);
  const canManage = !!host && !t.local && role !== 'host' && isUuid(t.identity);
  const guest = role === 'guest' || /\(손님\)$/.test(t.name);
  return (
    <li className="rounded bg-slate-700/40" data-testid="meet-person" data-local={t.local ? '1' : '0'}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-slate-600 text-xs font-semibold">{(t.local ? selfLabel : t.name).slice(0, 1)}</span>
        <span className="min-w-0 flex-1 truncate">{t.local ? `${selfLabel}${selfLabel === '나' ? '' : '(나)'}` : t.name}<span className="text-xs text-slate-400">{role === 'host' ? ' · 주최자' : role === 'cohost' ? ' · 공동 주최자' : ''}</span></span>
        {hand && <span aria-label="손 듦" title="손 듦">✋</span>}
        {t.micOn ? <Mic className="size-4 text-slate-300" aria-label="마이크 켜짐" /> : <MicOff className="size-4 text-red-300" aria-label="마이크 꺼짐" />}
        {t.camOn ? <Video className="size-4 text-slate-300" aria-label="카메라 켜짐" /> : <VideoOff className="size-4 text-red-300" aria-label="카메라 꺼짐" />}
        {canManage && <button type="button" className="rounded p-1 hover:bg-slate-600" onClick={() => setOpen((x) => !x)} aria-label={`${t.name} 관리`} aria-expanded={open} data-testid="meet-person-more"><MoreHorizontal className="size-4" /></button>}
      </div>
      {canManage && open && host && (
        <div className="flex flex-wrap gap-1.5 px-2 pb-2">
          <button type="button" className={mini} disabled={host.busy || !t.micOn} onClick={() => host.person(t.identity, 'mute', `${t.name} 님의 마이크를 껐습니다`)} data-testid="meet-person-mute"><MicOff className="size-3.5" />마이크 끄기</button>
          {!guest && <button type="button" className={mini} disabled={host.busy} onClick={() => host.person(t.identity, role === 'cohost' ? 'uncohost' : 'cohost', role === 'cohost' ? '공동 주최자에서 뺐습니다' : '공동 주최자로 정했습니다 — 다음에 들어올 때부터 주최자 도구가 보입니다')} data-testid="meet-person-cohost">{role === 'cohost' ? '공동 주최자 해제' : '공동 주최자로'}</button>}
          <button type="button" className={cx(mini, 'text-red-200')} disabled={host.busy} onClick={() => { if (confirm(`${t.name} 님을 내보낼까요? 이 회의에 다시 들어올 수 없습니다.`)) void host.person(t.identity, 'remove', '내보냈습니다'); }} data-testid="meet-person-remove">내보내기</button>
        </div>
      )}
    </li>
  );
}
const mini = 'inline-flex items-center gap-1 rounded bg-slate-600 px-2 py-1 text-xs hover:bg-slate-500 disabled:opacity-50';

function PersonTile({ t, small, selfLabel, hand, react, pinned, onPin, onFlip }: { t: Tile; small?: boolean; selfLabel: string; hand: boolean; react?: string; pinned: boolean; onPin?: () => void; onFlip?: () => void }) {
  return (
    <div className={cx('relative size-full overflow-hidden rounded-card bg-slate-800 ring-2 transition-shadow', t.speaking ? 'ring-emerald-400' : pinned ? 'ring-brand-500' : 'ring-transparent', onPin && 'cursor-pointer')}
      onClick={onPin} data-testid={t.local ? 'meet-self' : 'meet-tile'} data-local={t.local ? '1' : '0'} data-speaking={t.speaking ? '1' : '0'} data-video={t.cam ? '1' : '0'}>
      {t.cam ? <SrcVideo src={t.cam} mirror={t.mirror} /> : <div className="absolute inset-0 flex items-center justify-center"><span className={cx('flex items-center justify-center rounded-full bg-slate-700 font-semibold', small ? 'size-9 text-sm' : 'size-16 text-xl')}>{t.local ? <UserRound className={small ? 'size-5' : 'size-8'} /> : t.name.slice(0, 1)}</span></div>}
      <span className={cx('absolute bottom-1.5 left-1.5 flex max-w-[88%] items-center gap-1 truncate rounded bg-black/55 px-1.5 py-0.5', small ? 'text-[10px]' : 'text-xs')}>
        {!t.micOn && <MicOff className="size-3 shrink-0 text-red-300" aria-label="마이크 꺼짐" />}{t.local ? selfLabel : t.name}{t.role === 'host' ? ' · 주최자' : t.role === 'cohost' ? ' · 공동 주최자' : ''}</span>
      {t.poor && <span className="absolute right-1.5 top-1.5 rounded bg-black/60 p-0.5" title="연결 약함"><SignalLow className="size-4 text-amber-300" /></span>}
      {pinned && <span className="absolute left-1.5 top-1.5 rounded bg-black/60 p-0.5" title="크게 고정됨"><Pin className="size-3.5" /></span>}
      {hand && <span className={cx('absolute right-1.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-slate-900', small ? 'bottom-1 text-xs' : 'bottom-1.5 text-base')} data-testid="meet-tile-hand" aria-label="손 듦">✋</span>}
      {react && <span className={cx('pointer-events-none absolute inset-0 flex animate-fade-up items-center justify-center', small ? 'text-3xl' : 'text-6xl')} data-testid="meet-tile-react">{react}</span>}
      {onFlip && !small && <button type="button" className="absolute right-1.5 top-1.5 rounded-full bg-black/55 p-2 hover:bg-black/75" onClick={(e) => { e.stopPropagation(); onFlip(); }} aria-label="카메라 전환" title="카메라 전환(앞 ↔ 뒤)" data-testid="meet-flip-tile"><Camera className="size-4" /></button>}
    </div>
  );
}

/** 공유 화면 — 크게 보기(+/−, 밀어서 움직임) · 내가 공유 중이면 멈추기·쪽 넘기기 */
function ScreenArea({ src, label, mine, note, doc, onPage, onPick, onStop }: { src: VideoSrc | null; label: string; mine: boolean; note: string | null; doc: DocHandle | null; onPage: (d: number) => void; onPick: () => void; onStop?: () => void }) {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-card bg-black" data-testid="meet-screen-share" data-mine={mine ? '1' : '0'}>
      <div className="absolute inset-0 overflow-auto">
        <div className="relative" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
          {src ? <SrcVideo src={src} contain /> : <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-slate-300"><p><Smartphone className="mx-auto mb-2 size-8" />{note}</p></div>}
        </div>
      </div>
      <span className="absolute left-2 top-2 max-w-[60%] truncate rounded bg-black/60 px-1.5 py-0.5 text-xs">{label}{doc ? ` · ${doc.name}` : ''}</span>
      {src && <div className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/60 p-0.5">
        <button type="button" className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-40" disabled={zoom <= 1} onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="작게" data-testid="meet-zoom-out"><Minus className="size-4" /></button>
        <span className="w-9 text-center text-[11px] tabular-nums" data-testid="meet-zoom">{Math.round(zoom * 100)}%</span>
        <button type="button" className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-40" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.min(3, z + 0.5))} aria-label="크게" data-testid="meet-zoom-in"><Plus className="size-4" /></button>
      </div>}
      {mine && onStop && <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-center gap-1.5">
        {doc && doc.pages > 1 && <span className="inline-flex items-center gap-1 rounded-full bg-black/70 p-1 text-xs">
          <button type="button" className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-40" disabled={doc.page <= 1} onClick={() => onPage(-1)} aria-label="이전 쪽" data-testid="meet-doc-prev"><ChevronLeft className="size-4" /></button>
          <span className="tabular-nums" data-testid="meet-doc-page">{doc.page} / {doc.pages}</span>
          <button type="button" className="rounded-full p-1.5 hover:bg-white/15 disabled:opacity-40" disabled={doc.page >= doc.pages} onClick={() => onPage(1)} aria-label="다음 쪽" data-testid="meet-doc-next"><ChevronRight className="size-4" /></button></span>}
        {doc && <button type="button" className="rounded-full bg-black/70 px-3 py-1.5 text-xs hover:bg-black/85" onClick={onPick} data-testid="meet-doc-change">다른 파일</button>}
        <button type="button" className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-semibold hover:bg-red-700" onClick={onStop} data-testid="meet-share-stop-inline">공유 멈추기</button>
      </div>}
    </div>
  );
}

function SrcVideo({ src, mirror, contain }: { src: VideoSrc; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null); const cur = useRef(src); cur.current = src;
  useEffect(() => { const el = ref.current; if (!el) return; return cur.current.attach(el); }, [src.id]);
  return <video ref={ref} autoPlay playsInline muted className={cx('absolute inset-0 size-full', contain ? 'object-contain' : 'object-cover', mirror && '-scale-x-100')} />;
}

function Tool({ on, active, danger, onClick, label, aria, children, testid, disabled, badge, count }: { on: boolean; active?: boolean; danger?: boolean; onClick: () => void; label: string; aria: string; children: React.ReactNode; testid: string; disabled?: boolean; badge?: string; count?: number }) {
  return (
    <button type="button" onClick={onClick} aria-label={aria} title={aria} aria-pressed={!on || !!active} disabled={disabled} data-testid={testid}
      className="group relative flex min-w-0 max-w-[76px] flex-1 flex-col items-center gap-0.5 rounded-input py-0.5 text-[10px] text-slate-200 disabled:opacity-50 sm:text-[11px]">
      <span className={cx('flex size-10 items-center justify-center rounded-full [&>svg]:size-5', danger ? 'bg-red-600 group-hover:bg-red-700' : !on ? 'bg-red-600 group-hover:bg-red-700' : active ? 'bg-brand-600 group-hover:bg-brand-700' : 'bg-slate-700 group-hover:bg-slate-600')}>{children}</span>
      <span className="whitespace-nowrap">{label}{count !== undefined ? ` ${count}` : ''}</span>
      {badge && <span className="absolute right-[14%] top-0 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-semibold leading-4 text-white" data-testid={`${testid}-badge`}>{badge}</span>}
    </button>
  );
}
