// #499-2 후속(운영 10/24 실계정 시험): 네이버 이름 30자(code 3711) 자동 줄이기·저장 때 권고 · 소재 가운뎃점 → 쉼표 · 실패 뒤 다시 누르면 같은 캠페인 이어 씀
// · 네이버에 남은 같은 이름 빈 캠페인 이어 씀(다른 세팅안에 연결된 것·켜진 것은 안 씀, 이름 겹치면 번호) · 끊긴 '만드는 중' 이어 만들기 · 소재 멱등
// · [네이버 반영 값 다시 읽기](세팅안과 같음/다름/읽지 못함 · 실패 시도 이어 씀 · 연결 안 된 빈 캠페인). 가짜 네이버 서버 = 구조 시험(실계정 응답 칸 이름은 확인 전)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3244;
let srv, ctx, sql, naver, calls = [], seq = 0, fail = {};
const camps = new Map(); const groups = new Map(); const kws = new Map(); const ads = new Map(); const targets = new Map(); const negs = new Map();
const nameErr = (n) => [...String(n ?? '')].length < 1 || [...String(n ?? '')].length > 30;
before(async () => {
  naver = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const path = u.pathname.slice('/naver'.length);
    res.setHeader('content-type', 'application/json');
    const send = (code, j) => { res.statusCode = code; res.end(JSON.stringify(j)); };
    const sig = createHmac('sha256', 'naver-secret-key-rb').update(`${req.headers['x-timestamp']}.${req.method}.${path}`).digest('base64');
    if (req.headers['x-signature'] !== sig || req.headers['x-customer'] !== '7654321') return send(403, { title: 'Forbidden', code: 1018 });
    const j = body ? JSON.parse(body) : null;
    const q = Object.fromEntries(u.searchParams);
    calls.push({ method: req.method, path, q, body: j });
    let m;
    if (req.method === 'GET' && path === '/ncc/campaigns') return send(200, [...camps.values()]);
    if (req.method === 'GET' && (m = path.match(/^\/ncc\/campaigns\/([^/]+)$/))) return camps.has(m[1]) ? send(200, camps.get(m[1])) : send(404, { title: 'Not found', code: 1002 });
    if (req.method === 'POST' && path === '/ncc/campaigns') {
      // 실계정 규칙 흉내: 이름 1~30자 · 같은 이름 캠페인 없음
      if (nameErr(j.name)) return send(400, { title: 'Invalid campaign name length', code: 3710 });
      if ([...camps.values()].some((c) => c.name === j.name)) return send(400, { title: 'Duplicate campaign name', code: 3506 });
      const c = { nccCampaignId: `cmp-${++seq}`, trackingMode: 'TRACKING_DISABLED', regTm: new Date(Date.now() + seq).toISOString(), ...j }; camps.set(c.nccCampaignId, c); return send(200, c);
    }
    if (req.method === 'GET' && path === '/ncc/adgroups') return send(200, [...groups.values()].filter((g) => g.nccCampaignId === q.nccCampaignId));
    if (req.method === 'GET' && (m = path.match(/^\/ncc\/adgroups\/([^/]+)$/))) return groups.has(m[1]) ? send(200, groups.get(m[1])) : send(404, { title: 'Not found' });
    if (req.method === 'POST' && path === '/ncc/adgroups') {
      if (fail.group) { fail.group--; return send(400, { title: 'Invalid ad group name length', code: 3711, detail: '그룹명을 1자~30자로 설정하세요' }); }
      if (nameErr(j.name)) return send(400, { title: 'Invalid ad group name length', code: 3711, detail: '그룹명을 1자~30자로 설정하세요' });
      const g = { nccAdgroupId: `grp-${++seq}`, pcNetworkBidWeight: 100, mobileNetworkBidWeight: 100, useExpSearch: true, expSearchBudgetRatio: 100, aiAdsOptIn: true, adRollingType: 'PERFORMANCE', ...j };
      groups.set(g.nccAdgroupId, g); return send(200, g);
    }
    if (req.method === 'POST' && path === '/ncc/keywords') { const g = kws.get(q.nccAdgroupId) ?? []; for (const k of j) g.push({ nccKeywordId: `kw-${++seq}`, keyword: k.keyword, userLock: false }); kws.set(q.nccAdgroupId, g); return send(200, j.map((k) => ({ keyword: k.keyword }))); }
    if (req.method === 'GET' && path === '/ncc/keywords') return send(200, kws.get(q.nccAdgroupId) ?? []);
    if (req.method === 'POST' && path === '/ncc/ads') {
      if (fail.adAt && (ads.get(j.nccAdgroupId)?.length ?? 0) + 1 === fail.adAt) { fail.adAt = 0; return send(500, { title: 'Internal error', code: 9999 }); }
      const a = { nccAdId: `nad-${++seq}`, nccAdgroupId: j.nccAdgroupId, type: j.type, ad: j.ad, userLock: j.userLock, inspectStatus: 'UNDER_REVIEW' };
      ads.set(j.nccAdgroupId, [...(ads.get(j.nccAdgroupId) ?? []), a]); return send(200, a);
    }
    if (req.method === 'GET' && path === '/ncc/ads') return send(200, ads.get(q.nccAdgroupId) ?? []);
    if (req.method === 'GET' && path === '/ncc/targets') {
      const t = targets.get(q.ownerId) ?? {};
      return send(200, [{ nccTargetId: `mtg-${q.ownerId}`, ownerId: q.ownerId, targetTp: 'MEDIA_TARGET', target: JSON.stringify(t.MEDIA_TARGET ?? { type: 1, search: [], contents: [] }) },
        { nccTargetId: `rtg-${q.ownerId}`, ownerId: q.ownerId, targetTp: 'REGIONAL_TARGET', target: t.REGIONAL_TARGET ?? { location: null } }].filter((x) => !q.types || x.targetTp === q.types));
    }
    if (req.method === 'PUT' && path.startsWith('/ncc/targets/')) { targets.set(j.ownerId, { ...(targets.get(j.ownerId) ?? {}), [j.targetTp]: j.target }); return send(200, j); }
    if ((m = path.match(/^\/ncc\/adgroups\/([^/]+)\/restricted-keywords$/))) {
      if (req.method === 'POST') { negs.set(m[1], [...(negs.get(m[1]) ?? []), ...j.map((k) => ({ ...k, nccAdgroupRestrictKwdId: `rst-${++seq}` }))]); return send(200, negs.get(m[1])); }
      return send(200, negs.get(m[1]) ?? []);
    }
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); naver?.close(); await sql?.end(); });

