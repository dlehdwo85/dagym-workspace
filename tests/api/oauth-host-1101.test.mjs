// 로컬 11/21 #1101: 간편 로그인 첫 시도가 '로그인 요청이 만료'로 실패 — 시작을 dagym-workspace.vercel.app 에서 하면 상태 쿠키가 그 호스트에만 생기고
// 콜백(redirect_uri)은 늘 APP_URL 로 돌아와 쿠키가 없었음. 시작 주소가 APP_URL 호스트와 다르면 먼저 APP_URL 의 같은 시작 주소로(쿼리 그대로),
// 계정 연결(mode=link)은 APP_URL 의 설정 화면으로(?relink=…) · 콜백 '만료'의 하위 이유를 감사 기록(auth.oauth_failed)·운영 기록에 코드로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

/** Host 머리를 바꿔 부르기(fetch 는 Host 를 못 바꿈) */
const viaHost = (path, host) => new Promise((resolve, reject) => {
  const u = new URL(BASE + path);
  const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'GET', headers: { host } }, (res) => { res.resume(); resolve({ status: res.statusCode, location: res.headers.location, cookies: res.headers['set-cookie'] ?? [] }); });
  r.on('error', reject); r.end();
});

test('다른 주소에서 시작 → APP_URL 의 같은 시작 주소로(쿼리 그대로, 상태 쿠키는 아직 안 만듦)', async () => {
  const r = await viaHost('/api/auth/oauth/kakao/start?utm_source=meta&client=web', 'dagym-workspace.vercel.app');
  assert.equal(r.status, 307);
  assert.equal(r.location, `${BASE}/api/auth/oauth/kakao/start?utm_source=meta&client=web`);
  assert.ok(!r.cookies.some((c) => c.startsWith('wos_oauth=')), '다른 주소에는 상태 쿠키를 심지 않음');
});

test('계정 연결(mode=link)을 다른 주소에서 → APP_URL 설정 화면(?relink=)으로', async () => {
  const r = await viaHost('/api/auth/oauth/google/start?mode=link', 'dagym-workspace.vercel.app');
  assert.equal(r.status, 303);
  assert.equal(r.location, `${BASE}/settings?relink=google`);
});

test('APP_URL 주소에서 시작은 그대로(제공자 설정이 없으면 예전처럼 로그인 화면 안내)', async () => {
  const r = await viaHost('/api/auth/oauth/kakao/start', new URL(BASE).host);
  assert.notEqual(r.status, 307);
  assert.ok(!String(r.location ?? '').startsWith(`${BASE}/api/auth/oauth/kakao/start`), '다시 시작 주소로 돌지 않음');
});

test("콜백 '만료' 하위 이유: 쿠키 없음 → state_no_cookie(감사 기록) · 서명 다름 → state_bad_sig · 화면 문구는 그대로", async () => {
  const a = await fetch(`${BASE}/api/auth/oauth/kakao/callback?code=x&state=y`, { redirect: 'manual' });
  assert.equal(a.status, 303);
  assert.match(decodeURIComponent(a.headers.get('location') ?? ''), /로그인 요청이 만료되었습니다/);
  const b = await fetch(`${BASE}/api/auth/oauth/kakao/callback?code=x&state=y`, { redirect: 'manual', headers: { cookie: 'wos_oauth=abc.def' } });
  assert.equal(b.status, 303);
  const rows = await sql`select detail->>'reason' as reason, detail->>'provider' as provider, detail->>'host' as host from audit_logs where action = 'auth.oauth_failed' order by id`;
  assert.deepEqual(rows.map((x) => x.reason), ['state_no_cookie', 'state_bad_sig']);
  assert.equal(rows[0].provider, 'kakao'); assert.equal(rows[0].host, new URL(BASE).host);
});
