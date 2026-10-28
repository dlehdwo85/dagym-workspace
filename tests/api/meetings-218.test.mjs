// 218차 화상회의 서버(결정 15-37, 설계 docs/research/VIDEO_MEETINGS_DESIGN_2026-10-28.md) — 가짜 엔진(MEETING_ENGINE=fake)으로 시험: '구조 시험 통과, 실제 연동 미확인'
// 스위치 꺼짐 = 404 · 일정 [워크인 화상회의](편집 권한·회의 주소 칸) · 손님 이름 입장 → 대기실 → 허락 · 직원 입장 전 대기 · 대기실 정책·잠금·내보내기(재입장 금지)·공동 주최자
// · 입장권(가짜 엔진에 발급 요청) · 엔진 알림(서명)·30초 신호 → 회의 기록(사람별 시간) · 회의 끝 · 다른 회사 404 · 내 회의실 같은 주소 · 대화방 통화(멤버만) · 손님 요청 한도 · 정기 실행(신호 끊김 퇴장)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const REC_PORT = 3247, HOOK = 'hook-test-secret';
const ON = { FEATURE_MEETINGS: '1', MEETING_ENGINE: 'fake', MEETING_HOOK_SECRET: HOOK, MEETING_FAKE_URL: `http://127.0.0.1:${REC_PORT}`, PUBLIC_SIGNUP: '1', MAIL_DEV: '1' };
let srv, sql, ctx, rec, other;
const calls = [];
const guest = () => new Client('guest');
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); };
const hook = (events, secret = HOOK) => fetch(`${BASE}/api/meetings/engine-hook`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ events }) });
const gs = (code, pid, secret) => guest().req('GET', `/api/meet/${code}/guest/${pid}`, undefined, { 'x-guest-secret': secret });
const iso = (min) => new Date(Date.now() + min * 60000).toISOString();

before(async () => {
  rec = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { calls.push({ op: req.url.split('/').pop(), ...JSON.parse(b || '{}') }); res.end('{}'); }); }).listen(REC_PORT);
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); rec?.close(); await sql?.end(); });

test('스위치 꺼짐(기본): 회의 주소·만들기·일정 켜기 모두 404 · 일정 화면은 enabled:false', async () => {
  assert.equal((await ctx.owner.req('POST', '/api/meetings', { kind: 'instant' })).status, 404);
  assert.equal((await guest().req('GET', '/api/meet/AAAAAAAAAAAAAAAAAAAAAA')).status, 404);
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
  const ev = (await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '꺼짐 시험', start: iso(60), end: iso(120) })).id;
  assert.deepEqual(await ctx.owner.ok('GET', `/api/events/${ev}/meeting`), { enabled: false });
  assert.equal((await ctx.owner.req('PUT', `/api/events/${ev}/meeting`, { on: true })).status, 404);
  const types = async () => (await ctx.owner.ok('GET', '/api/notifications/prefs')).types.map((x) => x.type);
  assert.ok(!(await types()).includes('meeting_lobby'), '꺼져 있으면 대기실 알림 설정도 숨김');
  // 켜서 다시 시작 + 다른 회사
  srv.proc.kill(); await once(srv.proc, 'exit'); srv = await startServer(ON);
  assert.ok((await types()).includes('meeting_lobby'), '켜면 대기실 알림 설정');
  other = new Client('other');
  const r = await other.ok('POST', '/api/auth/signup', { email: 'meet@other.test', password: 'signup-pass-1234', name: '남대표', mode: 'team', company: '남의회사', industry: '운동·피트니스', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await other.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
});

