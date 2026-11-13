// 399차 #1025(대표 11/13 "현재 네이버 하이링크 광고 현황 및 보완점 … 워크인에서 보기가 어렵네요. 한눈에 보기 쉽게"): 사업(브랜드)별 한 장 요약
// 이번 달 광고비·계획·클릭·문의·잔액 · 잘 되는 검색어(문의 → 클릭 순) · 돈만 쓰는 검색어(비용만·노출만) · 할 일 3 · 브랜드 없는 캠페인 · 다른 회사 숨김 · 홈 카드 'brief'
// 광고 성과는 DB 에 직접 넣음(매체 연동 = 구조 시험)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, seoulToday, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, acc, H, B, Z;
const today = seoulToday();
const daysIn = (() => { const [y, m] = today.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); })();
const elapsed = Math.round((Number(today.slice(8, 10)) / daysIn) * 100);

before(async () => {
  await resetDb();
  srv = await startServer({});
  sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  [H] = (await sql`insert into mkt_brands (tenant, name, color) values ('default', '하이링크', '#2563EB') returning id`).map((r) => r.id);
  [B, Z] = (await sql`insert into mkt_brands (tenant, name) values ('default', '바디랩 두정점'), ('default', '워크인') returning id`).map((r) => r.id);
  await sql`insert into tenants (id, name) values ('t_bf1025', '남의 회사') on conflict do nothing`;
  const [ob] = await sql`insert into mkt_brands (tenant, name) values ('t_bf1025', '남의 브랜드') returning id`;
  const [oa] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, status) values ('t_bf1025', 'naver', '999', '남의 계정', 'active') returning id`;
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${oa.id}, ${today}, 'o-1', '남의 브랜드 캠페인', 9000, 90, 900000)`;
  assert.ok(ob.id);
  acc = (await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, status, last_sync_at) values ('default', 'naver', '7777777', '다짐·하이링크', 'active', now()) returning id`)[0].id;
  const stat = (cid, name, imp, clicks, cost) => sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${acc}, ${today}, ${cid}, ${name}, ${imp}, ${clicks}, ${cost})`;
  await stat('cmp-h', '하이링크_아파트플랫폼', 5000, 40, 60000); // 클릭률 0.8% · 클릭당 1,500원
  await stat('cmp-b', '바디랩 두정점 플레이스', 800, 20, 8000);
  await stat('cmp-x', '이름 모를 캠페인', 300, 3, 3000); // 브랜드 없음
  const kw = (id, name, cid, cname, imp, clicks, cost) => sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${acc}, ${today}, 'keyword', ${id}, ${name}, ${cid}, ${cname}, ${imp}, ${clicks}, ${cost})`;
  await kw('k1', '헬스장 위탁', 'cmp-h', '하이링크_아파트플랫폼', 900, 12, 20000);   // 광고 전화 1건 → 잘 되는 검색어 1위
  await kw('k2', '아파트 출입', 'cmp-h', '하이링크_아파트플랫폼', 1500, 18, 25000);  // 비용만 · 문의 0
  await kw('k3', '관리사무소 앱', 'cmp-h', '하이링크_아파트플랫폼', 700, 8, 9000);    // 비용만(1만원 아래)
  await kw('k4', '커뮤니티 예약', 'cmp-h', '하이링크_아파트플랫폼', 1200, 0, 0);     // 노출만 · 클릭 0
  await kw('k5', '출입 카드', 'cmp-h', '하이링크_아파트플랫폼', 50, 0, 0);          // 노출 100 아래 — 안 나옴
  await kw('k6', '두정동 헬스장', 'cmp-b', '바디랩 두정점 플레이스', 800, 20, 8000);
  await sql`insert into mkt_calls (tenant, phone, created_by, ad_keyword, ad_provider, brand_id, called_at) values ('default', '010-0000-0000', ${ctx.ownerId}, '헬스장 위탁', 'naver', ${H}, ${`${today}T00:30:00+09:00`}::timestamptz)`;
  await sql`insert into mkt_ad_balances (tenant, provider, label, account_id, balance_krw, source) values ('default', 'naver', '다짐·하이링크', ${acc}, 20000, 'manual')`;
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/watch', { brandPlans: { [H]: 100000 } });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('399차 사업별 한 장 요약', () => {
  test('숫자(광고비·계획·클릭·문의·잔액) · 잘 되는 검색어 · 돈만 쓰는 검색어 · 할 일 · 광고비 많은 순 · 브랜드 없는 캠페인 · 다른 회사 숨김', async () => {
    const v = await ctx.owner.ok('GET', '/api/marketing/ad-ops/brief');
    assert.equal(v.month, today.slice(0, 7)); assert.equal(v.day, today); assert.equal(v.elapsedPct, elapsed);
    assert.deepEqual(v.brands.map((b) => b.name), ['하이링크', '바디랩 두정점', '워크인'], '광고비 많은 순 · 다른 회사 브랜드 없음');
    const h = v.brands[0];
    assert.deepEqual([h.cost, h.plan, h.planPct, h.impressions, h.clicks, h.ctr, h.cpc], [60000, 100000, 60, 5000, 40, 0.8, 1500]);
    assert.equal(h.color, '#2563EB');
    assert.deepEqual([h.leads, h.calls], [1, 1], '광고 키워드로 확인된 문의 1 · 전화 기록 1');
    assert.equal(h.balance.krw, 20000); assert.ok(h.balance.days !== null && h.balance.days > 0, '잔액 남은 날');
    assert.equal(h.good[0].keyword, '헬스장 위탁'); assert.equal(h.good[0].leads, 1);
    assert.deepEqual(h.waste.map((k) => k.keyword), ['아파트 출입', '관리사무소 앱', '커뮤니티 예약'], '비용 큰 순 → 노출만 있는 검색어');
    assert.match(h.waste[0].why, /25,000원 · 클릭 18 · 문의 0/); assert.match(h.waste[2].why, /노출 1,200 · 클릭 0/);
    assert.ok(!h.waste.some((k) => k.keyword === '헬스장 위탁' || k.keyword === '출입 카드'), '문의가 난 검색어·노출 100 아래는 안 나옴');
    assert.ok(h.todos.length >= 1 && h.todos.length <= 3, JSON.stringify(h.todos));
    assert.ok(h.todos.some((t) => /'아파트 출입' 입찰가 내리기·중지 검토 — 25,000원 쓰고 문의 0/.test(t)) || h.todos.some((t) => /잔액 충전|계획보다 빠릅니다/.test(t)), JSON.stringify(h.todos));
    if (60 - elapsed >= 15) assert.ok(h.todos.some((t) => /비용이 계획보다 빠릅니다 — 계획의 60%/.test(t)), JSON.stringify(h.todos));
    const b = v.brands[1];
    assert.deepEqual([b.cost, b.plan, b.planPct, b.clicks, b.leads], [8000, null, null, 20, 0]);
    assert.ok(b.todos.some((t) => /이번 달 계획\(예산\)이 없습니다/.test(t)), JSON.stringify(b.todos));
    assert.equal(b.good[0].keyword, '두정동 헬스장');
    const z = v.brands[2];
    assert.equal(z.cost, 0); assert.deepEqual(z.todos, ['이번 달 광고 집행이 없습니다']); assert.equal(z.balance, null, '최근 30일 쓴 계정이 없으면 잔액 없음');
    assert.equal(v.unbranded.name, '(브랜드 없음)'); assert.equal(v.unbranded.cost, 3000);
    assert.match(v.unbranded.todos[0], /브랜드가 정해지지 않은 캠페인/);
    assert.ok(!JSON.stringify(v).includes('남의'), '다른 회사 숫자·이름 없음');
  });

  test('마케팅 공간 구성원은 봄 · 공간 밖 직원은 404 · 로그인 없으면 401', async () => {
    const m = await ctx.staffA.client.ok('GET', '/api/marketing/ad-ops/brief');
    assert.equal(m.brands[0].name, '하이링크');
    assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/ad-ops/brief')).status, 404);
    assert.equal((await fetch(`${BASE}/api/marketing/ad-ops/brief`)).status, 401);
  });

  test("홈 카드: 기본 순서에 '사업별 광고 요약'이 숫자 4칸 아래 · 예전에 저장한 구성에는 한 번 끼워 넣음 · 그 뒤 저장하면 끈 것도 지킴", async () => {
    const h0 = await ctx.owner.ok('GET', '/api/marketing/home');
    assert.deepEqual(h0.cards.cards.slice(0, 3), ['chat', 'kpi', 'brief']); assert.equal(h0.cardLabels.brief, '사업별 광고 요약');
    // 예전 구성(표식 없음): 숫자 4칸 아래에 끼움 · 숫자 4칸이 없으면 맨 위(AI 입력창 다음)
    await sql`insert into user_settings (user_id, mkt_home_cards) values (${ctx.staffA.id}, ${sql.json(['chat', 'kpi', 'approve'])}) on conflict (user_id) do update set mkt_home_cards = excluded.mkt_home_cards`;
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/marketing/home')).cards.cards, ['chat', 'kpi', 'brief', 'approve']);
    await sql`update user_settings set mkt_home_cards = ${sql.json(['chat', 'week'])} where user_id = ${ctx.staffA.id}`;
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/marketing/home')).cards.cards, ['chat', 'brief', 'week']);
    // 새로 저장(끈 채로) → 그대로
    await ctx.staffA.client.ok('POST', '/api/marketing/home', { action: 'cards', cards: ['chat', 'week'] });
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/marketing/home')).cards.cards, ['chat', 'week']);
    await ctx.staffA.client.ok('POST', '/api/marketing/home', { action: 'cards', cards: ['brief', 'chat'] });
    assert.deepEqual((await ctx.staffA.client.ok('GET', '/api/marketing/home')).cards.cards, ['brief', 'chat']);
  });
});
