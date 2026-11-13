// 402차 #1028(대표 11/13 "하이링크는 절대 네이버 광고 비용이 닳아서 광고가 진행 안 되는 상황이 연출되어선 안 됩니다. 이 부분은 메일로 따로 알려 주세요"):
// 끊김 방지 메일 — 켠 계정의 남은 날이 14·7·3일 아래로 내려갈 때마다 대표 메일(같은 단계는 하루 1번을 넘지 않음), 3일 아래·잔액 0 은 채워질 때까지 하루 1번 다시,
// 14일 위로 올라오면 비움(다시 내려가면 또 알림) · 켜지 않은 계정은 안 감 · 관리자만 켬 · 다른 회사 줄은 404
// 잔액은 직접 입력으로 바꿔 가며 확인(매체 연동 = 구조 시험), 메일은 가짜 발송 서버
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, mailSrv, acc, acc2, H, B; const mails = [];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const dayAgo = (n) => { const d = new Date(`${today}T12:00:00+09:00`); d.setUTCDate(d.getUTCDate() - n); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d); };
const guardMails = () => mails.filter((m) => /남음\(\d+일 아래\)|광고가 멈춥니다/.test(m.subject));
const setBal = (label, krw) => ctx.owner.ok('PUT', '/api/marketing/ads/balances', { provider: 'naver', label, balanceKrw: krw });
const row = async (id) => (await sql`select guard, guard_stage, guard_on::text as guard_on from mkt_ad_balances where id = ${id}`)[0];

before(async () => {
  mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { mails.push(JSON.parse(b)); } catch { /* 무시 */ } res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"m"}'); }); });
  await new Promise((r) => mailSrv.listen(0, '127.0.0.1', r));
  await resetDb();
  srv = await startServer({ RESEND_API_KEY: 'test-key', MAIL_FROM: '워크인 <no-reply@work.test>', RESEND_API_BASE: `http://127.0.0.1:${mailSrv.address().port}` }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  // 계정 2개: 하루 평균 7,000원(하이링크) · 2,000원(바디랩)
  acc = (await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, status, last_sync_at) values ('default', 'naver', '1111111', '다짐·하이링크', 'active', now()) returning id`)[0].id;
  acc2 = (await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, status, last_sync_at) values ('default', 'naver', '2222222', '바디랩 두정점', 'active', now()) returning id`)[0].id;
  for (let i = 0; i < 7; i++) {
    await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${acc}, ${dayAgo(i)}, 'c-h', '하이링크_아파트플랫폼', 1000, 20, 7000)`;
    await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${acc2}, ${dayAgo(i)}, 'c-b', '바디랩 두정점 플레이스', 500, 10, 2000)`;
  }
  await setBal('다짐·하이링크', 140000); await setBal('바디랩 두정점', 100000);
  const b = (await ctx.owner.ok('GET', '/api/marketing/ads/balances')).balances;
  H = b.find((x) => x.label === '다짐·하이링크'); B = b.find((x) => x.label === '바디랩 두정점');
  assert.deepEqual([H.pace, H.days, H.guard, B.pace, B.days, B.guard], [7000, 20, false, 2000, 50, false]);
});
after(async () => { srv?.proc.kill(); mailSrv?.close(); await sql?.end(); });

test('켜기: 관리자만 · 다른 회사 줄 404 · 20일분이면 메일 없음', async () => {
  assert.equal((await ctx.staffA.client.req('PATCH', '/api/marketing/ads/balances', { id: H.id, guard: true })).status, 403);
  assert.equal((await ctx.owner.req('PATCH', '/api/marketing/ads/balances', { id: '00000000-0000-4000-8000-000000001028', guard: true })).status, 404);
  const r = await ctx.owner.ok('PATCH', '/api/marketing/ads/balances', { id: H.id, guard: true });
  assert.equal(r.sent, 0); assert.equal(r.balances.find((x) => x.id === H.id).guard, true);
  assert.equal(guardMails().length, 0, '14일 위면 메일 없음');
});

