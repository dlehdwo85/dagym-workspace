// 358차(로컬 11/04, 대표 '워크인 네이버는 멈추기보다 금액을 낮추고'): 네이버 광고 화면에서 직접 만든 캠페인 가져오기 — 가짜 네이버 서버 = 구조 시험.
// 목록(읽기만) → 가져오기(네이버에 쓰기 없음·두 번 못 가져옴) → 하루 예산 · 광고 그룹 입찰가(그룹을 읽은 값 + 입찰가만) · 그룹 끄기/켜기 · 되돌리기(그룹마다 전 값)
// · 돈이 느는 변경은 월 상한 검사 · 상한 넘으면 tick 이 가져온 캠페인도 자동 중지 · 일부 그룹 실패 = 바뀐 것만 기록 · 다시 읽기 · 직원 403 · 공간 없는 직원 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

const PORT = 3358;
let srv, ctx, sql, fake, calls = [], failGroup = null;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const camps = {
  'cmp-w': { nccCampaignId: 'cmp-w', customerId: 1234567, name: '다짐·하이링크 검색광고', campaignTp: 'WEB_SITE', dailyBudget: 5000, useDailyBudget: true, userLock: false, status: 'ELIGIBLE' },
  'cmp-off': { nccCampaignId: 'cmp-off', customerId: 1234567, name: '꺼진 캠페인', campaignTp: 'WEB_SITE', dailyBudget: 0, useDailyBudget: false, userLock: true },
};
const NAMES = ['전자결재시스템', '입찰정보', '인스타대행', '마케팅 대행 검색어', '업무관리', '일정관리'];
const ORIG = [800, 700, 900, 650, 800, 750];
const groups = new Map(NAMES.map((name, k) => [`grp-${k + 1}`, { nccAdgroupId: `grp-${k + 1}`, nccCampaignId: 'cmp-w', customerId: 1234567, name, bidAmt: ORIG[k], userLock: false,
  pcChannelId: 'bsn-1', mobileChannelId: 'bsn-1', adgroupType: 'WEB_SITE', status: 'ELIGIBLE', statusReason: 'ELIGIBLE' }]));

