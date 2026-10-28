// #754(대표 10/28 '다짐과 DAGYM 은 같은 브랜드 — 다짐 하나로'): 브랜드 합치기 — 합칠 브랜드의 콘텐츠·광고 계정·캠페인 연결·목표(같은 달이면 남길 브랜드 것)·광고 예산 브랜드 계획을 옮기고
// 이름·찾는 낱말은 남길 브랜드의 찾는 낱말로, 키트 빈 칸은 채우고 목록 칸은 합치고 광고 비중은 더한 뒤 합칠 브랜드를 지움 · 관리자만 · 다른 회사 브랜드는 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql; const B = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  [B.from] = await sql`insert into mkt_brands (tenant, name, tone, intro, ad_share, colors, ad_aliases, banned_words, voice) values ('default', 'DAGYM', '친근', '영문 표기 소개', 10, ${['#111111']}, ${['DAGYM_KR']}, ${['최고']}, ${sql.json({ notes: '합칠 쪽 말투' })}) returning id`;
  [B.into] = await sql`insert into mkt_brands (tenant, name, intro, ad_share, colors, banned_words) values ('default', '다짐', '한글 소개', 15, ${['#222222']}, ${['무조건']}) returning id`;
  [B.other] = await sql`insert into mkt_brands (tenant, name) values ('default', '하이링크') returning id`;
  await sql`insert into mkt_contents (tenant, title, brand_id) values ('default', 'DAGYM 글 1', ${B.from.id}), ('default', 'DAGYM 글 2', ${B.from.id}), ('default', '다짐 글', ${B.into.id})`;
  await sql`insert into mkt_goals (tenant, brand_id, month) values ('default', ${B.from.id}, '2026-10'), ('default', ${B.from.id}, '2026-11'), ('default', ${B.into.id}, '2026-10')`;
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, brand_id) values ('default', 'meta', '754001', 'DAGYM 메타', ${B.from.id}) returning id`;
  await sql`insert into mkt_ad_campaign_brands (account_id, campaign_id, brand_id) values (${acc.id}, 'c-754', ${B.from.id})`;
  await sql`insert into mkt_ad_budgets (tenant, month, status, total, brand_plan) values ('default', '2026-10', 'approved', 300000,
    ${sql.json([{ brandId: B.from.id, name: 'DAGYM', monthly: 100000 }, { brandId: B.into.id, name: '다짐', monthly: 200000 }, { brandId: B.other.id, name: '하이링크', monthly: 50000 }])})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('관리자가 아니면 못 함 · 같은 브랜드끼리 400 · 없는 브랜드 404', async () => {
  const s = await ctx.staffA.client.req('POST', `/api/marketing/auto/brands/${B.from.id}/merge`, { into: B.into.id });
  assert.ok([403, 404].includes(s.status), String(s.status));
  assert.equal((await ctx.owner.req('POST', `/api/marketing/auto/brands/${B.from.id}/merge`, { into: B.from.id })).status, 400);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/auto/brands/${B.from.id}/merge`, { into: '00000000-0000-4000-8000-000000000754' })).status, 404);
  assert.equal((await sql`select count(*)::int n from mkt_brands where id = ${B.from.id}`)[0].n, 1, '아무것도 안 바뀜');
});

test("DAGYM → 다짐: 콘텐츠·광고 계정·캠페인 연결·목표 옮김(같은 달은 다짐 것) · 예산 계획 합산 · 찾는 낱말·키트 합침 · DAGYM 지움", async () => {
  const r = await ctx.owner.ok('POST', `/api/marketing/auto/brands/${B.from.id}/merge`, { into: B.into.id });
  assert.deepEqual([r.from.name, r.into.name, r.goalsDropped, r.budgets], ['DAGYM', '다짐', 1, 1]);
  assert.deepEqual({ c: r.moved.mkt_contents, g: r.moved.mkt_goals, a: r.moved.mkt_ad_accounts, cb: r.moved.mkt_ad_campaign_brands }, { c: 2, g: 1, a: 1, cb: 1 });
  assert.equal((await sql`select count(*)::int n from mkt_brands where id = ${B.from.id}`)[0].n, 0, '합친 브랜드는 지움');
  assert.equal((await sql`select count(*)::int n from mkt_contents where brand_id = ${B.into.id}`)[0].n, 3);
  assert.deepEqual((await sql`select month from mkt_goals where brand_id = ${B.into.id} order by month`).map((g) => g.month), ['2026-10', '2026-11']);
  assert.equal((await sql`select brand_id from mkt_ad_campaign_brands where campaign_id = 'c-754'`)[0].brand_id, B.into.id, '캠페인 연결이 지워지지 않고 옮겨짐');
  const [plan] = await sql`select brand_plan from mkt_ad_budgets where tenant = 'default' and month = '2026-10'`;
  assert.deepEqual(plan.brand_plan.map((x) => [x.brandId, x.monthly]), [[B.into.id, 300000], [B.other.id, 50000]], '같은 브랜드 금액은 더함');
  const [k] = await sql`select ad_aliases, tone, intro, ad_share::float8 as share, colors, banned_words, voice from mkt_brands where id = ${B.into.id}`;
  assert.deepEqual([k.ad_aliases, k.tone, k.intro, k.share, k.colors, k.banned_words, k.voice], [['DAGYM', 'DAGYM_KR'], '친근', '한글 소개', 25, ['#222222', '#111111'], ['무조건', '최고'], { notes: '합칠 쪽 말투' }]);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'marketing.brand_merge'`)[0].n, 1);
  // 광고 캠페인 이름에 DAGYM 이 있으면 다짐으로 셈(찾는 낱말)
  const list = await ctx.owner.ok('GET', '/api/marketing/brands');
  assert.deepEqual(list.brands.map((b) => b.name).sort(), ['다짐', '하이링크']);
});
