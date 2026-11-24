// 상용화 A4(대표 위임 11/24 '결제와 공간 연결'):
// ① 업무 + 영업(w_sales)으로 결제(전환)되면 영업이 열림(space_grants.sales = 'plan') · 회사 관리자 알림 · 감사 기록
// ② 30일 미납(이용 중지)이면 영업 잠금, 운영자가 잠금을 풀면 다시 열림 · 7일 미납(보기만)은 그대로
// ③ 해지 예약 → 결제일에 만료되면 영업 잠금(자료는 그대로) · 운영자가 연 공간('operator')은 그대로
// ④ 마케팅은 운영자가 회사 상세에서 요금제를 정하면 결제 금액(quote)에 합침 · 빼면 공간은 그대로 · 운영자만
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

let srv, sql, ctx, T;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SPACES_SELF_SERVE: '0' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const c = new Client('ceo@paid-a4.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@paid-a4.test', password: 'signup-pass-1234', name: '정대표', mode: 'team', company: '결제상사', industry: '운동·피트니스', industries: ['운동·피트니스'], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, id: me.user.id, tenant: me.user.tenant };
  await sql`update tenants set signup_status = 'approved' where id = ${T.tenant}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const ten = async () => (await sql`select spaces, space_grants from tenants where id = ${T.tenant}`)[0];
const salesOpen = async () => (await T.c.req('GET', '/api/sales/award-stats')).status !== 404;

test('업무 + 영업 전환 = 영업 열림 · 30일 미납 잠금 → 잠금 풀면 다시 열림 · 해지 만료 = 잠금(운영자가 연 마케팅은 그대로)', async () => {
  assert.equal(await salesOpen(), false, '처음엔 잠김');
  await ctx.owner.ok('POST', `/api/platform/tenants/${T.tenant}/trial`, { action: 'convert', planCode: 'w_sales' });
  let t = await ten();
  assert.ok(t.spaces.includes('sales')); assert.equal(t.space_grants.sales, 'plan');
  assert.equal(await salesOpen(), true, '결제(전환)되면 영업 사용');
  assert.equal((await sql`select title from notifications where user_id = ${T.id} order by created_at desc limit 1`)[0].title, '영업 공간을 열었습니다');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'space.plan_open'`)[0].n, 1);

  // 운영자가 상담 뒤 마케팅을 염 → 'operator'
  await ctx.owner.ok('PUT', `/api/platform/tenants/${T.tenant}/spaces`, { spaces: ['sales', 'marketing'] });
  t = await ten();
  assert.deepEqual([t.space_grants.sales, t.space_grants.marketing], ['plan', 'operator']);
  const d = await ctx.owner.ok('GET', `/api/platform/tenants/${T.tenant}/detail`);
  assert.deepEqual(d.spaceBilling.grants, { sales: 'plan', marketing: 'operator' });

  // 7일 미납(보기만)은 영업도 그대로
  await sql`update tenant_subscriptions set billing_cycle = null, past_due_since = now() - interval '8 days', next_retry_on = null where tenant = ${T.tenant}`;
  await tick();
  assert.equal((await sql`select billing_lock from tenant_subscriptions where tenant = ${T.tenant}`)[0].billing_lock, 'read_only');
  assert.ok((await ten()).spaces.includes('sales'), '7일 미납은 영업 잠그지 않음');
  // 30일 미납(이용 중지) → 영업 잠금
  await sql`update tenant_subscriptions set past_due_since = now() - interval '31 days' where tenant = ${T.tenant}`;
  await tick();
  t = await ten();
  assert.equal(t.spaces.includes('sales'), false, '30일 미납이면 영업 잠금');
  assert.equal(t.space_grants.sales, undefined); assert.ok(t.spaces.includes('marketing'), '운영자가 연 마케팅은 그대로');
  // 운영자가 잠금 해제 → 다시 열림
  await sql`update tenant_subscriptions set past_due_since = null where tenant = ${T.tenant}`;
  await ctx.owner.ok('POST', `/api/platform/tenants/${T.tenant}/billing`, { action: 'unlock' });
  t = await ten();
  assert.ok(t.spaces.includes('sales')); assert.equal(t.space_grants.sales, 'plan');

  // 해지 예약 → 결제일에 만료 → 영업 잠금 · 자료는 그대로
  await sql`insert into sales_work_records (tenant, data) values (${T.tenant}, '{"note":"keep"}'::jsonb)`.catch(() => null);
  const before = (await sql`select count(*)::int n from sales_work_records where tenant = ${T.tenant}`)[0].n;
  await sql`update tenant_subscriptions set billing_cycle = 'monthly', next_billing_on = current_date, cancel_at_period_end = true, past_due_since = null, billing_lock = null where tenant = ${T.tenant}`;
  await tick();
  assert.equal((await sql`select status from tenant_subscriptions where tenant = ${T.tenant}`)[0].status, 'expired');
  t = await ten();
  assert.equal(t.spaces.includes('sales'), false, '해지 만료 = 영업 잠금');
  assert.ok(t.spaces.includes('marketing'), '운영자가 연 마케팅은 그대로');
  assert.equal((await sql`select count(*)::int n from sales_work_records where tenant = ${T.tenant}`)[0].n, before, '자료는 그대로');
  assert.equal((await sql`select title from notifications where user_id = ${T.id} and title = '영업 공간이 잠겼습니다'`).length >= 1, true);
  assert.ok((await sql`select count(*)::int n from audit_logs where action = 'space.plan_lock'`)[0].n >= 2);
});