before(async () => {
  fake = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const path = u.pathname.slice('/naver'.length);
    res.setHeader('content-type', 'application/json');
    const send = (code, j) => { res.statusCode = code; res.end(JSON.stringify(j)); };
    const sig = createHmac('sha256', 'naver-secret-key-xyz').update(`${req.headers['x-timestamp']}.${req.method}.${path}`).digest('base64');
    if (req.headers['x-signature'] !== sig || req.headers['x-customer'] !== '1234567') return send(403, { title: 'Forbidden', code: 1018 });
    const j = body ? JSON.parse(body) : null;
    const fields = u.searchParams.get('fields');
    calls.push({ method: req.method, path, fields, body: j });
    if (req.method === 'GET' && path === '/stats') return send(200, { data: [] });
    if (req.method === 'GET' && path === '/ncc/campaigns') return send(200, Object.values(camps));
    let m = path.match(/^\/ncc\/campaigns\/([\w-]+)$/);
    if (m && req.method === 'GET') return camps[m[1]] ? send(200, camps[m[1]]) : send(404, { title: 'not found' });
    if (m && req.method === 'PUT') {
      const c = camps[m[1]]; if (!c || j.nccCampaignId !== m[1]) return send(400, { title: 'bad' });
      if (fields === 'budget') Object.assign(c, { dailyBudget: j.dailyBudget, useDailyBudget: j.useDailyBudget });
      else if (fields === 'userLock') c.userLock = j.userLock; else return send(400, { title: 'Invalid fields' });
      return send(200, c);
    }
    if (req.method === 'GET' && path === '/ncc/adgroups') return send(200, [...groups.values()].filter((g) => g.nccCampaignId === u.searchParams.get('nccCampaignId')));
    m = path.match(/^\/ncc\/adgroups\/([\w-]+)$/);
    if (m && req.method === 'GET') return groups.has(m[1]) ? send(200, groups.get(m[1])) : send(404, { title: 'not found' });
    if (m && req.method === 'PUT') {
      const g = groups.get(m[1]); if (!g || j.nccAdgroupId !== m[1]) return send(400, { title: 'bad' });
      if (failGroup === m[1]) return send(400, { title: 'Invalid bid amount', code: 1018 });
      if (fields === 'userLock') { g.userLock = j.userLock; return send(200, g); }
      // 필드 지정 없는 수정 = 그룹 전체를 보냄(읽은 값 그대로 + 바꿀 값) — 이름·캠페인이 빠지면 거절
      if (fields || !j.name || j.nccCampaignId !== g.nccCampaignId) return send(400, { title: 'Invalid adgroup' });
      g.bidAmt = j.bidAmt; return send(200, g);
    }
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

const writes = () => calls.filter((c) => c.method !== 'GET');
const bids = () => NAMES.map((_, k) => groups.get(`grp-${k + 1}`).bidAmt);

test('기존 캠페인 가져오기 → 하루 예산·그룹 입찰가·그룹 끄기·되돌리기·상한·다시 읽기', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  const acc = await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '다짐·하이링크', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 100000 });

  // 목록: 읽기만 · 직원 403 · 공간 없는 직원 404
  assert.equal((await ctx.staffA.client.req('GET', `/api/marketing/ad-ops/import?accountId=${acc.id}`)).status, 403);
  assert.equal((await ctx.staffB.client.req('GET', `/api/marketing/ad-ops/import?accountId=${acc.id}`)).status, 404);
  calls = [];
  const list = await ctx.owner.ok('GET', `/api/marketing/ad-ops/import?accountId=${acc.id}`);
  assert.deepEqual(list.campaigns.map((c) => [c.id, c.dailyBudget, c.on, c.linked]), [['cmp-w', 5000, true, false], ['cmp-off', null, false, false]]);
  // 가져오기: 꼴이 틀린 id 400 · 직원 403 · 네이버에 쓰기 없음
  assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/import', { accountId: acc.id, campaignId: 'grp-1' })).status, 400);
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ad-ops/import', { accountId: acc.id, campaignId: 'cmp-w' })).status, 403);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/import', { accountId: acc.id, campaignId: 'cmp-none' })).status, 502, '네이버에 없는 캠페인');
  const imp = await ctx.owner.ok('POST', '/api/marketing/ad-ops/import', { accountId: acc.id, campaignId: 'cmp-w' });
  assert.equal(imp.status, 'active'); assert.equal(imp.dailyBudget, 5000);
  assert.deepEqual(imp.adgroups.map((g) => [g.name, g.bidAmt, g.paused]), NAMES.map((n, k) => [n, ORIG[k], false]));
  assert.deepEqual(writes(), [], '가져오기는 네이버를 읽기만');
  const again = await ctx.owner.req('POST', '/api/marketing/ad-ops/import', { accountId: acc.id, campaignId: 'cmp-w' });
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'already_linked');
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/ad-ops/import?accountId=${acc.id}`)).campaigns.find((c) => c.id === 'cmp-w').linked, true);
  let ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  let pl = ov.plans.find((x) => x.id === imp.id);
  assert.equal(pl.kind, 'imported'); assert.deepEqual(pl.issues, [], '세팅안 검사(키워드·소재 없음)는 하지 않음');
  assert.equal(ov.changes[0].kind, 'import');
  const act = (body) => ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${imp.id}/action`, body);
  // 가져온 캠페인은 키워드·소재·지역을 워크인에서 바꾸지 않음
  for (const a of ['readback', 'sync', 'region']) { const r = await act({ action: a, region: [] }); assert.equal(r.status, 409, a); assert.equal(r.body.error.code, 'imported_limited'); }

  // 하루 예산 5,000 → 1,000(줄이는 쪽 — 상한 검사 없음)
  calls = [];
  assert.equal((await act({ action: 'budget', dailyBudget: 1000 })).status, 200);
  assert.deepEqual(writes().map((c) => [c.path, c.fields, c.body.dailyBudget]), [['/ncc/campaigns/cmp-w', 'budget', 1000]]);
  assert.equal(camps['cmp-w'].dailyBudget, 1000);
  // 모든 그룹 입찰가 500원: 그룹을 읽은 값 그대로 + 입찰가만(필드 지정 없는 수정) → 다시 읽어 확인
  const ids = NAMES.map((_, k) => `grp-${k + 1}`);
  calls = [];
  const r1 = await act({ action: 'group_bid', adgroupIds: ids, bidAmt: 500 });
  assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.mismatch, undefined);
  assert.deepEqual(bids(), [500, 500, 500, 500, 500, 500]);
  assert.ok(writes().every((c) => c.fields === null && c.body.name && c.body.pcChannelId === 'bsn-1'), '그룹 전체를 보냄');
  assert.equal((await act({ action: 'group_bid', adgroupIds: ['grp-1'], bidAmt: 50 })).status, 400, '70원 미만');
  assert.equal((await act({ action: 'group_bid', adgroupIds: ['grp-99'], bidAmt: 500 })).status, 400, '이 캠페인 그룹 아님');
  // '마케팅 대행 검색어' 그룹 끄기 · 전부 끄기는 막힘
  calls = [];
  assert.equal((await act({ action: 'group_pause', adgroupIds: ['grp-4'] })).status, 200);
  assert.deepEqual(writes().map((c) => [c.path, c.fields, c.body.userLock]), [['/ncc/adgroups/grp-4', 'userLock', true]]);
  const all = await act({ action: 'group_pause', adgroupIds: ids.filter((x) => x !== 'grp-4') });
  assert.equal(all.status, 409); assert.equal(all.body.error.code, 'last_group');
  ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  pl = ov.plans.find((x) => x.id === imp.id);
  assert.deepEqual(pl.plan.dailyBudget, 1000);
  assert.deepEqual(pl.external.adgroups.map((g) => [g.bidAmt, g.paused]), [[500, false], [500, false], [500, false], [500, true], [500, false], [500, false]]);
  assert.deepEqual(ov.changes.slice(0, 3).map((c) => [c.kind, c.money_up]), [['group_pause', false], ['group_bid', false], ['budget', false]]);
  // 되돌리기: 입찰가는 그룹마다 바꾸기 전 네이버 값으로(올리는 쪽 = 상한 검사 통과) · 끄기 → 켜기
  const bidChange = ov.changes.find((c) => c.kind === 'group_bid');
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/changes/${bidChange.id}/revert`, {})).status, 200);
  assert.deepEqual(bids(), ORIG);
  const pauseChange = ov.changes.find((c) => c.kind === 'group_pause');
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/changes/${pauseChange.id}/revert`, {})).status, 200);
  assert.equal(groups.get('grp-4').userLock, false);
  ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  assert.deepEqual(ov.changes.slice(0, 2).map((c) => [c.kind, c.money_up, !!c.revert_of]), [['group_resume', true, true], ['group_bid', true, true]], '되돌리기 = 올리는 쪽(돈 나가는 변경)');
  // 입찰가 다시 500 → 이번 달 광고비가 상한에 닿으면 올리는 쪽은 막히고 내리는 쪽은 됨
  assert.equal((await act({ action: 'group_bid', adgroupIds: ids, bidAmt: 500 })).status, 200);
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, cost_krw) values (${acc.id}, ${today}, 'cmp-w', '다짐·하이링크 검색광고', 100000)`;
  const up = await act({ action: 'group_bid', adgroupIds: ['grp-1'], bidAmt: 600 });
  assert.equal(up.status, 409); assert.equal(up.body.error.code, 'cap_reached');
  assert.equal((await act({ action: 'group_bid', adgroupIds: ['grp-1'], bidAmt: 400 })).status, 200, '내리는 쪽은 상한과 상관없음');
  // 상한 도달 → tick 이 가져온 캠페인도 자동 중지
  calls = [];
  await tick(); await tick();
  ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  assert.equal(ov.plans.find((x) => x.id === imp.id).status, 'paused');
  assert.equal(camps['cmp-w'].userLock, true);
  assert.ok(writes().some((c) => c.path === '/ncc/campaigns/cmp-w' && c.fields === 'userLock' && c.body.userLock === true));
  // 일부 그룹 실패: 앞 2개만 바뀜 → 바뀐 2개는 기록(되돌리기 가능) + 실패 기록, 화면 값도 실제와 같게
  failGroup = 'grp-3';
  const part = await act({ action: 'group_bid', adgroupIds: ids, bidAmt: 300 });
  assert.equal(part.status, 502); assert.equal(part.body.error.code, 'naver_partial'); assert.match(part.body.error.message, /2\/6개 그룹만/);
  failGroup = null;
  assert.deepEqual(bids(), [300, 300, 500, 500, 500, 500]);
  ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  pl = ov.plans.find((x) => x.id === imp.id);
  assert.deepEqual(pl.external.adgroups.map((g) => g.bidAmt), [300, 300, 500, 500, 500, 500]);
  const [okRow, failRow] = [ov.changes.find((c) => c.kind === 'group_bid' && c.status === 'applied'), ov.changes.find((c) => c.kind === 'group_bid' && c.status === 'failed')];
  assert.equal(okRow.after.adgroups.length, 2); assert.match(failRow.error, /Invalid bid amount/);
  // 다시 읽기: 네이버 화면에서 바꾼 값(하루 예산·켜짐·그룹 입찰가)을 그대로 가져옴 — 네이버에 쓰기 없음
  camps['cmp-w'].dailyBudget = 2000; groups.get('grp-6').bidAmt = 1200;
  calls = [];
  const rf = await act({ action: 'refresh' });
  assert.equal(rf.status, 200); assert.equal(rf.body.status, 'paused'); assert.equal(rf.body.dailyBudget, 2000);
  assert.deepEqual(writes(), []);
  ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  pl = ov.plans.find((x) => x.id === imp.id);
  assert.equal(pl.plan.dailyBudget, 2000); assert.equal(pl.external.adgroups[5].bidAmt, 1200);
  // 꺼진 캠페인은 꺼진 채로 가져옴(하루 제한 없음 = 0)
  const off = await ctx.owner.ok('POST', '/api/marketing/ad-ops/import', { accountId: acc.id, campaignId: 'cmp-off' });
  assert.equal(off.status, 'paused'); assert.equal(off.dailyBudget, 0);
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/ad-ops/plans/${imp.id}/action`, { action: 'group_pause', adgroupIds: ['grp-1'] })).status, 403, '직원은 못 바꿈');
});
