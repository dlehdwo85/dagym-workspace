'use client';
// 219차 워크인 화상회의 화면(결정 15-37, 설계 docs/research/VIDEO_MEETINGS_DESIGN_2026-10-28.md 6-2·6-3) — 참가 전 미리보기 → (손님 이름) → 대기실 → 회의 → 나가기.
// 영상·음성은 엔진(중계 서버)으로 직접 가는데, 지금은 엔진 화면 연결 전 단계: 가짜 엔진이면 '시험 연결'로 내 화면·참가자·주최자 도구만(실제 영상은 0단계 시험대에서).
// 줌·구글·마이크로소프트의 로고·색·아이콘·문구는 쓰지 않는다 — 워크인 디자인 문서(docs/DESIGN_SYSTEM.md) 기준.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Loader2, Lock, LogOut, Mic, MicOff, ShieldCheck, Unlock, UserRound, Users, Video, VideoOff, X } from 'lucide-react';
import { Button, Field, Toaster, cx, inputCls, toast } from '@/components/ui';

type Pub = { title: string; company: string; status: 'open' | 'live' | 'ended'; locked: boolean; staffFirst: boolean; started: boolean; staff: boolean; meetingId: string | null; engine: string | null };
type Grant = { token: string; url: string; engine: string; expiresIn: number };
type Person = { id: string; name: string; guest: boolean; role: string; state: string };
type Phase = 'loading' | 'error' | 'ended' | 'pre' | 'waiting' | 'waitingStaff' | 'in' | 'left' | 'removed' | 'denied';
type Guest = { pid: string; secret: string; name: string };

async function call<T = any>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; keepalive?: boolean } = {}): Promise<T> {
  const r = await fetch(path, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined, credentials: 'same-origin', keepalive: init.keepalive });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message ?? '오류가 났습니다'), { status: r.status });
  return j as T;
}
const store = { get(code: string): Guest | null { try { return JSON.parse(sessionStorage.getItem(`wos_meet_${code}`) ?? 'null'); } catch { return null; } },
  set(code: string, g: Guest | null) { try { if (g) sessionStorage.setItem(`wos_meet_${code}`, JSON.stringify(g)); else sessionStorage.removeItem(`wos_meet_${code}`); } catch { /* 저장 못 해도 이번 화면에서는 그대로 */ } } };
