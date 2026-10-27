// 218차 화상회의 회의 규칙(결정 15-37, 설계 docs/research/VIDEO_MEETINGS_DESIGN_2026-10-28.md) — 기능 스위치 FEATURE_MEETINGS=1 일 때만(기본 꺼짐, 꺼지면 모두 404).
// 권한: 같은 회사만(다른 회사 404) · 일정 회의 = 그 일정을 볼 수 있는 직원 · 메시지방 통화 = 방 멤버 · 즉석·내 회의실 = 같은 회사 직원 · 손님 = 주소를 아는 회의 1개·이름만.
// 대기실(lobby): guests(기본, 손님만 대기) · everyone(주최자·공동 주최자 말고 모두) · invited(일정 참석자·방 멤버 말고) · none — 손님은 직원이 들어와 있어야(staff_first) 입장권.
// 입장권은 엔진 어댑터(engine.ts)가 서명 — 영상은 워크인을 지나가지 않는다. 회의 기록 = 참가자 상태·시간 + meeting_log.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db, type Sql } from '../db';
import { zUuid } from '../api';
import { HttpError, badRequest, forbidden, notFound } from '../errors';
import { appUrl } from '../mail';
import { notify } from '../notifications';
import { tenantOf, type SessionUser } from '../types';
import { EngineAuthError, meetingEngine, type EngineRole, type MeetingEngine } from './engine';

export const meetingsOn = () => process.env.FEATURE_MEETINGS === '1';
const NF = '회의를 찾을 수 없습니다';
function assertOn() { if (!meetingsOn()) throw notFound(NF); }
/** 회의당 들어와 있는 사람(직원+손님) · 대기실 · 손님 요청(1분) 한도 — 요금제별 한도는 요금 시안과 함께 */
export const MEETING_MAX = 25, LOBBY_MAX = 50, GUEST_PER_MIN = 20;
const TOKEN_TTL = 600; // 입장권 10분(입장할 때만 씀 — 끊기면 다시 받음)
const ttlOf = () => TOKEN_TTL;

export type MeetingRow = { id: string; tenant: string; code: string; kind: 'event' | 'room' | 'instant' | 'personal'; event_id: string | null; room_id: string | null; title: string; host_id: string | null;
  status: 'open' | 'live' | 'ended'; lobby: 'guests' | 'everyone' | 'invited' | 'none'; staff_first: boolean; locked: boolean; share: 'all' | 'host'; engine: string | null;
  started_at: Date | null; ended_at: Date | null; expires_at: Date; created_by: string | null; created_at: Date; updated_at: Date };
type PartRow = { id: string; meeting_id: string; user_id: string | null; guest_name: string | null; guest_secret_hash: string | null; role: EngineRole; state: 'waiting' | 'admitted' | 'joined' | 'left' | 'denied' | 'removed';
  first_joined_at: Date | null; last_joined_at: Date | null; left_at: Date | null; seconds: number; last_seen_at: Date | null; created_at: Date };

const newCode = () => randomBytes(16).toString('base64url'); // 22자
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const meetUrl = (code: string) => `${appUrl()}/meet/${code}`;
const engineOr503 = (): MeetingEngine => { const e = meetingEngine(); if (!e) throw new HttpError(503, 'engine_off', '영상 연결을 준비 중입니다 — 잠시 뒤 다시 들어와 주세요'); return e; };
async function log(sql: Sql, meetingId: string, kind: string, o: { participantId?: string | null; by?: string | null; data?: Record<string, unknown>; at?: Date } = {}) {
  await sql`insert into meeting_log (meeting_id, participant_id, kind, by_user, at, data) values (${meetingId}, ${o.participantId ?? null}, ${kind}, ${o.by ?? null}, ${o.at ?? new Date()}, ${sql.json((o.data ?? {}) as never)})`;
}
const isHost = (role: string) => role === 'host' || role === 'cohost';