test('일정 [워크인 화상회의]: 편집 권한만 · 회의 주소 칸에 /meet/<code> · 손님 대기실 → 직원 입장 전 대기 → 허락 · 입장권 · 엔진 알림·신호로 회의 기록 · 끝내기 · 끄면 주소 비움', async () => {
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
  const ev = (await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '거래처 미팅 218', start: iso(30), end: iso(90), attendeeIds: [ctx.staffA.id] })).id;
  assert.equal((await ctx.staffA.client.req('PUT', `/api/events/${ev}/meeting`, { on: true })).status, 403, '참석자는 켜고 끌 수 없음');
  const on = await ctx.owner.ok('PUT', `/api/events/${ev}/meeting`, { on: true });
  assert.equal(on.on, true); const { id, code, url } = on.meeting;
  assert.match(code, /^[A-Za-z0-9_-]{22}$/); assert.equal(url, `${BASE}/meet/${code}`);
  assert.equal((await sql`select meeting_url from events where id = ${ev}`)[0].meeting_url, url);
  // 다른 회사·로그인 안 한 사람: 회의 정보 404, 주소로는 회사 이름·회의 이름·상태만
  assert.equal((await other.req('GET', `/api/meetings/${id}`)).status, 404); assert.equal((await other.req('POST', `/api/meetings/${id}/join`)).status, 404);
  const pub = await guest().ok('GET', `/api/meet/${code}`);
  assert.deepEqual([pub.title, pub.status, pub.started, pub.staff, pub.meetingId, pub.engine], ['거래처 미팅 218', 'open', false, false, null, 'fake']);
  assert.ok(pub.company && !JSON.stringify(pub).includes('staffA') && !('people' in pub), '참석자 정보 없음');
  assert.equal((await ctx.staffA.client.ok('GET', `/api/meet/${code}`)).meetingId, id, '같은 회사 직원은 직원 입장으로');
  // 손님: 이름만 → 대기실(주최자에게 알림) · 직원이 아직 없음
  assert.equal((await guest().req('POST', `/api/meet/${code}/guest`, { name: '' })).status, 400);
  const g = await guest().ok('POST', `/api/meet/${code}/guest`, { name: '김손님' });
  assert.equal(g.state, 'waiting'); assert.ok(g.secret.length >= 30);
  const [n] = await sql`select title, link from notifications where user_id = ${ctx.ownerId} and type = 'meeting_lobby' order by created_at desc limit 1`;
  assert.deepEqual([n.title, n.link], ['대기 중: 김손님(손님)', `/meet/${code}`]);
  assert.equal((await gs(code, g.participantId, 'wrong-secret')).status, 404, '비밀값이 다르면 404');
  assert.deepEqual(await (await gs(code, g.participantId, g.secret)).body, { state: 'waiting', started: false });
  // 주최자가 미리 허락해도 직원이 아무도 없으면 입장권 없음(직원 입장 전 대기)
  const lb = await ctx.owner.ok('GET', `/api/meetings/${id}/lobby`);
  assert.deepEqual(lb.waiting.map((w) => [w.name, w.guest]), [['김손님', true]]);
  assert.equal((await ctx.staffA.client.req('GET', `/api/meetings/${id}/lobby`)).status, 403, '참가자는 대기실을 못 봄');
  await ctx.owner.ok('POST', `/api/meetings/${id}/lobby`, { action: 'admit', ids: [g.participantId] });
  assert.deepEqual((await gs(code, g.participantId, g.secret)).body, { state: 'admitted', waitingStaff: true });
  // 주최자 참가 → 회의 시작 · 입장권(가짜 엔진 발급) → 손님도 입장권
  calls.length = 0;
  const hj = await ctx.owner.ok('POST', `/api/meetings/${id}/join`);
  assert.deepEqual([hj.state, hj.role, hj.engine, hj.meeting.status, hj.expiresIn], ['admitted', 'host', 'fake', 'live', 600]);
  const tok = JSON.parse(Buffer.from(hj.token.slice(5), 'base64url').toString());
  assert.deepEqual([tok.room, tok.identity, tok.role, tok.canShare], [id, hj.participantId, 'host', true]);
  const gt = (await gs(code, g.participantId, g.secret)).body;
  assert.equal(gt.state, 'admitted'); assert.match(gt.token, /^fake\./); assert.equal(JSON.parse(Buffer.from(gt.token.slice(5), 'base64url').toString()).name, '김손님(손님)');
  assert.deepEqual(calls.map((c) => [c.op, c.role]), [['issue', 'host'], ['issue', 'guest']]);
  // 참석자(초대받은 직원)는 바로 · 대기실 '모두'로 바꾸면 처음 오는 직원은 대기, 한 번 들어왔던 사람은 다시 바로
  const aj = await ctx.staffA.client.ok('POST', `/api/meetings/${id}/join`);
  assert.equal(aj.state, 'admitted');
  await ctx.owner.ok('PATCH', `/api/meetings/${id}`, { lobby: 'everyone' });
  assert.equal((await ctx.staffA.client.ok('POST', `/api/meetings/${id}/join`)).state, 'admitted', '이미 들어온 사람');
  // 엔진 알림(서명) → 입장 · 손님 5분 뒤 퇴장 · 틀린 서명 401
  assert.equal((await hook([{ kind: 'join', room: id, identity: g.participantId }], 'nope')).status, 401);
  const t0 = new Date(Date.now() - 6 * 60000);
  assert.equal((await hook([{ kind: 'join', room: id, identity: hj.participantId, at: t0.toISOString() }, { kind: 'join', room: id, identity: g.participantId, at: t0.toISOString() },
    { kind: 'leave', room: id, identity: g.participantId, at: new Date(t0.getTime() + 5 * 60000).toISOString() }])).status, 200);
  // 직원 신호(30초) → 입장 · 나가기
  assert.equal((await ctx.staffA.client.ok('POST', `/api/meetings/${id}/seen`, {})).state, 'joined');
  const [gp] = await sql`select state, seconds from meeting_participants where id = ${g.participantId}`;
  assert.deepEqual([gp.state, gp.seconds], ['left', 300]);
  // 공동 주최자: 손님은 안 됨 · 직원은 됨 → 대기실을 봄
  const people = (await ctx.owner.ok('GET', `/api/meetings/${id}`)).people;
  const aPid = people.find((p) => p.name === '이직원').id;
  assert.equal((await ctx.owner.req('POST', `/api/meetings/${id}/participants/${g.participantId}`, { action: 'cohost' })).status, 400);
  await ctx.owner.ok('POST', `/api/meetings/${id}/participants/${aPid}`, { action: 'cohost' });
  assert.equal((await ctx.staffA.client.req('GET', `/api/meetings/${id}/lobby`)).status, 200, '공동 주최자는 대기실');
  // 잠금 → 새 손님 요청 423 · 풀기
  await ctx.staffA.client.ok('PATCH', `/api/meetings/${id}`, { locked: true });
  assert.equal((await guest().req('POST', `/api/meet/${code}/guest`, { name: '늦은 손님' })).status, 423);
  await ctx.owner.ok('PATCH', `/api/meetings/${id}`, { locked: false, lobby: 'guests' });
  // 내보내기 → 엔진에 내보내기 요청 · 같은 손님 비밀값으로 다시 못 들어옴
  const g2 = await guest().ok('POST', `/api/meet/${code}/guest`, { name: '두번째 손님' });
  await ctx.owner.ok('POST', `/api/meetings/${id}/lobby`, { action: 'admitAll' });
  assert.match((await gs(code, g2.participantId, g2.secret)).body.token, /^fake\./);
  calls.length = 0;
  await ctx.owner.ok('POST', `/api/meetings/${id}/participants/${g2.participantId}`, { action: 'remove' });
  assert.deepEqual(calls.map((c) => [c.op, c.identity]), [['remove', g2.participantId]]);
  assert.deepEqual((await gs(code, g2.participantId, g2.secret)).body, { state: 'removed' });
  assert.equal((await ctx.owner.req('POST', `/api/meetings/${id}/participants/${hj.participantId}`, { action: 'remove' })).status, 403, '주최자는 못 내보냄');
  // 끝내기 → 엔진 방 닫기 · 모두 나감 · 회의 기록(사람별 분) · 다시 참가 410 · 손님 화면 ended
  calls.length = 0;
  const end = await ctx.owner.ok('POST', `/api/meetings/${id}/end`);
  assert.deepEqual(calls.map((c) => c.op), ['end']);
  assert.deepEqual([end.record.staff, end.record.guests], [2, 1], JSON.stringify(end.record));
  assert.ok(end.record.minutes >= 5 && end.record.people.find((p) => p.name === '김손님').minutes === 5, JSON.stringify(end.record.people));
  assert.equal((await ctx.staffA.client.req('POST', `/api/meetings/${id}/join`)).status, 410);
  assert.deepEqual((await gs(code, g.participantId, g.secret)).body, { state: 'ended' });
  const rec2 = await ctx.staffA.client.ok('GET', `/api/events/${ev}/meeting`);
  assert.deepEqual([rec2.on, rec2.record.staff, rec2.record.guests, rec2.canEdit], [false, 2, 1, false], '참석자도 회의 기록을 봄');
  const kinds = (await sql`select kind from meeting_log where meeting_id = ${id} order by id`).map((r) => r.kind);
  for (const k of ['create', 'wait', 'admit', 'start', 'token', 'join', 'leave', 'cohost', 'lock', 'unlock', 'remove', 'end']) assert.ok(kinds.includes(k), `${k} 기록: ${kinds.join(',')}`);
  // 다시 켜면 같은 주소로 다시 열림 · 끄면 일정 회의 주소 칸 비움
  assert.equal((await ctx.owner.ok('PUT', `/api/events/${ev}/meeting`, { on: true })).meeting.code, code);
  await ctx.owner.ok('PUT', `/api/events/${ev}/meeting`, { on: false });
  assert.equal((await sql`select meeting_url from events where id = ${ev}`)[0].meeting_url, null);
  assert.equal((await guest().ok('GET', `/api/meet/${code}`)).status, 'ended');
});

