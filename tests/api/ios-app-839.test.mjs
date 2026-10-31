// 294차 #839 App Store 심사 거절(10/28 · 4.8 로그인 서비스 · 3.1.1 앱 안 가입) — 아이폰 앱은 로그인만:
// 앱 표시(WorkInApp) + 안드로이드 아님(아이패드는 맥 표시)이면 가입·소개·랜딩 주소 → /login(307). 안드로이드 앱·웹 브라우저는 그대로.
// + 점검 중 발견: 카카오톡·인스타그램·페이스북 등 다른 앱 안 브라우저(WebView)를 우리 앱으로 보던 것 — 첫 주소(/)가 소개 대신 로그인으로 가던 문제
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const UA = {
  iosApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WorkInApp',
  ipadApp: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) WorkInApp',
  androidApp: 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 WorkInApp',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  kakaoIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 25.9.0',
  instaIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0 (iPhone15,2; iOS 18_0; ko_KR; ko)',
  kakaoAndroid: 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36;KAKAOTALK 2510900',
  oldIosApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
};
const get = (path, ua) => fetch(BASE + path, { headers: { 'user-agent': ua }, redirect: 'manual' });
let srv, sql;
before(async () => { await resetDb(); sql = testDb(); srv = await startServer(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('아이폰·아이패드 앱: 가입·소개·랜딩 주소는 로그인으로(307) · 로그인·초대·약관은 그대로', async () => {
  for (const ua of [UA.iosApp, UA.ipadApp]) {
    for (const p of ['/signup', '/signup/social?t=abc', '/welcome', '/landing/workin', '/signup?plan=pro']) {
      const r = await get(p, ua);
      assert.equal(r.status, 307, `${p} → 307 (${ua.slice(13, 25)})`);
      assert.equal(new URL(r.headers.get('location'), BASE).pathname + new URL(r.headers.get('location'), BASE).search, '/login', `${p} → /login (검색어 없음)`);
    }
    for (const p of ['/login', '/terms', '/privacy']) assert.equal((await get(p, ua)).status, 200, `${p} 그대로`);
    assert.notEqual((await get('/invite/abc', ua)).headers.get('location'), '/login', '초대 주소는 막지 않음(회사가 만든 계정)');
  }
});

test('안드로이드 앱·웹 브라우저(아이폰 사파리 포함)는 가입 화면 그대로', async () => {
  for (const ua of [UA.androidApp, UA.iphoneSafari, UA.kakaoIphone]) {
    const r = await get('/signup', ua);
    assert.equal(r.status, 200, `가입 그대로 (${ua.slice(13, 30)})`);
  }
});

test('다른 앱 안 브라우저(카카오톡·인스타그램)는 첫 주소(/)에서 소개 화면 · 우리 앱(옛 아이폰 앱 포함)은 로그인 쪽', async () => {
  for (const ua of [UA.kakaoIphone, UA.instaIphone, UA.kakaoAndroid, UA.iphoneSafari]) {
    const r = await get('/', ua);
    assert.equal(r.status, 200, `소개 화면 (${ua.slice(-30)})`);
    assert.match(await r.text(), /14일 무료 체험|워크인/, '소개 화면 글');
  }
  for (const ua of [UA.iosApp, UA.androidApp, UA.oldIosApp]) {
    const r = await get('/', ua);
    assert.notEqual(r.status, 200, `앱은 소개 대신 로그인 쪽 (${ua.slice(-20)}) → ${r.status}`);
  }
});

test('295차: 관리 › 사용자 — 카카오·네이버로만 가입해 비밀번호가 없는 사람 표시(아이폰 앱은 이메일 로그인만) · 비밀번호 값은 안 보냄', async () => {
  const ctx = await bootstrap();
  await sql`insert into user_identities (provider, subject, user_id, email) values ('kakao', 'k-839', ${ctx.staffA.id}, null), ('naver', 'n-839', ${ctx.staffB.id}, null)`;
  await sql`update users set password_hash = null where id = ${ctx.staffA.id}`;
  const { users } = await ctx.owner.ok('GET', '/api/admin/users');
  const a = users.find((u) => u.id === ctx.staffA.id); const b = users.find((u) => u.id === ctx.staffB.id); const o = users.find((u) => u.id === ctx.ownerId);
  assert.deepEqual([a.social, a.has_password], [['kakao'], false], '카카오만 · 비밀번호 없음');
  assert.deepEqual([b.social, b.has_password], [['naver'], true], '네이버 연결 + 비밀번호 있음');
  assert.deepEqual([o.social, o.has_password], [[], true]);
  assert.ok(users.every((u) => !('password_hash' in u)), '비밀번호 값은 응답에 없음');
  assert.equal(users.filter((u) => !u.has_password && u.social.length).length, 1, '아이폰에서 비밀번호가 필요한 사람 수');
});