/** 직원이 회의에 접근 — 같은 회사 + 회의 종류별(일정을 볼 수 있음·방 멤버) · role = 주최자/공동 주최자/참가자 · invited = 일정 참석자·만든 사람·방 멤버 */
async function access(u: SessionUser, id: string, sql: Sql = db()) {
  assertOn();
  if (!zUuid.safeParse(id).success) throw notFound(NF);
  const [m] = await sql<MeetingRow[]>`select * from meetings where id = ${id} and tenant = ${tenantOf(u)}`;
  if (!m) throw notFound(NF);
  let invited = false;
  if (m.kind === 'event') {
    if (!m.event_id) throw notFound(NF);
    const { event, perms } = await (await import('../events')).loadEvent(u, m.event_id, sql).catch(() => { throw notFound(NF); });
    invited = perms.attendee || event.created_by === u.id;
  } else if (m.kind === 'room') {
    if (!m.room_id) throw notFound(NF);
    await (await import('../chat')).loadRoom(u, m.room_id, sql).catch(() => { throw notFound(NF); });
    invited = true;
  }
  const [p] = await sql<{ role: string }[]>`select role from meeting_participants where meeting_id = ${m.id} and user_id = ${u.id}`;
  const role: EngineRole = m.host_id === u.id ? 'host' : p?.role === 'cohost' ? 'cohost' : 'member';
  return { m, role, invited };
}
async function hostAccess(u: SessionUser, id: string, sql: Sql = db()) {
  const a = await access(u, id, sql);
  if (!isHost(a.role)) throw forbidden('주최자·공동 주최자만 할 수 있습니다');
  return a;
}
/** 지금 들어와 있는 직원(최근 2분 안 신호) — 손님 입장(직원 입장 전 대기)·회의 상태 판단 */
async function staffPresent(sql: Sql, meetingId: string) {
  const [r] = await sql<{ n: number }[]>`select count(*)::int n from meeting_participants where meeting_id = ${meetingId} and user_id is not null and state in ('admitted', 'joined') and last_seen_at > now() - interval '2 minutes'`;
  return r.n > 0;
}
async function inRoomCount(sql: Sql, meetingId: string) {
  const [r] = await sql<{ n: number }[]>`select count(*)::int n from meeting_participants where meeting_id = ${meetingId} and state in ('admitted', 'joined')`;
  return r.n;
}
async function hostsOf(sql: Sql, m: MeetingRow) {
  const r = await sql<{ user_id: string }[]>`select user_id from meeting_participants where meeting_id = ${m.id} and role = 'cohost' and user_id is not null`;
  return [...new Set([m.host_id, ...r.map((x) => x.user_id)].filter((x): x is string => !!x))];
}
async function issueFor(sql: Sql, m: MeetingRow, p: { id: string; role: EngineRole; name: string }, eng: MeetingEngine) {
  const t = await eng.issue({ room: m.id, identity: p.id, name: p.name.slice(0, 60), role: p.role, canShare: m.share === 'all' || isHost(p.role), ttlSec: ttlOf() });
  await log(sql, m.id, 'token', { participantId: p.id, data: { role: p.role } });
  if (!m.engine) await sql`update meetings set engine = ${eng.id} where id = ${m.id}`;
  return { engine: eng.id, url: t.url, token: t.token, expiresIn: ttlOf() };
}
async function goLive(sql: Sql, m: MeetingRow, by: string) {
  if (m.status !== 'open') return;
  const r = await sql`update meetings set status = 'live', started_at = coalesce(started_at, now()), updated_at = now() where id = ${m.id} and status = 'open' returning id`;
  if (r.length) await log(sql, m.id, 'start', { by });
}
/** 대기실에 사람이 오면 주최자·공동 주최자에게(앱 푸시) */
async function lobbyNotify(sql: Sql, m: MeetingRow, pid: string, name: string, by: string | null) {
  await notify(sql, { userIds: await hostsOf(sql, m), type: 'meeting_lobby', title: `대기 중: ${name.slice(0, 30)}`, body: m.title.slice(0, 80) || '화상회의', link: `/meet/${m.code}`,
    entityType: 'meeting', entityId: m.id, actorId: by, dedupeKey: `meeting_lobby:${pid}:${Math.floor(Date.now() / 60000)}`, space: 'work' }).catch(() => []);
}
const view = (m: MeetingRow) => ({ id: m.id, code: m.code, url: meetUrl(m.code), kind: m.kind, title: m.title, status: m.status, lobby: m.lobby, staffFirst: m.staff_first, locked: m.locked, share: m.share,
  eventId: m.event_id, roomId: m.room_id, hostId: m.host_id, startedAt: m.started_at, endedAt: m.ended_at });

