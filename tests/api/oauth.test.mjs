// V29 소셜 가입·로그인(Google·카카오·네이버) — 가짜 제공자 서버(인가 코드 → 토큰 → 프로필)로 시험. 실제 제공자 연동 확인은 키 등록 후 운영에서
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

const PORT = 3204, FAKE = `http://localhost:${PORT}`;
let fake, srv, sql, ctx;
const seen = [];

// 코드 = base64url(JSON 프로필) — 토큰 = 코드, 프로필 주소가 제공자별 모양으로 돌려줌
function fakeProvider() {
  return http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const j = (o, s = 200) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      const [, , p, step] = req.url.split('?')[0].split('/');
      if (step === 'token') { const f = new URLSearchParams(body); seen.push({ p, f: Object.fromEntries(f) }); return j({ access_token: f.get('code'), token_type: 'bearer' }); }
      if (step === 'me') {
        const prof = JSON.parse(Buffer.from((req.headers.authorization ?? '').slice(7), 'base64url').toString());
        if (p === 'google') return j({ sub: prof.sub, email: prof.email, email_verified: prof.verified !== false, name: prof.name });
        if (p === 'kakao') return j({ id: Number(prof.sub), kakao_account: { email: prof.email, is_email_valid: true, is_email_verified: prof.verified !== false, profile: { nickname: prof.name } } });
        return j({ resultcode: '00', response: { id: prof.sub, email: prof.email, name: prof.name } });
      }
      j({ error: 'nope' }, 404);
    });
  }).listen(PORT);
}
const code = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** 시작 → (제공자 화면 건너뜀) → 콜백. 돌아온 곳(location) */
async function social(c, p, prof, q = '') {
  const s = await c.req('GET', `/api/auth/oauth/${p}/start?${q}`);
  assert.equal(s.status, 303);
  const auth = new URL(s.headers.get('location'));
  assert.equal(auth.origin + auth.pathname, `${FAKE}/oauth/${p}/authorize`);
  assert.equal(auth.searchParams.get('redirect_uri'), `${BASE}/api/auth/oauth/${p}/callback`);
  const st = (s.headers.getSetCookie?.() ?? []).find((x) => x.startsWith('wos_oauth=')).split(';')[0];
  const keep = c.cookie; c.cookie = keep ? `${keep}; ${st}` : st;
  const r = await c.req('GET', `/api/auth/oauth/${p}/callback?code=${code(prof)}&state=${auth.searchParams.get('state')}`);
  if (c.cookie.includes('wos_oauth=')) c.cookie = keep;
  assert.equal(r.status, 303);
  return new URL(r.headers.get('location'), BASE);
}

before(async () => {
  fake = fakeProvider();
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', OAUTH_TEST_BASE: FAKE, GOOGLE_LOGIN_CLIENT_ID: 'g-id', GOOGLE_LOGIN_CLIENT_SECRET: 'g-secret',
    KAKAO_REST_KEY: 'k-id', NAVER_CLIENT_ID: 'n-id', NAVER_CLIENT_SECRET: 'n-secret' });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

