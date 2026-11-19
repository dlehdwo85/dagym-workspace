// 화상회의 보강(대표 11/19 "줌 수준으로 · 화면 공유") — 가짜 엔진으로 시험: '구조 시험 통과, 실제 연동 미확인'
// ① 회의 중 채팅(서버 보관): 직원·손님 주고받기 · after 로 새 글만 · 손님은 자기가 참가 요청한 뒤의 글만 · 대기실에 있는 손님·회의 밖 직원·다른 회사는 못 봄 · 길이·횟수 한도
// ② 한 사람 마이크 끄기(주최자만, 엔진에 그 사람만 요청) ③ 휴대폰 앱 화면 공유용 입장권(화면 전용 접속 '<참가자 id>~screen' · 주최자만 공유인 회의에서 손님은 403 · 내보내면 화면 접속도 끊음)
// ④ 엔진 알림에 화면 전용 접속이 와도 회의 기록에 넣지 않음
// ⑤ 회의 시작 알림(일정 참석자·대화방 멤버 — 첫 직원 입장 때 한 번)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const REC_PORT = 3294, HOOK = 'hook-chat-secret';
let srv, sql, ctx, rec, other; const calls = [];
const guest = () => new Client('guest');
const gh = (secret) => ({ 'x-guest-secret': secret });
const tok = (t) => JSON.parse(Buffer.from(t.slice(5), 'base64url').toString());

before(async () => {
  rec = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { calls.push({ op: req.url.split('/').pop(), ...JSON.parse(b || '{}') }); res.end('{}'); }); }).listen(REC_PORT);
  await resetDb(); sql = testDb();
  srv = await startServer({ FEATURE_MEETINGS: '1', MEETING_ENGINE: 'fake', MEETING_HOOK_SECRET: HOOK, MEETING_FAKE_URL: `http://127.0.0.1:${REC_PORT}` });
  ctx = await bootstrap();
  await sql`insert into tenants (id, name) values ('t_chat2', '남의회사') on conflict do nothing`;
  const [u] = await sql`insert into users (email, name, role, status, tenant) values ('boss@other-chat.test', '남대표', 'owner', 'active', 't_chat2') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into sessions (id, user_id, client, expires_at) values (${createHash('sha256').update(token).digest('hex')}, ${u.id}, 'web', now() + interval '1 day')`;
  other = new Client('other'); other.cookie = `wos_session=${token}`;
});
after(async () => { srv?.proc.kill(); rec?.close(); await sql?.end(); });