// ---------------- 만들기 ----------------
export const meetingInput = z.object({ kind: z.enum(['instant', 'personal', 'room']), title: z.string().trim().max(100).optional(), roomId: zUuid.optional() });
/** 즉석 회의 · 내 고정 회의실(1개, 같은 주소) · 메시지방 통화(열린 회의가 있으면 그것) */
export async function createMeeting(u: SessionUser, i: z.infer<typeof meetingInput>) {
  assertOn(); const sql = db(); const t = tenantOf(u);
  if (i.kind === 'personal') {
    const [cur] = await sql<MeetingRow[]>`select * from meetings where tenant = ${t} and host_id = ${u.id} and kind = 'personal'`;
    if (cur) { if (cur.status === 'ended') await sql`update meetings set status = 'open', ended_at = null, updated_at = now() where id = ${cur.id}`; return { ...view({ ...cur, status: cur.status === 'ended' ? 'open' : cur.status }), created: false }; }
    const [m] = await sql<MeetingRow[]>`insert into meetings (tenant, code, kind, title, host_id, created_by) values (${t}, ${newCode()}, 'personal', ${i.title || `${u.name} 회의실`}, ${u.id}, ${u.id}) returning *`;
    await log(sql, m.id, 'create', { by: u.id, data: { kind: 'personal' } });
    return { ...view(m), created: true };
  }
  let roomId: string | null = null; let title = i.title || '바로 회의';
  if (i.kind === 'room') {
    if (!i.roomId) throw badRequest('대화방을 골라 주세요');
    const r = await (await import('../chat')).loadRoom(u, i.roomId, sql); roomId = r.id; title = i.title || r.name || '대화방 통화';
    const [open] = await sql<MeetingRow[]>`select * from meetings where room_id = ${roomId} and status <> 'ended' and created_at > now() - interval '12 hours' order by created_at desc limit 1`;
    if (open) return { ...view(open), created: false };
  }
  const [m] = await sql<MeetingRow[]>`insert into meetings (tenant, code, kind, room_id, title, host_id, created_by) values (${t}, ${newCode()}, ${i.kind}, ${roomId}, ${title}, ${u.id}, ${u.id}) returning *`;
  await log(sql, m.id, 'create', { by: u.id, data: { kind: i.kind } });
  return { ...view(m), created: true };
}

// ---------------- 일정 [워크인 화상회의] ----------------
/** 반복 일정의 회차(예외 행)는 마스터 일정의 회의를 함께 씀(매 회차 같은 주소) */
async function masterOf(sql: Sql, eventId: string) {
  const [e] = await sql<{ id: string; recurring_event_id: string | null }[]>`select id, recurring_event_id from events where id = ${eventId}`;
  return e?.recurring_event_id ?? eventId;
}
export async function eventMeeting(u: SessionUser, eventId: string) {
  if (!meetingsOn()) return { enabled: false as const };
  const sql = db(); const { perms } = await (await import('../events')).loadEvent(u, eventId, sql);
  const master = await masterOf(sql, eventId);
  const [m] = await sql<MeetingRow[]>`select * from meetings where event_id = ${master} and tenant = ${tenantOf(u)}`;
  return { enabled: true as const, canEdit: perms.edit, on: !!m && m.status !== 'ended', meeting: m && m.status !== 'ended' ? view(m) : null, record: m ? await record(sql, m) : null };
}
export async function setEventMeeting(u: SessionUser, eventId: string, on: boolean) {
  assertOn(); const sql = db(); const ev = await (await import('../events')).loadEvent(u, eventId, sql);
  if (!ev.perms.edit) throw forbidden('일정을 고칠 수 있는 사람만 화상회의를 켜고 끕니다');
  const master = await masterOf(sql, eventId); const t = tenantOf(u);
  const [e] = await sql<{ id: string; title: string; created_by: string; meeting_url: string | null }[]>`select id, title, created_by, meeting_url from events where id = ${master}`;
  const [cur] = await sql<MeetingRow[]>`select * from meetings where event_id = ${master} and tenant = ${t}`;
  if (on) {
    const m = cur ? (await sql<MeetingRow[]>`update meetings set status = case when status = 'ended' then 'open' else status end, ended_at = case when status = 'ended' then null else ended_at end,
        title = ${e.title}, expires_at = now() + interval '90 days', updated_at = now() where id = ${cur.id} returning *`)[0]
      : (await sql<MeetingRow[]>`insert into meetings (tenant, code, kind, event_id, title, host_id, created_by) values (${t}, ${newCode()}, 'event', ${master}, ${e.title}, ${e.created_by}, ${u.id}) returning *`)[0];
    await sql`update events set meeting_url = ${meetUrl(m.code)}, updated_at = now() where id = ${master} or recurring_event_id = ${master}`; // 판 번호는 그대로 — 일정 창의 자동 저장이 '다른 사람이 고침'(409)으로 막히지 않게
    await log(sql, m.id, cur ? 'reopen' : 'create', { by: u.id, data: { kind: 'event' } });
    return eventMeeting(u, eventId);
  }
  if (cur && cur.status !== 'ended') await endNow(sql, cur, u.id);
  if (cur) await sql`update events set meeting_url = null, updated_at = now() where (id = ${master} or recurring_event_id = ${master}) and meeting_url = ${meetUrl(cur.code)}`;
  return eventMeeting(u, eventId);
}

