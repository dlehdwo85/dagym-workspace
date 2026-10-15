// V23-1·4장·4.5: 크레딧 부족 안내·1시간 차단·알림, 정가 원가(원)·사람별 월·하루 한도·80/100% 알림·추가 요청 승인, 문서 예상 비용 확인 (가짜 Anthropic)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, FAKE } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const say = (text, usage) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', ...(usage ? { usage } : {}) });

before(async () => { await resetDb(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('V23 AI 비용·한도', () => {
  test('정가 원가: 대화 1건 비용(원)을 답에 돌려주고 ai_usage 에 원 환산·대화 표시, 남은 한도 막대 값', async () => {
    await ctl({ anthropicReset: true, anthropicQueue: [say('안녕하세요', { input_tokens: 10000, output_tokens: 1000, cache_read_input_tokens: 20000, cache_creation_input_tokens: 4000 })] });
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '이번 주 일정 알려줘' });
    // Sonnet 5.5: (10000×2 + 4000×2×1.25 + 20000×0.2 + 1000×10)/1e6 = $0.044 → 61.6원
    const [u] = await sql`select cost_usd::float8 usd, cost_krw::float8 krw, purpose from ai_usage where user_id = ${ctx.ownerId} order by created_at desc limit 1`;
    assert.ok(Math.abs(u.usd - 0.044) < 1e-6, String(u.usd)); assert.equal(u.krw, 61.6); assert.equal(u.purpose, 'assistant');
    assert.equal(r.costKrw, 62);
    const st = await ctx.owner.ok('GET', '/api/ai/status');
    assert.equal(st.budget.limitKrw, 20000, '대표 기본 20,000원'); assert.equal(st.budget.usedKrw, 62); assert.equal(st.budget.dayLimitKrw, 4000);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/ai/status')).budget.limitKrw, 10000, '그 밖 10,000원');
  });

  test('사람별 한도: 대표가 한도 1,000원으로 → 80% 알림(본인·대표) → 100% 차단 → 추가 요청 → 대표 승인 → 다시 사용, 직원은 한도 못 바꿈', async () => {
    assert.equal((await ctx.staffA.client.req('PUT', '/api/ai/user-limits', { userId: ctx.staffA.id, monthlyKrw: 99999 })).status, 403);
    await ctx.owner.ok('PUT', '/api/ai/user-limits', { userId: ctx.staffA.id, monthlyKrw: 1000 });
    const big = { input_tokens: 300000, output_tokens: 0 }; // Sonnet $0.6 = 840원
    await ctl({ anthropicReset: true, anthropicQueue: [say('첫 답', big)] });
    await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '내 업무 알려줘' });
    const n80 = await sql`select user_id from notifications where title like 'AI 한도 80%%' order by created_at`;
    assert.ok(n80.some((n) => n.user_id === ctx.staffA.id) && n80.some((n) => n.user_id === ctx.ownerId), '80% 알림 본인·대표');
    // 하루 한도(200원)도 넘었음 → 오늘 막힘
    const day = await ctx.staffA.client.req('POST', '/api/ai/chat', { text: '또 알려줘' });
    assert.equal(day.status, 429); assert.match(day.body.error?.message ?? '', /오늘/);
    await sql`update ai_usage set created_at = created_at - interval '1 day' where user_id = ${ctx.staffA.id} and created_at > date_trunc('month', now()) + interval '1 day'`;
    await ctl({ anthropicReset: true, anthropicQueue: [say('둘째 답', { input_tokens: 100000, output_tokens: 0 })] }); // 280원 → 1,120원
    await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '다른 것' });
    const out = await ctx.staffA.client.req('POST', '/api/ai/chat', { text: '하나 더' });
    assert.equal(out.status, 429); assert.match(out.body.error.message, /추가 요청/);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/ai/status')).overLimit, true);
    const rq = await ctx.staffA.client.ok('POST', '/api/ai/limit-requests', { amountKrw: 5000, reason: '견적서 작업' });
    assert.equal((await ctx.staffA.client.req('POST', '/api/ai/limit-requests', { amountKrw: 5000 })).status, 400, '기다리는 요청은 하나만');
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/ai/limit-requests/${rq.id}`, { approve: true })).status, 403, '직원은 승인 못 함');
    const ov = await ctx.owner.ok('GET', '/api/ai/budgets');
    assert.equal(ov.pending.length, 1); assert.ok(ov.people.find((p) => p.id === ctx.staffA.id).pct >= 100);
    await ctx.owner.ok('PATCH', `/api/ai/limit-requests/${rq.id}`, { approve: true });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/ai/status')).budget.limitKrw, 6000, '승인하면 그 달 한도 +5,000');
    await ctl({ anthropicReset: true, anthropicQueue: [say('다시 됩니다')] });
    await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '다시 질문' });
    assert.ok((await sql`select count(*)::int n from audit_logs where action in ('ai.user_limit','ai.limit_request','ai.limit_approved')`)[0].n >= 3);
    assert.ok(ov.top.length >= 1, '비싼 요청 상위');
    assert.equal((await ctx.staffA.client.req('GET', '/api/ai/budgets')).status, 403);
  });

  test('문서 작업: 예상 비용 > 남은 한도면 시작 안 함, 500원 넘으면 먼저 확인', async () => {
    await ctx.owner.ok('PUT', '/api/ai/user-limits', { userId: ctx.managerA.id, monthlyKrw: 100000 });
    // 지난 문서 평균 700원으로 꾸밈
    await sql`insert into ai_doc_jobs (tenant, user_id, mode, kind, title, instructions, status, cost_usd) values ('default', ${ctx.managerA.id}, 'create', 'xlsx', '예전', 'x', 'done', 0.5)`;
    const n0 = (await fakeState()).anthropic.length;
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'tool_use', id: 'd1', name: 'run_file_task', input: { mode: 'create', kind: 'xlsx', title: '큰 문서', instructions: '표' } }], stop_reason: 'tool_use' }, say('약 700원인데 계속할까요?')] });
    const r = await ctx.managerA.client.ok('POST', '/api/ai/chat', { text: '큰 엑셀 문서 만들어줘' });
    assert.equal(r.docJobs, undefined, '확인 전에는 작업 안 만듦');
    assert.match(JSON.stringify((await fakeState()).anthropic.slice(n0)[1].body.messages.at(-1)), /needConfirm/);
    await ctx.owner.ok('PUT', '/api/ai/user-limits', { userId: ctx.managerA.id, monthlyKrw: 300 });
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'tool_use', id: 'd2', name: 'run_file_task', input: { mode: 'create', kind: 'xlsx', title: '큰 문서', instructions: '표', confirmedCost: true } }], stop_reason: 'tool_use' }, say('한도가 모자랍니다')] });
    const r2 = await ctx.managerA.client.ok('POST', '/api/ai/chat', { text: '그래도 엑셀 만들어줘' });
    assert.equal(r2.docJobs, undefined);
    assert.match(JSON.stringify((await fakeState()).anthropic.at(-1).body.messages.at(-1)), /남은 AI 한도/);
  });

  test('크레딧 부족: 402 billing_error → 안내 문구, 1시간 차단(다시 호출 안 함), 대표·운영자 하루 1번 알림, 상태 화면 빨간 안내, 차단 풀리면 다시', async () => {
    await ctx.owner.ok('PUT', '/api/ai/user-limits', { userId: ctx.ownerId, monthlyKrw: 1000000 });
    await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 402, errorType: 'billing_error', message: 'Your credit balance is too low to access the Anthropic API.' }] });
    const r = await ctx.owner.req('POST', '/api/ai/chat', { text: '오늘 할 일' });
    assert.equal(r.status, 503); assert.match(r.body.error.message, /AI 크레딧이 모두 사용/);
    const n0 = (await fakeState()).anthropic.length;
    const r2 = await ctx.owner.req('POST', '/api/ai/chat', { text: '다시' });
    assert.equal(r2.status, 503); assert.equal((await fakeState()).anthropic.length, n0, '차단 중엔 Anthropic 을 다시 부르지 않음');
    assert.equal((await sql`select count(*)::int n from notifications where title = 'AI 크레딧 소진'`)[0].n, 1);
    const st = await ctx.staffA.client.ok('GET', '/api/ai/status');
    assert.equal(st.creditBlocked, true); assert.match(st.creditMessage, /크레딧/);
    // 1시간 지난 것으로 → 다음 요청이 확인, 성공하면 풀림
    await sql`update app_settings set value = jsonb_set(value, '{until}', to_jsonb((now() - interval '1 minute')::text)) where key = 'ai_credit_block'`;
    await ctl({ anthropicReset: true, anthropicQueue: [say('다시 됩니다')] });
    await ctx.owner.ok('POST', '/api/ai/chat', { text: '이제 됩니까' });
    assert.equal((await sql`select count(*)::int n from app_settings where key = 'ai_credit_block'`)[0].n, 0);
    // 요청 한도(429)는 다른 문구, 차단 없음
    await ctl({ anthropicReset: true, anthropicQueue: [{ httpError: 400, errorType: 'invalid_request_error', message: 'bad' }] });
    const r3 = await ctx.owner.req('POST', '/api/ai/chat', { text: '오류 시험' });
    assert.equal(r3.status, 502);
    assert.equal((await sql`select count(*)::int n from app_settings where key = 'ai_credit_block'`)[0].n, 0);
  });
  test('V23 5장 AI 원가 전망(운영자): 누적·예상·소진일·무료 업체 수·충전 권장·요금 역산·콘솔 대조, 70% 알림, 운영자 아니면 404', async () => {
    assert.equal((await ctx.staffA.client.req('GET', '/api/platform/ai-forecast')).status, 404);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/platform/ai-forecast', { securedUsd: 1 })).status, 404);
    await sql`delete from ai_usage`;
    // 이번 달: 다짐(default) $3, 다른 회사 $1 — 모두 최근 7일 안
    await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, purpose, created_at) values
      ('default', ${ctx.ownerId}, gen_random_uuid(), 'anthropic', 'claude-sonnet-5-5', 1, 1, 2, 'assistant', now()),
      ('default', ${ctx.staffA.id}, gen_random_uuid(), 'anthropic', 'claude-sonnet-5-5', 1, 1, 1, 'assistant', now()),
      ('default', ${ctx.managerA.id}, gen_random_uuid(), 'anthropic', 'claude-haiku-5-5', 1, 1, 0.5, 'library_organize', now())`;
    await ctx.owner.ok('PUT', '/api/platform/ai-forecast', { securedUsd: 4, nextSecuredUsd: 4, consoleUsd: 3, companySize: 10, aiShare: 0.3 });
    const f = await ctx.owner.ok('GET', '/api/platform/ai-forecast');
    assert.equal(f.monthUsd, 3.5); assert.equal(f.monthKrw, 4900); assert.equal(f.usedPct, 88);
    assert.ok(f.forecastUsd >= 3.5, '예상 ≥ 누적');
    assert.equal(f.dailyUsd, 0.5, '최근 7일 하루 평균');
    assert.ok(f.exhaustDate, '소진 예상일'); assert.ok(f.rechargeUsd > 0, '충전 권장');
    assert.equal(f.tiers.users, 3); assert.ok(f.tiers.heavy >= f.tiers.medium && f.tiers.medium >= f.tiers.light);
    assert.equal(f.console.usd, 3); assert.equal(f.console.diffPct, 17);
    assert.ok(Array.isArray(f.pricing) && f.pricing.length > 0); assert.ok(f.units.some((u) => u.purpose === 'assistant'));
    assert.ok(f.freeCompanies === 0 || f.freeCompanies === null, '확보 70% 를 우리 회사가 다 씀 → 무료 0곳');
    // 70% 넘음 → 정기 실행 알림 1번(다시 돌려도 1번)
    const { tick } = await import('../helpers.mjs');
    await tick(); await tick();
    assert.equal((await sql`select count(*)::int n from notifications where title like 'AI 크레딧 %% 사용'`)[0].n, 1);
  });
});