test('내 고정 회의실(같은 주소) · 바로 회의 대기실 \'모두\' · 대화방 통화(멤버만) · 손님 요청 한도 · 신호 끊긴 참가자 정기 실행 퇴장', async () => {
  const p1 = await ctx.staffA.client.ok('POST', '/api/meetings', { kind: 'personal' }); const p2 = await ctx.staffA.client.ok('POST', '/api/meetings', { kind: 'personal' });
  assert.deepEqual([p1.created, p2.created, p2.code], [true, false, p1.code], '내 회의실은 늘 같은 주소');
  // 바로 회의: 대기실 '모두'면 같은 회사 직원도 대기 → 허락 → 입장권
  const inst = await ctx.owner.ok('POST', '/api/meetings', { kind: 'instant', title: '급한 회의' });
  await ctx.owner.ok('PATCH', `/api/meetings/${inst.id}`, { lobby: 'everyone' });
  await ctx.owner.ok('POST', `/api/meetings/${inst.id}/join`);
  const w = await ctx.staffB.client.ok('POST', `/api/meetings/${inst.id}/join`);
  assert.equal(w.state, 'waiting');
  await ctx.owner.ok('POST', `/api/meetings/${inst.id}/lobby`, { action: 'admit', ids: [w.participantId] });
  const ok2 = await ctx.staffB.client.ok('POST', `/api/meetings/${inst.id}/join`);
  assert.equal(ok2.state, 'admitted'); assert.match(ok2.token, /^fake\./);
  assert.equal(JSON.parse(Buffer.from(ok2.token.slice(5), 'base64url').toString()).canShare, true);
  await ctx.owner.ok('PATCH', `/api/meetings/${inst.id}`, { share: 'host' });
  assert.equal(JSON.parse(Buffer.from((await ctx.staffB.client.ok('POST', `/api/meetings/${inst.id}/join`)).token.slice(5), 'base64url').toString()).canShare, false, '화면 공유 주최자만');
  // 대화방 통화: 방 멤버만(다른 직원 404)
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
  const rm = await ctx.owner.ok('POST', '/api/meetings', { kind: 'room', roomId: room });
  assert.equal((await ctx.staffA.client.ok('POST', '/api/meetings', { kind: 'room', roomId: room })).id, rm.id, '열린 통화가 있으면 그것');
  assert.equal((await ctx.staffB.client.req('GET', `/api/meetings/${rm.id}`)).status, 404);
  assert.equal((await ctx.staffB.client.req('POST', '/api/meetings', { kind: 'room', roomId: room })).status, 404);
  // 손님 요청 1분 20번 한도
  let last;
  for (let k = 0; k < 21; k++) last = await guest().req('POST', `/api/meet/${inst.code}/guest`, { name: `손님${k}` });
  assert.equal(last.status, 429);
  // 정기 실행: 신호가 90초 넘게 끊긴 참가자 → 마지막 신호 + 30초에 나감
  await ctx.staffB.client.ok('POST', `/api/meetings/${inst.id}/seen`, {});
  await sql`update meeting_participants set last_seen_at = now() - interval '5 minutes', last_joined_at = now() - interval '10 minutes' where id = ${w.participantId}`;
  await tick();
  const [b] = await sql`select state, seconds from meeting_participants where id = ${w.participantId}`;
  assert.equal(b.state, 'left'); assert.ok(b.seconds >= 320 && b.seconds <= 340, String(b.seconds));
  assert.ok((await sql`select 1 from meeting_log where participant_id = ${w.participantId} and kind = 'leave' and data->>'via' = 'timeout'`).length === 1);
});
