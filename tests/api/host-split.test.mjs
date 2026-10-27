// 198차 결정 15-29(#664·#683) 주소 분리 A안 — 스위치(APP_HOST_SPLIT=1)를 켠 서버로 호스트 갈림 확인(설계 docs/research/WWW_APP_HOST_SPLIT_2026-10-25.md §3·§8).
// www = 소개·약관·공용(API·정적 파일)만, 그 밖은 app. 으로 308(경로·검색어 그대로) · www 첫 화면은 로그인했어도 소개 · 옛 앱(WebView)은 유예 날짜까지 www 그대로
// · app. 의 소개 화면은 www 로 308 · app. robots.txt = 전부 막음 · app. 은 noindex · app. 첫 화면은 로그인 전이면 /login · 다른 호스트·API 는 그대로
// · 이 사람의 받는 중인 구독 수(브라우저 알림 다시 켜기 안내)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { PORT, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

const WWW = 'www.work-in.dev', APP = 'app.work-in.dev';
const APP_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 WorkInApp';
const raw = (host, path, headers = {}) => new Promise((ok, fail) => {
  const r = http.request({ host: '127.0.0.1', port: PORT, path, method: 'GET', headers: { host, ...headers } }, (s) => { let b = ''; s.on('data', (d) => (b += d)); s.on('end', () => ok({ status: s.statusCode, headers: s.headers, body: b })); });
  r.on('error', fail); r.end();
});
let srv, sql, ctx;
const stop = async () => { if (!srv?.proc || srv.proc.exitCode !== null) return; const gone = new Promise((r) => srv.proc.once('exit', r)); srv.proc.kill(); await gone; }; // 같은 포트로 다음 서버를 띄우기 전에 끝날 때까지

