// 대표 10/21 14:30 #411 광고비 충전 흐름(구조 시험 — 가짜 네이버 비즈머니): 잔액이 최근 7일 페이스 기준 3일분 미만 → tick 이 운영실 '충전 필요' 카드(금액 제안·충전 페이지 딥링크·알림)
// → 대표 승인 → 잔액이 올라간 것을 다음 동기화에서 감지하면 자동 '완료' · 구글 선불은 관리자 직접 입력(직원 403) · 광고실 잔액 표
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3229;
let srv, ctx, sql, fake, mailSrv, bizmoney = 20000, calls = []; const mails = [];
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
  mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { mails.push(JSON.parse(b)); } catch { /* 무시 */ } res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m"}'); }); });
  await new Promise((r) => mailSrv.listen(0, '127.0.0.1', r));
  await resetDb(); srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}`, RESEND_API_KEY: 'test-key', MAIL_FROM: '워크인 <no-reply@work.test>', RESEND_API_BASE: `http://127.0.0.1:${mailSrv.address().port}` }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
});
after(async () => { srv?.proc.kill(); fake?.close(); mailSrv?.close(); await sql?.end(); });

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

// 322차 #897(대표 11/02 00:0x '잔여 비즈머니로 우선 진행하고 10,000원 미만으로 떨어졌을 때 대표자한테 워크인에서 알림'): 페이스 카드와 별개로 기준 금액(기본 1만 원, 회사 설정) 미만이면
// 회사 대표(소유자)에게 워크인 알림 + 메일 — 매체 줄마다 하루 1번 · 기준 위로 오르면 다시 알림 대상 · 광고 성과 화면에 기준 표시 · 관리자만 바꿈
test('322차 #897 잔액 기준 금액 미만 → 대표 알림 + 메일(하루 1번) · 기준은 회사 설정(관리자) · 기준 위로 오르면 다시 알림 대상', async () => {
  const back = () => sql`update mkt_ad_balances set checked_at = now() - interval '7 hours' where tenant = 'default' and provider = 'naver'`;
  const alerts = async () => sql`select title, body from notifications where user_id = ${ctx.ownerId} and type = 'usage_alert' and title like '광고 잔액%' order by created_at`;
  bizmoney = 9000; await back(); mails.length = 0;
  await tick();
  let a = await alerts();
  assert.equal(a.length, 1, JSON.stringify(a)); assert.match(a[0].title, /^광고 잔액 9,000원 — 10,000원 미만: 네이버 검색광고 하이링크/); assert.match(a[0].body, /충전/);
  const m = mails.filter((x) => String(x.subject ?? '').includes('광고 잔액')); assert.equal(m.length, 1, JSON.stringify(mails.map((x) => x.subject))); assert.match(m[0].subject, /9,000원/);
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/ads?days=7')).lowBalanceKrw, 10000, '기본 기준');
  await back(); await tick();
  assert.equal((await alerts()).length, 1, '같은 날 두 번 안 보냄'); assert.equal(mails.filter((x) => String(x.subject ?? '').includes('광고 잔액')).length, 1);
  // 기준 바꾸기(관리자만) → 9,000 은 기준(5,000) 위 → 알림 표시 비움 → 4,000 으로 내려가면 다시 알림
  assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/marketing/auto', { lowBalanceKrw: 5000 })).status), '직원은 못 바꿈');
  await ctx.owner.ok('PUT', '/api/marketing/auto', { lowBalanceKrw: 5000 });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/ads?days=7')).lowBalanceKrw, 5000);
  await back(); await tick();
  assert.equal((await alerts()).length, 1);
  assert.equal((await sql`select low_alerted_on from mkt_ad_balances where tenant = 'default' and provider = 'naver'`)[0].low_alerted_on, null, '기준 위로 오르면 다시 알림 대상');
  bizmoney = 4000; await back(); await tick();
  a = await alerts(); assert.equal(a.length, 2, JSON.stringify(a)); assert.match(a[1].title, /^광고 잔액 4,000원 — 5,000원 미만/);
  assert.equal(mails.filter((x) => String(x.subject ?? '').includes('광고 잔액')).length, 2);
});
