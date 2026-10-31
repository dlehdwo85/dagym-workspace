// 대표 10/24 ②: 요금제별 회사 월 AI 예산(원) — 체험 5,000원·1인 금액 × 결제 인원 + 마케팅 요금제 AI 몫 + AI 팩, 80% 알림·100% 멈춤(다음 달 1일 안내),
// 영상 제작 AI 는 셈에서 뺌, 플랫폼 운영에서 요금제 금액·회사별 조정(무제한), 대표 한도(원)가 낮으면 그 값, 예전 요금제(우리 회사)는 예전 달러 한도 (가짜 Anthropic)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, FAKE } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, sql, ctx, cust, custTenant, custOwnerId;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 10 } });
const form = (o) => ({ password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false }, ...o });
/** 회사 이번 달 AI 사용 기록(사람 없음 — 사람별 한도와 섞이지 않게). 1,400원/$ */
const spend = (usd, purpose = 'assistant') => sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, purpose)
  values (${custTenant}, null, gen_random_uuid(), 'anthropic', 'claude-sonnet-5-5', 1, 1, ${usd}, ${purpose})`;
const budget = async () => (await cust.ok('GET', '/api/usage')).aiBudget;

before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', USD_KRW: '1400' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  cust = new Client('cust-ai');
  const r = await cust.ok('POST', '/api/auth/signup', form({ email: 'boss@ai-budget.test', name: '예산대표', mode: 'team', company: '예산회사' }));
  await cust.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await cust.ok('GET', '/api/auth/me');
  custTenant = me.user.tenant; custOwnerId = me.user.id;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('회사 월 AI 예산(원)', () => {
  test('14일 체험 = 회사 월 5,000원(요청 횟수 한도 없음) · 사용량 화면 게이지 · AI 상태(대표에게만 금액)', async () => {
    const u = await cust.ok('GET', '/api/usage');
    assert.equal(u.subscription.planCode, 'trial');
    assert.equal(u.limits.aiRequests, null, '원 예산 요금제는 요청 횟수로 멈추지 않음(192)');
    assert.equal(u.aiBudget.source, 'plan'); assert.equal(u.aiBudget.limitKrw, 5000); assert.equal(u.aiBudget.usedKrw, 0); assert.equal(u.aiBudget.pct, 0);
    assert.match(u.aiBudget.resetLabel, /^\d{1,2}월 1일$/); assert.match(u.aiBudget.resetOn, /^\d{4}-\d{2}-01$/);
    const st = await cust.ok('GET', '/api/ai/status');
    assert.equal(st.company.pct, 0); assert.equal(st.company.over, false); assert.equal(st.company.limitKrw, 5000);
    // 요금제 표(플랫폼 운영): 체험 고정 5,000원 · 베이직·스탠다드·프로 1인 금액(초안)
    const p = await ctx.owner.ok('GET', '/api/platform');
    const lim = Object.fromEntries(p.plans.map((x) => [x.code, x.limits]));
    assert.equal(lim.trial.aiBudgetKrw, 5000); assert.equal(lim.trial.aiRequests, undefined);
    assert.deepEqual([lim.w_basic.perUserAiBudgetKrw, lim.w_standard.perUserAiBudgetKrw, lim.w_pro.perUserAiBudgetKrw], [500, 1200, 3000]);
    assert.equal(lim.w_basic.perUserAi, undefined, '요청 횟수 한도는 비움');
  });

  test('80% 알림(대표·관리자, 한 번) → 100% 멈춤 429 ai_budget(다음 달 1일 다시 채워짐) · 영상 제작 AI 는 셈에서 뺌', async () => {
    await spend(3); // 4,200원 = 84%
    await spend(10, 'marketing_video_qa'); await spend(10, 'marketing_video_plan'); // 영상 제작 몫 — 예산 밖
    let b = await budget();
    assert.equal(b.usedKrw, 4200, '영상 제작 AI 는 빼고 셈'); assert.equal(b.pct, 84); assert.equal(b.over, false);
    await ctl({ anthropicReset: true, anthropicQueue: [say('네, 정리해 드릴게요')] });
    await cust.ok('POST', '/api/ai/chat', { text: '이번 주 할 일 정리해줘' });
    const n80 = await sql`select title, body from notifications where user_id = ${custOwnerId} and dedupe_key like 'ai_budget:%'`;
    assert.equal(n80.length, 1); assert.equal(n80[0].title, 'AI 예산 80% 사용'); assert.match(n80[0].body, /5,000원 중 4,2\d\d원\(8\d%\)/); assert.match(n80[0].body, /\d+월 1일까지 AI 기능만 멈춥니다/);
    await cust.ok('GET', '/api/ai/status'); // 다시 불러도 알림은 한 번
    assert.equal((await sql`select count(*)::int n from notifications where user_id = ${custOwnerId} and dedupe_key like 'ai_budget:%:80'`)[0].n, 1);
    await spend(1); // 5,600원 = 112%
    const st = await cust.ok('GET', '/api/ai/status');
    assert.equal(st.overLimit, true); assert.equal(st.company.over, true); assert.match(st.company.message, /회사 AI 사용량을 모두 써서 AI 기능을 멈췄습니다 — \d+월 1일에 다시 채워집니다/);
    const r = await cust.req('POST', '/api/ai/chat', { text: '하나 더 부탁해' });
    assert.equal(r.status, 429); assert.equal(r.body.error.code, 'ai_budget');
    assert.match(r.body.error.message, /\d+월 1일에 다시 채워집니다/); assert.match(r.body.error.message, /업무·일정 등 다른 기능은 그대로/);
    assert.doesNotMatch(r.body.error.message, /5,000원|\$/, '직원에게는 금액 없이');
    const n100 = await sql`select title, body from notifications where user_id = ${custOwnerId} and dedupe_key like 'ai_budget:%:100'`;
    assert.equal(n100.length, 1); assert.equal(n100[0].title, '이번 달 AI 예산을 모두 썼습니다'); assert.doesNotMatch(n100[0].body, /크레딧 팩|요금제/, '298차 #861: 알림(앱에도 뜸)에 구매 권유 없음');
    b = await budget(); assert.equal(b.over, true); assert.equal(b.leftKrw, 0);
    // 업무는 그대로
    await cust.ok('POST', '/api/tasks', { title: 'AI 멈춰도 업무는 됨' });
  });

  test('플랫폼 운영: 회사별 조정(금액·무제한·지우기) → 요금제 바꾸면 1인 금액 × 결제 인원 + AI 팩 + 마케팅 요금제 몫, 요금제 금액도 배포 없이', async () => {
    await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/limits`, { aiBudgetKrw: 20000 });
    let b = await budget(); assert.equal(b.source, 'override'); assert.equal(b.limitKrw, 20000); assert.equal(b.over, false);
    await ctl({ anthropicReset: true, anthropicQueue: [say('다시 됩니다')] });
    await cust.ok('POST', '/api/ai/chat', { text: '다시 질문' });
    await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/limits`, { aiBudgetKrw: null });
    b = await budget(); assert.equal(b.source, 'unlimited'); assert.equal(b.limitKrw, null); assert.equal(b.pct, null);
    await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/limits`, { clear: ['aiBudgetKrw'] });
    b = await budget(); assert.equal(b.source, 'plan'); assert.equal(b.limitKrw, 5000);
    // 유료 전환(스탠다드) + AI 크레딧 S 팩 1개: 1인 1,200원 × 3명(최소 인원) + 4,950원
    await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}`, { planCode: 'w_standard', addons: { ai_credit_s: 1 }, status: 'active' });
    b = await budget();
    assert.deepEqual([b.limitKrw, b.parts.perSeatKrw, b.parts.seats, b.parts.packKrw, b.parts.mktKrw], [3600 + 4950, 1200, 3, 4950, 0]);
    // 마케팅 요금제(스탠다드, AI $6)를 고르면 그 몫을 더함
    await sql`insert into mkt_settings (tenant, plan_code) values (${custTenant}, 'standard') on conflict (tenant) do update set plan_code = 'standard'`;
    b = await budget(); assert.equal(b.parts.mktKrw, 8400); assert.equal(b.limitKrw, 3600 + 4950 + 8400);
    // 요금제 표에서 1인 금액 바꾸기(배포 없음)
    await ctx.owner.ok('PUT', '/api/platform/plans/w_standard', { name: '스탠다드', monthlyKrw: 0, perUserKrw: 4500,
      limits: { users: null, storageGb: null, aiRequests: null, perUserStorageGb: 10, perUserAiBudgetKrw: 2000 } });
    b = await budget(); assert.equal(b.limitKrw, 6000 + 4950 + 8400);
    // 운영 목록·상세에 같은 값
    const l = await ctx.owner.ok('GET', `/api/platform/tenants?q=${encodeURIComponent('예산회사')}`);
    assert.equal(l.tenants[0].ai_budget.limitKrw, 19350); assert.equal(l.tenants[0].ai_budget.source, 'plan');
    const d = await ctx.owner.ok('GET', `/api/platform/tenants/${custTenant}/detail`);
    assert.deepEqual([d.aiBudget.parts.perSeatKrw, d.aiBudget.parts.seats, d.aiBudget.parts.mktKrw, d.aiBudget.parts.packKrw], [2000, 3, 8400, 4950]);
    // 요금제별 기준표(고객·소개 사이트 같은 데이터): 1인 금액·팩 원
    const m = (await cust.ok('GET', '/api/usage')).aiLimits;
    assert.equal(m.plans.plans.find((p) => p.code === 'w_standard').work.perUserBudgetKrw, 2000);
    assert.equal(m.plans.packs.find((a) => a.code === 'ai_credit_s').aiBudgetKrw, 4950);
    assert.equal(m.budget.limitKrw, 19350);
    assert.equal((await cust.req('PUT', `/api/platform/tenants/${custTenant}/limits`, { aiBudgetKrw: 999999 })).status, 404, '고객은 운영 화면 없음');
  });

  test('대표가 AI 설정에서 원으로 한도를 낮추면 그 값에서 멈춤, 비우면 요금제 예산 그대로 — 직원은 못 바꿈', async () => {
    await cust.ok('PUT', '/api/ai/limit', { monthlyKrw: 7000 });
    let b = await budget(); assert.equal(b.parts.ownerCapKrw, 7000); assert.equal(b.limitKrw, 7000);
    await cust.ok('PUT', '/api/ai/limit', { clear: true });
    b = await budget(); assert.equal(b.parts.ownerCapKrw, null); assert.equal(b.limitKrw, 19350);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/ai/limit', { monthlyKrw: 1 })).status, 403);
    assert.equal((await cust.req('PUT', '/api/ai/limit', {})).status, 400);
  });

  test('요금제에 원 예산이 없는 우리 회사(internal)는 예전 회사 월 한도($ → 원) 그대로', async () => {
    const [cap] = await sql`select monthly_usd::float8 usd from ai_limits where tenant = 'default'`;
    const u = await ctx.owner.ok('GET', '/api/usage');
    assert.equal(u.aiBudget.source, 'legacy'); assert.equal(u.aiBudget.limitKrw, Math.round((cap?.usd ?? 30) * 1400));
  });
});
