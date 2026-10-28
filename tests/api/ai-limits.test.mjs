// 대표 10/21 14:30 (#412): 업무 AI 비서·영업 AI 세일즈·마케팅 AI 마케터 한도 → 쓴 양 → 남은 양 한 표(체감 단위) + 요금제별 기준표(한 데이터) + 플랫폼 회사별 잔여·원가/마진 한 줄
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE, FAKE } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } });
before(async () => {
  await resetDb(); fake = await startFakeGoogle(); srv = await startServer({ MAIL_DEV: '1', USD_KRW: '1400' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('사용량·요금제: 세 AI 줄 — 공간별 쓴 양(purpose 로 구분)·회사 공유 한도·마케팅 크레딧·체감 환산, 요금제별 기준표', async () => {
  await sql`delete from ai_usage`;
  await sql`insert into ai_limits (tenant, monthly_usd) values ('default', 10) on conflict (tenant) do update set monthly_usd = 10`;
  await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, purpose, created_at) values
    ('default', ${ctx.ownerId}, gen_random_uuid(), 'anthropic', 'claude-haiku-5-5', 1, 1, 1, 'assistant', now()),
    ('default', ${ctx.ownerId}, gen_random_uuid(), 'anthropic', 'claude-haiku-5-5', 1, 1, 0.5, 'mail_draft', now()),
    ('default', ${ctx.staffA.id}, gen_random_uuid(), 'anthropic', 'claude-haiku-5-5', 1, 1, 2, 'sales_assistant', now()),
    ('default', ${ctx.staffA.id}, gen_random_uuid(), 'anthropic', 'claude-haiku-5-5', 1, 1, 0.25, 'sales_setup', now()),
    ('default', ${ctx.ownerId}, gen_random_uuid(), 'anthropic', 'claude-haiku-5-5', 1, 1, 1.5, 'marketing_produce', now()),
    ('default', ${ctx.ownerId}, gen_random_uuid(), 'anthropic', 'claude-haiku-5-5', 1, 1, 0.75, 'marketing_assistant', now())`;
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'standard' });
  await sql`insert into mkt_credit_ledger (tenant, kind, credits, note) values ('default', 'generate_image', 13, '시험'), ('default', 'generate_video', 20, '시험')`;
  const u = await ctx.owner.ok('GET', '/api/usage');
  const L = u.aiLimits; assert.ok(L, 'aiLimits');
  assert.deepEqual(L.rows.map((r) => r.key), ['work', 'sales', 'marketing']);
  assert.deepEqual(L.rows.map((r) => r.name), ['AI 비서', 'AI 세일즈', 'AI 마케터'], 'AI 명칭 통일');
  const [w, s, m] = L.rows;
  assert.equal(w.used.requests, 2); assert.equal(w.used.usd, 1.5);
  assert.equal(s.used.requests, 2); assert.equal(s.used.usd, 2.25);
  assert.equal(m.used.requests, 2); assert.equal(m.used.usd, 2.25); assert.equal(m.used.credits, 33); assert.equal(m.used.videos, 1);
  // 업무·영업 = 회사 공유 주머니: 한도 $10, 쓴 합계 $6(마케팅 포함) → 남은 $4, 요청 수는 내부 회사라 무제한
  assert.equal(w.limit.usd, 10); assert.equal(w.left.usd, 4); assert.equal(s.left.usd, 4); assert.equal(w.limit.requests, null); assert.equal(w.left.requests, null);
  assert.equal(w.pct, 60); assert.equal(s.shared, true);
  // 마케팅 스탠다드: 월 80크레딧 · AI $6 → 남은 47크레딧 = 시안 7장(6.5) 또는 영상 0편(80), 마케팅 AI 남은 $3.75
  assert.equal(m.planLabel, '스탠다드'); assert.equal(m.limit.credits, 80); assert.equal(m.left.credits, 47); assert.equal(m.limit.usd, 6); assert.equal(m.left.usd, 3.75);
  const feel = Object.fromEntries(m.feel.map((f) => [f.label, f.n]));
  assert.equal(feel['시안 이미지'], 7); assert.equal(feel['생성 영상'], 0); assert.ok(feel['원고·캡션'] >= 1);
  const wf = Object.fromEntries(w.feel.map((f) => [f.label, f]));
  assert.ok(wf['질문·답변'].n >= 1 && /원/.test(wf['질문·답변'].per), '체감 단위 + 단가');
  assert.ok(wf['메일·문자 초안'].n > wf['질문·답변'].n, '메일 초안이 더 싸다');
  // 요금제별 기준표: 업무 요금제 × 마케팅 요금제 짝(w_basic→basic) + AI 크레딧 팩
  const basic = L.plans.plans.find((p) => p.code === 'w_basic');
  // 대표 10/24 ②: 1인 월 AI 예산(원, 192 초안 500원) — 요청 횟수 대신, 체감 = 500원 ÷ 질문 단가(기본 $0.05 × 1,400 = 70원) = 7회
  assert.equal(basic.work.perUserAi, null); assert.equal(basic.work.perUserBudgetKrw, 500); assert.equal(basic.marketing.label, '베이직'); assert.equal(basic.marketing.monthlyCredits, 30); assert.equal(basic.marketing.images, 4);
  assert.equal(basic.work.feelPerUser[0].n, 7);
  assert.equal(L.plans.plans.find((p) => p.code === 'w_free'), undefined, '#466 무료 5명 폐지(188) — 요금표에서 내림'); // 대표 10/23
  assert.ok(L.plans.packs.some((a) => a.code === 'ai_credit_s' && a.aiRequests === 100 && a.aiBudgetKrw === 4950));
  assert.equal(L.budget.source, 'legacy', '우리 회사(internal)는 예전 회사 월 한도'); assert.equal(L.budget.limitKrw, 14000);
  // 직원은 사용량 화면 없음(메뉴 권한 → 있는 줄도 모르게 404)
  assert.equal((await ctx.staffA.client.req('GET', '/api/usage')).status, 404);
});

test('소개 사이트·요금 안내 같은 데이터: /api/public/ai-plans 로그인 없이, 고객 화면 기준표와 같은 값', async () => {
  const r = await fetch(`${BASE}/api/public/ai-plans`); assert.equal(r.status, 200);
  const m = await r.json();
  // #602: 로그인 없는 기준표에는 원가·단가·환율이 없음(요청당 평균 원가·크레딧 원가·'1회 약 n원'·마케팅 AI 달러)
  assert.deepEqual(Object.keys(m).sort(), ['note', 'packs', 'plans']);
  assert.ok(!/usd|krwPerCredit|"per":"1/i.test(JSON.stringify(m.plans.map((p) => ({ ...p, marketing: p.marketing && { ...p.marketing, aiMonthlyUsd: undefined } })))), JSON.stringify(m.plans[0]));
  assert.ok(m.plans.every((p) => !p.marketing || p.marketing.aiMonthlyUsd === null));
  const u = await ctx.owner.ok('GET', '/api/usage');
  assert.deepEqual(m.plans.map((p) => [p.code, p.work.perUserAi, p.work.aiRequests, p.marketing?.monthlyCredits ?? null]), u.aiLimits.plans.plans.map((p) => [p.code, p.work.perUserAi, p.work.aiRequests, p.marketing?.monthlyCredits ?? null]));
  // 플랫폼 운영에서 마케팅 표 숫자를 바꾸면 두 곳 다 바뀐다(배포 없음)
  await ctx.owner.ok('PUT', '/api/platform/mkt-plans', { plan: { code: 'basic', monthlyCredits: 40 } });
  const m2 = await (await fetch(`${BASE}/api/public/ai-plans`)).json();
  assert.equal(m2.plans.find((p) => p.code === 'w_basic').marketing.monthlyCredits, 40);
  assert.equal((await ctx.owner.ok('GET', '/api/usage')).aiLimits.plans.plans.find((p) => p.code === 'w_basic').marketing.monthlyCredits, 40);
});

test('AI 비서 대화는 호출 공간에 따라 sales_assistant·marketing_assistant 로 기록 → 영업·마케팅 줄에 잡힌다', async () => {
  await sql`delete from ai_usage`;
  // 관리자(대표)는 켠 공간을 모두 쓴다 — 따로 넣지 않음
  await ctl({ anthropicReset: true, anthropicQueue: [say('업무 답'), say('영업 답'), say('마케팅 답')] });
  for (const space of [undefined, 'sales', 'marketing']) {
    const r = await ctx.owner.req('POST', '/api/ai/chat', { text: `${space ?? '업무'} 질문`, ...(space ? { space } : {}) });
    assert.equal(r.status, 200, `chat ${space} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  const rows = await sql`select purpose, count(*)::int n from ai_usage where purpose in ('assistant', 'sales_assistant', 'marketing_assistant') group by purpose`;
  const by = Object.fromEntries(rows.map((r) => [r.purpose, r.n]));
  assert.ok(by.assistant >= 1 && by.sales_assistant >= 1 && by.marketing_assistant >= 1, JSON.stringify(by));
  const L = (await ctx.owner.ok('GET', '/api/usage')).aiLimits;
  assert.ok(L.rows.find((r) => r.key === 'sales').used.requests >= 1); assert.ok(L.rows.find((r) => r.key === 'marketing').used.requests >= 1);
  // 사람별 AI 한도 화면의 '대화' 건수도 세 종류를 모두 센다
  const b = await ctx.owner.ok('GET', '/api/ai/budgets');
  assert.ok(b.people.find((p) => p.id === ctx.ownerId).chats >= 3, JSON.stringify(b.people[0]));
});

test('플랫폼 운영: 회사별 AI 잔여(요청·마케팅 크레딧) + 전체 원가·마진 한 줄, 운영자 아니면 404', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/tenants')).status, 404);
  await sql`update tenants set is_test = false where id = 'default'`;
  const d = await ctx.owner.ok('GET', '/api/platform/tenants');
  const t = d.tenants.find((x) => x.id === 'default');
  assert.equal(t.ai_limit_requests, null, '내부 회사 무제한'); assert.equal(t.ai_left_requests, null);
  assert.equal(t.mkt_plan_code, 'standard'); assert.equal(t.mkt_credits_limit, 80); assert.equal(t.mkt_credits_used, 33); assert.equal(t.mkt_credits_left, 47);
  assert.ok(d.summary && typeof d.summary.aiCostKrw === 'number' && typeof d.summary.revenueKrw === 'number' && typeof d.summary.marginKrw === 'number', JSON.stringify(d.summary));
  assert.equal(d.summary.customers, 0, '우리 회사·체험은 고객사에서 뺀다'); assert.equal(d.summary.marginPct, null, '요금 0원이면 마진율 없음');
});
