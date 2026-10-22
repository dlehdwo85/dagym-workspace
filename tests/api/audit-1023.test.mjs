// 로컬 10/23 전수 점검(클라우드 누락·회귀): #77 처음 사용 안내 기록 API · #449 가입 전환 태그(플랫폼 운영에서 넣으면 가입 화면에 바로) · #436 '음성 등록' 문구
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('#77 처음 사용 안내: 사람별 본 기록(봤음·다시 보기 초기화) · 모르는 투어 400 · 시험 서버는 자동으로 안 띄움', async () => {
  let r = await ctx.staffA.client.ok('GET', '/api/tours');
  assert.deepEqual(r.seen, []); assert.equal(r.auto, false, 'TOURS_AUTO=0(시험 서버)');
  await ctx.staffA.client.ok('POST', '/api/tours', { tourId: 'home' });
  await ctx.staffA.client.ok('POST', '/api/tours', { tourId: 'tasks' });
  await ctx.staffA.client.ok('POST', '/api/tours', { tourId: 'home' }); // 두 번 눌러도 한 줄
  r = await ctx.staffA.client.ok('GET', '/api/tours');
  assert.deepEqual(r.seen.sort(), ['home', 'tasks']);
  assert.deepEqual((await ctx.owner.ok('GET', '/api/tours')).seen, [], '다른 사람 기록과 섞이지 않음');
  assert.equal((await ctx.staffA.client.post('/api/tours', { tourId: 'nope' })).status, 400);
  await ctx.staffA.client.ok('DELETE', '/api/tours');
  assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/tours')).seen, [], '[사용 안내 다시 보기] = 초기화');
  assert.equal((await new Client('anon-tour').get('/api/tours')).status, 401);
});

test('#449 가입 전환 태그: 플랫폼 운영자만 저장(형식 검사) → 가입 화면(GET /api/auth/signup)에 바로 · 비우면 빌드 값', async () => {
  const pub = async () => (await (await fetch(BASE + '/api/auth/signup')).json());
  assert.deepEqual((await pub()).tags, { googleAds: '', ga4: '', metaPixel: '', naverWa: '' });
  assert.equal((await ctx.staffA.client.get('/api/platform/conversion-tags')).status, 404);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/platform/conversion-tags', { googleAds: 'AW-123456789/AbCdEf123' })).status, 404);
  const bad = await ctx.owner.req('PUT', '/api/platform/conversion-tags', { googleAds: 'AW-123456789' });
  assert.equal(bad.status, 400, '라벨 없는 전환 ID 는 거절');
  assert.equal((await ctx.owner.req('PUT', '/api/platform/conversion-tags', { ga4: 'UA-1234' })).status, 400);
  const v = await ctx.owner.ok('PUT', '/api/platform/conversion-tags', { googleAds: 'AW-123456789/AbCdEf123', ga4: 'G-TEST1234' });
  assert.equal(v.tags.googleAds, 'AW-123456789/AbCdEf123'); assert.ok(v.updatedAt);
  const p = await pub();
  assert.equal(p.enabled, true);
  assert.deepEqual(p.tags, { googleAds: 'AW-123456789/AbCdEf123', ga4: 'G-TEST1234', metaPixel: '', naverWa: '' });
  // 일부만 바꾸면 나머지는 그대로, 빈 칸으로 보내면 지움
  await ctx.owner.ok('PUT', '/api/platform/conversion-tags', { metaPixel: '123456789012345' });
  assert.equal((await pub()).tags.googleAds, 'AW-123456789/AbCdEf123');
  await ctx.owner.ok('PUT', '/api/platform/conversion-tags', { googleAds: '', ga4: '', metaPixel: '' });
  assert.deepEqual((await pub()).tags, { googleAds: '', ga4: '', metaPixel: '', naverWa: '' });
  const [a] = await sql`select count(*)::int as n from audit_logs where action = 'platform.conversion_tags'`;
  assert.ok(a.n >= 3, '감사 기록');
});

test('#436 "말로 등록" 문구 없음 — 소개 사이트·개인정보 처리방침은 "음성 등록"', async () => {
  for (const path of ['/welcome', '/privacy']) {
    const html = await (await fetch(BASE + path)).text();
    assert.ok(!html.includes('말로 등록') && !html.includes('말로 업무 등록'), `${path} 에 '말로 등록' 없음`);
  }
  assert.match(await (await fetch(BASE + '/welcome')).text(), /음성 등록/);
});
