// 311차 #867(대표 11/01 '페이지별로 홍보 목표를 정해서'): 소개 페이지별 방문 → 체험 가입 → 영업·마케팅 공간 선택.
// 방문 = 페이지 이름만(개인정보·브라우저 id 없음, 같은 브라우저 하루 1번은 브라우저 쪽) · 가입 = 처음 들어온 소개 페이지(utm.page) · 운영자 가입 흐름·주간 보고용 공개 집계(토큰)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const TOKEN = 'funnel-token-867-test-abcdef';
let srv, sql, ctx;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', FUNNEL_STATS_TOKEN: TOKEN });
  sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const view = (page) => fetch(`${BASE}/api/public/landing-view`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page }) });
const agree = { terms: true, age14: true, privacy: true, ai: false, marketing: false };
async function signup(email, company, utm) {
  const c = new Client(`lf-${email}`);
  const r = await c.ok('POST', '/api/auth/signup', { email, name: '가입자', mode: 'team', company, password: 'landing-pass-1234', agree, utm });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  return (await sql`select tenant from users where email = ${email}`)[0].tenant;
}

test('방문 기록: 목록에 있는 소개 페이지(home·landing slug)만 셈 · 이름 형식이 틀리면 400 · 날짜(서울)·페이지별 숫자만 저장', async () => {
  for (let k = 0; k < 2; k++) assert.deepEqual(await (await view('bid-collection')).json(), { ok: true });
  assert.deepEqual(await (await view('home')).json(), { ok: true });
  assert.deepEqual(await (await view('no-such-page')).json(), { ok: false }, '없는 페이지는 안 셈');
  assert.equal((await view('Bad Page!')).status, 400);
  const rows = await sql`select page, n from landing_views order by page`;
  assert.deepEqual(rows.map((r) => [r.page, r.n]), [['bid-collection', 2], ['home', 1]]);
  assert.deepEqual(Object.keys((await sql`select * from landing_views limit 1`)[0]).sort(), ['day', 'n', 'page'], '개인정보 칸 없음');
});

test('가입: 처음 들어온 소개 페이지(utm.page)를 회사에 남김 · 형식이 틀리면 가입 막음 · UTM 없이 페이지만 와도 남김', async () => {
  const c = new Client('lf-bad');
  assert.equal((await c.req('POST', '/api/auth/signup', { email: 'lf-bad@example.com', name: '가입자', mode: 'team', company: '틀린상사', password: 'landing-pass-1234', agree, utm: { page: '../x' } })).status, 400);
  const t1 = await signup('lf1@example.com', '마케팅상사', { source: 'naver', medium: 'cpc', page: 'marketing-automation' });
  const t2 = await signup('lf2@example.com', '입찰상사', { page: 'bid-collection' });
  const t3 = await signup('lf3@example.com', '모름상사', { source: 'instagram' });
  const u = Object.fromEntries((await sql`select id, signup_utm from tenants where id in ${sql([t1, t2, t3])}`).map((r) => [r.id, r.signup_utm]));
  assert.deepEqual(u[t1], { source: 'naver', medium: 'cpc', page: 'marketing-automation' });
  assert.deepEqual(u[t2], { page: 'bid-collection' });
  assert.equal(u[t3].page, undefined);
  // 가입 뒤 공간 선택(관리자 화면에서 켬)
  await sql`update tenants set spaces = array['work','marketing'] where id = ${t1}`;
  await sql`update tenants set spaces = array['work','sales','marketing'] where id = ${t2}`;
});

test('운영자 가입 흐름·공개 집계(토큰): 페이지별 방문 → 체험 가입 → 영업·마케팅 선택 · 첫 페이지 모르는 가입은 따로 · 운영자만', async () => {
  const f = await ctx.owner.ok('GET', '/api/platform/funnel?weeks=4');
  const by = Object.fromEntries(f.byPage.rows.map((r) => [r.page, r]));
  assert.equal(f.byPage.days, 30);
  assert.deepEqual(['home', 'task-management', 'e-approval', 'collaboration', 'marketing-automation', 'bid-collection'].filter((p) => !by[p]), [], '페이지 6줄 모두');
  assert.deepEqual([by['marketing-automation'].label, by['marketing-automation'].signups, by['marketing-automation'].sales, by['marketing-automation'].marketing], ['마케팅 자동화', 1, 0, 1]);
  assert.deepEqual([by['bid-collection'].visits, by['bid-collection'].signups, by['bid-collection'].sales, by['bid-collection'].marketing], [2, 1, 1, 1]);
  assert.deepEqual([by.home.label, by.home.visits, by.home.signups], ['홈(소개)', 1, 0]);
  assert.equal(by['(모름)'].signups, 1, 'UTM 만 있고 페이지 모르는 가입');
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/funnel')).status, 404, '운영자만');
  const pub = await (await fetch(`${BASE}/api/public/funnel`, { headers: { authorization: `Bearer ${TOKEN}` } })).json();
  assert.equal(pub.byPage.rows.find((r) => r.page === 'bid-collection').visits, 2, '주간 보고용 공개 집계에도');
});
