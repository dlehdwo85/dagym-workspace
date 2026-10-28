// 221차 #531 광고 성과 캠페인 단위 브랜드: 여러 브랜드가 같이 쓰는 광고 계정(계정에 브랜드 없음)도 캠페인마다 브랜드로 나눔
// 순서 = 관리자 직접 지정 > 계정 브랜드 > 캠페인 이름(브랜드 이름·찾는 낱말, 가장 긴 낱말, 같은 길이로 두 브랜드면 정하지 않음) · 전체 화면 브랜드별·브랜드×매체 · 사이트별 집계 광고비도 같은 기준
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday(); const month = today.slice(0, 7);
const B = {}; const A = {};
before(async () => {
  await resetDb(); srv = await startServer({}); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  for (const n of ['하이링크', '바디랩', '다짐']) B[n] = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: n })).id;
  const acc = async (provider, external_id, label, brand, tenant = 'default') => (await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, brand_id, created_by) values (${tenant}, ${provider}, ${external_id}, ${label}, ${brand}, ${ctx.ownerId}) returning id`)[0].id;
  A.shared = await acc('naver', '1111111', '공용 검색광고', null); // 여러 브랜드가 같이 쓰는 계정
  A.meta = await acc('meta', '2222222', '바디랩 메타', B['바디랩']); // 계정에 브랜드
  const row = (account, cid, name, clk, cost, conv = 0) => sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw, conversions) values (${account}, ${today}::date, ${cid}, ${name}, ${clk * 20}, ${clk}, ${cost}, ${conv})`;
  await row(A.shared, 'c-hl', '[하이링크] 파워링크_출입통제', 30, 30000, 2);
  await row(A.shared, 'c-bl', '바디랩_천안 두정 검색', 20, 20000, 1);
  await row(A.shared, 'c-en', 'HILINK 브랜드검색', 10, 10000);
  await row(A.shared, 'c-mix', 'BODY 하이링크 묶음', 5, 5000);
  await row(A.meta, 'm-1', '하이링크 리타게팅', 40, 40000, 3); // 계정 브랜드(바디랩)가 이름보다 먼저
  await sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, campaign_id, campaign_name, clicks, cost_krw) values (${A.shared}, ${today}::date, 'keyword', 'k-1', '출입통제 시스템', 'c-hl', '[하이링크] 파워링크_출입통제', 7, 7000)`;
  // 남의 회사 계정·브랜드(직접 지정에 쓰면 404)
  await sql`insert into tenants (id, name) values ('t_ad221', '남의회사') on conflict do nothing`;
  A.other = await acc('naver', '3333333', '남의 계정', null, 't_ad221');
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, cost_krw) values (${A.other}, ${today}::date, 'o-1', '남의 캠페인', 1000)`;
  B.other = (await sql`insert into mkt_brands (tenant, name) values ('t_ad221', '남의 브랜드') returning id`)[0].id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const camp = (v, id) => v.campaigns.find((c) => c.campaign_id === id);
const brandCost = (v) => Object.fromEntries(v.byBrand.map((r) => [r.brand, r.cost]));

