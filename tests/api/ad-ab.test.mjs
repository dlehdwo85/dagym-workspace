// 광고 최적화 1차 ① 3안 소액 테스트 + ④ 대행사 대비 절감액 (네이버 가짜 서버 = 구조 시험 — 소재 userLock 쓰기는 실계정 확인 전)
// 세팅안 3안 + 테스트 설정 → 판정(켜기 전 · 비교 중 · 일부 · 비김 · 이긴 안, 클릭률/전환율) → 소재 끄기(마지막 하나는 막힘)·실패 기록
// → [이긴 안에 집중](진 안 끄기 + 하루 예산, 상한 넘으면 예산만 막힘)·되돌리기 → 절감액(기본 15%·회사 설정·월간 보고·광고 성과) · 직원 403 · 공간 미배정 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3232;
let srv, ctx, sql, fake, calls = [], seq = 0, failAd = null;
const kwStore = new Map();
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
    if (req.method === 'GET' && path === '/ncc/campaigns') return send(200, []); // 연결 확인
    if (req.method === 'GET' && path === '/stats') return send(200, { data: [] });
    if (req.method === 'GET' && path === '/ncc/channels') return send(200, [{ nccBusinessChannelId: 'bsn-1', name: '우리 홈페이지', channelTp: 'SITE' }]);
    if (req.method === 'POST' && path === '/ncc/campaigns') return send(200, { nccCampaignId: `cmp-${++seq}`, ...j });
    if (req.method === 'POST' && path === '/ncc/adgroups') return send(200, { nccAdgroupId: `grp-${++seq}`, ...j });
    if (req.method === 'POST' && path === '/ncc/keywords') { const g = kwStore.get(u.searchParams.get('nccAdgroupId')) ?? []; for (const k of j) g.push({ nccKeywordId: `kw-${++seq}`, keyword: k.keyword }); kwStore.set(u.searchParams.get('nccAdgroupId'), g); return send(200, j.map((k) => ({ keyword: k.keyword }))); }
    if (req.method === 'GET' && path === '/ncc/keywords') return send(200, kwStore.get(u.searchParams.get('nccAdgroupId')) ?? []);
    if (req.method === 'POST' && path === '/ncc/ads') return send(200, { nccAdId: `nad-${++seq}`, ...j });
    if (req.method === 'PUT' && path.startsWith('/ncc/ads/')) return path === `/ncc/ads/${failAd}` ? send(400, { title: 'Invalid ad status', code: 4003 }) : send(200, { ...j });
    if (req.method === 'PUT' && path.startsWith('/ncc/campaigns/')) return send(200, { ...j });
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); fake?.close(); await sql?.end(); });

const ad = (headline) => ({ headline, description: '첫 상담 무료, 가까운 헬스장에서 시작하세요', url: 'https://example.com' });
const plan = (accountId, over = {}) => ({ accountId, name: '3안 테스트', dailyBudget: 5000, bidAmt: 300, channelId: 'bsn-1', keywords: ['동네 헬스장'],
  ads: [ad('가을 PT 상담'), ad('첫 달 반값 PT'), ad('동네 헬스장 PT')], test: { on: true, days: 7, minImpressions: 300, afterBudget: 20000 }, ...over });