let m, host, g1;
test('① 회의 중 채팅: 직원·손님 주고받기 · 새 글만 받기 · 손님은 들어오기 전 글을 못 봄 · 회의 밖 사람·다른 회사는 못 봄', async () => {
  m = await ctx.owner.ok('POST', '/api/meetings', { kind: 'instant', title: '채팅 시험' });
  const chat = `/api/meetings/${m.id}/chat`;
  assert.equal((await ctx.owner.req('GET', chat)).status, 403, '회의에 들어오기 전에는 못 봄');
  host = await ctx.owner.ok('POST', `/api/meetings/${m.id}/join`);
  assert.deepEqual((await ctx.owner.ok('GET', chat)).messages, []);
  const a = await ctx.owner.ok('POST', chat, { text: '  손님 오시기 전 내부 이야기  ' });
  assert.match(a.id, /^\d+$/);
  // 손님: 대기실에 있을 때는 채팅 못 봄·못 씀
  g1 = await guest().ok('POST', `/api/meet/${m.code}/guest`, { name: '김손님' });
  const gchat = `/api/meet/${m.code}/guest/${g1.participantId}/chat`;
  assert.equal((await guest().req('GET', gchat, undefined, gh(g1.secret))).status, 403, '대기실에서는 못 봄');
  assert.equal((await guest().req('POST', gchat, { text: '안녕하세요' }, gh(g1.secret))).status, 403);
  assert.equal((await guest().req('GET', gchat, undefined, gh('wrong'))).status, 404, '비밀값이 다르면 404');
  await ctx.owner.ok('POST', `/api/meetings/${m.id}/lobby`, { action: 'admit', ids: [g1.participantId] });
  assert.deepEqual((await guest().ok('GET', gchat, undefined, gh(g1.secret))).messages, [], '손님은 자기가 참가 요청하기 전의 글을 못 봄');
  await guest().ok('POST', gchat, { text: '안녕하세요, 김손님입니다' }, gh(g1.secret));
  await ctx.owner.ok('POST', chat, { text: '반갑습니다' });
  const all = (await ctx.owner.ok('GET', chat)).messages;
  assert.deepEqual(all.map((x) => [x.name, x.guest, x.mine, x.text]), [['김대표', false, true, '손님 오시기 전 내부 이야기'], ['김손님(손님)', true, false, '안녕하세요, 김손님입니다'], ['김대표', false, true, '반갑습니다']]);
  const gv = (await guest().ok('GET', gchat, undefined, gh(g1.secret))).messages;
  assert.deepEqual(gv.map((x) => [x.name, x.mine, x.text]), [['김손님(손님)', true, '안녕하세요, 김손님입니다'], ['김대표', false, '반갑습니다']]);
  // after = 마지막으로 받은 글 번호 → 새 글만
  assert.deepEqual((await ctx.owner.ok('GET', `${chat}?after=${all[1].id}`)).messages.map((x) => x.text), ['반갑습니다']);
  assert.deepEqual((await ctx.owner.ok('GET', `${chat}?after=${all[2].id}`)).messages, []);
  assert.equal((await ctx.owner.ok('GET', `${chat}?after=abc`)).messages.length, 3, '이상한 after 는 처음부터');
  // 한도: 빈 글·1000자 넘는 글
  assert.equal((await ctx.owner.req('POST', chat, { text: '   ' })).status, 400);
  assert.equal((await ctx.owner.req('POST', chat, { text: 'ㄱ'.repeat(1001) })).status, 400);
  // 회의에 안 들어온 직원 · 다른 회사
  assert.equal((await ctx.staffA.client.req('GET', chat)).status, 403, '회의에 들어오지 않은 직원');
  assert.equal((await other.req('GET', chat)).status, 404, '다른 회사는 없는 회의');
  assert.equal((await other.req('POST', chat, { text: 'x' })).status, 404);
  // 1분에 30개 한도
  await sql`insert into meeting_messages (meeting_id, participant_id, name, guest, body) select ${m.id}, ${g1.participantId}, '김손님(손님)', true, 'x' from generate_series(1, 30)`;
  assert.equal((await guest().req('POST', gchat, { text: '너무 많이' }, gh(g1.secret))).status, 429);
});

test('② 한 사람 마이크 끄기: 주최자만 · 엔진에 그 사람만 요청 · 기록', async () => {
  calls.length = 0;
  const r = await ctx.owner.ok('POST', `/api/meetings/${m.id}/participants/${g1.participantId}`, { action: 'mute' });
  assert.deepEqual(r, { ok: true, muted: true });
  assert.deepEqual(calls.filter((c) => c.op === 'mute').map((c) => [c.room, c.identity]), [[m.id, g1.participantId]]);
  const [lg] = await sql`select kind, participant_id from meeting_log where meeting_id = ${m.id} and kind = 'mute'`;
  assert.equal(lg.participant_id, g1.participantId);
  // 참가자(주최자 아님)는 못 함
  await ctx.staffA.client.ok('POST', `/api/meetings/${m.id}/join`);
  assert.equal((await ctx.staffA.client.req('POST', `/api/meetings/${m.id}/participants/${g1.participantId}`, { action: 'mute' })).status, 403);
  assert.equal((await other.req('POST', `/api/meetings/${m.id}/participants/${g1.participantId}`, { action: 'mute' })).status, 404);
});