// ---------------- 직원 입장 ----------------
export async function getMeeting(u: SessionUser, id: string) {
  const sql = db(); const { m, role } = await access(u, id, sql);
  const people = await sql<{ id: string; name: string; guest: boolean; role: string; state: string }[]>`
    select p.id, coalesce(u.name, p.guest_name) as name, p.user_id is null as guest, p.role, p.state from meeting_participants p left join users u on u.id = p.user_id
    where p.meeting_id = ${m.id} and p.state in ('admitted', 'joined'${isHost(role) ? sql`, 'waiting'` : sql``}) order by p.created_at`;
  return { meeting: view(m), role, people, waiting: isHost(role) ? people.filter((p) => p.state === 'waiting').length : undefined, engine: meetingEngine()?.id ?? null };
}
/** [참가] — 대기실 정책을 보고 바로 입장권 또는 대기 */
export async function joinMeeting(u: SessionUser, id: string) {
  const sql = db(); const { m, role, invited } = await access(u, id, sql); const eng = engineOr503();
  if (m.status === 'ended') throw new HttpError(410, 'ended', '회의가 끝났습니다');
  const [cur] = await sql<PartRow[]>`select * from meeting_participants where meeting_id = ${m.id} and user_id = ${u.id}`;
  if (cur?.state === 'removed') throw forbidden('주최자가 이 회의에서 내보냈습니다');
  if (m.locked && !isHost(role) && !(cur && ['admitted', 'joined'].includes(cur.state))) throw new HttpError(423, 'locked', '회의가 잠겨 있습니다 — 주최자에게 열어 달라고 해 주세요');
  // 이미 허락받은 적 있는 사람(잠깐 나갔다 다시 — 끊김·새로 고침)은 대기실을 다시 거치지 않음 · 인원 한도는 지금 안에 없는 사람만 셈
  const inside = !!cur && (cur.state === 'admitted' || cur.state === 'joined'); const wasIn = inside || cur?.state === 'left';
  const admit = isHost(role) || wasIn || m.lobby === 'guests' || m.lobby === 'none' || (m.lobby === 'invited' && invited);
  if (admit && !inside && (await inRoomCount(sql, m.id)) >= MEETING_MAX) throw new HttpError(409, 'full', `회의 인원(${MEETING_MAX}명)이 찼습니다`);
  const state = admit ? (cur?.state === 'joined' ? 'joined' : 'admitted') : 'waiting';
  const [p] = await sql<PartRow[]>`insert into meeting_participants (meeting_id, user_id, role, state, last_seen_at) values (${m.id}, ${u.id}, ${role}, ${state}, now())
    on conflict (meeting_id, user_id) where user_id is not null do update set role = case when meeting_participants.role = 'cohost' then 'cohost' else excluded.role end, state = excluded.state, last_seen_at = now()
    returning *`;
  await sql`update meetings set expires_at = greatest(expires_at, now() + interval '90 days') where id = ${m.id}`;
  if (state === 'waiting') {
    if (cur?.state !== 'waiting') { await log(sql, m.id, 'wait', { participantId: p.id, by: u.id }); await lobbyNotify(sql, m, p.id, u.name, u.id); }
    return { meeting: view(m), participantId: p.id, role, state: 'waiting' as const };
  }
  if (cur?.state !== state) await log(sql, m.id, 'admit', { participantId: p.id, by: u.id, data: { auto: true } });
  await goLive(sql, m, u.id);
  return { meeting: view({ ...m, status: m.status === 'open' ? 'live' : m.status }), participantId: p.id, role, state: 'admitted' as const, ...(await issueFor(sql, m, { id: p.id, role, name: u.name }, eng)) };
}
/** 회의 중 30초마다 '아직 있음'(엔진 알림이 빠져도 퇴장 시각 추정) · leave = 나가기 */
export async function staffSeen(u: SessionUser, id: string, leave = false) {
  const sql = db(); const { m } = await access(u, id, sql);
  const [p] = await sql<PartRow[]>`select * from meeting_participants where meeting_id = ${m.id} and user_id = ${u.id}`;
  if (!p) throw notFound('참가 기록이 없습니다');
  return seen(sql, m, p, leave, u.id);
}
async function seen(sql: Sql, m: MeetingRow, p: PartRow, leave: boolean, by: string | null) {
  if (m.status === 'ended') return { state: 'ended' as const }; // 끝난 회의에 늦게 온 신호로 다시 입장 처리하지 않음
  if (leave) { await leftAt(sql, p.id, new Date()); await log(sql, m.id, 'leave', { participantId: p.id, by, data: { via: 'client' } }); return { state: 'left' as const }; }
  if (p.state === 'admitted' || p.state === 'left') {
    await sql`update meeting_participants set state = 'joined', first_joined_at = coalesce(first_joined_at, now()), last_joined_at = now(), left_at = null, last_seen_at = now() where id = ${p.id} and state in ('admitted', 'left')`;
    await log(sql, m.id, 'join', { participantId: p.id, by, data: { via: 'client' } });
    return { state: 'joined' as const };
  }
  if (p.state === 'joined') { await sql`update meeting_participants set last_seen_at = now() where id = ${p.id}`; return { state: 'joined' as const }; }
  return { state: p.state };
}
/** 퇴장 시각 → 머문 시간 더하기 */
async function leftAt(sql: Sql, pid: string, at: Date) {
  await sql`update meeting_participants set state = 'left', left_at = ${at}, seconds = seconds + greatest(0, extract(epoch from (${at}::timestamptz - coalesce(last_joined_at, ${at}::timestamptz))))::int
    where id = ${pid} and state = 'joined'`;
  await sql`update meeting_participants set state = 'left', left_at = ${at} where id = ${pid} and state = 'admitted'`;
}