const LOBBY: [string, string][] = [['guests', '손님만 대기'], ['everyone', '주최자 말고 모두 대기'], ['invited', '초대받은 사람 말고 대기'], ['none', '대기실 없음']];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function MeetRoom({ code }: { code: string }) {
  const [pub, setPub] = useState<Pub | null>(null); const [err, setErr] = useState('');
  const [phase, setPhase] = useState<Phase>('loading');
  const [guest, setGuest] = useState<Guest | null>(null); const [name, setName] = useState('');
  const [grant, setGrant] = useState<Grant | null>(null); const [role, setRole] = useState<string>('member'); const [selfId, setSelfId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 미리보기(브라우저 기능 — 엔진과 무관)
  const [stream, setStream] = useState<MediaStream | null>(null); const [mediaErr, setMediaErr] = useState('');
  const [mic, setMic] = useState(true); const [cam, setCam] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]); const [camId, setCamId] = useState(''); const [micId, setMicId] = useState('');
  const vref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => { call<Pub>(`/api/meet/${code}`).then((p) => { setPub(p); const g = p.staff ? null : store.get(code); setGuest(g); setPhase(p.status === 'ended' ? 'ended' : g ? 'waiting' : 'pre'); })
    .catch((e) => { setErr(e.status === 404 ? '회의를 찾을 수 없습니다 — 주소를 다시 확인해 주세요' : e.message); setPhase('error'); }); }, [code]);

  const openMedia = useCallback(async (c = camId, m = micId) => {
    if (!navigator.mediaDevices?.getUserMedia) { setMediaErr('이 브라우저에서는 카메라·마이크를 쓸 수 없습니다 — 없이 들어갈 수 있습니다'); return; }
    try {
      stream?.getTracks().forEach((t) => t.stop());
      const s = await navigator.mediaDevices.getUserMedia({ video: c ? { deviceId: { exact: c } } : true, audio: m ? { deviceId: { exact: m } } : true });
      s.getAudioTracks().forEach((t) => (t.enabled = mic)); s.getVideoTracks().forEach((t) => (t.enabled = cam));
      setStream(s); setMediaErr('');
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' || d.kind === 'audioinput'));
    } catch { setMediaErr('카메라·마이크를 쓸 수 없습니다 — 브라우저 주소창 옆에서 허용하거나, 없이 들어갈 수 있습니다'); }
  }, [camId, micId, stream, mic, cam]);
  useEffect(() => { if (phase === 'pre' && !stream && !mediaErr) void openMedia(); }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (vref.current) vref.current.srcObject = stream; }, [stream, phase]);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);
  const toggleMic = () => { const v = !mic; setMic(v); stream?.getAudioTracks().forEach((t) => (t.enabled = v)); };
  const toggleCam = () => { const v = !cam; setCam(v); stream?.getVideoTracks().forEach((t) => (t.enabled = v)); };

  // 들어가기: 직원 = 입장(대기실이면 3초마다 다시), 손님 = 이름 → 대기 → 3초마다 상태
  const staffJoin = useCallback(async () => {
    const r = await call<any>(`/api/meetings/${pub!.meetingId}/join`, { body: {} });
    setRole(r.role ?? 'member'); setSelfId(r.participantId ?? null);
    if (r.state === 'admitted') { setGrant({ token: r.token, url: r.url, engine: r.engine, expiresIn: r.expiresIn }); setPhase('in'); } else setPhase('waiting');
  }, [pub]);
  const guestPoll = useCallback(async (g: Guest) => {
    const r = await call<any>(`/api/meet/${code}/guest/${g.pid}`, { headers: { 'x-guest-secret': g.secret } });
    if (r.state === 'admitted' && r.token) { setGrant({ token: r.token, url: r.url, engine: r.engine, expiresIn: r.expiresIn }); setRole('guest'); setPhase('in'); }
    else if (r.state === 'admitted') setPhase('waitingStaff');
    else if (r.state === 'waiting') setPhase('waiting');
    else if (r.state === 'ended' || r.state === 'removed' || r.state === 'denied') { setPhase(r.state); if (r.state !== 'ended') store.set(code, null); }
    else if (r.state === 'left') setPhase('left');
  }, [code]);
  async function join() {
    setBusy(true);
    try {
      if (pub?.staff) await staffJoin();
      else { const g0 = guest ?? { ...(await call<{ participantId: string; secret: string }>(`/api/meet/${code}/guest`, { body: { name: name.trim() } })), name: name.trim() } as any;
        const g: Guest = guest ?? { pid: g0.participantId, secret: g0.secret, name: name.trim() }; store.set(code, g); setGuest(g); await guestPoll(g); }
    } catch (e: any) { if (e.status === 410) setPhase('ended'); else if (e.status === 404 && guest) { store.set(code, null); setGuest(null); setPhase('pre'); toast.error('예전 참가 요청이 사라졌습니다 — 다시 요청해 주세요'); } else toast.error(e.message); }
    finally { setBusy(false); }
  }
  useEffect(() => { // 대기 중 3초마다
    if (phase !== 'waiting' && phase !== 'waitingStaff') return;
    const h = setInterval(() => { (pub?.staff ? staffJoin() : guest ? guestPoll(guest) : Promise.resolve()).catch((e) => { if (e.status === 410) setPhase('ended'); }); }, 3000);
    return () => clearInterval(h);
  }, [phase, pub, guest, staffJoin, guestPoll]);

  // 회의 중: 30초마다 '아직 있음' · 나갈 때 알림
  const seen = useCallback(async (leave = false) => {
    const r = pub?.staff ? await call<any>(`/api/meetings/${pub.meetingId}/seen`, { body: { leave }, keepalive: leave })
      : guest ? await call<any>(`/api/meet/${code}/guest/${guest.pid}`, { body: { leave }, headers: { 'x-guest-secret': guest.secret }, keepalive: leave }) : null;
    if (r?.state === 'ended' || r?.state === 'removed') { setPhase(r.state); setGrant(null); }
  }, [pub, guest, code]);
  useEffect(() => {
    if (phase !== 'in') return;
    void seen().catch(() => {});
    const h = setInterval(() => void seen().catch(() => {}), 30_000);
    const bye = () => { void seen(true).catch(() => {}); };
    window.addEventListener('pagehide', bye);
    return () => { clearInterval(h); window.removeEventListener('pagehide', bye); };
  }, [phase, seen]);
  async function leave() { setBusy(true); try { await seen(true); } catch { /* 나가기는 화면에서 먼저 */ } setGrant(null); setPhase('left'); setBusy(false); }

  // 회의 시간
  const [since, setSince] = useState(0); const [tick, setTick] = useState(0);
  useEffect(() => { if (phase === 'in') { setSince(Date.now()); const h = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(h); } }, [phase]);
  const elapsed = since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0; void tick;

  if (phase === 'loading') return <Shell><p className="mt-6 flex items-center gap-2 text-sm text-ink-2"><Loader2 className="size-4 animate-spin" />회의를 확인하는 중…</p></Shell>;
  if (phase === 'error' || !pub) return <Shell><p className="mt-6 rounded-input bg-red-50 p-3 text-sm text-red-700" role="alert" data-testid="meet-error">{err || '회의를 열 수 없습니다'}</p></Shell>;
  const head = <><p className="text-xs font-semibold tracking-wide text-brand-700">{pub.company} · 화상회의</p><h1 className="mt-1 text-xl font-bold" data-testid="meet-title">{pub.title}</h1></>;
  if (phase === 'ended') return <Shell>{head}<Note tone="slate" testid="meet-ended">회의가 끝났습니다.</Note></Shell>;
  if (phase === 'removed') return <Shell>{head}<Note tone="red" testid="meet-removed">주최자가 이 회의에서 내보냈습니다.</Note></Shell>;
  if (phase === 'denied') return <Shell>{head}<Note tone="red" testid="meet-denied">주최자가 참가 요청을 받지 않았습니다.</Note></Shell>;
  if (phase === 'left') return <Shell>{head}<Note tone="slate" testid="meet-left">회의에서 나왔습니다.</Note><Button className="mt-3" onClick={join} disabled={busy} data-testid="meet-rejoin">다시 들어가기</Button></Shell>;
  if (phase === 'waiting' || phase === 'waitingStaff') return (
    <Shell>{head}
      <div className="mt-5 flex items-center gap-3 rounded-card border border-line bg-white p-4" data-testid="meet-waiting" data-phase={phase}>
        <Loader2 className="size-5 shrink-0 animate-spin text-brand-600" />
        <div><p className="font-medium">{phase === 'waitingStaff' ? '주최 측이 들어오면 시작합니다' : '주최자가 허락하면 들어갑니다'}</p>
          <p className="mt-0.5 text-xs text-ink-2">{guest ? `${guest.name}(손님)` : '직원'} · 이 화면을 닫지 말고 기다려 주세요</p></div>
      </div>
    </Shell>
  );
  if (phase === 'pre') return (
    <Shell>{head}
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_280px]">
        <div>
          <Preview vref={vref} on={!!stream && cam} label={pub.staff ? '나' : name || '나'} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <RoundBtn on={mic} onClick={toggleMic} label={mic ? '마이크 끄기' : '마이크 켜기'} testid="meet-pre-mic">{mic ? <Mic /> : <MicOff />}</RoundBtn>
            <RoundBtn on={cam} onClick={toggleCam} label={cam ? '카메라 끄기' : '카메라 켜기'} testid="meet-pre-cam">{cam ? <Video /> : <VideoOff />}</RoundBtn>
            {devices.length > 0 && <>
              <select className={cx(inputCls, 'h-9 w-auto max-w-[45%] py-0 text-xs')} value={camId} onChange={(e) => { setCamId(e.target.value); void openMedia(e.target.value, micId); }} aria-label="카메라">
                <option value="">기본 카메라</option>{devices.filter((d) => d.kind === 'videoinput').map((d, k) => <option key={d.deviceId || k} value={d.deviceId}>{d.label || `카메라 ${k + 1}`}</option>)}</select>
              <select className={cx(inputCls, 'h-9 w-auto max-w-[45%] py-0 text-xs')} value={micId} onChange={(e) => { setMicId(e.target.value); void openMedia(camId, e.target.value); }} aria-label="마이크">
                <option value="">기본 마이크</option>{devices.filter((d) => d.kind === 'audioinput').map((d, k) => <option key={d.deviceId || k} value={d.deviceId}>{d.label || `마이크 ${k + 1}`}</option>)}</select></>}
          </div>
          {mediaErr && <p className="mt-2 text-xs text-amber-700" data-testid="meet-media-error">{mediaErr}</p>}
        </div>
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void join(); }}>
          {pub.staff ? <p className="text-sm text-ink-2">같은 회사 직원으로 들어갑니다.</p>
            : <Field label="이름" hint="회의 참가자에게 보이는 이름입니다"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="name" placeholder="예: 홍길동" data-testid="meet-name" /></Field>}
          {pub.locked && <p className="text-xs text-red-700">회의가 잠겨 있어 지금은 들어갈 수 없습니다.</p>}
          <Button type="submit" className="w-full" disabled={busy || pub.locked || (!pub.staff && !name.trim())} data-testid="meet-join">{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{pub.staff ? '참가' : '참가 요청'}</Button>
          {!pub.staff && <p className="text-[11px] text-ink-3">손님은 주최자가 허락하면 들어갑니다{pub.staffFirst ? ' · 주최 측 직원이 들어와 있어야 시작합니다' : ''}.</p>}
        </form>
      </div>
    </Shell>
  );
  // 회의 중
  const host = role === 'host' || role === 'cohost';
  return (
    <main className="flex min-h-dvh flex-col bg-slate-900 text-white" data-testid="meet-room">
      <Toaster />
      <header className="flex items-center gap-2 px-4 py-2 text-sm">
        <span className="min-w-0 truncate font-semibold">{pub.title}</span>
        <span className="tabular-nums text-slate-300" data-testid="meet-elapsed">{mmss(elapsed)}</span>
        <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-slate-200" data-testid="meet-engine" title={grant?.engine === 'fake' ? '실제 영상은 오가지 않습니다' : '지금은 내 화면만 보입니다'}>
          {grant?.engine === 'fake' ? <>시험 연결<span className="hidden sm:inline"> — 실제 영상은 오가지 않습니다</span></> : <>연결 준비 중<span className="hidden sm:inline"> — 지금은 내 화면만</span></>}</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:flex-row">
        <Tiles self={<Preview vref={vref} on={!!stream && cam} label={guest ? `${guest.name}(손님)` : '나'} dark />} meetingId={pub.staff ? pub.meetingId : null} selfId={selfId} />
        {host && pub.meetingId && <HostPanel meetingId={pub.meetingId} onEnded={() => { setPhase('ended'); setGrant(null); }} />}
      </div>
      <footer className="flex items-center justify-center gap-3 border-t border-slate-800 px-4 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <RoundBtn on={mic} onClick={toggleMic} label={mic ? '마이크 끄기' : '마이크 켜기'} dark testid="meet-mic">{mic ? <Mic /> : <MicOff />}</RoundBtn>
        <RoundBtn on={cam} onClick={toggleCam} label={cam ? '카메라 끄기' : '카메라 켜기'} dark testid="meet-cam">{cam ? <Video /> : <VideoOff />}</RoundBtn>
        <Button variant="danger" onClick={leave} disabled={busy} data-testid="meet-leave"><LogOut />나가기</Button>
      </footer>
    </main>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-dvh max-w-3xl bg-canvas px-4 py-8 text-ink" data-testid="meet-page"><Toaster />{children}</main>;
}
function Note({ tone, testid, children }: { tone: 'slate' | 'red'; testid: string; children: React.ReactNode }) {
  return <p className={cx('mt-5 rounded-input p-3 text-sm', tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-white text-ink-2 shadow-card')} data-testid={testid}>{children}</p>;
}
function RoundBtn({ on, onClick, label, children, dark, testid }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode; dark?: boolean; testid: string }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={!on} data-testid={testid}
    className={cx('inline-flex size-10 items-center justify-center rounded-full [&>svg]:size-5', on ? (dark ? 'bg-slate-700 text-white hover:bg-slate-600' : 'border border-line bg-white text-ink hover:bg-slate-50') : 'bg-red-600 text-white hover:bg-red-700')}>{children}</button>;
}
function Preview({ vref, on, label, dark }: { vref: React.MutableRefObject<HTMLVideoElement | null>; on: boolean; label: string; dark?: boolean }) {
  return (
    <div className={cx('relative aspect-video w-full overflow-hidden rounded-card', dark ? 'bg-slate-800' : 'bg-slate-200')} data-testid="meet-self">
      <video ref={vref} autoPlay playsInline muted className={cx('size-full -scale-x-100 object-cover', !on && 'hidden')} />
      {!on && <div className="absolute inset-0 flex items-center justify-center"><span className={cx('flex size-16 items-center justify-center rounded-full', dark ? 'bg-slate-700 text-slate-200' : 'bg-white text-ink-2')}><UserRound className="size-8" /></span></div>}
      <span className="absolute bottom-2 left-2 max-w-[80%] truncate rounded bg-black/55 px-1.5 py-0.5 text-xs text-white">{label}</span>
    </div>
  );
}
/** 참가자 칸 — 직원은 회의 참가자 목록(5초마다), 손님은 내 칸만(참가자 목록은 직원에게만) */
function Tiles({ self, meetingId, selfId }: { self: React.ReactNode; meetingId: string | null; selfId: string | null }) {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => { if (!meetingId) return; const load = () => call<{ people: Person[] }>(`/api/meetings/${meetingId}`).then((r) => setPeople(r.people.filter((p) => p.state !== 'waiting' && p.id !== selfId))).catch(() => {});
    void load(); const h = setInterval(load, 5000); return () => clearInterval(h); }, [meetingId, selfId]);
  return (
    <section className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="meet-tiles">
      {self}
      {people.map((p) => (
        <div key={p.id} className="relative flex aspect-video items-center justify-center rounded-card bg-slate-800" data-testid="meet-tile" data-state={p.state}>
          <span className="flex size-14 items-center justify-center rounded-full bg-slate-700 text-lg font-semibold">{p.name.slice(0, 1)}</span>
          <span className="absolute bottom-2 left-2 max-w-[80%] truncate rounded bg-black/55 px-1.5 py-0.5 text-xs">{p.name}{p.guest ? '(손님)' : ''}{p.role === 'host' ? ' · 주최자' : p.role === 'cohost' ? ' · 공동 주최자' : ''}{p.state === 'admitted' ? ' · 들어오는 중' : ''}</span>
        </div>
      ))}
    </section>
  );
}
/** 주최자·공동 주최자 도구: 대기실(허락·거절·모두 허락) · 잠금 · 대기실 정책 · 화면 공유 · 모두 음소거 · 끝내기 */
function HostPanel({ meetingId, onEnded }: { meetingId: string; onEnded: () => void }) {
  const [wait, setWait] = useState<{ id: string; name: string; guest: boolean }[]>([]);
  const [m, setM] = useState<{ locked: boolean; lobby: string; share: string } | null>(null);
  const [busy, setBusy] = useState(false); const seenIds = useRef(new Set<string>());
  const load = useCallback(async () => {
    const [l, g] = await Promise.all([call<{ waiting: { id: string; name: string; guest: boolean }[] }>(`/api/meetings/${meetingId}/lobby`), call<any>(`/api/meetings/${meetingId}`)]);
    setWait(l.waiting); setM({ locked: g.meeting.locked, lobby: g.meeting.lobby, share: g.meeting.share });
    for (const w of l.waiting) if (!seenIds.current.has(w.id)) { seenIds.current.add(w.id); toast.info(`대기 중: ${w.name}${w.guest ? '(손님)' : ''}`); }
  }, [meetingId]);
  useEffect(() => { void load().catch(() => {}); const h = setInterval(() => void load().catch(() => {}), 3000); return () => clearInterval(h); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await load(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } };
  const lobby = (action: string, ids?: string[]) => act(() => call(`/api/meetings/${meetingId}/lobby`, { body: { action, ids } }));
  const patch = (body: Record<string, unknown>) => act(() => call(`/api/meetings/${meetingId}`, { method: 'PATCH', body }));
  async function end() { if (!confirm('회의를 끝낼까요? 모두 나가게 됩니다.')) return; setBusy(true); try { await call(`/api/meetings/${meetingId}/end`, { body: {} }); onEnded(); } catch (e: any) { toast.error(e.message); } finally { setBusy(false); } }
  return (
    <aside className="w-full shrink-0 space-y-3 rounded-card bg-slate-800 p-3 text-sm md:w-72" data-testid="meet-host">
      <div>
        <p className="flex items-center gap-1.5 font-semibold"><Users className="size-4" />대기 중 <span data-testid="meet-wait-count">{wait.length}</span>명
          {wait.length > 1 && <button type="button" className="ml-auto rounded bg-brand-600 px-2 py-0.5 text-xs font-medium hover:bg-brand-700" disabled={busy} onClick={() => lobby('admitAll')} data-testid="meet-admit-all">모두 허락</button>}</p>
        <ul className="mt-1.5 space-y-1">{wait.map((w) => (
          <li key={w.id} className="flex items-center gap-1.5 rounded bg-slate-700/60 px-2 py-1" data-testid="meet-wait-row">
            <span className="min-w-0 flex-1 truncate">{w.name}{w.guest ? '(손님)' : ''}</span>
            <button type="button" aria-label={`${w.name} 허락`} title="허락" className="rounded p-1 hover:bg-slate-600" disabled={busy} onClick={() => lobby('admit', [w.id])} data-testid="meet-admit"><Check className="size-4" /></button>
            <button type="button" aria-label={`${w.name} 거절`} title="거절" className="rounded p-1 hover:bg-slate-600" disabled={busy} onClick={() => lobby('deny', [w.id])} data-testid="meet-deny"><X className="size-4" /></button>
          </li>))}
          {!wait.length && <li className="text-xs text-slate-400">기다리는 사람이 없습니다</li>}</ul>
      </div>
      {m && <div className="space-y-2 border-t border-slate-700 pt-2">
        <button type="button" className="flex w-full items-center gap-1.5 rounded px-1 py-1 hover:bg-slate-700" disabled={busy} onClick={() => patch({ locked: !m.locked })} data-testid="meet-lock">{m.locked ? <Lock className="size-4 text-amber-300" /> : <Unlock className="size-4" />}{m.locked ? '회의 잠김 — 풀기' : '회의 잠그기(새로 못 들어옴)'}</button>
        <label className="block text-xs text-slate-300">대기실<select className="mt-0.5 block w-full rounded bg-slate-700 px-2 py-1 text-sm text-white" value={m.lobby} disabled={busy} onChange={(e) => patch({ lobby: e.target.value })} data-testid="meet-lobby-policy">{LOBBY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="block text-xs text-slate-300">화면 공유<select className="mt-0.5 block w-full rounded bg-slate-700 px-2 py-1 text-sm text-white" value={m.share} disabled={busy} onChange={(e) => patch({ share: e.target.value })} data-testid="meet-share-policy"><option value="all">누구나</option><option value="host">주최자·공동 주최자만</option></select></label>
        <button type="button" className="flex w-full items-center gap-1.5 rounded px-1 py-1 hover:bg-slate-700" disabled={busy} onClick={() => patch({ muteAll: true })} data-testid="meet-mute-all"><MicOff className="size-4" />모두 음소거</button>
      </div>}
      <Button variant="danger" size="sm" className="w-full" disabled={busy} onClick={end} data-testid="meet-end">회의 끝내기</Button>
    </aside>
  );
}