describe('주소 분리 켬(유예 날짜 앞)', () => {
  before(async () => {
    await resetDb(); sql = testDb();
    srv = await startServer({ APP_HOST_SPLIT: '1', APP_URL: `https://${APP}`, APP_HOST_SPLIT_APP_GRACE_UNTIL: addDays(seoulToday(), 14) });
    ctx = await bootstrap();
  });
  after(async () => { await stop(); await sql?.end(); });

  test('www: 소개·약관·공용은 그대로 · 로그인·업무·영업 화면은 app. 으로 308(경로·검색어 그대로) · 첫 화면은 소개', async () => {
    for (const [p, to] of [['/tasks', '/tasks'], ['/login?next=%2Fcalendar', '/login?next=%2Fcalendar'], ['/s/sales/leads?lv=closed', '/s/sales/leads?lv=closed'], ['/signup', '/signup'], ['/invite/abc', '/invite/abc']]) {
      const r = await raw(WWW, p);
      assert.equal(r.status, 308, `${p} → 308`); assert.equal(r.headers.location, `https://${APP}${to}`);
    }
    for (const p of ['/privacy', '/terms', '/api/health', '/sw.js', '/manifest.webmanifest', '/robots.txt']) assert.equal((await raw(WWW, p)).status, 200, `${p} 그대로`);
    const home = await raw(WWW, '/'); assert.equal(home.status, 200); assert.ok(!home.headers['x-robots-tag'], 'www 는 색인');
    const signedHome = await raw(WWW, '/', { cookie: 'wos_session=anything' });
    assert.equal(signedHome.status, 200, '로그인 쿠키가 있어도 www 첫 화면은 소개(앱 화면 아님)');
    assert.match(await (await raw(WWW, '/robots.txt')).body, /Disallow: \/api\//, 'www robots 는 예전 그대로');
  });

  test('www: 옛 앱(WebView)은 유예 날짜까지 app. 으로 보내지 않음', async () => {
    const r = await raw(WWW, '/tasks', { 'user-agent': APP_UA });
    assert.ok(!(r.status === 308 && String(r.headers.location).includes(APP)), `유예 중 앱은 www 그대로: ${r.status} ${r.headers.location ?? ''}`);
  });

  test('app.: 소개 화면은 www 로 · robots 전부 막음 · noindex · 첫 화면 로그인 전 → /login · API 그대로', async () => {
    for (const p of ['/welcome', '/privacy', '/landing/fitness']) {
      const r = await raw(APP, p); assert.equal(r.status, 308, p); assert.equal(r.headers.location, `https://${WWW}${p}`);
    }
    const rb = await raw(APP, '/robots.txt');
    assert.deepEqual([rb.status, rb.body.trim(), rb.headers['x-robots-tag']], [200, 'User-agent: *\nDisallow: /', 'noindex, nofollow']);
    const root = await raw(APP, '/'); assert.equal(root.status, 307); assert.match(String(root.headers.location), /\/login$/);
    const login = await raw(APP, '/login'); assert.equal(login.status, 200); assert.equal(login.headers['x-robots-tag'], 'noindex, nofollow');
    const api = await raw(APP, '/api/health'); assert.equal(api.status, 200); assert.ok(!api.headers.location);
  });

  test('소셜 로그인 시작이 www 면 app. 의 같은 시작 주소로(상태 쿠키와 콜백 호스트를 맞춤 — 옛 앱의 시스템 브라우저)', async () => {
    const r = await raw(WWW, '/api/auth/oauth/google/start?ac=abc');
    assert.equal(r.status, 307); assert.equal(r.headers.location, `https://${APP}/api/auth/oauth/google/start?ac=abc`);
    const a = await raw(APP, '/api/auth/oauth/google/start?ac=abc');
    assert.notEqual(a.status, 307, 'app. 에서는 그대로 시작(설정이 없으면 로그인 화면으로 안내)');
  });

  test('그 밖의 호스트(Vercel 기본 주소 등)는 예전 그대로 · 받는 중인 구독 수', async () => {
    const r = await raw(`localhost:${PORT}`, '/tasks'); assert.notEqual(r.status, 308);
    assert.ok(!String(r.headers.location ?? '').includes(APP));
    assert.deepEqual(await ctx.staffA.client.ok('GET', '/api/push/subscribe'), { web: 0, fcm: 0 });
    await ctx.staffA.client.ok('POST', '/api/push/subscribe', { kind: 'webpush', endpoint: 'https://push.example.test/www-sub-1', keys: { p256dh: 'p', auth: 'a' }, platform: 'web' });
    assert.deepEqual(await ctx.staffA.client.ok('GET', '/api/push/subscribe'), { web: 1, fcm: 0 }, '다른 주소에서 받던 웹 푸시 → app. 에서 다시 켜기 안내');
  });
});

describe('주소 분리 켬(유예 끝)', () => {
  before(async () => { srv = await startServer({ APP_HOST_SPLIT: '1', APP_URL: `https://${APP}`, APP_HOST_SPLIT_APP_GRACE_UNTIL: addDays(seoulToday(), -1) }); });
  after(stop);
  test('유예가 지나면 앱도 app. 으로(첫 화면 포함)', async () => {
    for (const p of ['/tasks', '/']) {
      const r = await raw(WWW, p, { 'user-agent': APP_UA });
      assert.equal(r.status, 308, p); assert.equal(r.headers.location, `https://${APP}${p}`);
    }
  });
});

describe('스위치 꺼짐(지금 운영)', () => {
  before(async () => { srv = await startServer({ APP_URL: `https://${APP}` }); });
  after(stop);
  test('APP_URL 이 달라도 스위치를 켜기 전에는 www·app. 모두 예전 그대로', async () => {
    for (const h of [WWW, APP]) {
      const r = await raw(h, '/tasks'); assert.notEqual(r.status, 308, h);
      assert.ok(!r.headers['x-robots-tag'], `${h} noindex 없음`);
      assert.match((await raw(h, '/robots.txt')).body, /Disallow: \/api\//);
    }
    assert.equal((await raw(WWW, '/')).status, 200);
  });
});