test('캠페인 이름·계정 브랜드로 나눔 → 브랜드 필터·전체 브랜드별·브랜드×매체 · 기간 보기도', async () => {
  const v = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`);
  assert.equal(v.totals.cost, 105000);
  assert.deepEqual([camp(v, 'c-hl').brand, camp(v, 'c-hl').brand_source], ['하이링크', 'name'], '공용 계정 → 캠페인 이름 [하이링크]');
  assert.deepEqual([camp(v, 'c-bl').brand, camp(v, 'c-bl').brand_source], ['바디랩', 'name'], '밑줄·띄어쓰기 상관없이');
  assert.deepEqual([camp(v, 'c-en').brand_id, camp(v, 'c-en').brand_source], [null, null], '영문 HILINK 는 찾는 낱말이 없으면 정하지 않음');
  assert.deepEqual([camp(v, 'm-1').brand, camp(v, 'm-1').brand_source], ['바디랩', 'account'], '계정 브랜드가 캠페인 이름보다 먼저');
  assert.equal(camp(v, 'c-mix').brand, '하이링크', "'BODY 하이링크 묶음' — 아직 BODY 는 낱말이 아니라 하이링크만 걸림");
  assert.deepEqual(brandCost(v), { '바디랩': 60000, '하이링크': 35000, '(브랜드 없음)': 10000 });
  assert.deepEqual(v.byBrand.map((r) => r.brand), ['바디랩', '하이링크', '(브랜드 없음)'], '광고비 순');
  const bp = Object.fromEntries(v.byBrandProvider.map((r) => [`${r.brand}/${r.provider}`, r.cost]));
  assert.deepEqual(bp, { '바디랩/meta': 40000, '바디랩/naver': 20000, '하이링크/naver': 35000, '(브랜드 없음)/naver': 10000 }, '브랜드 × 매체');
  // 브랜드를 고르면 그 브랜드 캠페인만(예전엔 계정 단위라 공용 계정은 0)
  const h = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}&brand=${B['하이링크']}`);
  assert.equal(h.totals.cost, 35000); assert.deepEqual(h.campaigns.map((c) => c.campaign_id), ['c-hl', 'c-mix']);
  assert.deepEqual(h.keywords.map((k) => [k.item_name, k.brand]), [['출입통제 시스템', '하이링크']], '키워드 표도 캠페인 브랜드');
  const none = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}&brand=none`);
  assert.deepEqual(none.campaigns.map((c) => c.campaign_id), ['c-en']);
  const d = await ctx.owner.ok('GET', '/api/marketing/ads?days=7');
  assert.deepEqual(brandCost(d), brandCost(v), '기간 보기에서도 브랜드별');
  assert.ok(d.brands.every((b) => Array.isArray(b.aliases) && b.color), '브랜드 목록에 찾는 낱말·색');
  assert.equal((await ctx.staffA.client.ok('GET', `/api/marketing/ads?month=${month}`)).totals.cost, 105000, '공간 멤버 직원도 읽기');
});

test('찾는 낱말(관리자): HILINK → 하이링크 · 같은 길이로 두 브랜드에 걸리면 정하지 않음 · 사이트별 집계 광고비도 같은 기준', async () => {
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/ads/brand-aliases', { brandId: B['하이링크'], aliases: ['HILINK'] })).status, 403, '직원은 못 바꿈');
  assert.equal((await ctx.owner.req('PUT', '/api/marketing/ads/brand-aliases', { brandId: B.other, aliases: ['X1'] })).status, 404, '남의 회사 브랜드 404');
  assert.equal((await ctx.owner.req('PUT', '/api/marketing/ads/brand-aliases', { brandId: B['하이링크'], aliases: ['H'] })).status, 400, '1자 낱말은 받지 않음');
  const r = await ctx.owner.ok('PUT', '/api/marketing/ads/brand-aliases', { brandId: B['하이링크'], aliases: ['HILINK', ' hilink ', '하이링크SA'] });
  assert.deepEqual(r.aliases, ['HILINK', '하이링크SA'], '대소문자·띄어쓰기만 다른 낱말은 하나로');
  let v = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`);
  assert.deepEqual([camp(v, 'c-en').brand, camp(v, 'c-en').brand_source], ['하이링크', 'name']);
  await ctx.owner.ok('PUT', '/api/marketing/ads/brand-aliases', { brandId: B['바디랩'], aliases: ['BODY'] });
  v = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`);
  assert.deepEqual([camp(v, 'c-mix').brand_id, camp(v, 'c-mix').brand_source], [null, null], 'BODY(4자)·하이링크(4자) 같은 길이 → 정하지 않음');
  assert.deepEqual(brandCost(v), { '바디랩': 60000, '하이링크': 40000, '(브랜드 없음)': 5000 });
  const s = await ctx.owner.ok('GET', '/api/marketing/sites?weeks=1');
  const adCost = Object.fromEntries(s.rows.map((x) => [x.name, x.weeks[0].adCost]));
  assert.equal(adCost['하이링크'], 40000, '사이트별 집계 광고비도 캠페인 브랜드'); assert.equal(adCost['바디랩'], 60000);
  const [a] = await sql`select count(*)::int n from audit_logs where action = 'mkt_ads.brand_aliases'`;
  assert.equal(a.n, 2, '감사 기록(저장된 2번만 — 거절된 요청은 기록 없음)');
});

test('캠페인 브랜드 직접 지정(관리자): 브랜드 → 공통(브랜드 없음) → 자동으로 되돌리기 · 남의 회사 404', async () => {
  const put = (c, b) => c.req('PUT', '/api/marketing/ads/campaign-brand', b);
  assert.equal((await put(ctx.staffA.client, { accountId: A.shared, campaignId: 'c-mix', brandId: B['다짐'] })).status, 403, '직원은 못 바꿈');
  assert.equal((await put(ctx.owner, { accountId: A.other, campaignId: 'o-1', brandId: B['다짐'] })).status, 404, '남의 회사 계정 404');
  assert.equal((await put(ctx.owner, { accountId: A.shared, campaignId: 'c-mix', brandId: B.other })).status, 404, '남의 회사 브랜드 404');
  assert.equal((await put(ctx.owner, { accountId: A.shared, campaignId: 'nope', brandId: B['다짐'] })).status, 404, '없는 캠페인 404');
  assert.deepEqual(await ctx.owner.ok('PUT', '/api/marketing/ads/campaign-brand', { accountId: A.shared, campaignId: 'c-mix', brandId: B['다짐'] }), { brandId: B['다짐'], source: 'manual' });
  let v = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`);
  assert.deepEqual([camp(v, 'c-mix').brand, camp(v, 'c-mix').brand_source, camp(v, 'c-mix').auto_brand_id], ['다짐', 'manual', null], '직접 지정 · 자동이면 정하지 않음(같은 길이)');
  assert.equal(brandCost(v)['다짐'], 5000);
  // 계정 브랜드가 있는 캠페인도 직접 지정이 먼저
  await ctx.owner.ok('PUT', '/api/marketing/ads/campaign-brand', { accountId: A.meta, campaignId: 'm-1', brandId: B['하이링크'] });
  v = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`);
  assert.deepEqual([camp(v, 'm-1').brand, camp(v, 'm-1').brand_source, camp(v, 'm-1').auto_brand_id, camp(v, 'm-1').auto_source], ['하이링크', 'manual', B['바디랩'], 'account']);
  assert.deepEqual(brandCost(v), { '하이링크': 80000, '바디랩': 20000, '다짐': 5000 });
  // 공통(브랜드 없음)으로 직접
  assert.deepEqual(await ctx.owner.ok('PUT', '/api/marketing/ads/campaign-brand', { accountId: A.shared, campaignId: 'c-hl', brandId: null }), { brandId: null, source: 'manual' });
  v = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`);
  assert.deepEqual([camp(v, 'c-hl').brand_id, camp(v, 'c-hl').brand_source, camp(v, 'c-hl').auto_brand_id], [null, 'manual', B['하이링크']]);
  // 자동으로 되돌리기
  assert.deepEqual(await ctx.owner.ok('PUT', '/api/marketing/ads/campaign-brand', { accountId: A.shared, campaignId: 'c-hl', brandId: 'auto' }), { brandId: B['하이링크'], source: 'name' });
  assert.equal((await sql`select count(*)::int n from mkt_ad_campaign_brands where campaign_id = 'c-hl'`)[0].n, 0, '자동 = 직접 지정 줄 지움');
  // 브랜드를 지우면 그 직접 지정도 사라져 자동으로
  await sql`delete from mkt_brands where id = ${B['다짐']}`;
  v = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`);
  assert.deepEqual([camp(v, 'c-mix').brand_id, camp(v, 'c-mix').brand_source], [null, null]);
  const [a] = await sql`select count(*)::int n from audit_logs where action = 'mkt_ads.campaign_brand'`;
  assert.equal(a.n, 4, '감사 기록');
});
