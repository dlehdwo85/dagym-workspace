// 대표 10/20 15:40 (#103): 요금제별 마케팅 제작 범위·한도별 금액 — 플랫폼 운영 표(숫자만 바꿈) → 고객 화면 한도·'이번 달 남은 제작 n건'·초과 안내 · 실측 원가로 원가율
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => {
  await resetDb(); srv = await startServer({ MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('플랫폼 운영 표: 기본값(코드와 같음·가격 결정 전) → 숫자 바꾸기 → 원가율 계산 · 원가 기준 바꾸기 · 플랫폼 운영자 아니면 404', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/platform/mkt-plans')).status, 404);
  assert.equal((await ctx.staffA.client.req('PUT', '/api/platform/mkt-plans', { plan: { code: 'pro', monthlyCredits: 1 } })).status, 404);
  const g = await ctx.owner.ok('GET', '/api/platform/mkt-plans');
  const pro = g.plans.find((p) => p.code === 'pro'); assert.equal(pro.monthlyCredits, 250); assert.equal(pro.price, null); assert.equal(pro.rateMin, null); assert.deepEqual(pro.weekly, { feed: 5, blog: 2, reels: 2 });
  assert.equal(pro.images, Math.floor(250 / 6.5)); assert.equal(pro.videos, 3); assert.equal(pro.costMin, 250 * 43); assert.equal(pro.costMax, 250 * 70);
  const s = await ctx.owner.ok('PUT', '/api/platform/mkt-plans', { plan: { code: 'pro', priceKrw: 199000, monthlyCredits: 300, weekly: { feed: 5, blog: 2, reels: 2, shorts: 2, story: 3 }, videoMonthly: 3, regenMonthly: 12, extraCreditKrw: 60 } });
  const p2 = s.plans.find((p) => p.code === 'pro'); assert.equal(p2.price, 199000); assert.equal(p2.monthlyCredits, 300); assert.equal(p2.weekly.story, 3); assert.equal(p2.extraCreditKrw, 60);
  assert.equal(p2.rateMin, Math.round((300 * 43 / 199000) * 1000) / 10); assert.equal(p2.rateMax, Math.round((300 * 70 / 199000) * 1000) / 10);
  const c = await ctx.owner.ok('PUT', '/api/platform/mkt-plans', { cost: { imageCredits: 5, videoCredits: 100, krwPerCreditMin: 50, krwPerCreditMax: 60 } });
  const p3 = c.plans.find((p) => p.code === 'pro'); assert.equal(p3.images, 60); assert.equal(p3.videos, 3); assert.equal(p3.costMin, 300 * 50);
  assert.equal((await ctx.owner.req('PUT', '/api/platform/mkt-plans', { cost: { imageCredits: 5, videoCredits: 100, krwPerCreditMin: 70, krwPerCreditMax: 60 } })).status, 400);
  assert.equal((await ctx.owner.req('PUT', '/api/platform/mkt-plans', { plan: { code: 'gold', monthlyCredits: 1 } })).status, 400);
  const [a] = await sql`select count(*)::int n from audit_logs where action = 'platform.mkt_plan.save'`; assert.ok(a.n >= 1);
});

test('고객 화면: 요금제 고르면 표의 숫자가 한도로 · 이번 달 남은 제작(이미지/영상 환산·주간 종류별) · 크레딧 다 쓰면 초과 안내(초과 크레딧 금액) · 홈에도', async () => {
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro' });
  const v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.equal(v.limits.monthlyCredits, 300); assert.equal(v.limits.videoMonthly, 3); assert.equal(v.plans.pro.price, 199000);
  const a = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.equal(a.production.leftCredits, 300); assert.equal(a.production.images, 60); assert.equal(a.production.videos, 3); assert.equal(a.production.over, false); assert.equal(a.production.overMessage, null);
  assert.deepEqual(a.production.weekly.map((w) => `${w.kind}:${w.limit}:${w.used}`).sort(), ['blog:2:0', 'feed:5:0', 'reels:2:0', 'shorts:2:0', 'story:3:0']);
  await sql`insert into mkt_credit_ledger (tenant, kind, credits, note) values ('default', 'generate_image', 295, '시험'), ('default', 'generate_video', 20, '시험')`;
  const b = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.equal(b.production.leftCredits, 0); assert.equal(b.production.over, true); assert.equal(b.production.shortfall, 15); assert.match(b.production.overMessage, /초과 15/); assert.match(b.production.overMessage, /60원/); assert.match(b.production.overMessage, /900원/);
  const h = await ctx.owner.ok('GET', '/api/marketing/home'); assert.equal(h.production.over, true); assert.equal(h.production.images, 0);
  // 직원도 남은 제작은 봄
  const st = await ctx.staffA.client.ok('GET', '/api/marketing/auto'); assert.equal(st.production.over, true);
});