test('3안 테스트 판정·소재 끄기·[이긴 안에 집중]·되돌리기·절감액', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  const acc = await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '본점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 300000 });
  // 테스트를 켰는데 소재가 1개 → 검사에 걸림(시작 막힘) · 비교 기간 2일은 입력 오류
  const one = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '소재 하나', ads: [ad('가을 PT 상담')] }));
  assert.ok(one.issues.some((x) => x.includes('소재가 2개 이상')), JSON.stringify(one.issues));
  assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { test: { on: true, days: 2 } }))).status, 400);
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id));
  assert.deepEqual(p.issues, []);
  const made = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  const [A, B, C] = made.external.adIds; const cid = made.external.campaignId;
  assert.equal(made.external.adIds.length, 3);
  const ab = async () => (await ctx.owner.ok('GET', '/api/marketing/ad-ops')).plans.find((x) => x.id === p.id).ab;
  // 켜기 전: 판정 없음, 세팅안 테스트 값 그대로
  let r = await ab();
  assert.equal(r.status, 'not_started'); assert.equal(r.on, true); assert.equal(r.afterBudget, 20000);
  assert.deepEqual(r.ads.map((x) => [x.label, x.headline, x.paused]), [['안 A', '가을 PT 상담', false], ['안 B', '첫 달 반값 PT', false], ['안 C', '동네 헬스장 PT', false]]);
  assert.match(r.message, /광고를 켜면 7일 동안 소재 3개/);
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'enable' });
  // 소재별 성과(하루 한 번 읽는 표) — 시험은 오늘 한 줄로 바꿔 가며 확인
  const stats = async (rows) => {
    for (const [id, impressions, clicks, conversions] of rows) {
      await sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, impressions, clicks, cost_krw, conversions) values (${acc.id}, ${today}, 'ad', ${id}, '소재', ${impressions}, ${clicks}, ${clicks * 300}, ${conversions})
        on conflict (account_id, day, kind, item_id) do update set impressions = excluded.impressions, clicks = excluded.clicks, cost_krw = excluded.cost_krw, conversions = excluded.conversions`;
    }
  };
  await stats([[A, 1000, 60, 0], [B, 1000, 30, 0], [C, 1000, 28, 0]]);
  r = await ab();
  assert.equal(r.status, 'running', '켠 첫날은 기간 전'); assert.equal(r.leader, null); assert.deepEqual(r.losers, []);
  assert.match(r.message, /비교 중 0\/7일/);
  // 7일 넘게 지남(켠 기록을 8일 전으로) + 안 C 노출이 최소에 못 미침 → 아직 비교 중
  await sql`update mkt_ad_changes set created_at = now() - interval '8 days' where plan_id = ${p.id} and kind = 'enable'`;
  await stats([[C, 200, 6, 0]]);
  r = await ab();
  assert.equal(r.status, 'running'); assert.match(r.message, /노출이 가장 적은 안 200\/300회/);
  // 일부 판정: A 6% > C 2.8% 확실, A vs B 5% 는 차이 뚜렷하지 않음
  await stats([[B, 1000, 50, 0], [C, 1000, 28, 0]]);
  r = await ab();
  assert.equal(r.status, 'partial', JSON.stringify(r)); assert.equal(r.metric, 'ctr'); assert.equal(r.leader, A); assert.deepEqual(r.losers, [C]);
  assert.match(r.message, /1등 안 A\(클릭률 6%\) — 안 C보다는 확실히 낫지만 안 B와는/);
  // 비김: 3.5% / 3% / 2.8%
  await stats([[A, 1000, 35, 0], [B, 1000, 30, 0]]);
  r = await ab();
  assert.equal(r.status, 'tie'); assert.deepEqual(r.losers, []);
  // 이긴 안: A 6% 가 B 3%·C 2.8% 를 모두 이김(z ≈ 3.24·3.49)
  await stats([[A, 1000, 60, 0], [B, 1000, 30, 0]]);
  r = await ab();
  assert.equal(r.status, 'winner'); assert.equal(r.leader, A); assert.deepEqual(r.losers.sort(), [B, C].sort());
  assert.deepEqual(r.ads.map((x) => x.ctr), [6, 3, 2.8]);
  assert.equal(r.ads[1].z, 3.24); assert.equal(r.ads[0].z, null);
  assert.match(r.message, /안 A 클릭률 6% — 나머지 안\(안 B 3%, 안 C 2.8%\)보다 확실히 높습니다/);
  // 전환이 10건 이상이면 전환율로 판정(A 12/60 vs B 1/30 · C 0/28)
  await stats([[A, 1000, 60, 12], [B, 1000, 30, 1]]);
  r = await ab();
  assert.equal(r.metric, 'cvr'); assert.equal(r.status, 'winner'); assert.equal(r.ads[0].cvr, 20);
  // 직원: 보기만(소재 끄기 403), 공간 미배정 직원 404
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'ad_pause', adIds: [B] })).status, 403);
  assert.equal((await ctx.staffB.client.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'ad_pause', adIds: [B] })).status, 404);
  // 소재를 모두 끌 수는 없음 · 다른 세팅안의 소재 id 는 400 — 네이버에 아무것도 안 보냄
  calls = [];
  const all = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'ad_pause', adIds: [A, B, C] });
  assert.equal(all.status, 409); assert.equal(all.body.error.code, 'last_ad');
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'ad_pause', adIds: ['nad-999'] })).status, 400);
  assert.equal(calls.length, 0);
  // [이긴 안에 집중]: 진 안 B·C 끄기(소재 userLock) + 하루 예산 5,000 → 20,000(켜져 있으니 상한 검사 통과)
  const ap = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'ab_apply', adIds: [B, C], dailyBudget: 20000 });
  assert.equal(ap.dailyBudget, 20000); assert.equal(ap.budgetError, undefined);
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.q.fields, c.body.userLock ?? c.body.dailyBudget]),
    [['PUT', `/ncc/ads/${B}`, 'userLock', true], ['PUT', `/ncc/ads/${C}`, 'userLock', true], ['PUT', `/ncc/campaigns/${cid}`, 'budget', 20000]]);
  assert.equal(calls[0].body.nccAdId, B);
  let ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  r = ov.plans.find((x) => x.id === p.id).ab;
  assert.deepEqual(r.ads.map((x) => x.paused), [false, true, true]);
  assert.equal(ov.plans.find((x) => x.id === p.id).plan.dailyBudget, 20000);
  const [pauseChg, budgetChg] = [ov.changes.find((c) => c.kind === 'ad_pause'), ov.changes.find((c) => c.kind === 'budget')];
  assert.deepEqual([pauseChg.after.adIds, pauseChg.after.ab, pauseChg.money_up], [[B, C], true, false]);
  assert.equal(budgetChg.money_up, true, '예산 올림 = 돈이 나가는 변경');
  // 되돌리기: 끈 소재를 다시 켬(같은 소재만)
  calls = [];
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/changes/${pauseChg.id}/revert`, {});
  assert.deepEqual(calls.map((c) => [c.path, c.body.userLock]), [[`/ncc/ads/${B}`, false], [`/ncc/ads/${C}`, false]]);
  ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  assert.deepEqual(ov.plans.find((x) => x.id === p.id).ab.ads.map((x) => x.paused), [false, false, false]);
  assert.equal(ov.changes[0].kind, 'ad_resume'); assert.equal(ov.changes[0].revert_of, pauseChg.id);
  // 이미 꺼진 소재를 셈: B 끈 뒤 A·C 를 끄면 마지막 하나(B 는 꺼짐) → 막힘
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'ad_pause', adIds: [B] });
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'ad_pause', adIds: [A, C] })).body.error.code, 'last_ad');
  // 중간 실패: B 켜기는 되고 C 에서 네이버 400 → 502 + 실패 기록(된 것까지 저장, 화면이 실제와 같게)
  failAd = C;
  const half = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'ad_resume', adIds: [B, C] });
  assert.equal(half.status, 502); assert.match(half.body.error.message, /4003/);
  const [fl] = await sql`select status, after, error from mkt_ad_changes where plan_id = ${p.id} and kind = 'ad_resume' order by created_at desc limit 1`;
  assert.equal(fl.status, 'failed'); assert.deepEqual(fl.after.done, [B]); assert.match(fl.error, /4003/);
  assert.equal((await sql`select external->'adLocks'->>${B}::text as v from mkt_ad_plans where id = ${p.id}`)[0].v, 'false');
  failAd = null;
  // 이번 달 광고비가 상한을 넘으면 [이긴 안에 집중]의 예산 올리기만 막히고 진 안 끄기는 그대로
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, cost_krw) values (${acc.id}, ${today}, ${cid}, '3안 테스트', 310000)`;
  calls = [];
  const capped = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'ab_apply', adIds: [C], dailyBudget: 30000 });
  assert.match(capped.budgetError, /상한/);
  assert.deepEqual(calls.map((c) => c.path), [`/ncc/ads/${C}`], '예산 PUT 은 안 보냄');
  assert.equal((await sql`select plan->>'dailyBudget' as b from mkt_ad_plans where id = ${p.id}`)[0].b, '20000');
  // 절감액(추정): 광고비 310,000 × 기본 15% = 46,500 → 회사 설정 20% → 62,000 (월간 보고·광고 성과 같은 값)
  ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  assert.deepEqual(ov.savings, { pct: 15, spend: 310000, amount: 46500, custom: false });
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/ad-ops/fee', { pct: 20 })).status, 403);
  assert.equal((await ctx.owner.req('PUT', '/api/marketing/ad-ops/fee', { pct: 60 })).status, 400);
  const fee = await ctx.owner.ok('PUT', '/api/marketing/ad-ops/fee', { pct: 20 });
  assert.deepEqual(fee.savings, { pct: 20, spend: 310000, amount: 62000, custom: true });
  const rep = await ctx.owner.ok('GET', `/api/marketing/report?month=${today.slice(0, 7)}`);
  assert.equal(rep.savings.amount, 62000);
  const ads = await ctx.owner.ok('GET', `/api/marketing/ads?month=${today.slice(0, 7)}`);
  assert.equal(ads.savings.amount, 62000); assert.equal(ads.savings.pct, 20);
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/fee', { pct: null });
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/ad-ops')).savings.pct, 15, '비우면 기본값');
});
