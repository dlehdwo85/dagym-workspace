'use client';
// #946(대표 11/04 화상회의 0단계 — 라이브킷): 회의 중 실제 영상·음성. 영상·음성은 브라우저 ↔ 라이브킷 서버로 바로 가고 워크인 서버를 지나지 않는다.
// 카메라·마이크·화면 공유(입장권이 허락할 때만) · 말하는 사람 테두리 · 자동 화질(adaptiveStream·dynacast·simulcast) · 연결 약함 표시 · 다시 연결 중 띠 · 소리 막힘(자동 재생) 단추.
// 주최자가 내보내면 'removed', 회의를 끝내면 'ended' 로 부모에게 알린다. 녹화는 하지 않는다(입장권에 녹화 권한 없음).
// 대표 11/19 보강: 화면은 StageView 가 그리고 여기는 연결만 — 화면 공유(탭 소리 포함) · 사진·PDF 자료 공유(그림판 → 화면 공유 길) · 앞뒤 카메라 전환 · 반응·손들기·새 채팅 신호(데이터 통로).
// 라이브킷 라이브러리는 이 칸이 처음 열릴 때만 받는다(회의 화면 밖에서는 안 받음).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from '@/components/ui';
import type { Room, RemoteTrack, Track as LkTrack } from 'livekit-client';
import { StageView, type StageProps } from './StageView';
import { SCREEN_SUFFIX, parseSignal, type Signal, type StageConn, type Tile, type VideoSrc } from './stage';

type LK = typeof import('livekit-client');
export type LiveGone = 'removed' | 'ended';
type Props = Omit<StageProps, 'conn'> & {
  url: string; token: string;
  start: { mic: boolean; cam: boolean; camId?: string; micId?: string };
  onGone: (why: LiveGone) => void; onRetry: () => void;
};
const TOPIC = 'wos';
function roleOf(metadata?: string) { try { return JSON.parse(metadata || '{}').role ?? ''; } catch { return ''; } }