// ---------------- 손님(계정 없음) ----------------
async function byCode(sql: Sql, code: string) {
  assertOn();
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(code)) throw notFound(NF);
  const [m] = await sql<(MeetingRow & { company: string; gone: boolean })[]>`select m.*, t.name as company, (m.kind = 'event' and (e.id is null or e.deleted_at is not null or e.cancelled)) as gone
    from meetings m join tenants t on t.id = m.tenant left join events e on e.id = m.event_id where m.code = ${code} and m.expires_at > now()`;
  if (!m) throw notFound(NF);
  return m.gone ? { ...m, status: 'ended' as const } : m; // 지운 일정의 회의는 끝난 회의로
}
/** 회의 주소를 연 사람에게: 회사 이름·회의 이름·상태만(참석자·일정 내용 없음) */
export async function meetPublic(code: string, user: SessionUser | null) {
  const sql = db(); const m = await byCode(sql, code);
  const staff = !!user && user.tenant === m.tenant; // 같은 회사 직원이면 직원 입장 화면으로
  return { title: m.title || '화상회의', company: m.company, status: m.status, locked: m.locked, staffFirst: m.staff_first, started: await staffPresent(sql, m.id), staff, meetingId: staff ? m.id : null, engine: meetingEngine()?.id ?? null };
}
export const guestInput = z.object({ name: z.string().trim().min(1, '이름을 적어 주세요').max(40, '이름은 40자까지입니다').refine((v) => !/[\u0000-\u001f<>]/.test(v), '쓸 수 없는 글자가 있습니다') });
export async function guestRequest(code: string, i: z.infer<typeof guestInput>) {
  const sql = db(); const m = await byCode(sql, code);
  if (m.status === 'ended') throw new HttpError(410, 'ended', '회의가 끝났습니다');
  if (m.locked) throw new HttpError(423, 'locked', '회의가 잠겨 있습니다 — 주최 측에 문의해 주세요');
  const [{ recent, waiting }] = await sql<{ recent: number; waiting: number }[]>`select count(*) filter (where created_at > now() - interval '1 minute')::int recent, count(*) filter (where state = 'waiting')::int waiting
    from meeting_participants where meeting_id = ${m.id} and user_id is null`;
  if (recent >= GUEST_PER_MIN || waiting >= LOBBY_MAX) throw new HttpError(429, 'too_many', '지금은 참가 요청이 많습니다 — 잠시 뒤 다시 시도해 주세요');
  const secret = randomBytes(24).toString('base64url');
  const state = m.lobby === 'none' ? 'admitted' : 'waiting';
  const [p] = await sql<PartRow[]>`insert into meeting_participants (meeting_id, guest_name, guest_secret_hash, role, state) values (${m.id}, ${i.name}, ${hash(secret)}, 'guest', ${state}) returning *`;
  await log(sql, m.id, state === 'waiting' ? 'wait' : 'admit', { participantId: p.id, data: { guest: true, ...(state === 'admitted' ? { auto: true } : {}) } });
  if (state === 'waiting') await lobbyNotify(sql, m, p.id, `${i.name}(손님)`, null);
  return { participantId: p.id, secret, state };
}
async function guestOf(sql: Sql, code: string, pid: string, secret: string | null) {
  const m = await byCode(sql, code);
  if (!zUuid.safeParse(pid).success || !secret) throw notFound(NF);
  const [p] = await sql<PartRow[]>`select * from meeting_participants where id = ${pid} and meeting_id = ${m.id} and user_id is null`;
  const a = Buffer.from(p?.guest_secret_hash ?? ''), b = Buffer.from(hash(secret));
  if (!p || a.length !== b.length || !timingSafeEqual(a, b)) throw notFound(NF);
  return { m, p };
}
/** 손님 대기 화면(3초마다): 허락되고 직원이 들어와 있으면 입장권 */
export async function guestStatus(code: string, pid: string, secret: string | null) {
  const sql = db(); const { m, p } = await guestOf(sql, code, pid, secret);
  if (m.status === 'ended') return { state: 'ended' as const };
  if (p.state === 'removed' || p.state === 'denied') return { state: p.state };
  if (p.state === 'waiting') return { state: 'waiting' as const, started: await staffPresent(sql, m.id) };
  if (m.staff_first && !(await staffPresent(sql, m.id))) return { state: 'admitted' as const, waitingStaff: true };
  if (p.state === 'left' && (await inRoomCount(sql, m.id)) >= MEETING_MAX) throw new HttpError(409, 'full', `회의 인원(${MEETING_MAX}명)이 찼습니다`);
  const eng = engineOr503();
  return { state: 'admitted' as const, ...(await issueFor(sql, m, { id: p.id, role: 'guest', name: `${p.guest_name}(손님)` }, eng)) };
}
export async function guestSeen(code: string, pid: string, secret: string | null, leave = false) {
  const sql = db(); const { m, p } = await guestOf(sql, code, pid, secret);
  if (p.state === 'removed' || p.state === 'denied' || p.state === 'waiting') return { state: p.state };
  return seen(sql, m, p, leave, null);
}