describe('V29 소셜 가입·로그인', () => {
  test('버튼 목록 · 처음이면 회사 만들기 → 확인 메일 없이 바로 시작, 그 이메일이 업무 이메일 · 다음부터 버튼 한 번으로 로그인', async () => {
    assert.deepEqual((await new Client().ok('GET', '/api/auth/oauth/providers')).providers, ['google', 'kakao', 'naver']);
    const c = new Client('g1');
    const to = await social(c, 'google', { sub: 'g-100', email: 'Boss@Social.test', name: '소셜대표' }, 'utm_source=naver');
    assert.equal(to.pathname, '/signup/social');
    assert.equal(seen.at(-1).f.client_secret, 'g-secret', '서버에서만 시크릿 사용');
    const t = to.searchParams.get('t');
    const info = await c.ok('GET', `/api/auth/oauth/pending?t=${t}`);
    assert.equal(info.email, 'boss@social.test'); assert.equal(info.name, '소셜대표');
    assert.equal((await c.post('/api/auth/oauth/complete', { token: t, name: '소셜대표', mode: 'team', agree: { terms: true, age14: true, privacy: true } })).status, 400, '팀이면 회사 이름 필요');
    await c.ok('POST', '/api/auth/oauth/complete', { token: t, name: '소셜대표', mode: 'team', company: '소셜회사', size: '2-10', industry: '제조', agree: { terms: true, age14: true, privacy: true, ai: false, marketing: false } });
    const me = await c.ok('GET', '/api/auth/me');
    assert.equal(me.user.email, 'boss@social.test'); assert.equal(me.user.role, 'owner');
    const [u] = await sql`select u.work_email, u.password_hash, u.signup_pending, t.size_band, t.industry, t.signup_utm from users u join tenants t on t.id = u.tenant where u.id = ${me.user.id}`;
    assert.equal(u.work_email, 'boss@social.test'); assert.equal(u.password_hash, null); assert.equal(u.signup_pending, false);
    assert.equal(u.size_band, '2-10'); assert.equal(u.industry, '제조'); assert.equal(u.signup_utm.source, 'naver');
    assert.equal((await c.post('/api/auth/oauth/complete', { token: t, name: 'x', mode: 'personal', agree: { terms: true, age14: true, privacy: true } })).status, 400, '한 번만');
    // 다음 로그인
    const c2 = new Client('g2');
    assert.equal((await social(c2, 'google', { sub: 'g-100', email: 'boss@social.test' })).pathname, '/');
    assert.equal((await c2.ok('GET', '/api/auth/me')).user.id, me.user.id);
    // 비밀번호 없는 사람: 마지막 로그인 방법은 못 끊음
    assert.equal((await c2.req('DELETE', '/api/account/identities?provider=google')).status, 400);
  });

  test('앱(시스템 브라우저) 로그인: 쿠키 대신 1회용 표로 앱 복귀 → 앱 검증값이 맞아야 세션, 한 번만 · 처음 가입·오류도 앱으로', async () => {
    const { createHash } = await import('node:crypto');
    const v = 'a'.repeat(40) + 'verifier-for-app-test', ac = createHash('sha256').update(v).digest('hex');
    const b = new Client('browser');
    const to = await social(b, 'google', { sub: 'g-100', email: 'boss@social.test' }, `client=android&ac=${ac}`);
    assert.equal(to.pathname, '/auth/app-return');
    const t = to.searchParams.get('t'); assert.ok(t);
    assert.equal((await b.req('GET', '/api/auth/me')).status, 401, '브라우저에는 세션 없음');
    const app = new Client('app');
    assert.equal((await app.post('/api/auth/oauth/app-exchange', { t, v: 'b'.repeat(40) })).status, 400, '검증값 다르면 거절(표도 소멸)');
    const to2 = await social(new Client(), 'google', { sub: 'g-100', email: 'boss@social.test' }, `client=android&ac=${ac}`);
    const t2 = to2.searchParams.get('t');
    assert.equal((await app.post('/api/auth/oauth/app-exchange', { t: t2, v })).status, 200);
    assert.equal((await app.ok('GET', '/api/auth/me')).user.email, 'boss@social.test');
    assert.equal((await new Client().post('/api/auth/oauth/app-exchange', { t: t2, v })).status, 400, '한 번만');
    const [s] = await sql`select client from sessions where user_id = (select id from users where email = 'boss@social.test') order by created_at desc limit 1`;
    assert.equal(s.client, 'android');
    // 처음 가입·오류 → 앱으로(회사 만들기 표 / 메시지)
    const p = await social(new Client(), 'kakao', { sub: '9001', email: 'appnew@social.test', name: '앱가입' }, `client=android&ac=${ac}`);
    assert.equal(p.pathname, '/auth/app-return'); assert.ok(p.searchParams.get('pending'));
    const e = await social(new Client(), 'kakao', { sub: '9002', email: null }, `client=android&ac=${ac}`);
    assert.match(e.searchParams.get('error'), /이메일/);
    // 299차 #858·#839: 아이폰 앱은 가입이 없음 — 처음 보는 소셜 계정은 회사 만들기 대신 안내(앱으로)
    const i = await social(new Client(), 'kakao', { sub: '9003', email: 'iosnew@social.test' }, `client=ios&ac=${ac}`);
    assert.equal(i.pathname, '/auth/app-return'); assert.equal(i.searchParams.get('pending'), null);
    assert.match(i.searchParams.get('error'), /회사 관리자의 초대로 만들어집니다/);
  });

  test('같은 이메일의 기존 계정은 자동으로 묶지 않음 · 인증 안 된 이메일·이메일 미동의는 가입 불가 · 상태 위조는 거절', async () => {
    let to = await social(new Client(), 'naver', { sub: 'n-1', email: 'boss@social.test', name: '다른사람' });
    assert.equal(to.pathname, '/login'); assert.equal(to.searchParams.get('code'), 'exists');
    to = await social(new Client(), 'kakao', { sub: '777', email: 'k@social.test', verified: false });
    assert.equal(to.searchParams.get('code'), 'unverified');
    to = await social(new Client(), 'kakao', { sub: '778', email: null });
    assert.equal(to.searchParams.get('code'), 'no_email');
    const r = await new Client().req('GET', `/api/auth/oauth/google/callback?code=${code({ sub: 'x', email: 'x@x.test' })}&state=forged`);
    assert.equal(r.status, 303); assert.match(decodeURIComponent(r.headers.get('location')), /만료/);
    assert.equal((await sql`select count(*)::int n from users where email in ('k@social.test', 'x@x.test')`)[0].n, 0);
  });

  test('설정에서 연결 → 그 버튼으로 로그인 · 이미 다른 계정에 연결된 소셜은 거절 · 연결 끊기', async () => {
    const c = ctx.staffA.client;
    assert.equal((await social(c, 'naver', { sub: 'n-staff', email: 'whatever@naver.test' }, 'mode=link')).pathname, '/settings');
    const ids = await c.ok('GET', '/api/account/identities');
    assert.deepEqual(ids.identities.map((x) => x.provider), ['naver']); assert.equal(ids.hasPassword, true);
    const n = new Client('n');
    assert.equal((await social(n, 'naver', { sub: 'n-staff' })).pathname, '/');
    assert.equal((await n.ok('GET', '/api/auth/me')).user.id, ctx.staffA.id);
    const taken = await social(ctx.owner, 'naver', { sub: 'n-staff' }, 'mode=link');
    assert.equal(taken.searchParams.get('code'), 'taken');
    await c.ok('DELETE', '/api/account/identities?provider=naver');
    assert.equal((await social(new Client(), 'naver', { sub: 'n-staff', email: 'staff-other@naver.test' })).pathname, '/signup/social', '끊으면 모르는 계정');
    assert.ok((await sql`select count(*)::int n from audit_logs where action in ('auth.identity_linked', 'auth.identity_unlinked')`)[0].n >= 2);
  });

  test('초대 링크 → 소셜 한 번으로 합류(초대받은 계정에 연결)', async () => {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'newbie@dagym.test', name: '신입', role: 'staff', orgUnitIds: [ctx.siteA] });
    const token = inv.path.split('/').pop();
    const c = new Client('inv');
    assert.equal((await social(c, 'kakao', { sub: '9001', email: 'newbie.private@kakao.test', name: '신입카톡' }, `invite=${token}`)).pathname, '/');
    const me = await c.ok('GET', '/api/auth/me');
    assert.equal(me.user.email, 'newbie@dagym.test', '초대받은 계정으로');
    assert.equal((await new Client().get(`/api/invitations/${token}`)).status, 400, '초대는 한 번만');
    assert.equal((await sql`select work_email from users where id = ${me.user.id}`)[0].work_email, 'newbie.private@kakao.test');
  });
});
