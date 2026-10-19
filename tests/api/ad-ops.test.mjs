// V44 ① 광고 운영(네이버 파워링크 쓰기, 가짜 서버 = 구조 시험): 상한 필수 → 세팅안 검사(글자 수·위험 표현) → [승인하고 시작] = 꺼진 상태로 생성(서명 요청) →
// [켜기] 상한 검사 → 끄기·예산·되돌리기 기록 → 월 상한 넘으면 tick 이 자동 중지·알림 1회 · 직원 403 · 다른 회사 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3223;
let srv, ctx, sql, fake, calls = [], seq = 0;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const path = u.pathname.slice('/naver'.length);
    res.setHeader('content-type', 'application/json');
    const send = (code, j) => { res.statusCode = code; res.end(JSON.stringify(j)); };
    const sig = createHmac('sha256', 'naver-secret-key-xyz').update(`${req.headers['x-timestamp']}.${req.method}.${path}`).digest('base64');
    if (req.headers['x-signature'] !== sig || req.headers['x-customer'] !== '1234567') return send(403, { title: 'Forbidden', code: 1018 });
    const j = body ? JSON.parse(body) : null;
    calls.push({ method: req.method, path, q: Object.fromEntries(u.searchParams), body: j });
    if (req.method === 'GET' && path === '/ncc/campaigns') return send(200, [{ nccCampaignId: 'cmp-a', name: '기존' }]);
    if (req.method === 'GET' && path === '/stats') return send(200, { data: [] });
    if (req.method === 'GET' && path === '/ncc/channels') return send(200, [{ nccBusinessChannelId: 'bsn-1', name: '우리 홈페이지', channelTp: 'WEB_SITE', channelKey: 'https://example.com' }, { nccBusinessChannelId: 'bsn-2', name: '플레이스', channelTp: 'PLACE' }]);
    if (req.method === 'POST' && path === '/ncc/campaigns') return send(200, { nccCampaignId: `cmp-${++seq}`, ...j });
    if (req.method === 'POST' && path === '/ncc/adgroups') return send(200, { nccAdgroupId: 'grp-1', ...j });
    if (req.method === 'POST' && path === '/ncc/keywords') return send(200, j.map((k, i) => ({ nccKeywordId: `kw-${i + 1}`, ...k })));
    if (req.method === 'POST' && path === '/ncc/ads') return send(200, { nccAdId: `ad-${++seq}`, ...j });
    if (req.method === 'PUT' && path.startsWith('/ncc/campaigns/')) return send(200, { ...j });
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

const plan = (accountId, over = {}) => ({ accountId, name: '가을 회원 모집', dailyBudget: 10000, bidAmt: 300, channelId: 'bsn-1', keywords: ['동네 헬스장', 'PT 가격'],
  ads: [{ headline: '가을 PT 상담', description: '첫 상담 무료, 가까운 헬스장에서 시작하세요', url: 'https://example.com' }], ...over });

test('상한 필수·검사·꺼진 상태 생성·켜기/끄기/예산·되돌리기·자동 중지', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  const acc = await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '본점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' });
  // 비즈채널 목록(웹사이트만)
  assert.deepEqual((await ctx.owner.ok('GET', `/api/marketing/ad-ops/channels?accountId=${acc.id}`)).channels.map((c) => c.id), ['bsn-1']);
  // 검사: 제목 15자 넘음 + 보장 표현 → 저장은 되지만 시작 막힘
  const bad = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '검사 걸림', ads: [{ headline: '무조건 효과 보장하는 가을 PT 특가', description: '설명', url: 'https://example.com' }] }));
  assert.equal(bad.issues.length >= 2, true, JSON.stringify(bad.issues));
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ad-ops/plans', plan(acc.id))).status, 403, '직원은 못 만듦');
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id));
  assert.deepEqual(p.issues, []);
  // 상한 없으면 시작 409
  const noCap = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(noCap.status, 409); assert.equal(noCap.body.error.code, 'cap_required');
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 300000 })).status, 403);
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 300000 });
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${bad.id}/approve`, {})).status, 409, '검사 걸린 세팅안은 시작 못 함');
  // 시작 = 네이버에 꺼진 상태로 생성
  calls = [];
  const ok = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.ok(ok.external.campaignId && ok.external.adgroupId);
  const camp = calls.find((c) => c.method === 'POST' && c.path === '/ncc/campaigns');
  assert.deepEqual([camp.body.campaignTp, camp.body.userLock, camp.body.dailyBudget], ['WEB_SITE', true, 10000], '꺼진 상태로 생성');
  assert.equal(calls.find((c) => c.path === '/ncc/adgroups').body.userLock, true);
  assert.deepEqual(calls.find((c) => c.path === '/ncc/keywords').body.map((k) => k.keyword), ['동네 헬스장', 'PT 가격']);
  assert.equal(calls.filter((c) => c.path === '/ncc/ads').length, 1);
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {})).status, 409, '두 번 만들지 않음');
  // 켜기(상한 안) → 끄기 → 예산 올림 → 되돌리기
  calls = [];
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'enable' });
  assert.deepEqual([calls[0].method, calls[0].q.fields, calls[0].body.userLock], ['PUT', 'userLock', false]);
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'budget', dailyBudget: 20000 });
  assert.equal(calls.at(-1).body.dailyBudget, 20000);
  let ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  const budget = ov.changes.find((c) => c.kind === 'budget');
  assert.equal(budget.money_up, true);
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/changes/${budget.id}/revert`, {});
  assert.equal(calls.at(-1).body.dailyBudget, 10000, '되돌리기 = 전 값');
  ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  assert.equal(ov.plans.find((x) => x.id === p.id).status, 'active');
  assert.deepEqual(ov.changes.map((c) => c.kind).slice(0, 4), ['budget', 'budget', 'enable', 'create']);
  assert.equal(ov.changes[0].revert_of, budget.id);
  assert.equal((await ctx.staffA.client.ok('GET', '/api/marketing/ad-ops')).canEdit, false, '직원은 보기만');
  // 이번 달 광고비가 상한을 넘으면 tick 이 자동 중지 + 알림 1번, 켜기도 막힘
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, cost_krw) values (${acc.id}, ${today}, 'cmp-1', '가을 회원 모집', 310000)`;
  calls = [];
  await tick(); await tick();
  ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  assert.equal(ov.plans.find((x) => x.id === p.id).status, 'paused', JSON.stringify(ov.changes[0]));
  assert.equal(ov.changes[0].kind, 'auto_pause');
  assert.equal(calls.find((c) => c.method === 'PUT').body.userLock, true);
  const blocked = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'enable' });
  assert.equal(blocked.body.error.code, 'cap_reached');
  const n = await sql`select count(*)::int n from notifications where dedupe_key like 'adcap:%'`;
  assert.equal(n[0].n, 1, '두 번 돌려도 알림은 한 번');
  // 공간 미배정 직원 404
  assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/ad-ops')).status, 404);
});
