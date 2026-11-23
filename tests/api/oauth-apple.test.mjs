// 299차 #858(대표 10/31 '애플로 로그인 개발 진행해주세요'): Apple로 로그인 — 가짜 Apple 서버(토큰·공개 키·해지)로 시험. 실제 Apple 연동은 키 등록 뒤 운영에서 확인
// ① 키 넷이 다 있어야 버튼 · 시작 = form_post·name email ② 콜백 POST(이름 처음 한 번) → 같은 주소 GET → 처음이면 회사 만들기(이름·이메일 채움), 클라이언트 비밀(ES256)·id_token(서명·대상) 확인
// ③ 다음부터 로그인 · id_token 대상이 다르면 거절 · 아이폰 앱에서 처음 보는 Apple 계정은 가입 대신 안내 ④ 설정에서 연결·끊기(끊으면 토큰 해지) ⑤ 계정 삭제 = 토큰 해지 + 연결 지움 ⑥ Apple 서버 알림(연결 끊기)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SignJWT, exportJWK, exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

const PORT = 3206, FAKE = `http://localhost:${PORT}`;
const TEAM = 'TEAM123456', SID = 'dev.work-in.signin.test', KID = 'KEY1234567', ISS = 'https://appleid.apple.com';
let fake, srv, sql, ctx, ec, rsa, jwk, PEM;
const seen = { token: [], revoke: [] };
let forceClient = false; // 로컬 11/21 #1094: 애플이 클라이언트를 거절하는 경우(키·팀 ID 등이 틀림) 흉내

const idToken = (o, aud = SID) => new SignJWT({ email: o.email, email_verified: 'true', is_private_email: o.private ? 'true' : 'false' })
  .setProtectedHeader({ alg: 'RS256', kid: 'apple-test' }).setIssuer(ISS).setAudience(aud).setSubject(o.sub).setIssuedAt().setExpirationTime('10m').sign(rsa.privateKey);
function fakeApple() {
  return http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', async () => {
      const j = (o, s = 200) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      const path = req.url.split('?')[0];
      if (path === '/oauth/apple/keys') return j({ keys: [jwk] });
      const f = Object.fromEntries(new URLSearchParams(body));
      // 클라이언트 비밀: 우리 키(ES256)로 서명 · 발급자 = 팀 · 주체 = Services ID · 대상 = Apple
      const cs = await jwtVerify(f.client_secret ?? '', ec.publicKey, { issuer: TEAM, audience: ISS, subject: SID }).then(() => true, () => false);
      if (path === '/oauth/apple/token') {
        seen.token.push({ ...f, cs });
        if (!cs || f.client_id !== SID || f.grant_type !== 'authorization_code') return j({ error: 'invalid_client' }, 400);
        if (forceClient) return j({ error: 'invalid_client' }, 400);
        if (String(f.code ?? '').startsWith('workin-selfcheck')) return j({ error: 'invalid_grant' }, 400); // 자가 점검의 가짜 코드
        const prof = JSON.parse(Buffer.from(f.code, 'base64url').toString());
        return j({ access_token: 'at', token_type: 'Bearer', id_token: await idToken(prof, prof.aud ?? SID), refresh_token: `rt-${prof.sub}` });
      }
      if (path === '/oauth/apple/revoke') { seen.revoke.push({ ...f, cs }); return j({}, cs ? 200 : 400); }
      j({ error: 'nope' }, 404);
    });
  }).listen(PORT);
}
const code = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const cookieOf = (r, name) => (r.headers.getSetCookie?.() ?? []).find((x) => x.startsWith(`${name}=`))?.split(';')[0] ?? null;

/** 시작 → (Apple 화면 건너뜀) → 콜백 POST(form) → 같은 주소 GET. 돌아온 곳 */
async function apple(c, prof, q = '', user = null) {
  const s = await c.req('GET', `/api/auth/oauth/apple/start?${q}`);
  assert.equal(s.status, 303);
  const auth = new URL(s.headers.get('location'));
  assert.equal(auth.origin + auth.pathname, `${FAKE}/oauth/apple/authorize`);
  assert.equal(auth.searchParams.get('response_mode'), 'form_post'); assert.equal(auth.searchParams.get('scope'), 'name email'); assert.equal(auth.searchParams.get('client_id'), SID);
  assert.equal(auth.searchParams.get('redirect_uri'), `${BASE}/api/auth/oauth/apple/callback`);
  const st = cookieOf(s, 'wos_oauth');
  // Apple 화면 → 우리 콜백으로 POST(다른 사이트에서 온 POST 라 쿠키 없이)
  const form = new URLSearchParams({ code: code(prof), state: auth.searchParams.get('state') }); if (user) form.set('user', JSON.stringify(user));
  const p = await fetch(`${BASE}/api/auth/oauth/apple/callback`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form, redirect: 'manual' });
  assert.equal(p.status, 303);
  const back = new URL(p.headers.get('location'), BASE);
  assert.equal(back.pathname, '/api/auth/oauth/apple/callback'); assert.equal(back.searchParams.get('state'), auth.searchParams.get('state'));
  assert.ok(!back.search.includes('%EA') && !/name|firstName/.test(back.search), '주소에 이름(개인정보) 없음');
  const nm = cookieOf(p, 'wos_oauth_name');
  const keep = c.cookie; c.cookie = [keep, st, nm].filter(Boolean).join('; ');
  const r = await c.req('GET', back.pathname + back.search);
  c.cookie = c.cookie.split('; ').filter((x) => !x.startsWith('wos_oauth')).join('; ');
  assert.equal(r.status, 303);
  return new URL(r.headers.get('location'), BASE);
}