const SETUP = { tracking: true, media: 'naver', pcWeight: 60, mobileWeight: 120, rolling: 'PERFORMANCE', expSearch: true, expRatio: 100, aiMax: true, negatives: ['구인', '채용'] };
const plan = (accountId, over = {}) => ({ accountId, name: '하이링크 커뮤니티', dailyBudget: 3000, bidAmt: 300, channelId: 'bsn-1', keywords: ['아파트 커뮤니티 운영', '단지 헬스장 위탁'],
  ads: [{ headline: '커뮤니티 운영 고민?', description: '관리소장님, 무료 운영 진단 받아 보세요', url: 'https://example.com/community' }], setup: SETUP, ...over });
const posts = (path) => calls.filter((c) => c.method === 'POST' && c.path === path);
const act = (id, body) => ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${id}/action`, body);
let acc;

test('이름 30자: 저장 때 권고 → 만들 때 캠페인 앞 30자 · 광고그룹 앞 27자 + 그룹 · 소재 가운뎃점은 쉼표로 저장', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  acc = await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '하이링크', customerId: '7654321', apiKey: 'naver-license-rb', secretKey: 'naver-secret-key-rb' });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  // 운영 10/24 그대로: 29자 이름 → 캠페인은 그대로, 그룹(이름 + ' 그룹' = 32자)만 줄임
  const n29 = '[시험] 하이링크 커뮤니티 B2B — 광고 설정 확인';
  assert.equal([...n29].length, 29);
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: n29, ads: [{ headline: '운영·위탁 고민?', description: '관리소장님 · 무료 진단 — 상담', url: 'https://example.com/b2b' }] }));
  assert.equal(p.fixed, 1, '가운뎃점·줄표를 바꾼 소재 수');
  assert.deepEqual(p.issues, [], '가운뎃점이 남지 않음');
  const [row] = await sql`select plan from mkt_ad_plans where id = ${p.id}`;
  assert.deepEqual([row.plan.ads[0].headline, row.plan.ads[0].description], ['운영,위탁 고민?', '관리소장님, 무료 진단 - 상담']);
  const gName = '[시험] 하이링크 커뮤니티 B2B — 광고 설정 그룹';
  assert.ok(p.advice.some((x) => x === `이름이 29자입니다 — 네이버 이름은 30자까지라 광고그룹 '${gName}'(으)로 줄여 만듭니다`), JSON.stringify(p.advice));
  calls = [];
  const ok = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(posts('/ncc/campaigns')[0].body.name, n29);
  assert.equal(posts('/ncc/adgroups')[0].body.name, gName);
  assert.ok([...gName].length <= 30);
  assert.deepEqual([ok.external.campaignFrom, ok.external.campaignName, ok.external.adgroupFrom, ok.external.adgroupName], ['new', n29, 'new', gName]);
  assert.equal(posts('/ncc/ads')[0].body.ad.description, '관리소장님, 무료 진단 - 상담');
  // 35자: 캠페인도 앞 30자
  const n35 = '하이링크 아파트 커뮤니티 위탁 운영 B2B 가을 시즌 확인';
  const q = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: n35 }));
  assert.ok(q.advice.some((x) => x.startsWith(`이름이 ${[...n35].length}자입니다 — 네이버 이름은 30자까지라 캠페인 '`)), JSON.stringify(q.advice));
  calls = [];
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${q.id}/approve`, {});
  const cn = posts('/ncc/campaigns')[0].body.name, gn = posts('/ncc/adgroups')[0].body.name;
  assert.ok([...cn].length <= 30 && n35.startsWith(cn), cn);
  assert.ok([...gn].length <= 30 && gn.endsWith(' 그룹') && n35.startsWith(gn.slice(0, -3)), gn);
  // 카드: 네이버 이름·고객 id(네이버에서 보기 링크용)
  const ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  const card = ov.plans.find((x) => x.id === q.id);
  assert.deepEqual([card.customer_id, card.external.campaignName], ['7654321', cn]);
  assert.ok(card.updated_at);
});

test('그룹에서 실패 → 다시 누르면 같은 캠페인 이어 씀(새로 만들지 않음) · 소재 중간 실패 → 이미 만든 소재는 다시 안 만듦', async () => {
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '그룹 실패 시험' }));
  fail.group = 1; calls = [];
  const r = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(r.status, 502); assert.match(r.body.error.message, /3711/);
  const [f] = await sql`select status, external from mkt_ad_plans where id = ${p.id}`;
  assert.equal(f.status, 'failed'); assert.ok(f.external.campaignId && !f.external.adgroupId, JSON.stringify(f.external));
  calls = [];
  const ok = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(posts('/ncc/campaigns').length, 0, '캠페인은 다시 안 만듦');
  assert.deepEqual([ok.external.campaignId, ok.external.resumed], [f.external.campaignId, 1]);
  assert.equal([...camps.values()].filter((c) => c.name === '그룹 실패 시험').length, 1, '네이버에 같은 이름 캠페인 하나뿐');
  // 소재 3개 중 2번째에서 실패 → 1번째는 네이버에 이미 있음 → 다시 누르면 2·3번째만
  const three = [1, 2, 3].map((n) => ({ headline: `커뮤니티 고민 ${n}?`, description: `무료 운영 진단 ${n}`, url: `https://example.com/${n}` }));
  const s = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '소재 실패 시험', ads: three }));
  fail.adAt = 2;
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${s.id}/approve`, {})).status, 502);
  calls = [];
  const ok2 = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${s.id}/approve`, {});
  assert.equal(posts('/ncc/ads').length, 2, '1번째 소재는 그대로 씀');
  assert.equal(ads.get(ok2.external.adgroupId).length, 3, '네이버 소재 3개(중복 없음)');
  assert.deepEqual(ok2.external.adIds, ads.get(ok2.external.adgroupId).map((a) => a.nccAdId), '세팅안 순서대로 id');
});

