'use client';
// #946(대표 11/04 화상회의 0단계 — 라이브킷): 회의 중 화면의 실제 영상·음성 칸. 영상·음성은 브라우저 ↔ 라이브킷 서버로 바로 가고 워크인 서버를 지나지 않는다.
// 카메라·마이크·화면 공유(입장권이 허락할 때만) · 말하는 사람 테두리 · 자동 화질(adaptiveStream·dynacast·simulcast) · 연결 약함 표시 · 다시 연결 중 띠 · 소리 막힘(자동 재생) 단추.
// 주최자가 내보내면 'removed', 회의를 끝내면 'ended' 로 부모에게 알린다. 녹화는 하지 않는다(입장권에 녹화 권한 없음).
// 라이브킷 라이브러리는 이 칸이 처음 열릴 때만 받는다(회의 화면 밖에서는 안 받음).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, LogOut, Mic, MicOff, MonitorUp, RefreshCw, SignalLow, UserRound, Video, VideoOff, Volume2 } from 'lucide-react';
import { Button, cx, toast } from '@/components/ui';
import type { Room, RemoteTrack, Track as LkTrack } from 'livekit-client';

type LK = typeof import('livekit-client');
type Tile = { key: string; identity: string; name: string; local: boolean; speaking: boolean; cam: LkTrack | null; screen: LkTrack | null; micOn: boolean; camOn: boolean; poor: boolean; role: string };
export type LiveGone = 'removed' | 'ended';
type Props = {
  url: string; token: string; canShare: boolean;
  start: { mic: boolean; cam: boolean; camId?: string; micId?: string };
  header: React.ReactNode; side?: React.ReactNode; selfLabel: string;
  onLeave: () => void; onGone: (why: LiveGone) => void; onRetry: () => void; busy?: boolean;
};

function roleOf(metadata?: string) { try { return JSON.parse(metadata || '{}').role ?? ''; } catch { return ''; } }

