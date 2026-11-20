// 대표 11/20 "사이트 주소를 공유하면 직원들이 앱을 내려받은 후 진행할 수 있도록" — 앱 받기 화면(/app, 로그인 없음).
// 기기에 맞는 길 하나: 안드로이드 = Google Play 단추 + 받은 뒤 3단계 · 아이폰 = (App Store 주소가 없는 동안) 홈 화면에 추가하는 방법 + [워크인 열기] · PC = QR + 두 스토어 + 웹 로그인
// · ?os= 로 다른 기기 안내 보기 · 앱 안(WorkInApp)·앱이 띄운 로그인 창(표시 쿠키)에서는 로그인으로(스토어 심사: 앱 안에 스토어 길 없음) · 요금 글자 없음 · 사이트맵에 있음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, resetDb, startServer } from '../helpers.mjs';

let srv;
before(async () => { await resetDb(); srv = await startServer(); });
after(() => srv?.proc.kill());
const UA = {
  pc: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  kakao: 'Mozilla/5.0 (Linux; Android 14; SM-S921N; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 KAKAOTALK 10.9.5',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  androidApp: 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 WorkInApp',
  iosApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WorkInApp',
};
const get = async (p, ua, headers = {}) => { const r = await fetch(BASE + p, { redirect: 'manual', headers: { 'user-agent': ua, ...headers } }); return { status: r.status, location: r.headers.get('location'), text: await r.text() }; };
const PLAY = 'https://play.google.com/store/apps/details?id=kr.co.dagym.workos';
const body = (t) => t.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
const noPrice = (t, who) => assert.doesNotMatch(body(t), /무료|체험|요금|결제|가격|[0-9]원/, `${who}: 요금 글자 없음`);

test('PC: QR(이 화면 주소) · Google Play 주소 · App Store 준비 중 · 웹으로 로그인 · 제목·색인·canonical', async () => {
  const r = await get('/app', UA.pc);
  assert.equal(r.status, 200);
  assert.match(r.text, /data-testid="app-get"[^>]*data-os="pc"|data-os="pc"[^>]*data-testid="app-get"/);
  assert.match(r.text, /data-testid="app-get-qr"[^>]*>\s*<svg/, 'QR 그림(svg)');
  assert.ok(r.text.includes('www.work-in.dev/app'), 'QR 옆에 주소 글자');
  assert.ok(r.text.includes(`href="${PLAY}"`), 'Google Play 공개 주소');
  assert.ok(r.text.includes('App Store 준비 중') && !r.text.includes('apps.apple.com'), 'App Store 주소가 없는 동안은 준비 중');
  assert.match(r.text, /href="\/login"[^>]*data-testid="app-get-web"/, '웹으로 로그인');
  assert.match(r.text, /<title>워크인 앱 받기<\/title>/);
  assert.match(r.text, /<link rel="canonical" href="https:\/\/www\.work-in\.dev\/app"/);
  assert.match(r.text, /<meta name="robots" content="index, follow"/);
  noPrice(r.text, 'PC');
});

test('안드로이드 브라우저(카카오톡 안 브라우저 포함): Google Play 단추 하나 + 받은 뒤 3단계 · QR 없음', async () => {
  for (const k of ['android', 'kakao']) {
    const r = await get('/app', UA[k]);
    assert.equal(r.status, 200, k);
    assert.ok(r.text.includes('data-os="android"'), `${k}: 안드로이드 안내`);
    assert.match(r.text, new RegExp(`href="${PLAY.replace(/[.?]/g, '\\$&')}"[^>]*data-testid="app-get-play"`), `${k}: Play 단추`);
    assert.ok(!r.text.includes('data-testid="app-get-qr"'), `${k}: QR 없음`);
    const t = body(r.text);
    assert.match(t, /이메일과 비밀번호[\s\S]*초대 링크를 받았다면 먼저 그 링크에서 비밀번호를 정하세요/, `${k}: 무엇으로 로그인하는지`);
    assert.match(t, /알림을 허용하면/, `${k}: 알림 허용 안내`);
    noPrice(r.text, k);
  }
});

test('아이폰 브라우저: App Store 주소가 없는 동안 — 준비 중 + 홈 화면에 추가 3단계 + [워크인 열기](로그인) · 스토어 단추 없음', async () => {
  const r = await get('/app', UA.iphone);
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('data-os="ios"'));
  const t = body(r.text);
  assert.match(t, /아이폰 앱은 준비 중입니다/); assert.match(t, /홈 화면에 추가/); assert.match(t, /Safari/);
  assert.match(r.text, /href="\/login"[^>]*data-testid="app-get-open"/, '[워크인 열기] = 로그인');
  assert.ok(!r.text.includes('data-testid="app-get-appstore"') && !r.text.includes('data-testid="app-get-play"'), '스토어 단추 없음');
  noPrice(r.text, '아이폰');
});

test('?os= 로 다른 기기 안내 보기 · 모르는 값은 기기대로', async () => {
  assert.ok((await get('/app?os=android', UA.pc)).text.includes('data-os="android"'));
  assert.ok((await get('/app?os=ios', UA.android)).text.includes('data-os="ios"'));
  assert.ok((await get('/app?os=pc', UA.iphone)).text.includes('data-testid="app-get-qr"'));
  assert.ok((await get('/app?os=windows', UA.android)).text.includes('data-os="android"'), '모르는 값은 무시');
  const pc = (await get('/app', UA.pc)).text;
  assert.ok(pc.includes('href="/app?os=android"') && pc.includes('href="/app?os=ios"') && !pc.includes('href="/app?os=pc"'), '다른 기기 링크 두 개');
});

test('앱 안(안드로이드·아이폰 앱)·앱이 띄운 로그인 창에서는 앱 받기 화면 대신 로그인으로', async () => {
  for (const [who, ua, h] of [['안드로이드 앱', UA.androidApp, {}], ['아이폰 앱', UA.iosApp, {}], ['앱이 띄운 로그인 창', UA.iphone, { cookie: 'wos_app=1' }], ['앱이 띄운 로그인 창(안드로이드)', UA.android, { cookie: 'wos_app=1' }]]) {
    const r = await get('/app', ua, h);
    assert.equal(r.status, 307, who); assert.equal(new URL(r.location, BASE).pathname, '/login', who);
  }
});

test('사이트맵에 앱 받기 주소 · robots 가 막지 않음 · 소개 첫 화면 [앱 다운로드] = /app · 로그인 화면에는 띠 자리만(서버 그림에는 없음)', async () => {
  const sm = await get('/sitemap.xml', UA.pc);
  assert.ok(sm.text.includes('<loc>https://www.work-in.dev/app</loc>'));
  const rb = await get('/robots.txt', UA.pc);
  assert.ok(!/Disallow: \/app\s/.test(rb.text + '\n'), 'robots 가 /app 을 막지 않음');
  const home = await get('/welcome', UA.pc);
  assert.match(home.text, /href="\/app"[^>]*data-testid="landing-app"/);
  assert.match(home.text.replace(/<!-- -->/g, ''), /data-testid="landing-app-page"[^>]*>www\.work-in\.dev\/app</, '앱 구역에 주소 글자');
  for (const p of ['/welcome', '/login']) assert.ok(!(await get(p, UA.android)).text.includes('data-testid="app-get-bar"'), `${p}: 띠는 브라우저에서 확인한 뒤에만 그림(서버 그림에는 없음)`);
});
