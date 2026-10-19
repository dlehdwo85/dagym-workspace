// V44 ① 광고 운영(네이버 파워링크 쓰기, 가짜 서버 = 구조 시험): 상한 필수 → 세팅안 검사(글자 수·위험 표현) → [승인하고 시작] = 꺼진 상태로 생성(서명 요청) →
// [켜기] 상한 검사 → 끄기·예산·되돌리기 기록 → 월 상한 넘으면 tick 이 자동 중지·알림 1회 · 직원 403 · 다른 회사 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3223;
let srv, ctx, sql, fake, calls = [], seq = 0, failGroup = false, kwBroken = false;
const kwStore = new Map(); // 그룹 → 키워드(가짜 네이버에 실제로 생긴 것)
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
    if (req.method === 'GET' && path === '/ncc/channels') return send(200, [{ nccBusinessChannelId: 'bsn-1', name: '우리 홈페이지', channelTp: 'SITE', channelKey: 'https://example.com' }, { nccBusinessChannelId: 'bsn-2', name: '플레이스', channelTp: 'PLACE' }]);
    if (req.method === 'POST' && path === '/ncc/campaigns') return send(200, { nccCampaignId: `cmp-${++seq}`, ...j });
    if (req.method === 'POST' && path === '/ncc/adgroups') {
      if (failGroup || j.adgroupType !== 'WEB_SITE') return send(400, { title: 'Invalid type of ad group.', code: 3734 }); // 운영 10/19: adgroupType 없으면 3734
      return send(200, { nccAdgroupId: 'grp-1', ...j });
    }
    // 운영 10/19: 생성 응답에서 id 를 못 읽어 'undefined' 저장 → 응답에 id 를 빼서 GET 으로 다시 읽는 길을 시험
    // 운영 10/19 실계정: 200 인데 키워드가 안 생김(빈 응답) → 실패로 다루고 이유를 남겨야 함. 여러 개를 한 번에 보내면 안 생기고 하나씩은 생기는 경우도 흉내
    if (req.method === 'POST' && path === '/ncc/keywords' && kwBroken === 'all') return send(200, []);
    if (req.method === 'POST' && path === '/ncc/keywords' && kwBroken === 'bulk' && j.length > 1) return send(200, []);
    if (req.method === 'POST' && path === '/ncc/keywords') { const g = kwStore.get(u.searchParams.get('nccAdgroupId')) ?? []; for (const k of j) g.push({ nccKeywordId: `kw-${g.length + 1}`, keyword: k.keyword }); kwStore.set(u.searchParams.get('nccAdgroupId'), g); return send(200, j.map((k) => ({ keyword: k.keyword }))); }
    if (req.method === 'GET' && path === '/ncc/keywords') return send(200, kwStore.get(u.searchParams.get('nccAdgroupId')) ?? []);
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
  // 네이버 허용 문자(운영 10/19 '·' 으로 400 1030) — 저장 때 바로 검사, [수정]으로 고치면 통과
  const dot = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '가운데점', ads: [{ headline: '가을 PT', description: '상담·체험 가능 😀', url: 'https://example.com' }] }));
  assert.ok(dot.issues.some((x) => x.includes("'·'") && x.includes("'😀'")), JSON.stringify(dot.issues));
  const fixed = await ctx.owner.ok('PUT', `/api/marketing/ad-ops/plans/${dot.id}`, plan(acc.id, { name: '가운데점 고침', ads: [{ headline: '가을 PT', description: '상담, 체험 가능', url: 'https://example.com' }] }));
  assert.deepEqual(fixed.issues, []);
  assert.equal((await sql`select name from mkt_ad_plans where id = ${dot.id}`)[0].name, '가운데점 고침');
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id));
  assert.deepEqual(p.issues, []);
  // 상한 없으면 시작 409
  const noCap = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(noCap.status, 409); assert.equal(noCap.body.error.code, 'cap_required');
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 300000 })).status, 403);
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 300000 });
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${bad.id}/approve`, {})).status, 409, '검사 걸린 세팅안은 시작 못 함');
  // 중간 실패(광고그룹 400) → 캠페인 id 는 세팅안에 남고 변경 기록에 '생성 실패 + 사유', 다시 누르면 그 캠페인에 이어서(캠페인 중복 생성 없음)
  failGroup = true;
  const half = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(half.status, 502); assert.match(half.body.error.message, /3734/);
  let ov0 = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  const fp = ov0.plans.find((x) => x.id === p.id);
  assert.equal(fp.status, 'failed'); assert.ok(fp.external.campaignId, '만든 캠페인 id 기록');
  const fc = ov0.changes.find((c) => c.plan_id === p.id && c.kind === 'create');
  assert.equal(fc?.status, 'failed', JSON.stringify(ov0.changes)); assert.match(fc.error, /3734/); assert.equal(fc.after.campaignId, fp.external.campaignId);
  failGroup = false;
  // 시작 = 네이버에 꺼진 상태로 생성 — 한 번에 세 번 눌려도 하나만 진행(나머지 409 plan_busy)
  calls = [];
  const tries = await Promise.all([1, 2, 3].map(() => ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {})));
  assert.deepEqual(tries.map((r) => r.status).sort(), [200, 409, 409], JSON.stringify(tries.map((r) => r.body)));
  const ok = tries.find((r) => r.status === 200).body;
  assert.equal(tries.find((r) => r.status === 409).body.error.code, 'plan_busy');
  assert.equal((await ctx.owner.req('PUT', `/api/marketing/ad-ops/plans/${p.id}`, plan(acc.id))).status, 409, '만든 뒤에는 세팅안 고치기 막힘');
  assert.ok(ok.external.campaignId && ok.external.adgroupId);
  assert.equal(calls.filter((c) => c.method === 'POST' && c.path === '/ncc/campaigns').length, 0, '이어서 만들기 — 캠페인 다시 안 만듦');
  assert.equal(ok.external.campaignId, fp.external.campaignId);
  const camp = (await sql`select after from mkt_ad_changes where plan_id = ${p.id} and kind = 'create' and status = 'failed'`)[0];
  assert.ok(camp.after.campaignId);
  assert.equal(calls.find((c) => c.path === '/ncc/adgroups').body.adgroupType, 'WEB_SITE');
  assert.equal(calls.find((c) => c.path === '/ncc/adgroups').body.userLock, true);
  assert.deepEqual(calls.find((c) => c.method === 'POST' && c.path === '/ncc/keywords').body.map((k) => k.keyword), ['동네헬스장', 'PT가격'], '네이버 키워드는 띄어쓰기 없이');
  assert.deepEqual(ok.external.keywordIds, ['kw-1', 'kw-2'], '생성 응답에 id 가 없어도 그룹에서 다시 읽음');
  assert.equal(calls.filter((c) => c.path === '/ncc/ads').length, 1);
  // 이미 'undefined' 로 저장된 세팅안 → [키워드 다시 읽기] = id 만 읽어 저장, 키워드 다시 안 만듦, 켜기 상태 그대로
  await sql`update mkt_ad_plans set external = external || '{"keywordIds":["undefined","undefined"]}'::jsonb where id = ${p.id}`;
  calls = [];
  const sy = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'sync' });
  assert.deepEqual(sy.keywordIds, ['kw-1', 'kw-2']);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, '이미 있는 키워드는 다시 안 만듦');
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0, '켜기·예산 안 바꿈');
  assert.deepEqual((await sql`select external->'keywordIds' k, status from mkt_ad_plans where id = ${p.id}`).map((r) => [r.k, r.status])[0], [['kw-1', 'kw-2'], 'created']);
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'sync' })).status, 403);
  // 운영 10/19: 키워드가 그룹에 하나도 없음 + 생성 200 빈 응답 → 502·이유·실패 기록, 하나씩은 되면 그걸로 채움, 동시 두 번은 한 번만
  const grp = (await sql`select external->>'adgroupId' g from mkt_ad_plans where id = ${p.id}`)[0].g;
  const saved = kwStore.get(grp); kwStore.set(grp, []);
  await sql`update mkt_ad_plans set external = external || '{"keywordIds":["undefined"]}'::jsonb where id = ${p.id}`;
  kwBroken = 'all';
  const badSync = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'sync' });
  assert.equal(badSync.status, 502); assert.match(badSync.body.error.message, /키워드를 만들지 못했습니다\(동네 헬스장, PT 가격\).*응답에 키워드 id 없음/);
  const [fl] = await sql`select status, error from mkt_ad_changes where plan_id = ${p.id} and kind = 'sync' order by created_at desc limit 1`;
  assert.equal(fl.status, 'failed'); assert.match(fl.error, /동네 헬스장/);
  kwBroken = 'bulk';
  const two = await Promise.all([1, 2].map(() => ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'sync' })));
  assert.deepEqual(two.map((r) => r.status).sort(), [200, 409], JSON.stringify(two.map((r) => r.body)));
  assert.equal(two.find((r) => r.status === 200).body.keywordIds.length, 2, '하나씩 보내서 만듦');
  kwBroken = false; kwStore.set(grp, saved);
  await sql`update mkt_ad_plans set external = external || '{"keywordIds":["kw-1","kw-2"]}'::jsonb where id = ${p.id}`;
  await sql`delete from mkt_ad_changes where plan_id = ${p.id} and kind = 'sync' and created_at > now() - interval '1 minute' and status = 'failed'`;
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
  assert.deepEqual(ov.changes.map((c) => c.kind).slice(0, 7), ['budget', 'budget', 'enable', 'sync', 'sync', 'create', 'create']);
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