test('14일 아래 → 메일 1통(잔액·하루 평균·남은 날·충전 경로) · 같은 날 다시 확인해도 안 감 · 켜지 않은 계정은 7일 아래여도 안 감', async () => {
  await setBal('다짐·하이링크', 91000); // 13일
  let g = guardMails(); assert.equal(g.length, 1, JSON.stringify(mails.map((m) => m.subject)));
  assert.match(g[0].subject, /^\[워크인\] 광고 잔액 약 13일분 남음\(14일 아래\) — 네이버 검색광고 다짐·하이링크 91,000원$/);
  assert.ok(JSON.stringify(g[0].to).includes('ceo@dagym.test'), '회사 대표에게');
  const text = String(g[0].text ?? g[0].html);
  for (const re of [/잔액: 91,000원/, /하루 평균 지출\(최근 7일\): 7,000원/, /남은 날: 약 13일/, /충전 경로: 네이버 검색광고 › 광고주센터 › 비즈머니 › \[충전하기\]/, /searchad\.naver\.com/, /다음 알림: 남은 날이 7일 아래로/]) assert.match(text, re);
  assert.deepEqual(await row(H.id), { guard: true, guard_stage: 14, guard_on: today });
  await setBal('다짐·하이링크', 90000); await setBal('다짐·하이링크', 85000); // 같은 단계
  assert.equal(guardMails().length, 1, '같은 단계는 다시 안 감');
  await sql`update mkt_ad_balances set guard_on = guard_on - 1 where id = ${H.id}`; await setBal('다짐·하이링크', 84000);
  assert.equal(guardMails().length, 1, '14일 단계는 다음 날에도 다시 안 감(7일 아래로 내려갈 때 다음 메일)');
  await setBal('바디랩 두정점', 12000); // 6일분 — 켜지 않음
  assert.equal(guardMails().length, 1, '켜지 않은 계정은 메일 없음');
  const n = await sql`select title, link from notifications where user_id = ${ctx.ownerId} and dedupe_key like 'mktguard:%'`;
  assert.equal(n.length, 1); assert.equal(n[0].link, '/s/marketing/connections');
});

test('7일 아래 → 메일 · 3일 아래 → 메일, 다음 날 또 1통(채워질 때까지) · 잔액 0 → 바로 "광고가 멈춥니다"', async () => {
  await setBal('다짐·하이링크', 45500); // 6.5일
  let g = guardMails(); assert.equal(g.length, 2); assert.match(g[1].subject, /약 6\.5일분 남음\(7일 아래\)/); assert.match(String(g[1].text ?? g[1].html), /다음 알림: 남은 날이 3일 아래로/);
  await setBal('다짐·하이링크', 17500); // 2.5일
  g = guardMails(); assert.equal(g.length, 3); assert.match(g[2].subject, /약 2\.5일분 남음\(3일 아래\)/); assert.match(String(g[2].text ?? g[2].html), /하루에 한 번 다시 알려 드립니다/);
  await setBal('다짐·하이링크', 17000);
  assert.equal(guardMails().length, 3, '같은 날은 1통');
  await sql`update mkt_ad_balances set guard_on = guard_on - 1 where id = ${H.id}`; await setBal('다짐·하이링크', 16000);
  assert.equal(guardMails().length, 4, '3일 아래는 다음 날 다시');
  await setBal('다짐·하이링크', 0);
  g = guardMails(); assert.equal(g.length, 5, '0원은 같은 날이어도 바로(더 급한 단계)');
  assert.match(g[4].subject, /^\[워크인\] 광고가 멈춥니다 — 네이버 검색광고 다짐·하이링크 잔액 0원$/);
  assert.match(String(g[4].text ?? g[4].html), /충전할 때까지 광고가 나가지 않습니다/);
  assert.equal((await row(H.id)).guard_stage, 0);
});

test('충전해 14일 위로 → 표시 비움 · 다시 14일 아래로 → 또 메일 · 조금만 채워 덜 급해지면 조용히 단계만 · 끄면 안 감', async () => {
  const n0 = guardMails().length;
  await setBal('다짐·하이링크', 210000); // 30일
  assert.deepEqual(await row(H.id), { guard: true, guard_stage: null, guard_on: null }); assert.equal(guardMails().length, n0);
  await setBal('다짐·하이링크', 20000); // 2.9일 → 3일 단계 메일
  assert.equal(guardMails().length, n0 + 1);
  await setBal('다짐·하이링크', 40000); // 5.7일 — 덜 급해짐: 메일 없이 단계만 7
  assert.equal(guardMails().length, n0 + 1); assert.equal((await row(H.id)).guard_stage, 7);
  await ctx.owner.ok('PATCH', '/api/marketing/ads/balances', { id: H.id, guard: false });
  await setBal('다짐·하이링크', 10500); // 1.5일 — 꺼서 안 감
  assert.equal(guardMails().length, n0 + 1);
  // 켜는 순간 이미 기준 아래면 바로 1통
  const r = await ctx.owner.ok('PATCH', '/api/marketing/ads/balances', { id: H.id, guard: true });
  assert.equal(r.sent, 1); assert.equal(guardMails().length, n0 + 2);
});
