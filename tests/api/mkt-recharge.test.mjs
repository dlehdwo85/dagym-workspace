// 대표 10/21 14:30 #411 광고비 충전 흐름(구조 시험 — 가짜 네이버 비즈머니): 잔액이 최근 7일 페이스 기준 3일분 미만 → tick 이 운영실 '충전 필요' 카드(금액 제안·충전 페이지 딥링크·알림)
// → 대표 승인 → 잔액이 올라간 것을 다음 동기화에서 감지하면 자동 '완료' · 구글 선불은 관리자 직접 입력(직원 403) · 광고실 잔액 표
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3229;
let srv, ctx, sql, fake, bizmoney = 20000, calls = [];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const dayAgo = (n) => { const d = new Date(`${today}T12:00:00+09:00`); d.setUTCDate(d.getUTCDate() - n); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d); };
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    res.setHeader('content-type', 'application/json');
    const send = (code, j) => { res.statusCode = code; res.end(JSON.stringify(j)); };
    if (!u.pathname.startsWith('/naver/')) return send(404, { error: 'nope' });
    const path = u.pathname.slice('/naver'.length);
    const sig = createHmac('sha256', 'naver-secret-key-xyz').update(`${req.headers['x-timestamp']}.${req.method}.${path}`).digest('base64');
    if (req.headers['x-signature'] !== sig || req.headers['x-customer'] !== '1234567') return send(403, { title: 'Forbidden', code: 1018 });
    calls.push(path);
    if (path === '/ncc/campaigns') return send(200, [{ nccCampaignId: 'cmp-1', name: '파워링크' }]);
    if (path === '/stats') return send(200, { data: [] });
    if (path === '/billing/bizmoney') return send(200, { bizmoney, refundLock: 0 });
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb(); srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

test('네이버 비즈머니 2일분 → tick 카드(조치)·딥링크·알림 → 승인 → 잔액 상승 감지 → 자동 완료', async () => {
  const acc = (await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '하이링크', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' })).id;
  for (let i = 0; i < 7; i++) await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw, conversions) values (${acc}, ${dayAgo(i)}, 'cmp-1', '파워링크', 1000, 30, 10000, 1)`;
  await tick();
  const b = (await ctx.staffA.client.ok('GET', '/api/marketing/ads/balances')).balances;
  assert.equal(b.length, 1); assert.deepEqual([b[0].provider, b[0].label, b[0].balance, b[0].source, b[0].pace, b[0].days, b[0].level], ['naver', '하이링크', 20000, 'api', 10000, 2, 'action']);
  assert.ok(calls.includes('/billing/bizmoney'), '비즈머니 조회');
  const [card] = await sql`select id, status, title, body from mkt_proposals where tenant = 'default' and kind = 'alert' and body->>'signal' = 'recharge:naver:하이링크'`;
  assert.ok(card, '충전 필요 카드'); assert.equal(card.status, 'pending'); assert.match(card.title, /^충전 필요: 네이버 검색광고 하이링크 잔액 20,000원\(약 2일\)/);
  assert.equal(card.body.amount, 280000, '30일분 − 잔액 = 28만'); assert.equal(card.body.link, 'https://searchad.naver.com/'); assert.equal(card.body.level, 'action');
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and type = 'usage_alert' and title like '충전 필요: 네이버%'`).length, '승인자 알림');
  await tick();
  assert.equal((await sql`select count(*)::int c from mkt_proposals where tenant = 'default' and body->>'signal' = 'recharge:naver:하이링크'`)[0].c, 1, '열린 카드 있으면 중복 없음');
  const ov = await ctx.owner.ok('GET', '/api/marketing/ads?days=7'); assert.equal(ov.balances?.[0]?.level, 'action', '광고실 잔액 표');
  await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${card.id}`, { action: 'approve' });
  // 대표가 매체에서 충전 → 다음 동기화(6시간 지남) 에서 잔액 상승 감지 → 자동 완료
  bizmoney = 350000; await sql`update mkt_ad_balances set checked_at = now() - interval '7 hours' where tenant = 'default'`;
  await tick();
  const [after] = await sql`select status, executed from mkt_proposals where id = ${card.id}`;
  assert.equal(after.status, 'done'); assert.equal(after.executed.auto, true); assert.equal(Number(after.executed.balanceNow), 350000);
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/ads/balances')).balances[0].level, 'ok');
  await tick(); assert.equal((await sql`select count(*)::int c from mkt_proposals where tenant = 'default' and body->>'signal' = 'recharge:naver:하이링크'`)[0].c, 1, '잔액 충분하면 새 카드 없음');
});

test('구글 선불(직접 입력): 직원 403 · 관리자 입력 → 지출 기록 없으면 ok · 지출 있으면 페이스 기준 카드', async () => {
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/ads/balances', { provider: 'google', label: '', balanceKrw: 94824 })).status, 403);
  const r = await ctx.owner.ok('PUT', '/api/marketing/ads/balances', { provider: 'google', label: '', balanceKrw: 94824 });
  const g = r.balances.find((x) => x.provider === 'google'); assert.deepEqual([g.balance, g.source, g.days, g.level], [94824, 'manual', null, 'ok']);
  assert.equal((await sql`select count(*)::int c from mkt_proposals where tenant = 'default' and body->>'signal' = 'recharge:google:'`)[0].c, 0);
  // 구글 지출 하루 2만 → 94,824 은 약 4.7일분 → 경고 카드
  await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, status) values ('default', 'google', '1112223333', '구글', 'active')`;
  const [ga] = await sql`select id from mkt_ad_accounts where tenant = 'default' and provider = 'google'`;
  for (let i = 0; i < 7; i++) await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw, conversions) values (${ga.id}, ${dayAgo(i)}, 'g-1', '검색', 500, 20, 20000, 0)`;
  const r2 = await ctx.owner.ok('PUT', '/api/marketing/ads/balances', { provider: 'google', label: '', balanceKrw: 94824 });
  const g2 = r2.balances.find((x) => x.provider === 'google'); assert.deepEqual([g2.days, g2.level], [4.7, 'warn']);
  const [card] = await sql`select title, body from mkt_proposals where tenant = 'default' and body->>'signal' = 'recharge:google:'`;
  assert.ok(card, '경고 카드'); assert.equal(card.body.link, 'https://ads.google.com/aw/billing/summary'); assert.equal(card.body.amount, 510000, '60만 − 94,824 → 만 원 올림');
});
