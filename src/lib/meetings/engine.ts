// 218차 화상회의 엔진 어댑터(결정 15-37, 설계 docs/research/VIDEO_MEETINGS_DESIGN_2026-10-28.md 5장).
// 영상·음성은 엔진(중계 서버)으로 직접 가고, 워크인은 입장권 발급·방 관리 요청·엔진 알림 받기만 한다 — 엔진을 바꿔 끼울 수 있게 여기서만 엔진을 안다.
// MEETING_ENGINE: fake(시험) · livekit(공개 소스, 서울 직접 운영 — 0단계 시험대 전에는 실제 서버로 확인 못함) · mediasoup(연결 안내 서버를 따로 만들어야 함 — 자리만)
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type EngineRole = 'host' | 'cohost' | 'member' | 'guest';
export type IssueInput = { room: string; identity: string; name: string; role: EngineRole; canShare: boolean; ttlSec: number };
export type EngineEvent = { kind: 'join' | 'leave' | 'end'; room: string; identity?: string; at: Date };
export interface MeetingEngine {
  id: 'livekit' | 'mediasoup' | 'fake';
  /** 브라우저가 접속할 주소와 입장권(서명 토큰) */
  issue(p: IssueInput): Promise<{ url: string; token: string }>;
  /** 내보내기 */
  remove(room: string, identity: string): Promise<void>;
  /** 전체 음소거(한 사람 빼고) */
  muteAll(room: string, exceptIdentity?: string): Promise<void>;
  /** 방 닫기 → 모두 나감 */
  end(room: string): Promise<void>;
  /** 엔진 알림 → 공통 사건(서명이 틀리면 throw) */
  hook(req: Request): Promise<EngineEvent[]>;
}
export class EngineAuthError extends Error {}

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');
/** HS256 JWT(라이브킷 입장권·방 관리 요청 공통 형식) */
export function signJwt(payload: Record<string, unknown>, secret: string) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${b64u(createHmac('sha256', secret).update(`${head}.${body}`).digest())}`;
}
function verifyJwt(token: string, secret: string): Record<string, any> {
  const [h, b, s] = token.split('.'); if (!h || !b || !s) throw new EngineAuthError('입장권 형식이 아닙니다');
  const want = createHmac('sha256', secret).update(`${h}.${b}`).digest(); const got = Buffer.from(s, 'base64url');
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new EngineAuthError('서명이 맞지 않습니다');
  const p = JSON.parse(Buffer.from(b, 'base64url').toString('utf8')); const now = Math.floor(Date.now() / 1000);
  if (typeof p.exp === 'number' && p.exp < now - 60) throw new EngineAuthError('만료된 서명');
  return p;
}

/** 시험용 — 입장권은 'fake.<참가 정보>', 방 관리 요청은 MEETING_FAKE_URL 로 보내 시험이 받은 것을 확인 · 엔진 알림은 MEETING_HOOK_SECRET 으로 확인 */
const fake: MeetingEngine = {
  id: 'fake',
  async issue(p) {
    const token = `fake.${b64u(JSON.stringify({ room: p.room, identity: p.identity, name: p.name, role: p.role, canShare: p.canShare, exp: Math.floor(Date.now() / 1000) + p.ttlSec }))}`;
    await tell('issue', { room: p.room, identity: p.identity, role: p.role, canShare: p.canShare });
    return { url: process.env.MEETING_FAKE_URL || 'fake://meet', token };
  },
  async remove(room, identity) { await tell('remove', { room, identity }); },
  async muteAll(room, exceptIdentity) { await tell('muteAll', { room, except: exceptIdentity ?? null }); },
  async end(room) { await tell('end', { room }); },
  async hook(req) {
    const secret = process.env.MEETING_HOOK_SECRET;
    if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) throw new EngineAuthError('엔진 알림 서명이 맞지 않습니다');
    const j = (await req.json().catch(() => null)) as { events?: { kind: string; room: string; identity?: string; at?: string }[] } | null;
    return (j?.events ?? []).filter((e) => ['join', 'leave', 'end'].includes(e.kind) && typeof e.room === 'string')
      .map((e) => ({ kind: e.kind as EngineEvent['kind'], room: e.room, identity: e.identity, at: e.at ? new Date(e.at) : new Date() }));
  },
};
async function tell(op: string, data: unknown) {
  const u = process.env.MEETING_FAKE_URL; if (!u || !/^https?:\/\//.test(u)) return;
  await fetch(`${u.replace(/\/$/, '')}/meeting/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(3000) }).catch(() => {});
}