test('네이버에 남은 같은 이름 빈 캠페인은 이어 씀 · 켜진 것·다른 세팅안 것은 안 씀(이름 뒤 번호)', async () => {
  camps.set('cmp-left', { nccCampaignId: 'cmp-left', name: '남은 캠페인', userLock: true, campaignTp: 'WEB_SITE', dailyBudget: 3000, useDailyBudget: true, regTm: '2026-10-24T00:00:00Z' });
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '남은 캠페인' }));
  calls = [];
  const ok = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(posts('/ncc/campaigns').length, 0);
  assert.deepEqual([ok.external.campaignId, ok.external.campaignFrom], ['cmp-left', 'leftover']);
  // 켜져 있는(누가 쓰는) 같은 이름 캠페인 → 새로 '이름 2'
  camps.set('cmp-live', { nccCampaignId: 'cmp-live', name: '켜진 캠페인', userLock: false, campaignTp: 'WEB_SITE' });
  const l = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '켜진 캠페인' }));
  calls = [];
  const okL = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${l.id}/approve`, {});
  assert.equal(posts('/ncc/campaigns')[0].body.name, '켜진 캠페인 2');
  assert.deepEqual([okL.external.campaignFrom, okL.external.campaignName], ['new', '켜진 캠페인 2']);
  // 다른 세팅안이 만든(연결된) 빈 캠페인은 이어 쓰지 않음 — 지금 캠페인 '남은 캠페인'(cmp-left)은 위 세팅안 것
  const dup = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '남은 캠페인' }));
  for (const g of [...groups.values()].filter((x) => x.nccCampaignId === 'cmp-left')) groups.delete(g.nccAdgroupId); // 빈 캠페인처럼 보이게
  calls = [];
  const okD = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${dup.id}/approve`, {});
  assert.notEqual(okD.external.campaignId, 'cmp-left');
  assert.equal(posts('/ncc/campaigns')[0].body.name, '남은 캠페인 2');
});