test('③ 휴대폰 앱 화면 공유용 입장권: 화면 전용 접속 · 주최자만 공유인 회의에서는 참가자·손님 403 · 내보내면 화면 접속도 끊음 ④ 엔진 알림의 화면 접속은 기록에 넣지 않음', async () => {
  calls.length = 0;
  const t = await ctx.owner.ok('POST', `/api/meetings/${m.id}/screen-ticket`, {});
  assert.equal(t.identity, `${host.participantId}~screen`); assert.equal(t.engine, 'fake'); assert.equal(t.expiresIn, 600);
  const c = tok(t.token);
  assert.deepEqual([c.room, c.identity, c.screenOf, c.name], [m.id, `${host.participantId}~screen`, host.participantId, '김대표 화면']);
  assert.deepEqual(calls.filter((x) => x.op === 'issue').map((x) => [x.identity, x.screenOf]), [[`${host.participantId}~screen`, host.participantId]]);
  // 손님도(누구나 공유인 회의) · 대기 중인 손님은 안 됨
  const gt = await guest().ok('POST', `/api/meet/${m.code}/guest/${g1.participantId}/screen-ticket`, {}, gh(g1.secret));
  assert.equal(tok(gt.token).name, '김손님(손님) 화면');
  const g2 = await guest().ok('POST', `/api/meet/${m.code}/guest`, { name: '대기 손님' });
  assert.equal((await guest().req('POST', `/api/meet/${m.code}/guest/${g2.participantId}/screen-ticket`, {}, gh(g2.secret))).status, 403, '대기실에서는 안 됨');
  assert.equal((await ctx.staffA.client.req('POST', `/api/meetings/${m.id}/screen-ticket`, {})).status, 200, '누구나 공유인 회의에서는 참가자도');
  // 주최자만 공유
  await ctx.owner.ok('PATCH', `/api/meetings/${m.id}`, { share: 'host' });
  assert.equal((await guest().req('POST', `/api/meet/${m.code}/guest/${g1.participantId}/screen-ticket`, {}, gh(g1.secret))).status, 403);
  assert.equal((await ctx.staffA.client.req('POST', `/api/meetings/${m.id}/screen-ticket`, {})).status, 403);
  assert.equal((await ctx.owner.req('POST', `/api/meetings/${m.id}/screen-ticket`, {})).status, 200, '주최자는 됨');
  assert.equal((await other.req('POST', `/api/meetings/${m.id}/screen-ticket`, {})).status, 404);
  // ④ 엔진이 화면 전용 접속의 입장·퇴장을 알려 와도 회의 기록(참가자)에 넣지 않음
  const before = await sql`select id, state from meeting_participants where meeting_id = ${m.id} order by created_at`;
  const r = await fetch(`${BASE}/api/meetings/engine-hook`, { method: 'POST', headers: { authorization: `Bearer ${HOOK}`, 'content-type': 'application/json' },
    body: JSON.stringify({ events: [{ kind: 'join', room: m.id, identity: `${host.participantId}~screen` }, { kind: 'leave', room: m.id, identity: `${host.participantId}~screen` }] }) });
  assert.equal(r.status, 200); assert.equal((await r.json()).applied, 0);
  assert.deepEqual(await sql`select id, state from meeting_participants where meeting_id = ${m.id} order by created_at`, before);
  // 내보내기 → 그 사람의 화면 접속도 끊음
  calls.length = 0;
  await ctx.owner.ok('POST', `/api/meetings/${m.id}/participants/${g1.participantId}`, { action: 'remove' });
  assert.deepEqual(calls.filter((x) => x.op === 'remove').map((x) => x.identity).sort(), [g1.participantId, `${g1.participantId}~screen`].sort());
  assert.equal((await guest().req('GET', `/api/meet/${m.code}/guest/${g1.participantId}/chat`, undefined, gh(g1.secret))).status, 403, '내보낸 손님은 채팅도 못 봄');
  // 나가기 → 화면 접속도 끊음(입장권을 받은 적이 있는 사람만 엔진에 요청)
  calls.length = 0;
  await ctx.staffA.client.ok('POST', `/api/meetings/${m.id}/seen`, { leave: true });
  const [sa] = await sql`select id from meeting_participants where meeting_id = ${m.id} and user_id = ${ctx.staffA.id}`;
  assert.deepEqual(calls.filter((x) => x.op === 'remove').map((x) => x.identity), [`${sa.id}~screen`]);
  // 끝난 회의
  await ctx.owner.ok('POST', `/api/meetings/${m.id}/end`, {});
  assert.equal((await ctx.owner.req('POST', `/api/meetings/${m.id}/screen-ticket`, {})).status, 410);
  assert.equal((await ctx.owner.req('POST', `/api/meetings/${m.id}/chat`, { text: '끝난 뒤' })).status, 410);
});

