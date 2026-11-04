// #946(대표 11/04 화상회의 0단계 — 라이브킷 클라우드): MEETING_ENGINE=livekit 으로 시험(가짜 라이브킷 서버 — 실제 영상은 운영 라이브킷 키가 들어간 뒤)
// ① '우리 회사만'(MEETINGS_TENANTS): 다른 회사 직원은 메뉴·회의 만들기·회의 주소·알림 설정 모두 없음
// ② 입장권 = 라이브킷 규격 HS256 JWT(방 = 회의 id · 이름표 = 참가자 id · 화면 공유는 회의 규칙대로 · 녹화 권한 없음) · 화면에 화면 공유 단추 여부(canShare)
// ③ 엔진 알림(라이브킷 웹훅 서명 = 본문 sha256) → 입장·퇴장 기록 · 틀린 서명 401 ④ 내보내기·회의 끝 → 라이브킷 방 관리 API(관리 JWT)
// ⑤ 화면: 참가 → 라이브킷 서버에 그 입장권으로 접속 시도(브라우저가 있을 때만) ⑥ 회의 기록 90일 뒤 정리
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const LK_PORT = 3293; const KEY = 'APItest946'; const SECRET = 'lk-secret-946-lk-secret-946-lk-secret';
let srv, ctx, sql, lk; const seen = { upgrades: [], validate: [], twirp: [] };
const b64u = (b) => Buffer.from(b).toString('base64url');
const jwt = (payload, secret = SECRET) => { const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64u(JSON.stringify(payload)); return `${h}.${p}.${b64u(createHmac('sha256', secret).update(`${h}.${p}`).digest())}`; };
const claims = (t) => { const [h, p, s] = t.split('.'); assert.equal(b64u(createHmac('sha256', SECRET).update(`${h}.${p}`).digest()), s, '서명 = LIVEKIT_API_SECRET'); return JSON.parse(Buffer.from(p, 'base64url').toString()); };
const hook = (event, secret = SECRET) => { const raw = JSON.stringify(event); const auth = jwt({ iss: KEY, exp: Math.floor(Date.now() / 1000) + 300, sha256: createHash('sha256').update(raw).digest('base64') }, secret);
  return fetch(`${BASE}/api/meetings/engine-hook`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/webhook+json' }, body: raw }); };
let other; // 다른 회사 직원(쿠키)

before(async () => {
  lk = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      if (req.url.startsWith('/rtc/validate')) { seen.validate.push(req.url); res.statusCode = 401; return res.end('invalid token'); }
      if (req.url.startsWith('/twirp/')) { seen.twirp.push({ method: req.url.split('/').pop(), auth: req.headers.authorization, body: JSON.parse(b || '{}') }); res.setHeader('content-type', 'application/json'); return res.end('{}'); }
      res.statusCode = 404; res.end();
    });
  });
  lk.on('upgrade', (req, socket) => { seen.upgrades.push(req.url); socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); });
  await new Promise((r) => lk.listen(LK_PORT, '127.0.0.1', r));
  await resetDb(); sql = testDb();
  srv = await startServer({ FEATURE_MEETINGS: '1', MEETING_ENGINE: 'livekit', LIVEKIT_URL: `ws://127.0.0.1:${LK_PORT}`, LIVEKIT_API_KEY: KEY, LIVEKIT_API_SECRET: SECRET, MEETINGS_TENANTS: 'default' });
  ctx = await bootstrap();
  await sql`insert into tenants (id, name) values ('t_meet2', '남의회사') on conflict do nothing`;
  const [u] = await sql`insert into users (email, name, role, status, tenant) values ('boss@other-meet.test', '남대표', 'owner', 'active', 't_meet2') returning id`;
  const token = randomBytes(32).toString('base64url');
  await sql`insert into sessions (id, user_id, client, expires_at) values (${createHash('sha256').update(token).digest('hex')}, ${u.id}, 'web', now() + interval '1 day')`;
  other = { id: u.id, cookie: `wos_session=${token}` };
});
after(async () => { srv?.proc.kill(); lk?.close(); await sql?.end(); });
const asOther = (method, path, body) => fetch(`${BASE}${path}`, { method, headers: { cookie: other.cookie, origin: BASE, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });

test("① '우리 회사만'(MEETINGS_TENANTS=default): 다른 회사는 메뉴·만들기·회의 주소·알림 설정 모두 없음", async () => {
  const mine = await ctx.owner.ok('POST', '/api/meetings', { kind: 'instant', title: '우리 회의' });
  assert.ok(mine.id && mine.code);
  assert.equal((await asOther('POST', '/api/meetings', { kind: 'instant' })).status, 404, '다른 회사 직원은 회의를 못 만듦');
  const [{ code }] = await sql`insert into meetings (tenant, code, kind, title, expires_at) values ('t_meet2', ${'x'.repeat(22)}, 'instant', '남의 회의', now() + interval '1 day') returning code`;
  assert.equal((await fetch(`${BASE}/api/meet/${code}`)).status, 404, '스위치 밖 회사의 회의 주소도 없음');
  assert.equal((await fetch(`${BASE}/api/meet/${mine.code}`)).status, 200);
  assert.ok((await (await fetch(`${BASE}/calendar`, { headers: { cookie: ctx.owner.cookie } })).text()).includes('\\"meetings\\":true'), '우리 회사 화면에는 화상회의');
  assert.ok((await (await asOther('GET', '/calendar')).text()).includes('\\"meetings\\":false'), '다른 회사 화면에는 없음');
  const pOwner = await ctx.owner.ok('GET', '/api/notifications/prefs'); const pOther = await (await asOther('GET', '/api/notifications/prefs')).json();
  assert.ok(pOwner.types.some((t) => t.type === 'meeting_lobby') && !pOther.types.some((t) => t.type === 'meeting_lobby'), '대기실 알림 설정도 우리 회사만');
});

test('② 입장권 = 라이브킷 JWT(방·이름표·발행 권한·화면 공유 규칙·녹화 권한 없음) + canShare', async () => {
  const m = await ctx.owner.ok('POST', '/api/meetings', { kind: 'instant', title: '입장권 시험' });
  const j = await ctx.owner.ok('POST', `/api/meetings/${m.id}/join`);
  assert.deepEqual([j.state, j.engine, j.url, j.canShare], ['admitted', 'livekit', `ws://127.0.0.1:${LK_PORT}`, true]);
  const c = claims(j.token);
  assert.deepEqual([c.iss, c.sub, c.video.room, c.video.roomJoin, c.video.canPublish, c.video.canSubscribe], [KEY, j.participantId, m.id, true, true, true]);
  assert.ok(c.video.canPublishSources.includes('screen_share') && c.exp - c.nbf <= 600, '주최자는 화면 공유 · 10분 입장권');
  assert.ok(!c.video.roomRecord && !c.video.recorder, '녹화 권한 없음(주최자는 218차 설계대로 그 방 관리 권한만)');
  assert.equal(JSON.parse(c.metadata).role, 'host');
  await ctx.owner.ok('PATCH', `/api/meetings/${m.id}`, { share: 'host' });
  const s = await ctx.staffA.client.ok('POST', `/api/meetings/${m.id}/join`);
  assert.equal(s.state, 'admitted', JSON.stringify(s));
  const cs = claims(s.token);
  assert.deepEqual([s.canShare, cs.video.canPublishSources.includes('screen_share'), JSON.parse(cs.metadata).role, !!cs.video.roomAdmin, !!cs.video.roomRecord], [false, false, 'member', false, false], '화면 공유 주최자만이면 직원 입장권에 화면 공유 없음 · 직원은 방 관리·녹화 없음');
});

test('③ 라이브킷 웹훅(본문 sha256 서명) → 입장·퇴장 기록 · 틀린 서명 401 · ④ 내보내기·끝내기 → 방 관리 API', async () => {
  const m = await ctx.owner.ok('POST', '/api/meetings', { kind: 'instant', title: '웹훅 시험' });
  const j = await ctx.owner.ok('POST', `/api/meetings/${m.id}/join`); const s = await ctx.staffA.client.ok('POST', `/api/meetings/${m.id}/join`);
  const now = Math.floor(Date.now() / 1000);
  assert.equal((await hook({ event: 'participant_joined', room: { name: m.id }, participant: { identity: s.participantId }, createdAt: now }, 'wrong-secret-wrong-secret')).status, 401);
  const ok = await hook({ event: 'participant_joined', room: { name: m.id }, participant: { identity: s.participantId }, createdAt: now });
  assert.equal(ok.status, 200); assert.equal((await ok.json()).applied, 1);
  assert.equal((await sql`select state from meeting_participants where id = ${s.participantId}`)[0].state, 'joined');
  await hook({ event: 'participant_left', room: { name: m.id }, participant: { identity: s.participantId }, createdAt: now + 30 });
  const [p] = await sql`select state, seconds from meeting_participants where id = ${s.participantId}`;
  assert.deepEqual([p.state, p.seconds >= 29], ['left', true], '퇴장·머문 시간');
  seen.twirp.length = 0;
  await ctx.owner.ok('POST', `/api/meetings/${m.id}/participants/${s.participantId}`, { action: 'remove' });
  await ctx.owner.ok('POST', `/api/meetings/${m.id}/end`, {});
  assert.deepEqual(seen.twirp.map((t) => t.method), ['RemoveParticipant', 'DeleteRoom']);
  const rm = seen.twirp[0]; const ac = claims(rm.auth.replace(/^Bearer /, ''));
  assert.deepEqual([rm.body.room, rm.body.identity, ac.video.room, ac.video.roomAdmin, ac.iss], [m.id, s.participantId, m.id, true, KEY], '관리 JWT 는 그 방만');
  void j;
});

test('⑤ 화면: [참가] → 라이브킷 서버에 그 입장권으로 접속 시도 · 접속 못 하면 안내·[다시 연결](브라우저 있을 때만)', async (t) => {
  let chromium; try { ({ chromium } = await import('playwright')); } catch { return t.skip('playwright 없음'); }
  if (!existsSync(chromium.executablePath())) return t.skip('브라우저 설치 전(CI API 단계)');
  const m = await ctx.owner.ok('POST', '/api/meetings', { kind: 'instant', title: '화면 시험' });
  const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  try {
    const bctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone'] });
    const [kv] = ctx.owner.cookie.split(';'); const [name, value] = kv.split('=');
    await bctx.addCookies([{ name, value, url: BASE }]);
    const p = await bctx.newPage(); seen.upgrades.length = 0;
    await p.goto(`${BASE}/meet/${m.code}`);
    await p.getByTestId('meet-join').click();
    await p.getByTestId('meet-room').waitFor();
    assert.equal(await p.getByTestId('meet-room').getAttribute('data-engine'), 'livekit');
    for (let i = 0; i < 50 && !seen.upgrades.length; i++) await p.waitForTimeout(200);
    assert.ok(seen.upgrades.length >= 1, '라이브킷 서버로 접속 시도');
    const url = new URL(seen.upgrades[0], 'ws://x'); assert.match(url.pathname, /^\/rtc(\/v\d+)?$/);
    const c = claims(url.searchParams.get('access_token'));
    const [pt] = await sql`select id from meeting_participants where meeting_id = ${m.id} and user_id = ${ctx.ownerId}`;
    assert.deepEqual([c.sub, c.video.room], [pt.id, m.id], '서버가 준 입장권 그대로');
    await p.getByTestId('meet-live-error').waitFor({ timeout: 20000 });
    assert.match(await p.getByTestId('meet-live-error').innerText(), /영상 서버에|입장권이 맞지 않아/);
    assert.equal(await p.getByTestId('meet-live-state').getAttribute('data-state'), 'error');
    assert.equal(await p.getByTestId('meet-share').count(), 1, '주최자 화면 공유 단추');
    const before = seen.upgrades.length; await p.getByTestId('meet-live-retry').click();
    for (let i = 0; i < 50 && seen.upgrades.length === before; i++) await p.waitForTimeout(200);
    assert.ok(seen.upgrades.length > before, '[다시 연결] = 새 입장권으로 다시 접속');
    await p.getByTestId('meet-leave').click();
    await p.getByTestId('meet-left').waitFor();
  } finally { await browser.close(); }
});

test('⑥ 회의 기록 90일: 끝난 지 90일 넘은 회의·기록은 정기 실행이 지움(최근 것은 남김)', async () => {
  const mk = async (days) => (await sql`insert into meetings (tenant, code, kind, title, status, ended_at, expires_at) values ('default', ${randomBytes(16).toString('base64url')}, 'instant', ${`옛 회의 ${days}`}, 'ended', now() - make_interval(days => ${days}), now() + interval '1 day') returning id`)[0].id;
  const old = await mk(100), recent = await mk(10);
  await sql`insert into meeting_log (meeting_id, kind, at, data) values (${recent}, 'start', now() - interval '120 days', '{}'), (${recent}, 'end', now() - interval '10 days', '{}')`;
  const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } });
  const d = (await r.json()).detail?.meetings;
  assert.ok(d?.purged >= 1 && d?.logs >= 1, JSON.stringify(d));
  assert.equal((await sql`select count(*)::int c from meetings where id = ${old}`)[0].c, 0, '100일 전 회의 지움');
  assert.equal((await sql`select count(*)::int c from meetings where id = ${recent}`)[0].c, 1, '10일 전 회의 남김');
  assert.equal((await sql`select count(*)::int c from meeting_log where meeting_id = ${recent}`)[0].c, 1, '120일 전 기록 줄만 지움');
});