// ---------------- 주최자 도구 ----------------
export async function lobby(u: SessionUser, id: string) {
  const sql = db(); const { m } = await hostAccess(u, id, sql);
  const rows = await sql<{ id: string; name: string; guest: boolean; at: Date }[]>`select p.id, coalesce(u.name, p.guest_name) as name, p.user_id is null as guest, p.created_at as at
    from meeting_participants p left join users u on u.id = p.user_id where p.meeting_id = ${m.id} and p.state = 'waiting' order by p.created_at`;
  return { meetingId: m.id, waiting: rows };
}
export const lobbyInput = z.object({ action: z.enum(['admit', 'deny', 'admitAll']), ids: z.array(zUuid).max(LOBBY_MAX).optional() });
export async function lobbyAction(u: SessionUser, id: string, i: z.infer<typeof lobbyInput>) {
  const sql = db(); const { m } = await hostAccess(u, id, sql);
  const ids = i.action === 'admitAll' ? (await sql<{ id: string }[]>`select id from meeting_participants where meeting_id = ${m.id} and state = 'waiting' order by created_at`).map((r) => r.id) : (i.ids ?? []);
  if (!ids.length) return lobby(u, id);
  if (i.action === 'deny') {
    const r = await sql<{ id: string }[]>`update meeting_participants set state = 'denied' where meeting_id = ${m.id} and id = any(${ids}::uuid[]) and state = 'waiting' returning id`;
    for (const x of r) await log(sql, m.id, 'deny', { participantId: x.id, by: u.id });
    return lobby(u, id);
  }
  const room = MEETING_MAX - (await inRoomCount(sql, m.id));
  if (ids.length > room) throw new HttpError(409, 'full', `회의 인원(${MEETING_MAX}명)이 차 ${Math.max(0, room)}명만 더 들어올 수 있습니다`);
  const r = await sql<{ id: string }[]>`update meeting_participants set state = 'admitted', admitted_by = ${u.id}, last_seen_at = case when user_id is null then last_seen_at else now() end
    where meeting_id = ${m.id} and id = any(${ids}::uuid[]) and state = 'waiting' returning id`;
  for (const x of r) await log(sql, m.id, 'admit', { participantId: x.id, by: u.id });
  return lobby(u, id);
}
export const participantInput = z.object({ action: z.enum(['remove', 'cohost', 'uncohost']) });
export async function participantAction(u: SessionUser, id: string, pid: string, i: z.infer<typeof participantInput>) {
  const sql = db(); const { m } = await hostAccess(u, id, sql);
  if (!zUuid.safeParse(pid).success) throw notFound('참가자가 없습니다');
  const [p] = await sql<PartRow[]>`select * from meeting_participants where id = ${pid} and meeting_id = ${m.id}`;
  if (!p) throw notFound('참가자가 없습니다');
  if (p.user_id && p.user_id === m.host_id) throw forbidden('주최자는 바꿀 수 없습니다');
  if (i.action === 'remove') {
    if (p.state === 'joined') await leftAt(sql, p.id, new Date());
    await sql`update meeting_participants set state = 'removed' where id = ${p.id}`;
    await log(sql, m.id, 'remove', { participantId: p.id, by: u.id });
    await meetingEngine()?.remove(m.id, p.id).catch(() => null);
    return { ok: true, state: 'removed' };
  }
  if (!p.user_id) throw badRequest('손님은 공동 주최자가 될 수 없습니다');
  const role = i.action === 'cohost' ? 'cohost' : 'member';
  await sql`update meeting_participants set role = ${role} where id = ${p.id}`;
  await log(sql, m.id, i.action, { participantId: p.id, by: u.id });
  return { ok: true, role };
}
export const meetingPatch = z.object({ title: z.string().trim().min(1).max(100).optional(), lobby: z.enum(['guests', 'everyone', 'invited', 'none']).optional(), staffFirst: z.boolean().optional(),
  locked: z.boolean().optional(), share: z.enum(['all', 'host']).optional(), muteAll: z.literal(true).optional() });
