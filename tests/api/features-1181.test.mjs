// #1181 상업화 마감 4번 · #1175 회사별 기능 켜기(설계 docs/research/COMMERCIAL_DESIGN_2026-11-26.md B, DB 289)
// ① 기본값 = 지금 동작(점검 켬) ② 회사 관리자가 점검을 끄면 대표까지 점검 API·직원 공유 기준 모두 404 · 다시 켜면 그대로
// ③ 직원은 못 바꿈(403) · 운영사 전용 기능·베타는 고객이 못 바꿈 ④ 운영자: 회사별 기능 표 · 기본값으로 · 베타 켜기 · 감사 기록 ⑤ 다른 회사(기본 회사)는 영향 없음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`; });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const agree = { terms: true, age14: true, privacy: true, ai: true };

test('점검 끄기·켜기(회사 관리자) · 운영자 기능 표·베타 · 다른 회사 영향 없음', async () => {
  const c = new Client('ceo@feat-1181.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@feat-1181.test', password: 'signup-pass-1234', name: '대표', mode: 'team', company: '기능상사', industry: 'IT·소프트웨어', agree });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const [t] = await sql`select tenant from users where email = 'ceo@feat-1181.test'`; const T = t.tenant;
  await sql`update tenants set signup_status = 'approved' where id = ${T}`;
  const unit = (await c.ok('GET', '/api/admin/org-units')).units[0].id;
  const inv = await c.ok('POST', '/api/admin/users', { email: 'st@feat-1181.test', name: '직원', role: 'staff', orgUnitIds: [unit] });
  const st = new Client('st-feat'); await st.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'signup-pass-1234', ai: true });

  // ① 기본값 = 켬(지금 동작)
  const f0 = (await c.ok('GET', '/api/admin/features')).features;
  assert.deepEqual(f0.map((x) => [x.key, x.on]), [['check', true]]);
  assert.equal((await c.req('GET', '/api/check/categories')).status, 200);
  assert.equal((await st.req('GET', '/api/check/shared')).status, 200, '직원 공유 기준');
  // ③ 직원은 못 바꿈 · 모르는 기능·베타는 고객이 못 바꿈
  assert.equal((await st.req('PUT', '/api/admin/features', { key: 'check', on: false })).status, 403);
  assert.equal((await c.req('PUT', '/api/admin/features', { key: 'beta:newui', on: true })).status, 400);
  assert.equal((await c.req('PUT', '/api/admin/features', { key: 'nope', on: true })).status, 400);
  // ② 끄기 → 대표·직원 모두 점검 API 404
  await c.ok('PUT', '/api/admin/features', { key: 'check', on: false });
  assert.equal((await c.req('GET', '/api/check/categories')).status, 404, '대표도 없음');
  assert.equal((await st.req('GET', '/api/check/shared')).status, 404, '직원 공유 기준도 없음');
  // ⑤ 기본 회사는 그대로
  assert.equal((await ctx.owner.req('GET', '/api/check/categories')).status, 200, '다른 회사(기본 회사) 영향 없음');
  // 다시 켜면 그대로
  await c.ok('PUT', '/api/admin/features', { key: 'check', on: true });
  assert.equal((await c.req('GET', '/api/check/categories')).status, 200);

  // ④ 운영자: 기능 표 · 끄기 → 기본값으로 · 베타
  assert.equal((await c.req('GET', `/api/platform/tenants/${T}/features`)).status, 404, '운영자만');
  await ctx.owner.ok('PUT', `/api/platform/tenants/${T}/features`, { key: 'check', on: false, note: '시험' });
  let pf = (await ctx.owner.ok('GET', `/api/platform/tenants/${T}/features`)).features;
  assert.deepEqual(pf.map((x) => [x.key, x.on, x.changed]), [['check', false, true]]);
  await ctx.owner.ok('PUT', `/api/platform/tenants/${T}/features`, { key: 'check', on: null });
  await ctx.owner.ok('PUT', `/api/platform/tenants/${T}/features`, { key: 'beta:newui', on: true, note: '새 화면 미리 보기' });
  pf = (await ctx.owner.ok('GET', `/api/platform/tenants/${T}/features`)).features;
  assert.deepEqual(pf.map((x) => [x.key, x.on, x.changed]), [['check', true, false], ['beta:newui', true, true]]);
  assert.deepEqual((await c.ok('GET', '/api/admin/features')).features.map((x) => x.key), ['check'], '고객 화면에는 베타·운영사 전용 없음');
  const acts = await sql`select count(*)::int n from audit_logs where action = 'feature.set' and target_id = ${T}`;
  assert.equal(acts[0].n, 5, '바꿀 때마다 감사 기록(고객 끄기·켜기 + 운영자 끄기·기본값·베타)');
});