test('⑤ 회의 시작 알림: 일정 회의 = 참석자에게 · 대화방 통화 = 방 멤버에게 · 들어온 본인·초대 안 된 사람은 안 받음 · 즉석 회의는 안 보냄 · 한 번만', async () => {
  const starts = async (userId) => [...(await sql`select title, body, link from notifications where user_id = ${userId} and type = 'meeting_start' order by created_at`)];
  const iso = (min) => new Date(Date.now() + min * 60000).toISOString();
  assert.ok((await ctx.owner.ok('GET', '/api/notifications/prefs')).types.some((t) => t.type === 'meeting_start'), '화상회의가 켜진 회사: 알림 설정에 보임');
  // 일정 회의: 참석자(이직원)에게 — 시작한 대표 본인·참석자가 아닌 박직원은 안 받음
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
  const ev = (await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '주간 회의 1120', start: iso(5), end: iso(65), attendeeIds: [ctx.staffA.id] })).id;
  const on = await ctx.owner.ok('PUT', `/api/events/${ev}/meeting`, { on: true });
  assert.deepEqual(await starts(ctx.staffA.id), [], '켜기만 해서는 알림 없음');
  await ctx.owner.ok('POST', `/api/meetings/${on.meeting.id}/join`);
  const a = await starts(ctx.staffA.id);
  assert.deepEqual(a.map((n) => [n.title, n.body, n.link]), [['회의가 시작됐습니다: 주간 회의 1120', '김대표 님이 들어와 있습니다 — 눌러서 참가', `/meet/${on.meeting.code}`]]);
  assert.deepEqual(await starts(ctx.ownerId), [], '들어온 본인은 안 받음');
  assert.deepEqual(await starts(ctx.staffB.id), [], '참석자가 아닌 사람');
  // 다시 들어와도·다른 사람이 들어와도 또 보내지 않음
  await ctx.owner.ok('POST', `/api/meetings/${on.meeting.id}/join`);
  await ctx.staffA.client.ok('POST', `/api/meetings/${on.meeting.id}/join`);
  assert.equal((await starts(ctx.staffA.id)).length, 1);
  // 대화방 통화: 방 멤버(박직원)에게
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffB.id })).id;
  const rm = await ctx.owner.ok('POST', '/api/meetings', { kind: 'room', roomId: room });
  await ctx.owner.ok('POST', `/api/meetings/${rm.id}/join`);
  const b = await starts(ctx.staffB.id);
  assert.equal(b.length, 1); assert.match(b[0].title, /^회의가 시작됐습니다: /); assert.equal(b[0].link, `/meet/${rm.code}`);
  // 즉석 회의: 누구를 불렀는지 모르므로 보내지 않음
  const before = (await sql`select count(*)::int c from notifications where type = 'meeting_start'`)[0].c;
  const inst = await ctx.owner.ok('POST', '/api/meetings', { kind: 'instant', title: '즉석' });
  await ctx.owner.ok('POST', `/api/meetings/${inst.id}/join`);
  assert.equal((await sql`select count(*)::int c from notifications where type = 'meeting_start'`)[0].c, before);
  // 다른 회사에는 화상회의 알림 설정이 그대로 보임(스위치가 회사 목록 없이 켜진 시험 서버) — 알림 자체는 가지 않음
  assert.equal((await sql`select count(*)::int c from notifications n join users u on u.id = n.user_id where n.type = 'meeting_start' and u.tenant <> 'default'`)[0].c, 0);
});