test('마케팅 요금제(운영자) → 결제 금액에 합침 · 빼면 공간은 그대로 · 운영자만', async () => {
  await sql`update tenant_subscriptions set status = 'active', plan_code = 'w_sales', billing_cycle = null, cancel_at_period_end = false where tenant = ${T.tenant}`;
  assert.equal((await T.c.req('PUT', `/api/platform/tenants/${T.tenant}/mkt-billing`, { planCode: 'standard' })).status, 404, '회사 관리자는 못 정함(없는 화면처럼)');
  const q0 = (await T.c.ok('GET', '/api/billing')).quotes.find((q) => q.cycle === 'monthly');
  assert.equal(q0.marketing, null);

  const r = await ctx.owner.ok('PUT', `/api/platform/tenants/${T.tenant}/mkt-billing`, { planCode: 'standard' });
  assert.equal(r.billed.code, 'standard');
  const [ms] = await sql`select plan_code from mkt_settings where tenant = ${T.tenant}`;
  assert.equal(ms.plan_code, 'standard');
  assert.equal((await ten()).space_grants.marketing, 'plan');
  const b = await T.c.ok('GET', '/api/billing');
  const q1 = b.quotes.find((q) => q.cycle === 'monthly' && q.planCode === q0.planCode);
  const a1 = b.quotes.find((q) => q.cycle === 'annual' && q.planCode === q0.planCode);
  assert.equal(q1.marketing, r.billed.label);
  assert.equal(q1.amount - q0.amount, r.billed.krw, '월 결제에 마케팅 월 금액(부가세 포함 — #1161)을 더함');
  assert.equal(r.billed.krw, 32000, '스탠다드 32,000원');
  assert.ok(a1.amount >= r.billed.krw * 12, '연간은 12개월치');
  const d = await ctx.owner.ok('GET', `/api/platform/tenants/${T.tenant}/detail`);
  assert.equal(d.spaceBilling.mktBilled.code, 'standard');
  assert.ok(d.spaceBilling.mktPlans.length >= 3);

  await ctx.owner.ok('PUT', `/api/platform/tenants/${T.tenant}/mkt-billing`, { planCode: null });
  const t = await ten();
  assert.equal(t.space_grants.marketing, 'operator', '결제에서 빼도 공간은 그대로(운영자가 연 것으로)');
  assert.ok(t.spaces.includes('marketing'));
  assert.equal((await T.c.ok('GET', '/api/billing')).quotes.find((q) => q.cycle === 'monthly').marketing, null);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'platform.mkt_billing'`)[0].n, 2);
});