before(async () => {
  ec = await generateKeyPair('ES256', { extractable: true }); rsa = await generateKeyPair('RS256', { extractable: true });
  jwk = { ...(await exportJWK(rsa.publicKey)), kid: 'apple-test', alg: 'RS256', use: 'sig' };
  fake = fakeApple();
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', OAUTH_TEST_BASE: FAKE, APPLE_TEAM_ID: TEAM, APPLE_SERVICES_ID: SID, APPLE_KEY_ID: KID,
    APPLE_PRIVATE_KEY: (PEM = await exportPKCS8(ec.privateKey)).replace(/\n/g, '\\n') }); // 운영 환경 변수처럼 한 줄(\n) 로도 읽힘
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

describe('299차 Apple로 로그인', () => {
  test('버튼 · 처음이면 회사 만들기(처음 한 번 오는 이름·숨김 이메일 채움) · 클라이언트 비밀·id_token 확인 · 토큰은 암호화 보관 · 다음부터 로그인', async () => {
    assert.deepEqual((await new Client().ok('GET', '/api/auth/oauth/providers')).providers, ['apple'], '키 넷이 있는 Apple 만');
    // 대표 11/19(애플 11/15 반려 뒤): 아이폰·아이패드 앱은 이메일 로그인만 — 앱 표시가 있고 안드로이드가 아니면 단추 목록이 빔(Apple 포함). 안드로이드 앱·웹은 그대로
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WorkInApp';
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) WorkInApp';
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 WorkInApp';
    for (const ua of [iphone, ipad]) assert.deepEqual((await new Client().ok('GET', '/api/auth/oauth/providers', undefined, { 'user-agent': ua })).providers, [], '아이폰·아이패드 앱: 소셜 단추 없음');
    assert.deepEqual((await new Client().ok('GET', '/api/auth/oauth/providers', undefined, { 'user-agent': android })).providers, ['apple'], '안드로이드 앱은 그대로');
    const c = new Client('a1');
    const to = await apple(c, { sub: 'apple.001', email: 'x7k2@privaterelay.appleid.com', private: true }, '', { name: { firstName: '길동', lastName: '홍' }, email: 'x7k2@privaterelay.appleid.com' });
    assert.equal(to.pathname, '/signup/social', to.href);
    assert.equal(seen.token.at(-1).cs, true, '클라이언트 비밀 = 우리 키(ES256)로 서명한 JWT');
    assert.equal(seen.token.at(-1).redirect_uri, `${BASE}/api/auth/oauth/apple/callback`);
    const t = to.searchParams.get('t');
    const info = await c.ok('GET', `/api/auth/oauth/pending?t=${t}`);
    assert.equal(info.providerLabel, 'Apple'); assert.equal(info.email, 'x7k2@privaterelay.appleid.com'); assert.equal(info.name, '홍길동', '한글 이름은 성+이름');
    await c.ok('POST', '/api/auth/oauth/complete', { token: t, name: info.name, mode: 'personal', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false } /* #1087 AI 동의 필수 */ });
    const me = await c.ok('GET', '/api/auth/me');
    assert.equal(me.user.email, 'x7k2@privaterelay.appleid.com'); P.u1 = me.user.id; P.c1 = c;
    const [idn] = await sql`select provider, subject, secret from user_identities where user_id = ${me.user.id}`;
    assert.equal(idn.provider, 'apple'); assert.equal(idn.subject, 'apple.001');
    assert.ok(idn.secret && !idn.secret.includes('rt-apple.001'), '해지용 토큰은 암호화해 보관');
    // 다음 로그인(이름은 다시 안 옴)
    const c2 = new Client('a2');
    assert.equal((await apple(c2, { sub: 'apple.001', email: 'x7k2@privaterelay.appleid.com' })).pathname, '/');
    assert.equal((await c2.ok('GET', '/api/auth/me')).user.id, me.user.id);
  });

  test('id_token 대상이 다르면 거절 · 아이폰 앱에서 처음 보는 Apple 계정은 가입 대신 안내(앱은 가입 없음)', async () => {
    const bad = await apple(new Client(), { sub: 'apple.bad', email: 'bad@example.com', aud: 'someone.else' });
    assert.equal(bad.pathname, '/login'); assert.match(bad.searchParams.get('oauth_error') ?? '', /Apple 로그인에 실패/);
    assert.equal((await sql`select count(*)::int as n from oauth_pending where email = 'bad@example.com'`)[0].n, 0);
    const ios = await apple(new Client(), { sub: 'apple.new', email: 'new@example.com' }, 'client=ios');
    assert.equal(ios.pathname, '/login'); assert.equal(ios.searchParams.get('code'), 'no_account');
    assert.match(ios.searchParams.get('oauth_error'), /회사 관리자의 초대로 만들어집니다/);
    // 아이폰 앱이어도 이미 연결된 계정은 로그인
    assert.equal((await apple(new Client(), { sub: 'apple.001', email: 'x7k2@privaterelay.appleid.com' }, 'client=ios')).pathname, '/');
  });

  test('#1094 실패 이유를 남김: id_token 대상이 다르면 이유 코드(id_token)·aud·기대 aud — 이메일·코드·토큰은 남기지 않음 · 애플이 클라이언트를 거절하면 token_invalid_client', async () => {
    await sql`delete from audit_logs where action = 'auth.oauth_failed'`;
    const prof = { sub: 'apple.bad2', email: 'bad2@example.com', aud: 'someone.else' };
    const bad = await apple(new Client(), prof);
    assert.match(bad.searchParams.get('oauth_error') ?? '', /Apple 로그인에 실패했습니다\. 다시 시도해 주세요\. \(id_token\)/);
    const [a1] = await sql`select detail, actor_id from audit_logs where action = 'auth.oauth_failed' order by id desc limit 1`;
    assert.equal(a1.detail.provider, 'apple'); assert.equal(a1.detail.reason, 'id_token'); assert.equal(a1.detail.aud, 'someone.else'); assert.equal(a1.detail.expectAud, SID);
    assert.match(a1.detail.msg, /aud/); assert.equal(a1.actor_id, null);
    const raw = JSON.stringify(a1.detail);
    assert.ok(!raw.includes('bad2@example.com') && !raw.includes(code(prof)) && !raw.includes('rt-apple'), '이메일·인가 코드·토큰 없음');
    forceClient = true;
    try {
      const r = await apple(new Client(), { sub: 'apple.bad3', email: 'bad3@example.com' });
      assert.match(r.searchParams.get('oauth_error') ?? '', /\(token_invalid_client\)/);
      const [a2] = await sql`select detail from audit_logs where action = 'auth.oauth_failed' order by id desc limit 1`;
      assert.equal(a2.detail.reason, 'token_invalid_client'); assert.equal(a2.detail.status, 400); assert.equal(a2.detail.redirect, `${BASE}/api/auth/oauth/apple/callback`);
    } finally { forceClient = false; }
  });

  test('#1094 운영 자가 점검(플랫폼 운영자만): 가짜 코드 → invalid_grant = 정상 / invalid_client = 설정 문제 · 그 밖의 사람은 404 · 비밀값은 돌려주지 않음', async () => {
    assert.equal((await ctx.staffA.client.get('/api/platform/apple-check')).status, 404, '플랫폼 운영자가 아니면 404');
    await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
    try {
      const ok = await ctx.owner.ok('GET', '/api/platform/apple-check');
      assert.equal(ok.configured, true); assert.equal(ok.ok, true); assert.equal(ok.error, 'invalid_grant'); assert.match(ok.verdict, /^정상/);
      assert.deepEqual([ok.servicesId, ok.teamId, ok.keyId, ok.redirectUri], [SID, TEAM, KID, `${BASE}/api/auth/oauth/apple/callback`]);
      const keyBody = PEM.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
      assert.ok(!JSON.stringify(ok).includes(keyBody.slice(20, 60)) && !JSON.stringify(ok).includes('client_secret'), '키 본문·클라이언트 비밀 없음');
      // 로컬 11/21 긴급: 키의 '모양'만 진단(값 없음) — 시험 서버는 운영처럼 글자 \n 한 줄
      assert.deepEqual([ok.keyShape.header, ok.keyShape.literalBackslashN, ok.keyShape.lines, ok.keyShape.readable, ok.keyShape.curve, ok.keyShape.fixedByNormalize], ['PRIVATE KEY', true, 1, true, 'prime256v1', false]);
      assert.equal(seen.token.at(-1).code, 'workin-selfcheck-not-a-real-code'); assert.equal(seen.token.at(-1).cs, true, '실제 로그인과 같은 서명');
      forceClient = true;
      const bad = await ctx.owner.ok('GET', '/api/platform/apple-check');
      assert.equal(bad.ok, false); assert.equal(bad.error, 'invalid_client'); assert.match(bad.verdict, /^설정 문제/);
    } finally { forceClient = false; await sql`update users set platform_admin = false where id = ${ctx.ownerId}`; }
  });

  test('설정 › 계정에서 연결(세션은 GET 단계에서 실림) → 끊기 = Apple 토큰 해지', async () => {
    const to = await apple(ctx.owner, { sub: 'apple.owner', email: 'owner-apple@example.com' }, 'mode=link');
    assert.equal(to.pathname, '/settings'); assert.equal(to.searchParams.get('linked'), 'apple');
    const ids = await ctx.owner.ok('GET', '/api/account/identities');
    assert.ok(ids.identities.some((x) => x.provider === 'apple')); assert.ok(ids.enabled.includes('apple'));
    const n0 = seen.revoke.length;
    await ctx.owner.ok('DELETE', '/api/account/identities?provider=apple');
    assert.equal(seen.revoke.length, n0 + 1); assert.equal(seen.revoke.at(-1).token, 'rt-apple.owner'); assert.equal(seen.revoke.at(-1).cs, true);
    assert.equal(seen.revoke.at(-1).token_type_hint, 'refresh_token');
  });

  test('계정 삭제 = Apple 토큰 해지(응답 뒤) + 연결 지움 → 같은 Apple 계정으로 다시 가입할 수 있음', async () => {
    const n0 = seen.revoke.length;
    await P.c1.ok('POST', '/api/account/delete', { password: '', confirm: '탈퇴합니다' }); // 소셜로만 가입: 방금 로그인한 세션으로 본인 확인
    for (let i = 0; i < 40 && seen.revoke.length === n0; i++) await new Promise((s) => setTimeout(s, 250));
    assert.equal(seen.revoke.length, n0 + 1); assert.equal(seen.revoke.at(-1).token, 'rt-apple.001');
    assert.equal((await sql`select count(*)::int as n from user_identities where subject = 'apple.001'`)[0].n, 0);
    assert.equal((await apple(new Client(), { sub: 'apple.001', email: 'x7k2@privaterelay.appleid.com' })).pathname, '/signup/social', '처음처럼');
  });

  test('Apple 서버 알림: 서명 확인 뒤 연결 끊기(consent-revoked)면 우리 쪽 연결도 지움 · 서명이 틀리면 400', async () => {
    const c = new Client('a3');
    await apple(c, { sub: 'apple.notify', email: 'notify@example.com' }, '', { name: { firstName: 'Jane', lastName: 'Doe' } });
    // 가입 전 단계(연결 없음)라 초대 흐름 대신 직접 연결 하나 만들어 둠
    await sql`insert into user_identities (provider, subject, user_id, email) values ('apple', 'apple.notify', ${ctx.ownerId}, 'notify@example.com')`;
    const events = JSON.stringify({ type: 'consent-revoked', sub: 'apple.notify', event_time: Date.now() });
    const good = await new SignJWT({ events }).setProtectedHeader({ alg: 'RS256', kid: 'apple-test' }).setIssuer(ISS).setAudience(SID).setIssuedAt().setExpirationTime('5m').sign(rsa.privateKey);
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ events }).setProtectedHeader({ alg: 'RS256', kid: 'apple-test' }).setIssuer(ISS).setAudience(SID).setIssuedAt().setExpirationTime('5m').sign(other.privateKey);
    const post = (payload) => fetch(`${BASE}/api/auth/oauth/apple/notify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload }) });
    assert.equal((await post(forged)).status, 400);
    assert.equal((await sql`select count(*)::int as n from user_identities where subject = 'apple.notify'`)[0].n, 1);
    const ok = await post(good); assert.equal(ok.status, 200); assert.equal((await ok.json()).type, 'consent-revoked');
    assert.equal((await sql`select count(*)::int as n from user_identities where subject = 'apple.notify'`)[0].n, 0);
    assert.equal((await fetch(`${BASE}/api/auth/oauth/kakao/notify`, { method: 'POST', body: '{}' })).status, 404);
  });
});
const P = {};