test('[네이버 반영 값 다시 읽기]: 같음 ✓ · 네이버에서 바뀐 값은 다름 · 못 읽은 칸 · 실패 시도 이어 씀 · 연결 안 된 빈 캠페인 · 권한', async () => {
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '반영 값 시험', local: { center: '', radiusKm: 3, areas: [], region: [], abroad: false } }));
  fail.group = 1;
  await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  const ok = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  const cid = ok.external.campaignId, gid = ok.external.adgroupId;
  camps.set('cmp-orphan', { nccCampaignId: 'cmp-orphan', name: '[시험] 예전 빈 캠페인', userLock: true, campaignTp: 'WEB_SITE', regTm: '2026-10-24T01:00:00Z' });
  camps.set('cmp-full', { nccCampaignId: 'cmp-full', name: '대행사 캠페인', userLock: true, campaignTp: 'WEB_SITE', regTm: '2026-10-24T01:00:01Z' });
  groups.set('grp-full', { nccAdgroupId: 'grp-full', nccCampaignId: 'cmp-full', name: '대행사 그룹' });
  const r = await act(p.id, { action: 'readback' });
  const it = Object.fromEntries(r.readBack.items.map((x) => [x.key, x]));
  for (const k of ['campaignName', 'lock', 'budget', 'tracking', 'groupName', 'bid', 'weight', 'rolling', 'exp', 'channel', 'media', 'region', 'negatives', 'keywords', 'ads'])
    assert.equal(it[k]?.ok, true, `${k} ${JSON.stringify(it[k])}`);
  assert.deepEqual([it.lock.naver, it.weight.naver, it.media.naver, it.budget.naver], ['꺼짐', '60%·120%', '네이버 매체만', '3,000원']);
  assert.deepEqual(r.readBack.ads.map((a) => [a.label, a.inspect]), [['안 A', '검수 중']]);
  assert.match(r.readBack.history, /^실패한 시도 1번 — 다시 눌렀을 때 실패한 시도에서 만든 캠페인\(cmp-\d+\)을 이어 썼습니다\(새로 만들지 않음\)$/);
  assert.ok(r.readBack.history.includes(cid));
  assert.deepEqual(r.readBack.orphans.map((o) => o.id), ['cmp-orphan'], '그룹 있는 캠페인·세팅안 캠페인은 빠짐');
  // 네이버 화면에서 바꾼 값 → 다름(세팅안 값과 함께), 응답에 없는 칸 → 읽지 못함(다름으로 안 셈)
  camps.get(cid).dailyBudget = 5000;
  Object.assign(groups.get(gid), { pcNetworkBidWeight: 80 });
  delete groups.get(gid).adRollingType;
  const r2 = await act(p.id, { action: 'readback' });
  const it2 = Object.fromEntries(r2.readBack.items.map((x) => [x.key, x]));
  assert.deepEqual([it2.budget.ok, it2.budget.naver, it2.budget.plan], [false, '5,000원', '3,000원']);
  assert.deepEqual([it2.weight.ok, it2.weight.naver], [false, '80%·120%']);
  assert.deepEqual([it2.rolling.ok, it2.rolling.naver], [null, null]);
  assert.equal(r2.readBack.items.filter((x) => x.ok === false).length, 2);
  // 카드에 남음 · 바꾼 것 없음(읽기만)
  const card = (await ctx.owner.ok('GET', '/api/marketing/ad-ops')).plans.find((x) => x.id === p.id);
  assert.equal(card.external.readBack.at, r2.readBack.at);
  calls = [];
  await act(p.id, { action: 'readback' });
  assert.deepEqual(calls.filter((c) => c.method !== 'GET'), [], '네이버에 쓰는 요청 없음');
  // 세팅안만 있고 캠페인 없음 → 409 · 직원 403 · 없는 세팅안 404
  const d = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '아직 안 만듦' }));
  assert.equal((await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${d.id}/action`, { action: 'readback' })).status, 409);
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'readback' })).status, 403);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/plans/00000000-0000-4000-8000-000000000000/action', { action: 'readback' })).status, 404);
});

test("끊긴 '만드는 중'(5분 넘게 진행 없음) → 다시 눌러 이어 만들기 · 진행 중이면 409", async () => {
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '끊긴 세팅안' }));
  await sql`update mkt_ad_plans set status = 'creating', updated_at = now() where id = ${p.id}`;
  const busy = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(busy.status, 409); assert.match(busy.body.error.message, /만드는 중/);
  await sql`update mkt_ad_plans set updated_at = now() - interval '10 minutes' where id = ${p.id}`;
  const ok = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(ok.ok, true);
  assert.equal((await sql`select status from mkt_ad_plans where id = ${p.id}`)[0].status, 'created');
});