export function LiveStage({ url, token, start, onGone, onRetry, onLeave, ...view }: Props) {
  const [state, setState] = useState<StageConn['state']>('connecting');
  const [err, setErr] = useState('');
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [mic, setMic] = useState(start.mic); const [cam, setCam] = useState(start.cam); const [sharing, setSharing] = useState<StageConn['sharing']>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const roomRef = useRef<Room | null>(null); const lkRef = useRef<LK | null>(null); const audioBox = useRef<HTMLDivElement | null>(null);
  const goneRef = useRef(onGone); goneRef.current = onGone;
  const leftByMe = useRef(false);
  const docTrack = useRef<MediaStreamTrack | null>(null);
  const facing = useRef<'user' | 'environment'>('user');
  const listeners = useRef(new Set<(from: string, sig: Signal) => void>());
  const srcs = useRef(new WeakMap<object, VideoSrc>());
  const srcOf = (track: LkTrack | null | undefined): VideoSrc | null => {
    if (!track) return null;
    let s = srcs.current.get(track);
    if (!s) { s = { id: track.sid || track.mediaStreamTrack?.id || String(Math.random()), attach: (el) => { track.attach(el); return () => { track.detach(el); }; } }; srcs.current.set(track, s); }
    return s;
  };

  useEffect(() => {
    let alive = true; let lk: LK; let room: Room;
    const refresh = () => {
      if (!alive || !room) return;
      const all = [room.localParticipant, ...room.remoteParticipants.values()];
      setTiles(all.map((p) => {
        const camPub = p.getTrackPublication(lk.Track.Source.Camera); const scrPub = p.getTrackPublication(lk.Track.Source.ScreenShare);
        const micPub = p.getTrackPublication(lk.Track.Source.Microphone); const local = p === room.localParticipant; const role = roleOf(p.metadata);
        return { key: p.sid || p.identity, identity: p.identity, name: p.name || p.identity, local, speaking: p.isSpeaking,
          cam: camPub && !camPub.isMuted ? srcOf(camPub.track) : null, screen: srcOf(scrPub?.track), micOn: !!micPub && !micPub.isMuted, camOn: !!camPub && !camPub.isMuted,
          poor: p.connectionQuality === lk.ConnectionQuality.Poor || p.connectionQuality === lk.ConnectionQuality.Lost, role,
          screenOnly: role === 'screen' || p.identity.endsWith(SCREEN_SUFFIX), mirror: local && facing.current === 'user' };
      }));
      setMic(room.localParticipant.isMicrophoneEnabled); setCam(room.localParticipant.isCameraEnabled);
      setSharing(room.localParticipant.isScreenShareEnabled ? (docTrack.current ? 'doc' : 'screen') : null);
      if (!room.localParticipant.isScreenShareEnabled) docTrack.current = null;
      setAudioBlocked(!room.canPlaybackAudio);
    };
    (async () => {
      try {
        lk = await import('livekit-client'); lkRef.current = lk;
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
        // 반응·손들기·새 채팅 신호(같은 방 사람끼리 — 내용은 짧은 신호만, 채팅 글은 워크인 서버에)
        room.on(E.DataReceived, (payload: Uint8Array, participant?: { identity: string }, _kind?: unknown, topic?: string) => {
          if (topic !== TOPIC || !participant) return;
          let sig: Signal | null = null; try { sig = parseSignal(JSON.parse(new TextDecoder().decode(payload))); } catch { /* 모르는 신호는 버림 */ }
          if (sig) for (const fn of listeners.current) fn(participant.identity, sig);
        });
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
    return () => { alive = false; leftByMe.current = true; docTrack.current?.stop(); docTrack.current = null; void roomRef.current?.disconnect(); roomRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, token]);

  const sync = useCallback(() => {
    const r = roomRef.current; if (!r) return;
    setMic(r.localParticipant.isMicrophoneEnabled); setCam(r.localParticipant.isCameraEnabled);
    setSharing(r.localParticipant.isScreenShareEnabled ? (docTrack.current ? 'doc' : 'screen') : null);
  }, []);
  const toggleMic = useCallback(() => { const r = roomRef.current; if (!r) return; void r.localParticipant.setMicrophoneEnabled(!r.localParticipant.isMicrophoneEnabled).catch(() => toast.error('마이크를 켜지 못했습니다 — 브라우저에서 마이크를 허용해 주세요')).finally(sync); }, [sync]);
  const toggleCam = useCallback(() => { const r = roomRef.current; if (!r) return; void r.localParticipant.setCameraEnabled(!r.localParticipant.isCameraEnabled).catch(() => toast.error('카메라를 켜지 못했습니다 — 브라우저에서 카메라를 허용해 주세요')).finally(sync); }, [sync]);
  const flipCam = useCallback(() => {
    const r = roomRef.current, lk = lkRef.current; if (!r || !lk) return;
    const vt = r.localParticipant.getTrackPublication(lk.Track.Source.Camera)?.videoTrack; if (!vt) return;
    const next = facing.current === 'user' ? 'environment' : 'user';
    void vt.restartTrack({ facingMode: next }).then(() => { facing.current = next; setTiles((ts) => ts.map((t) => (t.local ? { ...t, mirror: next === 'user' } : t))); })
      .catch(() => toast.error('카메라를 바꾸지 못했습니다 — 이 기기에 다른 카메라가 없을 수 있습니다'));
  }, []);
  const stopShare = useCallback(async () => {
    const r = roomRef.current; if (!r) return;
    try {
      if (docTrack.current) { const t = docTrack.current; docTrack.current = null; await r.localParticipant.unpublishTrack(t, true); }
      else await r.localParticipant.setScreenShareEnabled(false);
    } catch { /* 이미 멈춘 경우 */ }
    sync();
  }, [sync]);
  const startScreen = useCallback(async () => {
    const r = roomRef.current; if (!r) return;
    if (!navigator.mediaDevices?.getDisplayMedia) { toast.error('이 기기의 브라우저는 화면 전체 공유를 지원하지 않습니다 — 사진·PDF 보여 주기를 써 주세요'); return; }
    if (docTrack.current) await stopShare();
    const opts = { selfBrowserSurface: 'exclude' as const, surfaceSwitching: 'include' as const, systemAudio: 'include' as const };
    try { await r.localParticipant.setScreenShareEnabled(true, { ...opts, audio: true }); }
    catch (e: any) {
      if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') toast.info('화면 공유를 취소했습니다');
      else {
        // 소리 공유를 받지 않는 브라우저 → 화면만 다시
        try { await r.localParticipant.setScreenShareEnabled(true, opts); }
        catch (e2: any) { if (e2?.name === 'NotAllowedError' || e2?.name === 'AbortError') toast.info('화면 공유를 취소했습니다'); else toast.error('화면 공유를 시작하지 못했습니다 — 주최자만 공유할 수 있는 회의이거나, 브라우저가 화면 공유를 막고 있습니다'); }
      }
    }
    sync();
  }, [stopShare, sync]);
  const shareCanvas = useCallback(async (canvas: HTMLCanvasElement) => {
    const r = roomRef.current, lk = lkRef.current; if (!r || !lk) throw new Error('아직 연결되지 않았습니다');
    if (r.localParticipant.isScreenShareEnabled) await stopShare();
    const track = canvas.captureStream(8).getVideoTracks()[0]; if (!track) throw new Error('이 브라우저에서는 자료 공유를 쓸 수 없습니다');
    try { track.contentHint = 'detail'; } catch { /* 힌트를 모르는 브라우저 */ }
    docTrack.current = track;
    try { await r.localParticipant.publishTrack(track, { source: lk.Track.Source.ScreenShare, name: 'doc', simulcast: false, screenShareEncoding: { maxBitrate: 1_500_000, maxFramerate: 8 } }); }
    catch (e) { docTrack.current = null; track.stop(); throw new Error('자료 공유를 시작하지 못했습니다 — 주최자만 공유할 수 있는 회의일 수 있습니다'); }
    sync();
  }, [stopShare, sync]);
  const send = useCallback((sig: Signal) => {
    const r = roomRef.current; if (!r || r.state !== 'connected') return;
    void r.localParticipant.publishData(Uint8Array.from(new TextEncoder().encode(JSON.stringify(sig))), { reliable: true, topic: TOPIC }).catch(() => {});
  }, []);
  const onSignal = useCallback((fn: (from: string, sig: Signal) => void) => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; }, []);
  const unblockAudio = useCallback(() => { void roomRef.current?.startAudio().then(() => setAudioBlocked(false)); }, []);
  const leave = useCallback(() => { leftByMe.current = true; void (roomRef.current?.disconnect() ?? Promise.resolve()).catch(() => {}).finally(onLeave); }, [onLeave]);

  const conn: StageConn = useMemo(() => ({
    engine: 'livekit', state, err, tiles, mic, cam, sharing, audioBlocked,
    canScreen: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia,
    canFlip: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches,
    toggleMic, toggleCam, flipCam, unblockAudio, startScreen, shareCanvas, stopShare, send, onSignal, leave, retry: onRetry,
  }), [state, err, tiles, mic, cam, sharing, audioBlocked, toggleMic, toggleCam, flipCam, unblockAudio, startScreen, shareCanvas, stopShare, send, onSignal, leave, onRetry]);

  return (<>
    <StageView {...view} conn={conn} onLeave={leave} />
    <div ref={audioBox} className="hidden" aria-hidden />
  </>);
}