export async function patchMeeting(u: SessionUser, id: string, i: z.infer<typeof meetingPatch>) {
  const sql = db(); const { m } = await hostAccess(u, id, sql);
  if (m.status === 'ended') throw new HttpError(410, 'ended', '회의가 끝났습니다');
  const set: Record<string, unknown> = {};
  if (i.title !== undefined && m.kind !== 'event') set.title = i.title; // 일정 회의 이름은 일정 제목을 따라감
  if (i.lobby !== undefined) set.lobby = i.lobby;
  if (i.staffFirst !== undefined) set.staff_first = i.staffFirst;
  if (i.locked !== undefined) set.locked = i.locked;
  if (i.share !== undefined) set.share = i.share;
  if (Object.keys(set).length) {
    await sql`update meetings set ${sql(set as never)}, updated_at = now() where id = ${m.id}`;
    for (const [k, v] of Object.entries(set)) await log(sql, m.id, k === 'locked' ? (v ? 'lock' : 'unlock') : `set_${k}`, { by: u.id, data: { value: v as never } });
  }
  if (i.muteAll) {
    const [me] = await sql<{ id: string }[]>`select id from meeting_participants where meeting_id = ${m.id} and user_id = ${u.id}`;
    await engineOr503().muteAll(m.id, me?.id); await log(sql, m.id, 'mute_all', { by: u.id });
  }
  return getMeeting(u, id);
}
async function endNow(sql: Sql, m: MeetingRow, by: string | null, at = new Date()) {
  await sql`update meetings set status = 'ended', ended_at = ${at}, updated_at = now() where id = ${m.id} and status <> 'ended'`;
  for (const p of await sql<{ id: string }[]>`select id from meeting_participants where meeting_id = ${m.id} and state in ('joined', 'admitted')`) await leftAt(sql, p.id, at);
  await sql`update meeting_participants set state = 'denied' where meeting_id = ${m.id} and state = 'waiting'`;
  await log(sql, m.id, 'end', { by, at });
  if (by) await meetingEngine()?.end(m.id).catch(() => null); // 엔진이 알려 온 '끝'이면 다시 닫지 않음
}
export async function endMeeting(u: SessionUser, id: string) {
  const sql = db(); const { m } = await hostAccess(u, id, sql);
  if (m.status !== 'ended') await endNow(sql, m, u.id);
  return { ok: true, record: await record(sql, { ...m, status: 'ended' }) };
}

