// V41 4-1 마케팅 운영실 SSO(F-6): 1회용 서명 토큰(60초)·운영실 서버 확인(공유 비밀값 헤더)·같은 토큰 두 번 거부·위조 거부·마케팅 공간 없는 사람 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const SECRET = 'x'.repeat(40);
let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer({ MARKETING_SSO_SECRET: SECRET, MARKETING_SSO_URL: 'https://mkt.example.test/api/sso/workin', PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const verify = (token, secret = SECRET) => fetch(`${BASE}/api/sso/marketing/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sso-secret': secret }, body: JSON.stringify({ token }) });

test('SSO 토큰 발급·확인', async () => {
  assert.equal((await ctx.owner.get('/api/sso/marketing')).status, 404, '마케팅 공간을 안 켰으면 404');
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const r = await ctx.owner.get('/api/sso/marketing');
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://mkt.example.test/api/sso/workin');
  const token = loc.searchParams.get('token');
  assert.equal((await verify(token, 'y'.repeat(40))).status, 403, '비밀값 틀리면 403');
  const [b, s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, 'base64url')), role: 'owner', sub: ctx.staffA.id })).toString('base64url') + '.' + s;
  assert.equal((await verify(forged)).status, 401, '바꾼 토큰 거부');
  const ok = await verify(token);
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.user.id, ctx.ownerId); assert.equal(j.tenant, 'default'); assert.ok(j.spaces.includes('marketing'));
  assert.equal((await verify(token)).status, 401, '같은 토큰 두 번째 거부');
  assert.equal((await ctx.staffA.client.get('/api/sso/marketing')).status, 404, '마케팅 미배정 직원');
  // 만료
  const r2 = new URL((await ctx.owner.get('/api/sso/marketing')).headers.get('location')).searchParams.get('token');
  await sql`update sso_tokens set expires_at = now() - interval '1 second'`;
  assert.equal((await verify(r2)).status, 401, '만료(서버 기록)');
});

test('416차 G-58: 이 바로가기는 기본 회사 전용 — 다른 회사는 마케팅 공간을 켜도 404(이름·메일이 든 토큰을 외부 앱으로 보내지 않음)', async () => {
  const c = new Client('ceo@sso-1026.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@sso-1026.test', password: 'signup-pass-1234', name: '새대표', mode: 'team', company: '다른회사', industry: '기타', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  await c.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const before = (await sql`select count(*)::int as n from sso_tokens`)[0].n;
  const res = await c.get('/api/sso/marketing');
  assert.equal(res.status, 404); assert.equal(res.headers.get('location'), null);
  assert.equal((await sql`select count(*)::int as n from sso_tokens`)[0].n, before, '토큰을 만들지 않음');
  // 기본 회사는 그대로 302
  assert.equal((await ctx.owner.get('/api/sso/marketing')).status, 302);
});
