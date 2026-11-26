// 상업화 마감 F4(새 고객사 흐름 점검 빈틈 — 마케팅 요금제가 정해지지 않은 회사는 자동 제작 화면에 '제한 없음·한도 없음'이 보이고 사진·영상 생성 크레딧 한도가 없었음):
// ① 운영자가 회사 상세에서 마케팅을 열면 한도 요금제를 함께 정함(고르지 않으면 베이직) — 결제에 합치는 것(mkt-billing)과는 따로, 이미 요금제가 있으면 그대로
// ② 요금제 미정 고객 회사: 자동 제작 응답 production.undecided · AI 한도 표 마케팅 줄 = '요금제 미정' 설명 + 회사 AI 예산 %(제한 없음 아님) · 사진·영상 생성 가능 수 0
// ③ 열린 마케팅의 미정 요금제는 운영자가 나중에 정함(mktPlan) · 회사 관리자는 못 바꿈
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SPACES_SELF_SERVE: '0' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const c = new Client('ceo@f4-1127.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@f4-1127.test', password: 'signup-pass-1234', name: '대표', mode: 'team', company: '마케팅상사', industry: 'IT·소프트웨어', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, tenant: me.user.tenant };
  await sql`update tenants set signup_status = 'approved' where id = ${T.tenant}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const plan = async () => (await sql`select plan_code from mkt_settings where tenant = ${T.tenant}`)[0]?.plan_code ?? null;

test('운영자가 마케팅을 열면 한도 요금제 베이직(고르지 않으면) · 결제에는 안 합침 · 이미 있으면 그대로', async () => {
  assert.equal(await plan(), null);
  const r = await ctx.owner.ok('PUT', `/api/platform/tenants/${T.tenant}/spaces`, { spaces: ['marketing'] });
  assert.equal(r.mktPlan, 'basic');
  assert.equal(await plan(), 'basic');
  const [t] = await sql`select space_grants from tenants where id = ${T.tenant}`;
  assert.equal(t.space_grants.marketing, 'operator', '결제로 연 것이 아님');
  const [a] = await sql`select detail from audit_logs where action = 'platform.tenant_spaces' order by created_at desc limit 1`;
  assert.equal(a.detail.mktPlan, 'basic');
  const d = await ctx.owner.ok('GET', `/api/platform/tenants/${T.tenant}/detail`);
  assert.deepEqual([d.spaceBilling.mktPlanCode, d.spaceBilling.mktBilled], ['basic', null]);
  const auto = await T.c.ok('GET', '/api/marketing/auto');
  assert.deepEqual([auto.production.undecided, auto.production.planLabel], [false, '베이직']);
  assert.equal(auto.limits.monthlyCredits, 30, '베이직 월 크레딧');
  // 이미 요금제가 있으면 운영자가 다시 저장해도 그대로(바꾸기는 결제 요금제·사용량 화면)
  await ctx.owner.ok('PUT', `/api/platform/tenants/${T.tenant}/spaces`, { spaces: ['marketing'], mktPlan: 'pro' });
  assert.equal(await plan(), 'basic');
});

test('요금제 미정 고객 회사: 자동 제작 undecided · AI 한도 표 마케팅 = 미정 설명 + 회사 예산 % · 생성 가능 0 → 운영자가 정하면 풀림 · 회사 관리자는 못 정함', async () => {
  await sql`update mkt_settings set plan_code = null, monthly_credits = null where tenant = ${T.tenant}`;
  const auto = await T.c.ok('GET', '/api/marketing/auto');
  assert.equal(auto.production.undecided, true);
  assert.deepEqual([auto.production.planCode, auto.production.leftCredits], [null, null]);
  const L = (await T.c.ok('GET', '/api/usage')).aiLimits;
  const m = L.rows.find((x) => x.key === 'marketing');
  assert.match(m.note, /^요금제 미정 — 글은 회사 AI 예산 안에서, 사진·영상 생성은 요금제를 정한 뒤/);
  assert.notEqual(m.pct, null, '제한 없음 대신 회사 AI 예산 %');
  assert.equal(m.pct, L.rows.find((x) => x.key === 'work').pct);
  assert.deepEqual(m.feel.filter((f) => f.unit === '장' || f.unit === '편').map((f) => f.n), [0, 0], '사진·영상 생성 가능 수 0');
  // 회사 관리자는 요금제를 못 정함(#1139 A1 그대로)
  assert.equal((await T.c.req('PUT', '/api/marketing/auto', { planCode: 'basic' })).status, 403);
  assert.equal((await T.c.req('PUT', `/api/platform/tenants/${T.tenant}/spaces`, { spaces: ['marketing'], mktPlan: 'basic' })).status >= 400, true);
  // 운영자가 열린 마케팅의 미정 요금제를 정함
  const r = await ctx.owner.ok('PUT', `/api/platform/tenants/${T.tenant}/spaces`, { spaces: ['marketing'], mktPlan: 'standard' });
  assert.equal(r.mktPlan, 'standard');
  const a2 = await T.c.ok('GET', '/api/marketing/auto');
  assert.deepEqual([a2.production.undecided, a2.production.planLabel, a2.limits.monthlyCredits], [false, '스탠다드', 80]);
  // 우리 회사(내부)는 요금제가 없어도 미정으로 보지 않음
  await sql`delete from mkt_settings where tenant = 'default'`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true }).catch(() => {});
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/auto')).production.undecided, false);
});