// ---------------- 회의 기록 ----------------
async function record(sql: Sql, m: MeetingRow) {
  const people = await sql<{ name: string; guest: boolean; role: string; first: Date | null; left: Date | null; seconds: number; state: string; last: Date | null }[]>`
    select coalesce(u.name, p.guest_name) as name, p.user_id is null as guest, p.role, p.first_joined_at as first, p.left_at as left,
      p.seconds + case when p.state = 'joined' then greatest(0, extract(epoch from (now() - coalesce(p.last_joined_at, now()))))::int else 0 end as seconds, p.state, p.last_joined_at as last
    from meeting_participants p left join users u on u.id = p.user_id where p.meeting_id = ${m.id} and p.first_joined_at is not null order by p.first_joined_at`;
  const [s] = await sql<{ started: Date | null; ended: Date | null }[]>`select min(at) filter (where kind = 'start') as started, max(at) filter (where kind = 'end') as ended from meeting_log where meeting_id = ${m.id}`;
  // 시작 = 회의가 열린 때와 첫 입장(엔진 알림 시각) 중 이른 쪽
  const firsts = people.map((p) => p.first).filter((x): x is Date => !!x).map((x) => new Date(x).getTime());
  const open0 = s?.started ?? m.started_at; const started = firsts.length ? new Date(Math.min(...firsts, ...(open0 ? [new Date(open0).getTime()] : []))) : open0;
  const ended = m.status === 'ended' ? (s?.ended ?? m.ended_at) : null;
  return { started, ended, minutes: started ? Math.max(0, Math.round(((ended ? new Date(ended) : new Date()).getTime() - new Date(started).getTime()) / 60000)) : 0,
    staff: people.filter((p) => !p.guest).length, guests: people.filter((p) => p.guest).length, people: people.map((p) => ({ name: p.name, guest: p.guest, role: p.role, first: p.first, left: p.state === 'joined' ? null : p.left, minutes: Math.round(p.seconds / 60) })) };
}

// ---------------- 엔진 알림 · 정리 ----------------
/** 엔진(중계 서버)이 알려 온 입장·퇴장·회의 끝 → 회의 기록 */
export async function engineHook(req: Request) {
  assertOn(); const eng = meetingEngine(); if (!eng) throw new HttpError(503, 'engine_off', '엔진이 꺼져 있습니다');
  let events; try { events = await eng.hook(req); } catch (e) { if (e instanceof EngineAuthError) throw new HttpError(401, 'unauthorized', e.message); throw e; }
  const sql = db(); let n = 0;
  for (const e of events) {
    if (!zUuid.safeParse(e.room).success) continue;
    const [m] = await sql<MeetingRow[]>`select * from meetings where id = ${e.room}`; if (!m) continue;
    if (e.kind === 'end') { if (m.status !== 'ended') { await endNow(sql, m, null, e.at); n++; } continue; }
    if (!e.identity || !zUuid.safeParse(e.identity).success) continue;
    const [p] = await sql<PartRow[]>`select * from meeting_participants where id = ${e.identity} and meeting_id = ${m.id}`; if (!p) continue;
    if (e.kind === 'join' && (p.state === 'admitted' || p.state === 'left')) {
      await sql`update meeting_participants set state = 'joined', first_joined_at = coalesce(first_joined_at, ${e.at}), last_joined_at = ${e.at}, left_at = null, last_seen_at = greatest(coalesce(last_seen_at, ${e.at}), ${e.at}) where id = ${p.id}`;
      await log(sql, m.id, 'join', { participantId: p.id, at: e.at, data: { via: 'engine' } }); n++;
    } else if (e.kind === 'leave' && p.state === 'joined') { await leftAt(sql, p.id, e.at); await log(sql, m.id, 'leave', { participantId: p.id, at: e.at, data: { via: 'engine' } }); n++; }
  }
  return { ok: true, applied: n };
}
/** 정기 실행: 신호가 90초 넘게 끊긴 참가자는 마지막 신호 + 30초에 나간 것으로 · 끝나지 않은 회의가 하루 넘게 비어 있으면 끝냄 */
export async function meetingsTick() {
  if (!meetingsOn()) return { skipped: true };
  const sql = db(); let left = 0, ended = 0;
  for (const p of await sql<{ id: string; meeting_id: string; at: Date }[]>`select id, meeting_id, last_seen_at + interval '30 seconds' as at from meeting_participants where state = 'joined' and last_seen_at < now() - interval '90 seconds' limit 500`) {
    await leftAt(sql, p.id, new Date(p.at)); await log(sql, p.meeting_id, 'leave', { participantId: p.id, at: new Date(p.at), data: { via: 'timeout' } }); left++;
  }
  for (const m of await sql<MeetingRow[]>`select m.* from meetings m where m.status = 'live' and m.kind <> 'personal' and m.updated_at < now() - interval '1 day'
      and not exists (select 1 from meeting_participants p where p.meeting_id = m.id and p.state in ('joined', 'admitted') and p.last_seen_at > now() - interval '1 day') limit 100`) { await endNow(sql, m, null); ended++; }
  return { left, ended };
}
