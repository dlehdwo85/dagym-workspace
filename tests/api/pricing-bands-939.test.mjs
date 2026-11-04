// 355차 #939 ①②(대표 11/04 승인): 운영 요금표 1인 요금 → 구간 정액. 업무 1~5인 19,900 · 6~10인 39,900 · 11~20인 69,000 · 21~50인 169,000 · 51인~ 1인 3,900
// / 업무+영업 34,900 · 64,900 · 109,000 · 249,000 · 51인~ 영업 사용자 +7,900 / 저장 10·25·60·150GB · 51인~ 1인 5GB
// / 회사 AI 예산(내부 원) 1인 40회 × 30원 = 1,200원 × 구간 최대 인원(6,000 · 12,000 · 24,000 · 60,000 · 51인~ 1인 1,200) / 마케팅 9,900 · 29,000 · 59,000
// 결제 견적·저장 한도·회사 AI 예산이 같은 구간으로 셈, 예전 1인 요금제는 고객 화면에서 내렸지만 쓰는 회사는 갱신 견적이 됨, 플랫폼 운영에서 구간 숫자 바꾸기(배포 없음)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, cust, tid;
const form = (o) => ({ password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false }, ...o });
const usage = () => cust.ok('GET', '/api/usage');
/** 이 회사에 활성 직원 n명 더(시험용 — 이메일만 다름) */
const addPeople = async (n, tag) => {
  for (let i = 0; i < n; i++) await sql`insert into users (email, name, role, status, tenant) values (${`p${tag}-${i}@bands.test`}, ${`직원${tag}${i}`}, 'staff', 'active', ${tid})`;
};
const active = async () => (await sql`select count(*)::int n from users where tenant = ${tid} and status = 'active'`)[0].n;

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', USD_KRW: '1400' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  cust = new Client('cust-bands');
  const r = await cust.ok('POST', '/api/auth/signup', form({ email: 'boss@bands.test', name: '구간대표', mode: 'team', company: '구간회사' }));
  await cust.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  tid = (await cust.ok('GET', '/api/auth/me')).user.tenant;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('구간 정액 요금(#939 ①②)', () => {
  test('요금표·공개 기준표: 업무·업무+영업 구간, AI 는 원 없이 · 예전 1인 요금제 내림 · 설명·팩 이름에 원분 없음 · 마케팅 금액', async () => {
    const u = await usage();
    assert.deepEqual(u.plans.map((p) => p.code), ['w_work', 'w_sales']);
    const w = u.plans.find((p) => p.code === 'w_work');
    assert.deepEqual(w.bandRows.map((b) => [b.label, b.krw, b.annualKrw, b.storageGb]), [
      ['1~5인', 19900, 191040, 10], ['6~10인', 39900, 383040, 25], ['11~20인', 69000, 662400, 60], ['21~50인', 169000, 1622400, 150], ['51인~', 3900, 37440, 5]]);
    assert.equal(u.plans.find((p) => p.code === 'w_sales').bandRows[4].salesPerUserKrw, 7900);
    assert.doesNotMatch(JSON.stringify(u.plans.map((p) => [p.description, p.bandRows])), /원분|aiBudgetKrw/);
    assert.doesNotMatch(JSON.stringify(u.addons.map((a) => a.name)), /원분/, '팩 이름에 AI 원 금액 없음');
    const trial = (await sql`select description from plans where code = 'trial'`)[0].description;
    assert.doesNotMatch(trial, /원/);
    const pub = await (await fetch(`${BASE}/api/public/ai-plans`)).json();
    assert.deepEqual(pub.plans.map((p) => p.code), ['w_work', 'w_sales']);
    assert.ok(pub.plans.every((p) => p.work.budgetKrw === null && p.work.perUserBudgetKrw === null), '공개 표에 회사 AI 원 예산 없음');
    assert.deepEqual(pub.marketingPlans.map((m) => [m.code, m.price]), [['basic', 9900], ['standard', 29000], ['pro', 59000]]);
    assert.deepEqual((await sql`select public from plans where code in ('w_basic', 'w_standard', 'w_pro')`).map((x) => x.public), [false, false, false]);
  });

  test('업무 1~5인 → 6~10인: 결제 견적·저장·AI 예산이 같은 구간 · 구간 안에서는 인원이 늘어도 그대로 · 대표 화면 구간 표시', async () => {
    await ctx.owner.ok('PUT', `/api/platform/tenants/${tid}`, { planCode: 'w_work', status: 'active' });
    let u = await usage();
    assert.equal(await active(), 1);
    assert.deepEqual([u.subscription.planCode, u.subscription.band?.label, u.subscription.monthlyKrw, u.limits.storageGb], ['w_work', '1~5인', 19900, 10]);
    assert.deepEqual([u.aiBudget.source, u.aiBudget.limitKrw, u.aiBudget.parts.band, u.aiBudget.parts.planKrw], ['plan', 6000, '1~5인', 6000]);
    let b = await cust.ok('GET', '/api/billing');
    const q = (code, cy) => b.quotes.find((x) => x.planCode === code && x.cycle === cy);
    assert.deepEqual([q('w_work', 'monthly').band, q('w_work', 'monthly').amount, q('w_work', 'annual').amount], ['1~5인', Math.round(19900 * 1.1), Math.round(191040 * 1.1)]);
    assert.equal(q('w_sales', 'monthly').amount, Math.round(34900 * 1.1));
    await addPeople(4, 'a'); // 5명 — 같은 구간
    u = await usage();
    assert.deepEqual([u.subscription.band.label, u.subscription.monthlyKrw, u.limits.storageGb, u.aiBudget.limitKrw], ['1~5인', 19900, 10, 6000], '구간 안에서는 그대로');
    await addPeople(1, 'b'); // 6명 → 6~10인
    u = await usage();
    assert.deepEqual([u.subscription.band.label, u.subscription.band.people, u.subscription.monthlyKrw, u.limits.storageGb, u.aiBudget.limitKrw], ['6~10인', 6, 39900, 25, 12000]);
    b = await cust.ok('GET', '/api/billing');
    assert.deepEqual([q('w_work', 'monthly').band, q('w_work', 'monthly').seats, q('w_work', 'monthly').amount], ['6~10인', 6, Math.round(39900 * 1.1)]);
    // 저장 추가 팩은 구간 저장 위에 더함(팩 그대로)
    await ctx.owner.ok('PUT', `/api/platform/tenants/${tid}`, { planCode: 'w_work', addons: { storage50_v27: 1, ai_credit_s: 1 }, status: 'active' });
    u = await usage();
    assert.deepEqual([u.limits.storageGb, u.aiBudget.limitKrw, u.aiBudget.parts.packKrw], [75, 12000 + 4950, 4950]);
    // 80%·100% 판단은 예전과 같은 길(ai/companyBudget — 알림·멈춤 시험은 ai-company-budget) — 구간 예산 기준으로 %가 셈
    await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, purpose) values (${tid}, null, gen_random_uuid(), 'anthropic', 'claude-sonnet-5-5', 1, 1, ${(16950 * 0.85) / 1400}, 'assistant')`;
    let st = await cust.ok('GET', '/api/ai/status');
    assert.equal(st.company.over, false); assert.equal(st.company.pct, 85);
    await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, purpose) values (${tid}, null, gen_random_uuid(), 'anthropic', 'claude-sonnet-5-5', 1, 1, ${(16950 * 0.2) / 1400}, 'assistant')`;
    st = await cust.ok('GET', '/api/ai/status');
    assert.equal(st.company.over, true, '100% 넘으면 AI 만 멈춤'); assert.equal(st.overLimit, true);
    await cust.ok('POST', '/api/tasks', { title: 'AI 멈춰도 업무는 됨' });
    await sql`delete from ai_usage where tenant = ${tid}`;
  });

  test('업무+영업 51인~: 1인 3,900 × 인원 + 영업 사용자(대표·관리자 + 영업 공간 배정) 1인 7,900 · 저장 1인 5GB · AI 1인 1,200원', async () => {
    await ctx.owner.ok('PUT', `/api/platform/tenants/${tid}`, { planCode: 'w_sales', addons: {}, status: 'active' });
    await addPeople(45, 'c'); // 6 + 45 = 51명
    assert.equal(await active(), 51);
    const two = await sql`select id from users where tenant = ${tid} and role = 'staff' order by email limit 2`;
    for (const x of two) await sql`insert into space_members (user_id, tenant, spaces, role) values (${x.id}, ${tid}, ${['work', 'sales']}, 'staff')`;
    const u = await usage();
    const sales = 1 + 2; // 대표 1 + 영업 공간 배정 2
    assert.deepEqual([u.subscription.band.label, u.subscription.monthlyKrw, u.limits.storageGb, u.aiBudget.limitKrw, u.aiBudget.parts.perSeatKrw, u.aiBudget.parts.seats],
      ['51인~', 3900 * 51 + 7900 * sales, 255, 1200 * 51, 1200, 51]);
    const b = await cust.ok('GET', '/api/billing');
    const m = b.quotes.find((x) => x.planCode === 'w_sales' && x.cycle === 'monthly');
    assert.deepEqual([m.band, m.seats, m.amount], ['51인~', 51, Math.round((3900 * 51 + 7900 * sales) * 1.1)]);
    assert.equal(b.quotes.find((x) => x.planCode === 'w_work' && x.cycle === 'monthly').amount, Math.round(3900 * 51 * 1.1), '업무만이면 영업 추가 없음');
    await sql`update users set status = 'disabled' where tenant = ${tid} and email like 'pc-%@bands.test'`; // 다시 6명
    assert.equal((await usage()).subscription.band.label, '6~10인');
  });

  test('플랫폼 운영: 구간 숫자 바꾸기(배포 없이 견적·한도 반영) · 보통 저장 단추는 구간을 지우지 않음 · 예전 1인 요금제 회사는 갱신 견적이 됨 · 고객은 404', async () => {
    const plan = (await ctx.owner.ok('GET', '/api/platform')).plans.find((p) => p.code === 'w_work');
    assert.equal(plan.limits.bands.length, 4);
    await ctx.owner.ok('PUT', `/api/platform/tenants/${tid}`, { planCode: 'w_work', status: 'active' });
    const bands = plan.limits.bands.map((x, i) => (i === 1 ? { ...x, krw: 41900, storageGb: 30 } : x));
    await ctx.owner.ok('PUT', '/api/platform/plans/w_work', { name: '업무', monthlyKrw: 19900, perUserKrw: null, public: true, limits: { ...plan.limits, bands } });
    let u = await usage();
    assert.deepEqual([u.subscription.monthlyKrw, u.limits.storageGb], [41900, 30]);
    // 구간 없이 저장(보통 행 [저장]) → 구간은 그대로
    await ctx.owner.ok('PUT', '/api/platform/plans/w_work', { name: '업무', monthlyKrw: 19900, perUserKrw: null, public: true, limits: { users: null, storageGb: null, aiRequests: null } });
    const after = (await sql`select limits from plans where code = 'w_work'`)[0].limits;
    assert.equal(after.bands[1].krw, 41900); assert.equal(after.overPerUserKrw, 3900);
    assert.equal((await ctx.owner.req('PUT', '/api/platform/plans/w_work', { name: '업무', monthlyKrw: 1, limits: { users: null, storageGb: null, aiRequests: null, bands: [{ upTo: 10, krw: 1, storageGb: 1, aiBudgetKrw: 1 }, { upTo: 5, krw: 1, storageGb: 1, aiBudgetKrw: 1 }] } })).status, 400, '구간 인원은 커지는 순서');
    await ctx.owner.ok('PUT', '/api/platform/plans/w_work', { name: '업무', monthlyKrw: 19900, perUserKrw: null, public: true, limits: { ...plan.limits } });
    u = await usage(); assert.equal(u.subscription.monthlyKrw, 39900);
    assert.equal((await cust.req('PUT', '/api/platform/plans/w_work', { name: 'x', monthlyKrw: 1, limits: { users: null, storageGb: null, aiRequests: null } })).status, 404);
    // 예전 스탠다드(1인 4,500 · 최소 3인)를 쓰는 회사: 고객 요금표엔 없지만 다음 결제 견적은 됨(갱신 결제가 끊기지 않게)
    await ctx.owner.ok('PUT', `/api/platform/tenants/${tid}`, { planCode: 'w_standard', status: 'active' });
    await sql`update tenant_subscriptions set billing_cycle = 'monthly', next_billing_on = current_date + 10 where tenant = ${tid}`;
    const d = await ctx.owner.ok('GET', `/api/platform/tenants/${tid}/detail`);
    assert.equal(d.billing.expectedThisMonth, Math.round(4500 * 6 * 1.1));
    assert.equal((await cust.ok('GET', '/api/billing')).quotes.some((q) => q.planCode === 'w_standard'), false, '새로 고르는 목록에는 없음');
    assert.equal((await cust.req('POST', '/api/usage/request', { planCode: 'w_standard' })).status, 400);
  });
});
