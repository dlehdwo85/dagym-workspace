// #602(대표 10/25 "수집기 상태·오류는 슈퍼관리자만, 고객은 연동 방법·과정만" — docs/handoff/SUPER_ADMIN_SCOPE_2026-10-25.md §2·§4):
// 고객사 관리자 계정으로 수집기·사용량·자동 제작·마케팅 홈 응답을 불러 ① 금지 낱말(모델·외부 서비스·원가·$·HTTP 코드)·내부 회사 이름이 없는지
// ② 키 이름·원천 주소·오류 원인·공용 실행 기록이 빠졌는지 ③ 같은 API 를 내부 테넌트 관리자가 부르면 전부 보이는지(예외) 를 자동 검사한다.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';
import { FORBIDDEN_WORDS, INTERNAL_NAMES, forbidden, internal } from '../customerWords.mjs';

let srv, ctx, sql, cust, custTenant;
const form = (o) => ({ password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false }, ...o });
const clean = (label, body) => { const text = JSON.stringify(body); assert.deepEqual(forbidden(text), [], `${label}: 금지 낱말`); assert.deepEqual(internal(text), [], `${label}: 내부 회사 이름`); };

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', USD_KRW: '1400' }); sql = testDb(); ctx = await bootstrap();
  cust = new Client('cust-scope');
  const r = await cust.ok('POST', '/api/auth/signup', form({ email: 'boss@scope-test.test', name: '범위대표', mode: 'team', company: '범위회사' }));
  await cust.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  custTenant = (await cust.ok('GET', '/api/auth/me')).user.tenant;
  for (const space of ['sales', 'marketing']) await cust.ok('PUT', '/api/admin/spaces', { space, on: true });
  for (const space of ['sales', 'marketing']) await ctx.owner.ok('PUT', '/api/admin/spaces', { space, on: true }); // 내부 테넌트도 두 공간 켬(예외 비교용)
  // 공용 수집 기록: 누리장터가 '활용신청 전' 403 으로 두 번 실패 — 오류 원문·원천 주소·첫 줄 칸 이름이 붙어 있다
  for (const ago of [26, 2]) await sql`insert into sales_collector_runs (slug, trigger, started_at, finished_at, status, errors, summary, error_log, detail)
    values ('g2b_bid_notices', 'cron', now() - make_interval(hours => ${ago}), now() - make_interval(hours => ${ago}) + interval '20 seconds', 'failed', 1,
      '활용신청 필요(서비스 15129394) — HTTP 403 SERVICE_KEY_IS_NOT_REGISTERED', 'OpenAPI 호출 실패 HTTP 403: SERVICE_KEY_IS_NOT_REGISTERED_ERROR (data.go.kr)',
      ${sql.json({ sources: { g2b: { label: '누리장터', ok: false, calls: 1, received: 0, kept: 0, error: 'HTTP 403 SERVICE_KEY_IS_NOT_REGISTERED', sent: 'https://apis.data.go.kr/1230000/ad/BidPublicInfoService?serviceKey=****&numOfRows=100', head: '<response><header><resultCode>30</resultCode>' } } })})`;
  await sql`insert into sales_collector_state (slug, enabled, last_run_at, last_status) values ('g2b_bid_notices', true, now() - interval '2 hours', 'failed') on conflict (slug) do update set last_run_at = excluded.last_run_at, last_status = excluded.last_status`;
  // 마케팅 연결 계정 하나가 토큰 만료로 끊김(원인 문장이 저장돼 있음)
  await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, status, last_error) values (${custTenant}, 'meta_ig', 'ig-1', '@scope_test', 'error', 'OAuthException 190: Error validating access token (HTTP 400) — Anthropic/Higgsfield 아님, 메타 토큰 만료')`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('#602 슈퍼관리자만 아는 것 — 고객사 응답 범위', () => {
  test('수집기: 고객 관리자에게는 연결 상태 3가지·방법·받은 건수만(키 이름·원천 주소·오류 원문·원천별 상세·공용 실행 기록 없음) / 내부 테넌트는 전부', async () => {
    const c = await cust.ok('GET', '/api/sales/collectors');
    assert.equal(c.full, false); assert.deepEqual(c.runs, [], '공용 실행 기록 없음');
    assert.ok(c.collectors.length >= 12);
    for (const x of c.collectors) {
      assert.deepEqual(x.needs, [], `${x.slug} 키 이름 없음`); assert.equal(x.source, null, `${x.slug} 원천 주소 없음`);
      assert.ok(['connected', 'disconnected', 'apply_needed', 'off'].includes(x.state), `${x.slug} 상태 ${x.state}`);
      if (x.state === 'apply_needed') assert.match(x.how, /활용신청|운영사/, `${x.slug} 방법`);
    }
    const g2b = c.collectors.find((x) => x.slug === 'g2b_bid_notices');
    assert.equal(g2b.last.summary, '못 받았습니다 — 연결을 확인해 주세요'); assert.equal(g2b.last.error_log, null); assert.equal(g2b.last.detail, null); assert.equal(g2b.last.status, 'failed');
    assert.ok(['apply_needed', 'disconnected'].includes(g2b.state), `실패 원천 상태 ${g2b.state}`);
    for (const a of c.alerts) { assert.equal(a.error, null); assert.equal(a.reason, '오늘 새 공고를 받지 못했습니다. 데이터 설정에서 연결을 확인해 주세요'); }
    clean('수집기(고객)', c);
    // 내부 테넌트(우리 회사) 관리자 = 예외
    const f = await ctx.owner.ok('GET', '/api/sales/collectors');
    assert.equal(f.full, true); assert.ok(f.runs.length >= 2, '공용 실행 기록');
    const g = f.collectors.find((x) => x.slug === 'g2b_bid_notices');
    assert.match(g.last.error_log, /403/); assert.ok(g.last.detail.sources.g2b.sent.includes('apis.data.go.kr')); assert.ok(g.needs.length >= 1); assert.match(g.source, /누리장터|data\.go\.kr|g2b/i);
    assert.equal(g.state, null);
  });

  test('사용량·요금제: 고객에게는 원화·%·횟수만(달러·원가 단가·운영 메모 없음) / 내부는 달러 그대로', async () => {
    const u = await cust.ok('GET', '/api/usage');
    assert.equal(u.full, false); assert.equal(u.ai.currency, 'krw');
    assert.equal(u.ai.costUsd, undefined); assert.equal(u.ai.usdKrw, undefined); assert.equal(u.ai.consoleNote, undefined); assert.equal(u.usage.aiCostUsd, undefined);
    assert.equal(typeof u.ai.cost, 'number'); assert.equal(typeof u.ai.limit, 'number');
    for (const r of u.aiLimits.rows) { assert.equal(r.limit.usd, null); assert.equal(r.used.usd, null); assert.equal(r.left.usd, null); for (const f of r.feel) assert.equal(f.per, '', `${r.key} 단가 없음`); }
    assert.deepEqual(u.aiLimits.pool.usd, { limit: null, used: null, left: null });
    for (const p of u.aiLimits.plans.plans) { for (const f of p.work.feelPerUser) assert.equal(f.per, ''); if (p.marketing) { assert.equal(p.marketing.aiMonthlyUsd, null); assert.ok(p.marketing.aiMonthlyKrw === null || typeof p.marketing.aiMonthlyKrw === 'number'); } }
    clean('사용량(고객)', u);
    const b = await cust.ok('GET', '/api/ai/budgets');
    assert.equal(b.totalUsd, undefined); assert.equal(b.usdKrw, undefined); assert.equal(typeof b.totalKrw, 'number');
    clean('사람별 AI 한도(고객)', b);
    const f = await ctx.owner.ok('GET', '/api/usage');
    assert.equal(f.ai.currency, 'usd'); assert.equal(typeof f.ai.costUsd, 'number'); assert.equal(typeof f.ai.usdKrw, 'number');
    assert.ok(f.aiLimits.rows.some((r) => r.feel.some((x) => /1[회건] 약 [\d,]+원/.test(x.per))), '내부는 단가 표시');
    assert.equal(typeof (await ctx.owner.ok('GET', '/api/ai/budgets')).totalUsd, 'number');
  });

  test('자동 제작: 고객에게는 글 모델 등급 이름만(모델 이름·원고 1건 비용·달러 한도 없음) / 내부는 모델 이름 포함', async () => {
    const a = await cust.ok('GET', '/api/marketing/auto');
    assert.equal(a.full, false);
    assert.equal(typeof a.writeModel.label, 'string'); assert.equal(a.writeModel.model, undefined); assert.equal(a.writeModel.perDraftKrw, undefined); assert.equal(a.writeModel.byTier, undefined);
    assert.equal(a.writeModel.blog.model, undefined); assert.equal(typeof a.writeModel.blog.upgraded, 'boolean');
    assert.equal(a.usage.ai, undefined); assert.equal(a.usage.companyAiUsd, undefined); assert.equal(typeof a.usage.companyAi.usedKrw, 'number');
    assert.equal(a.limits.aiMonthlyUsd, null); assert.equal(a.settings.ai_monthly_usd, null);
    for (const p of Object.values(a.plans)) assert.equal(p.aiMonthlyUsd, null);
    clean('자동 제작(고객)', a);
    const f = await ctx.owner.ok('GET', '/api/marketing/auto');
    assert.equal(f.full, true); assert.match(f.writeModel.model, /claude/); assert.equal(typeof f.writeModel.perDraftKrw, 'number'); assert.equal(typeof f.usage.ai.usd, 'number');
  });

  test('마케팅 홈 연결 계정: 고객에게는 끊김 여부만(토큰 오류 원인·앱 심사 상태 없음) / 내부는 원인 문장', async () => {
    const h = await cust.ok('GET', '/api/marketing/home');
    const ig = h.channels.find((c) => c.key === 'instagram');
    assert.equal(ig.state, 'broken'); assert.equal(ig.account, '@scope_test'); assert.equal(ig.error, null, '원인 없음');
    for (const c of h.channels) { assert.equal(c.error, null); if (c.pending && c.kind !== 'helper') assert.equal(c.pending, '준비 중 — 그동안 게시 도우미(복사·열기)', `${c.key} 준비 사유(앱 심사·OAuth) 없음`); }
    clean('마케팅 홈(고객)', h);
    await sql`insert into mkt_publish_accounts (tenant, provider, external_id, label, status, last_error) values ('default', 'meta_ig', 'ig-hq', '@hq_test', 'error', 'OAuthException 190: token expired')`;
    const f = await ctx.owner.ok('GET', '/api/marketing/home');
    assert.match(f.channels.find((c) => c.key === 'instagram').error, /OAuthException/);
  });

  test('첫날 알림·기타 응답에 금지 낱말 없음(온보딩·내 정보·영업 출처·당일 메일 설정)', async () => {
    for (const path of ['/api/notifications', '/api/onboarding', '/api/auth/me', '/api/sales/sources', '/api/sales/digest/prefs']) clean(path, await cust.ok('GET', path));
    assert.ok(FORBIDDEN_WORDS.test('글 모델: 빠른 모델 (claude-haiku-5-5)') && FORBIDDEN_WORDS.test('원가 한도 $3.57') && FORBIDDEN_WORDS.test('HTTP 403') && FORBIDDEN_WORDS.test('403 오류') && !FORBIDDEN_WORDS.test('스탠다드 4,500원 · 500자 · "perUserAiBudgetKrw":500') && !FORBIDDEN_WORDS.test('{"usd":null}'), '금지 낱말 규칙 자체 점검');
    assert.ok(INTERNAL_NAMES.test('하이링크') && !INTERNAL_NAMES.test('워크인'));
  });
});
