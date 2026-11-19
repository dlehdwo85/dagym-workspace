'use client';
// 화상회의 '시험 연결'(가짜 엔진) — 실제 영상은 오가지 않는다. 내 카메라 미리보기와 서버의 참가자 목록으로 회의 화면(도구줄·참가자·채팅·대기실·자료 공유)을 그대로 보여 준다.
// 화면 시험(E2E)이 이 길로 돈다 — 통과해도 '구조 시험 통과'이고, 실제 영상·화면 공유는 라이브킷 서버에서 따로 확인해야 한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { call } from './api';
import { StageView, type StageProps } from './StageView';
import type { Signal, StageConn, Tile, VideoSrc } from './stage';

type Person = { id: string; name: string; guest: boolean; role: string; state: string };
type Props = Omit<StageProps, 'conn' | 'engineNote'> & {
  stream: MediaStream | null; mic: boolean; cam: boolean; toggleMic: () => void; toggleCam: () => void;
  /** 직원이면 회의 id(참가자 목록은 직원에게만) */
  meetingId: string | null; selfId: string | null; role: string; fake: boolean;
};
const streamSrc = (s: MediaStream): VideoSrc => ({ id: s.id, attach: (el) => { el.srcObject = s; return () => { if (el.srcObject === s) el.srcObject = null; }; } });

export function FakeStage({ stream, mic, cam, toggleMic, toggleCam, meetingId, selfId, role, fake, ...view }: Props) {
  const [people, setPeople] = useState<Person[]>([]);
  const [screen, setScreen] = useState<{ kind: 'screen' | 'doc'; stream: MediaStream } | null>(null);
  const listeners = useRef(new Set<(from: string, sig: Signal) => void>());
  useEffect(() => { if (!meetingId) return; const load = () => call<{ people: Person[] }>(`/api/meetings/${meetingId}`).then((r) => setPeople(r.people.filter((p) => p.state !== 'waiting' && p.id !== selfId))).catch(() => {});
    void load(); const h = setInterval(load, 5000); return () => clearInterval(h); }, [meetingId, selfId]);
  const stop = useCallback(async () => { setScreen((s) => { s?.stream.getTracks().forEach((t) => t.stop()); return null; }); }, []);
  useEffect(() => () => { void stop(); }, [stop]);
  const camSrc = useMemo(() => (stream ? streamSrc(stream) : null), [stream]);
  const screenSrc = useMemo(() => (screen ? streamSrc(screen.stream) : null), [screen]);
  const tiles: Tile[] = useMemo(() => [
    { key: 'me', identity: selfId ?? 'me', name: '나', local: true, speaking: false, cam: cam ? camSrc : null, screen: screenSrc, micOn: mic, camOn: cam && !!camSrc, poor: false, role, mirror: true },
    ...people.map((p) => ({ key: p.id, identity: p.id, name: `${p.name}${p.guest ? '(손님)' : ''}`, local: false, speaking: false, cam: null, screen: null, micOn: true, camOn: false, poor: false, role: p.role })),
  ], [selfId, cam, camSrc, screenSrc, mic, role, people]);
  const startScreen = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) return;
    try { const s = await navigator.mediaDevices.getDisplayMedia({ video: true }); await stop(); s.getVideoTracks()[0]?.addEventListener('ended', () => void stop()); setScreen({ kind: 'screen', stream: s }); } catch { /* 취소 */ }
  }, [stop]);
  const shareCanvas = useCallback(async (canvas: HTMLCanvasElement) => { await stop(); setScreen({ kind: 'doc', stream: canvas.captureStream(8) }); }, [stop]);
  const onSignal = useCallback((fn: (from: string, sig: Signal) => void) => { listeners.current.add(fn); return () => { listeners.current.delete(fn); }; }, []);
  const noop = useCallback(() => {}, []);
  const conn: StageConn = useMemo(() => ({
    engine: 'fake', state: 'live', err: '', tiles, mic, cam, sharing: screen?.kind ?? null, audioBlocked: false,
    canScreen: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia,
    canFlip: typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches,
    toggleMic, toggleCam, flipCam: noop, unblockAudio: noop, startScreen, shareCanvas, stopShare: stop, send: noop, onSignal, leave: view.onLeave, retry: noop,
  }), [tiles, mic, cam, screen, toggleMic, toggleCam, noop, startScreen, shareCanvas, stop, onSignal, view.onLeave]);
  return <StageView {...view} conn={conn}
    engineNote={<span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-slate-700 px-2 py-0.5 text-[11px] text-slate-200" data-testid="meet-engine" title={fake ? '실제 영상은 오가지 않습니다' : '지금은 내 화면만 보입니다'}>
      {fake ? <>시험 연결<span className="hidden sm:inline"> — 실제 영상은 오가지 않습니다</span></> : <>연결 준비 중<span className="hidden sm:inline"> — 지금은 내 화면만</span></>}</span>} />;
}