/**
 * 라이브킷(아파치 2.0) — 입장권은 공개 규격의 JWT 를 여기서 직접 서명(외부 호출 없음).
 * 방 관리(내보내기·음소거·방 닫기)는 라이브킷 방 관리 API(HTTP) · 엔진 알림은 'Authorization: <JWT(sha256 = 본문 해시)>' — 0단계 시험대에서 실제 서버로 확인 전까지 '확인 못함'.
 * 키 이름(값은 대표가 Vercel 에): LIVEKIT_URL(wss://…) · LIVEKIT_API_KEY · LIVEKIT_API_SECRET
 */
function livekit(): MeetingEngine {
  const url = process.env.LIVEKIT_URL ?? '', key = process.env.LIVEKIT_API_KEY ?? '', secret = process.env.LIVEKIT_API_SECRET ?? '';
  const http = url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace(/\/$/, '');
  const admin = (room: string, create = false) => signJwt({ iss: key, nbf: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, sub: 'workin-server', video: { room, roomAdmin: true, ...(create ? { roomCreate: true } : {}) } }, secret);
  const call = async (method: string, room: string, body: Record<string, unknown>, create = false) => {
    const r = await fetch(`${http}/twirp/livekit.RoomService/${method}`, { method: 'POST', headers: { authorization: `Bearer ${admin(room, create)}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`영상 서버가 요청을 받지 않았습니다(${method} ${r.status})`);
    return r.json().catch(() => ({})) as Promise<any>;
  };
  return {
    id: 'livekit',
    async issue(p) {
      const now = Math.floor(Date.now() / 1000);
      const token = signJwt({ iss: key, sub: p.identity, name: p.name, nbf: now, exp: now + p.ttlSec, metadata: JSON.stringify({ role: p.role }),
        video: { room: p.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true, canPublishSources: p.canShare ? ['camera', 'microphone', 'screen_share', 'screen_share_audio'] : ['camera', 'microphone'], ...(p.role === 'host' || p.role === 'cohost' ? { roomAdmin: true } : {}) } }, secret);
      return { url, token };
    },
    async remove(room, identity) { await call('RemoveParticipant', room, { room, identity }); },
    async muteAll(room, exceptIdentity) {
      const list = (await call('ListParticipants', room, { room }))?.participants ?? [];
      for (const pt of list) { if (pt.identity === exceptIdentity) continue; for (const t of pt.tracks ?? []) if (t.type === 'AUDIO' || t.type === 0) await call('MutePublishedTrack', room, { room, identity: pt.identity, track_sid: t.sid, muted: true }); }
    },
    async end(room) { await call('DeleteRoom', room, { room }, true); },
    async hook(req) {
      const raw = await req.text(); const auth = req.headers.get('authorization') ?? '';
      const claims = verifyJwt(auth.replace(/^Bearer\s+/i, ''), secret);
      if (claims.iss !== key || claims.sha256 !== createHash('sha256').update(raw).digest('base64')) throw new EngineAuthError('엔진 알림 서명이 맞지 않습니다');
      const e = JSON.parse(raw); const room = e?.room?.name; const at = e?.createdAt ? new Date(Number(e.createdAt) * 1000) : new Date();
      if (!room) return [];
      if (e.event === 'participant_joined') return [{ kind: 'join', room, identity: e.participant?.identity, at }];
      if (e.event === 'participant_left') return [{ kind: 'leave', room, identity: e.participant?.identity, at }];
      if (e.event === 'room_finished') return [{ kind: 'end', room, at }];
      return [];
    },
  };
}

/** 지금 쓰는 엔진 — 없거나 키가 비면 null(회의 화면은 '영상 연결 준비 중') */
export function meetingEngine(): MeetingEngine | null {
  const e = process.env.MEETING_ENGINE;
  if (e === 'fake') return fake;
  if (e === 'livekit' && process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) return livekit();
  return null; // mediasoup: 연결 안내 서버(+6~10주)를 만든 뒤에
}
