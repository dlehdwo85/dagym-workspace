// 화상회의 보강(대표 11/19 "줌 수준으로 · 화면 공유 · 대기실이 뭔지 모르겠다"): 회의 중 화면(StageView)과 영상 연결(라이브킷 · 시험용 가짜)을 나눈다.
// 화면은 이 모양(StageConn)만 안다 — 엔진이 바뀌어도 화면은 그대로이고, 가짜 엔진으로도 도구줄·참가자·채팅·대기실·자료 공유 화면을 시험할 수 있다.
export type VideoSrc = { id: string; attach(el: HTMLVideoElement): () => void };
export type Tile = {
  key: string; identity: string; name: string; local: boolean; speaking: boolean;
  cam: VideoSrc | null; screen: VideoSrc | null; micOn: boolean; camOn: boolean; poor: boolean; role: string;
  /** 휴대폰 앱의 '화면 공유 전용' 접속(<참가자 id>~screen) — 사람 칸·인원에 세지 않고 화면만 보여 준다 */
  screenOnly?: boolean; mirror?: boolean;
};
export const REACTIONS = ['👍', '👏', '❤️', '😂', '🎉'] as const;
export type Signal = { t: 'react'; e: string } | { t: 'hand'; up: boolean } | { t: 'chat' };
export function parseSignal(raw: unknown): Signal | null {
  const s = raw as any; if (!s || typeof s !== 'object') return null;
  if (s.t === 'react' && (REACTIONS as readonly string[]).includes(s.e)) return { t: 'react', e: s.e };
  if (s.t === 'hand' && typeof s.up === 'boolean') return { t: 'hand', up: s.up };
  if (s.t === 'chat') return { t: 'chat' };
  return null;
}
export type StageConn = {
  engine: 'livekit' | 'fake';
  state: 'connecting' | 'live' | 'reconnecting' | 'error'; err: string;
  tiles: Tile[]; mic: boolean; cam: boolean;
  /** 내가 공유 중인 것: 화면(컴퓨터) · 자료(사진·PDF) */
  sharing: null | 'screen' | 'doc';
  audioBlocked: boolean;
  /** 이 기기·브라우저가 화면 전체 공유를 할 수 있는지(휴대폰 브라우저·앱의 웹 화면은 못 함) */
  canScreen: boolean; canFlip: boolean;
  toggleMic(): void; toggleCam(): void; flipCam(): void; unblockAudio(): void;
  startScreen(): Promise<void>; shareCanvas(canvas: HTMLCanvasElement): Promise<void>; stopShare(): Promise<void>;
  send(sig: Signal): void; onSignal(fn: (from: string, sig: Signal) => void): () => void;
  leave(): void; retry(): void;
};
export const SCREEN_SUFFIX = '~screen';
export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