export function LiveStage({ url, token, canShare, start, header, side, selfLabel, onLeave, onGone, onRetry, busy }: Props) {
  const [state, setState] = useState<'connecting' | 'live' | 'reconnecting' | 'error'>('connecting');
  const [err, setErr] = useState('');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [mic, setMic] = useState(start.mic); const [cam, setCam] = useState(start.cam); const [sharing, setSharing] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const roomRef = useRef<Room | null>(null); const audioBox = useRef<HTMLDivElement | null>(null);
  const goneRef = useRef(onGone); goneRef.current = onGone;
  const leftByMe = useRef(false);

  useEffect(() => {
    let alive = true; let lk: LK; let room: Room;
    const refresh = () => {
      if (!alive || !room) return;
      const all = [room.localParticipant, ...room.remoteParticipants.values()];
      setTiles(all.map((p) => {
        const camPub = p.getTrackPublication(lk.Track.Source.Camera); const scrPub = p.getTrackPublication(lk.Track.Source.ScreenShare);
        const micPub = p.getTrackPublication(lk.Track.Source.Microphone);
        return { key: p.sid || p.identity, identity: p.identity, name: p.name || p.identity, local: p === room.localParticipant, speaking: p.isSpeaking,
          cam: camPub && !camPub.isMuted ? (camPub.track ?? null) : null, screen: scrPub?.track ?? null, micOn: !!micPub && !micPub.isMuted, camOn: !!camPub && !camPub.isMuted,
          poor: p.connectionQuality === lk.ConnectionQuality.Poor || p.connectionQuality === lk.ConnectionQuality.Lost, role: roleOf(p.metadata) };
      }));
      setMic(room.localParticipant.isMicrophoneEnabled); setCam(room.localParticipant.isCameraEnabled); setSharing(room.localParticipant.isScreenShareEnabled);
      setAudioBlocked(!room.canPlaybackAudio);
    };
    (async () => {
      try {
        lk = await import('livekit-client');
        room = new lk.Room({
          adaptiveStream: true, dynacast: true, // 자동 화질: 보이는 칸 크기만큼만 받고, 아무도 안 보는 화질은 보내지 않음
          videoCaptureDefaults: { resolution: lk.VideoPresets.h720.resolution, ...(start.camId ? { deviceId: start.camId } : {}) },
          audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(start.micId ? { deviceId: start.micId } : {}) },
          publishDefaults: { simulcast: true, videoCodec: 'vp8' },
        });
        roomRef.current = room;
        const E = lk.RoomEvent;
        for (const ev of [E.ParticipantConnected, E.ParticipantDisconnected, E.TrackPublished, E.TrackUnpublished, E.TrackMuted, E.TrackUnmuted, E.LocalTrackPublished, E.LocalTrackUnpublished, E.ActiveSpeakersChanged, E.ConnectionQualityChanged, E.ParticipantMetadataChanged, E.AudioPlaybackStatusChanged, E.ParticipantNameChanged]) room.on(ev as any, refresh);
        room.on(E.TrackSubscribed, (track: RemoteTrack) => {
          if (track.kind === lk.Track.Kind.Audio && audioBox.current) { const el = track.attach(); el.dataset.lk = 'audio'; audioBox.current.appendChild(el); }
          refresh();
        });
        room.on(E.TrackUnsubscribed, (track: RemoteTrack) => { track.detach().forEach((el) => el.remove()); refresh(); });
        room.on(E.Reconnecting, () => alive && setState('reconnecting'));
        room.on(E.Reconnected, () => { if (alive) { setState('live'); refresh(); } });
        room.on(E.Disconnected, (reason?: number) => {
          if (!alive || leftByMe.current) return;
          if (reason === lk.DisconnectReason.PARTICIPANT_REMOVED) return goneRef.current('removed');
          if (reason === lk.DisconnectReason.ROOM_DELETED) return goneRef.current('ended');
          setErr('영상 연결이 끊겼습니다'); setState('error');
        });
        await room.connect(url, token, { autoSubscribe: true });
        if (!alive) { await room.disconnect(); return; }
        setState('live'); refresh();
        // 참가 전 미리보기에서 고른 켜짐·꺼짐 그대로(권한이 없으면 꺼진 채로 들어감)
        await room.localParticipant.setMicrophoneEnabled(start.mic).catch(() => toast.error('마이크를 켜지 못했습니다 — 브라우저에서 마이크를 허용해 주세요'));
        await room.localParticipant.setCameraEnabled(start.cam).catch(() => toast.error('카메라를 켜지 못했습니다 — 브라우저에서 카메라를 허용해 주세요'));
        refresh();
      } catch (e: any) {
        if (!alive) return;
        setErr(/token|auth|401|403/i.test(String(e?.message)) ? '입장권이 맞지 않아 영상 서버에 들어가지 못했습니다' : '영상 서버에 연결하지 못했습니다');
        setState('error');
      }
    })();
    return () => { alive = false; leftByMe.current = true; void roomRef.current?.disconnect(); roomRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token]);

  const toggle = useCallback(async (what: 'mic' | 'cam' | 'screen') => {
    const r = roomRef.current; if (!r) return;
    try {
      if (what === 'mic') await r.localParticipant.setMicrophoneEnabled(!r.localParticipant.isMicrophoneEnabled);
      else if (what === 'cam') await r.localParticipant.setCameraEnabled(!r.localParticipant.isCameraEnabled);
      else await r.localParticipant.setScreenShareEnabled(!r.localParticipant.isScreenShareEnabled, { audio: false });
    } catch {
      toast.error(what === 'screen' ? '화면 공유를 시작하지 못했습니다(취소했거나 주최자만 공유할 수 있는 회의)' : what === 'mic' ? '마이크를 켜지 못했습니다' : '카메라를 켜지 못했습니다');
    }
    setMic(r.localParticipant.isMicrophoneEnabled); setCam(r.localParticipant.isCameraEnabled); setSharing(r.localParticipant.isScreenShareEnabled);
  }, []);
  async function leave() { leftByMe.current = true; await roomRef.current?.disconnect().catch(() => {}); onLeave(); }

  const screenTile = useMemo(() => tiles.find((t) => t.screen), [tiles]);
  const n = tiles.length;
  return (
    <main className="flex min-h-dvh flex-col bg-slate-900 text-white" data-testid="meet-room" data-engine="livekit">
      <header className="flex items-center gap-2 px-4 py-2 text-sm">
        {header}
        <span className={cx('ml-auto shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]', state === 'live' ? 'bg-emerald-700/70 text-emerald-50' : state === 'error' ? 'bg-red-700/80' : 'bg-slate-700 text-slate-200')} data-testid="meet-live-state" data-state={state}>
          {state === 'live' ? `연결됨 · ${n}명` : state === 'reconnecting' ? '다시 연결 중…' : state === 'error' ? '연결 안 됨' : '연결 중…'}</span>
      </header>
      {state === 'reconnecting' && <p className="mx-3 rounded-input bg-amber-500/20 px-3 py-1.5 text-xs text-amber-100" role="status">네트워크가 불안정해 다시 연결하고 있습니다 — 잠시만 기다려 주세요</p>}
      {audioBlocked && state === 'live' && <button type="button" className="mx-3 mt-2 inline-flex items-center gap-1.5 self-start rounded-input bg-brand-600 px-3 py-1.5 text-xs font-medium hover:bg-brand-700" onClick={() => void roomRef.current?.startAudio().then(() => setAudioBlocked(false))} data-testid="meet-audio-unblock"><Volume2 className="size-4" />소리 켜기(브라우저가 자동 재생을 막았습니다)</button>}
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:flex-row">
        <section className="flex min-h-0 flex-1 flex-col gap-3">
          {state === 'connecting' && <p className="flex items-center gap-2 text-sm text-slate-300" data-testid="meet-live-connecting"><Loader2 className="size-4 animate-spin" />영상 서버에 연결하는 중…</p>}
          {state === 'error' && <div className="rounded-card bg-red-900/40 p-3 text-sm" role="alert" data-testid="meet-live-error"><p>{err}</p>
            <Button size="sm" variant="secondary" className="mt-2" disabled={busy} onClick={onRetry} data-testid="meet-live-retry"><RefreshCw />다시 연결</Button></div>}
          {screenTile && <div className="relative aspect-video w-full overflow-hidden rounded-card bg-black" data-testid="meet-screen-share">
            <TrackVideo track={screenTile.screen} contain /><span className="absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs">{screenTile.local ? '내 화면 공유 중' : `${screenTile.name} 화면`}</span></div>}
          <div className={cx('grid auto-rows-min gap-3', screenTile ? 'grid-cols-3 sm:grid-cols-4 lg:grid-cols-6' : n <= 1 ? 'grid-cols-1' : n <= 4 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-3')} data-testid="meet-tiles">
            {tiles.map((t) => (
              <div key={t.key} className={cx('relative aspect-video overflow-hidden rounded-card bg-slate-800 ring-2 transition-shadow', t.speaking ? 'ring-emerald-400' : 'ring-transparent')} data-testid="meet-tile" data-local={t.local ? '1' : '0'} data-speaking={t.speaking ? '1' : '0'} data-video={t.cam ? '1' : '0'}>
                {t.cam ? <TrackVideo track={t.cam} mirror={t.local} /> : <div className="absolute inset-0 flex items-center justify-center"><span className="flex size-14 items-center justify-center rounded-full bg-slate-700 text-lg font-semibold">{t.local ? <UserRound className="size-7" /> : t.name.slice(0, 1)}</span></div>}
                <span className="absolute bottom-2 left-2 flex max-w-[85%] items-center gap-1 truncate rounded bg-black/55 px-1.5 py-0.5 text-xs">
                  {!t.micOn && <MicOff className="size-3 shrink-0 text-red-300" aria-label="마이크 꺼짐" />}{t.local ? selfLabel : t.name}{t.role === 'host' ? ' · 주최자' : t.role === 'cohost' ? ' · 공동 주최자' : ''}</span>
                {t.poor && <span className="absolute right-2 top-2 rounded bg-black/60 p-0.5" title="연결 약함"><SignalLow className="size-4 text-amber-300" /></span>}
              </div>
            ))}
          </div>
        </section>
        {side}
      </div>
      <div ref={audioBox} className="hidden" aria-hidden />
      <footer className="flex items-center justify-center gap-3 border-t border-slate-800 px-4 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}>
        <Round on={mic} disabled={state !== 'live'} onClick={() => void toggle('mic')} label={mic ? '마이크 끄기' : '마이크 켜기'} testid="meet-mic">{mic ? <Mic /> : <MicOff />}</Round>
        <Round on={cam} disabled={state !== 'live'} onClick={() => void toggle('cam')} label={cam ? '카메라 끄기' : '카메라 켜기'} testid="meet-cam">{cam ? <Video /> : <VideoOff />}</Round>
        {canShare && <Round on={!sharing} disabled={state !== 'live'} onClick={() => void toggle('screen')} label={sharing ? '화면 공유 멈추기' : '화면 공유'} testid="meet-share"><MonitorUp /></Round>}
        <Button variant="danger" onClick={() => void leave()} disabled={busy} data-testid="meet-leave"><LogOut />나가기</Button>
      </footer>
    </main>
  );
}

function TrackVideo({ track, mirror, contain }: { track: LkTrack | null; mirror?: boolean; contain?: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => { const el = ref.current; if (!el || !track) return; track.attach(el); return () => { track.detach(el); }; }, [track]);
  return <video ref={ref} autoPlay playsInline muted className={cx('absolute inset-0 size-full', contain ? 'object-contain' : 'object-cover', mirror && '-scale-x-100')} />;
}
function Round({ on, onClick, label, children, testid, disabled }: { on: boolean; onClick: () => void; label: string; children: React.ReactNode; testid: string; disabled?: boolean }) {
  return <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={!on} disabled={disabled} data-testid={testid}
    className={cx('inline-flex size-10 items-center justify-center rounded-full disabled:opacity-50 [&>svg]:size-5', on ? 'bg-slate-700 text-white hover:bg-slate-600' : 'bg-red-600 text-white hover:bg-red-700')}>{children}</button>;
}
