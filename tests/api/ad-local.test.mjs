// 광고 최적화 1차 ② 동네 타깃 (네이버 가짜 서버 = 구조 시험 — 지역 타겟팅·키워드 지우기는 실계정 확인 전)
// 동네 이름 추천(AI 추정, 이름 모양·반경·중복 거름 · 형식 오류는 '직접 적기') → 동네 × 서비스 검색량(키워드 도구, 거의 없음 표시, 연관 동네 키워드)
// → 세팅안 광고 지역(시·도) = [승인하고 시작] 때 꺼진 상태에서 맞춤(실패하면 멈추고 다시 누르면 이어서) → 켠 광고 지역 바꾸기·되돌리기·세부 지역은 안 건드림
// → 동네 키워드 추가(이미 있던 것은 안 만듦) → 되돌리기 = 새로 만든 것만 지움 · 직원 403 · 공간 미배정 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, ensureTls, resetDb, startServer, testDb, FAKE } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

const PORT = 3233;
let srv, ctx, sql, fake, naver, calls = [], seq = 0, failTarget = false;
const kwStore = new Map(); // 그룹 → 키워드
const targets = new Map(); // 그룹 → 지역 타겟(target 값)
const vol = (hint) => (hint.includes('두정') && hint.includes('헬스장') ? [300, 2100] : hint.includes('두정') ? [120, 880] : hint.includes('성정') && hint.includes('헬스장') ? ['< 10', 40] : ['< 10', '< 10']);
before(async () => {
  naver = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const path = u.pathname.slice('/naver'.length);
    res.setHeader('content-type', 'application/json');
    const send = (code, j) => { res.statusCode = code; res.end(JSON.stringify(j)); };
    const sig = createHmac('sha256', 'naver-secret-key-xyz').update(`${req.headers['x-timestamp']}.${req.method}.${path}`).digest('base64');
    if (req.headers['x-signature'] !== sig || req.headers['x-customer'] !== '1234567') return send(403, { title: 'Forbidden', code: 1018 });
    const j = body ? JSON.parse(body) : null;
    calls.push({ method: req.method, path, q: Object.fromEntries(u.searchParams), body: j });
    if (req.method === 'GET' && path === '/ncc/campaigns') return send(200, []);
    if (req.method === 'GET' && path === '/stats') return send(200, { data: [] });
    if (req.method === 'POST' && path === '/ncc/campaigns') return send(200, { nccCampaignId: `cmp-${++seq}`, ...j });
    if (req.method === 'POST' && path === '/ncc/adgroups') return send(200, { nccAdgroupId: `grp-${++seq}`, ...j });
    if (req.method === 'POST' && path === '/ncc/keywords') { const g = kwStore.get(u.searchParams.get('nccAdgroupId')) ?? []; for (const k of j) g.push({ nccKeywordId: `kw-${++seq}`, keyword: k.keyword }); kwStore.set(u.searchParams.get('nccAdgroupId'), g); return send(200, j.map((k) => ({ keyword: k.keyword }))); }
    if (req.method === 'GET' && path === '/ncc/keywords') return send(200, kwStore.get(u.searchParams.get('nccAdgroupId')) ?? []);
    if (req.method === 'DELETE' && path.startsWith('/ncc/keywords/')) { const id = path.split('/').pop(); for (const [g, l] of kwStore) kwStore.set(g, l.filter((k) => k.nccKeywordId !== id)); res.statusCode = 204; return res.end(); }
    if (req.method === 'POST' && path === '/ncc/ads') return send(200, { nccAdId: `nad-${++seq}`, ...j });
    if (req.method === 'PUT' && path.startsWith('/ncc/campaigns/')) return send(200, { ...j });
    // 지역 타겟: 광고그룹마다 1개(문서: target 은 JSON 문자열로 옴, 타겟 없음 = null = 전국)
    if (req.method === 'GET' && path === '/ncc/targets') {
      const g = u.searchParams.get('ownerId');
      if (failTarget) return send(500, { title: 'Internal error', code: 9999 });
      return send(200, [{ nccTargetId: `tgt-${g}`, ownerId: g, targetTp: 'REGIONAL_TARGET', target: targets.has(g) ? JSON.stringify(targets.get(g)) : null }]);
    }
    if (req.method === 'PUT' && path.startsWith('/ncc/targets/')) { targets.set(j.ownerId, j.target); return send(200, { ...j, target: JSON.stringify(j.target) }); }
    if (req.method === 'GET' && path === '/keywordstool') {
      const hints = u.searchParams.get('hintKeywords').split(',');
      return send(200, { keywordList: [...hints.map((h) => { const [pc, mobile] = vol(h); return { relKeyword: h, monthlyPcQcCnt: pc, monthlyMobileQcCnt: mobile, compIdx: '중간' }; }),
        { relKeyword: '두정동헬스장추천', monthlyPcQcCnt: 500, monthlyMobileQcCnt: 1900 }, { relKeyword: '서울헬스장', monthlyPcQcCnt: 9000, monthlyMobileQcCnt: 30000 }] });
    }
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb(); await ensureTls(); fake = await startFakeGoogle();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); naver?.close(); fake?.server.close(); await sql?.end(); });

const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const reply = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const plan = (accountId, over = {}) => ({ accountId, name: '두정 회원 모집', dailyBudget: 5000, bidAmt: 300, channelId: 'bsn-1', keywords: ['동네 헬스장'],
  ads: [{ headline: '가을 PT 상담', description: '첫 상담 무료, 가까운 헬스장에서 시작하세요', url: 'https://example.com' }], ...over });

test('동네 타깃: 동네 추천·검색량·광고 지역(시·도)·동네 키워드 추가·되돌리기', async () => {
  const owner = ctx.owner;
  await owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  const acc = await owner.ok('POST', '/api/marketing/ads/accounts', { label: '두정점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' });
  await owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 300000 });

  // ① 동네 이름 추천(AI 추정): 띄어쓰기 없앰 · 이름 모양 · 반경 1.5배 넘는 곳 · 중복은 버림
  await ctl({ anthropicReset: true, anthropicQueue: [reply({ areas: [{ name: '두정동', kind: '동', km: 0.4 }, { name: '두정역', kind: '역', km: 1.1 }, { name: '성정 동', kind: '동', km: 2 },
    { name: '성정동', kind: '동', km: 2.2 }, { name: '먼동네', kind: '동', km: 9 }, { name: '!!', kind: '기타', km: 1 }] })] });
  const ar = await owner.ok('POST', '/api/marketing/ad-ops/local/areas', { center: '천안 두정동 다짐', radiusKm: 3, services: ['헬스장'] });
  assert.deepEqual(ar.areas.map((a) => [a.name, a.km]), [['두정동', 0.4], ['두정역', 1.1], ['성정동', 2]]);
  assert.match(ar.note, /추정/);
  const asked = (await (await fetch(`${FAKE}/__state`)).json()).anthropic.at(-1).body;
  assert.match(asked.messages[0].content, /기준 위치: 천안 두정동 다짐\n반경: 3km\n업종·서비스: 헬스장/);
  assert.equal((await sql`select purpose from ai_usage order by created_at desc limit 1`)[0].purpose, 'marketing_ads_local', '마케팅 AI 사용량으로');
  // AI 답이 형식에 안 맞으면 '직접 적기' 안내(오류 아님)
  await ctl({ anthropicQueue: [{ content: [{ type: 'text', text: '잘 모르겠습니다' }], stop_reason: 'end_turn' }] });
  const none = await owner.ok('POST', '/api/marketing/ad-ops/local/areas', { center: '천안 두정동', radiusKm: 3 });
  assert.deepEqual(none.areas, []); assert.match(none.note, /직접 적어/);
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ad-ops/local/areas', { center: '천안 두정동', radiusKm: 3 })).status, 403);

  // ② 동네 × 서비스 검색량(네이버 키워드 도구, 5개씩): 많은 순 · '< 10' 은 5 로 셈 · 20 미만은 '검색 거의 없음' · 연관은 동네 이름이 든 것만
  calls = [];
  const kw = await owner.ok('POST', '/api/marketing/ad-ops/local/keywords', { accountId: acc.id, areas: ['두정동', '두정역', '성정동'], services: ['헬스장', 'PT'] });
  assert.deepEqual(kw.rows.map((r) => [r.keyword, r.total, r.low]), [['두정동 헬스장', 2400, false], ['두정역 헬스장', 2400, false], ['두정동 PT', 1000, false], ['두정역 PT', 1000, false],
    ['성정동 헬스장', 45, false], ['성정동 PT', 10, true]]);
  assert.deepEqual([kw.rows[0].pc, kw.rows[0].mobile], [300, 2100]);
  assert.deepEqual(kw.related, [{ keyword: '두정동헬스장추천', total: 2400 }], '동네 이름이 든 연관 키워드만(서울헬스장은 뺌)');
  assert.deepEqual(calls.filter((c) => c.path === '/keywordstool').map((c) => c.q.hintKeywords.split(',').length), [5, 1], '띄어쓰기 없이 5개씩');
  assert.equal(calls.find((c) => c.path === '/keywordstool').q.hintKeywords.split(',')[0], '두정동헬스장');
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ad-ops/local/keywords', { accountId: acc.id, areas: ['두정동'], services: ['PT'] })).status, 403);

  // ③ 세팅안 광고 지역 충남(15) → [승인하고 시작] 때 꺼진 상태에서 지역 타겟 맞춤(해외 끔)
  const p = await owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { local: { center: '천안 두정동 다짐', radiusKm: 3, areas: ['두정동', '두정역'], region: ['15'], abroad: false } }));
  assert.deepEqual(p.issues, []);
  calls = [];
  const made = await owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  const grp = made.external.adgroupId;
  const tg = calls.find((c) => c.method === 'GET' && c.path === '/ncc/targets');
  assert.deepEqual([tg.q.ownerId, tg.q.types], [grp, 'REGIONAL_TARGET']);
  const put = calls.find((c) => c.method === 'PUT' && c.path.startsWith('/ncc/targets/'));
  assert.deepEqual(put, { method: 'PUT', path: `/ncc/targets/tgt-${grp}`, q: {}, body: { nccTargetId: `tgt-${grp}`, ownerId: grp, targetTp: 'REGIONAL_TARGET', target: { location: { KR: ['15'], OTHERS: [] } } } });
  assert.ok(calls.findIndex((c) => c === put) > calls.findIndex((c) => c.path === '/ncc/ads'), '소재까지 만든 뒤(꺼진 상태)');
  assert.equal(made.external.regionSet, true);
  // 지역을 못 맞추면 '실패'로 멈춤 → 다시 누르면 지역만 이어서(캠페인·그룹·키워드·소재 다시 안 만듦)
  const p2 = await owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '서울 시험', local: { center: '', radiusKm: 3, areas: [], region: ['09'], abroad: true } }));
  failTarget = true;
  const half = await owner.req('POST', `/api/marketing/ad-ops/plans/${p2.id}/approve`, {});
  assert.equal(half.status, 502); assert.match(half.body.error.message, /9999/);
  assert.equal((await sql`select status from mkt_ad_plans where id = ${p2.id}`)[0].status, 'failed');
  failTarget = false; calls = [];
  const again = await owner.ok('POST', `/api/marketing/ad-ops/plans/${p2.id}/approve`, {});
  assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => c.path), [], '이어서 — 새로 만드는 것 없음');
  assert.deepEqual(targets.get(again.external.adgroupId), { location: { KR: ['09'], OTHERS: ['00'] } }, '서울 + 해외');

  // ④ 켠 광고 지역 바꾸기(충남 → 충남·충북) → 되돌리기(충남). 하루 예산 그대로라 돈 나가는 변경 아님
  await owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'enable' });
  await owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'region', region: ['15', '16'], abroad: false });
  assert.deepEqual(targets.get(grp), { location: { KR: ['15', '16'], OTHERS: [] } });
  let ov = await owner.ok('GET', '/api/marketing/ad-ops');
  const rc = ov.changes.find((c) => c.kind === 'region');
  assert.deepEqual([rc.before, rc.after, rc.money_up], [{ KR: ['15'], OTHERS: [] }, { KR: ['15', '16'], OTHERS: [] }, false]);
  assert.deepEqual(ov.plans.find((x) => x.id === p.id).plan.local.region, ['15', '16']);
  await owner.ok('POST', `/api/marketing/ad-ops/changes/${rc.id}/revert`, {});
  assert.deepEqual(targets.get(grp), { location: { KR: ['15'], OTHERS: [] } });
  ov = await owner.ok('GET', '/api/marketing/ad-ops');
  assert.deepEqual([ov.changes[0].kind, ov.changes[0].revert_of], ['region', rc.id]);
  // 네이버 화면에서 시·군·구까지 정한 그룹은 덮어쓰지 않음(409, PUT 없음)
  targets.set(grp, { location: { KR: ['1501'], OTHERS: [] } }); calls = [];
  const custom = await owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'region', region: ['15'] });
  assert.equal(custom.status, 409); assert.equal(custom.body.error.code, 'region_custom');
  assert.equal(calls.filter((c) => c.method === 'PUT').length, 0);
  targets.set(grp, { location: { KR: ['15'], OTHERS: [] } });

  // ⑤ 동네 키워드 추가: 세팅안에 이미 있는 것은 빼고, 네이버 그룹에 이미 있던 것(사람이 직접 넣은 '두정역PT')은 다시 안 만듦
  kwStore.get(grp).push({ nccKeywordId: 'kw-manual', keyword: '두정역PT' });
  calls = [];
  const added = await owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'keywords_add', keywords: ['동네헬스장', '두정동 헬스장', '두정역 PT', '두정동 헬스장'],
    local: { center: '천안 두정동 다짐', radiusKm: 3, areas: ['두정동', '두정역', '성정동'] } });
  assert.deepEqual(added.keywords, ['두정동 헬스장', '두정역 PT']);
  const created = calls.filter((c) => c.method === 'POST' && c.path === '/ncc/keywords').flatMap((c) => c.body);
  assert.deepEqual(created.map((k) => [k.keyword, k.useGroupBidAmt, k.bidAmt]), [['두정동헬스장', false, 300]], '없던 것만, 세팅안 입찰가로');
  let pl = (await sql`select plan, external from mkt_ad_plans where id = ${p.id}`)[0];
  assert.deepEqual(pl.plan.keywords, ['동네 헬스장', '두정동 헬스장', '두정역 PT']);
  assert.equal(pl.external.keywordIds.length, 3); assert.equal(pl.external.keywordIds[2], 'kw-manual');
  assert.deepEqual(pl.plan.local.areas, ['두정동', '두정역', '성정동']); assert.deepEqual(pl.plan.local.region, ['15'], '지역은 그대로');
  assert.equal((await owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'keywords_add', keywords: ['두정역PT'] })).status, 400, '모두 이미 있음');
  ov = await owner.ok('GET', '/api/marketing/ad-ops');
  const ka = ov.changes.find((c) => c.kind === 'keywords_add');
  assert.deepEqual(ka.after.createdIds, [pl.external.keywordIds[1]]);
  // 되돌리기 = 그때 새로 만든 키워드만 네이버에서 지움 + 세팅안에서 뺌(사람이 넣은 kw-manual 은 네이버에 남김)
  calls = [];
  await owner.ok('POST', `/api/marketing/ad-ops/changes/${ka.id}/revert`, {});
  assert.deepEqual(calls.filter((c) => c.method === 'DELETE').map((c) => c.path), [`/ncc/keywords/${pl.external.keywordIds[1]}`]);
  pl = (await sql`select plan, external from mkt_ad_plans where id = ${p.id}`)[0];
  assert.deepEqual(pl.plan.keywords, ['동네 헬스장']); assert.equal(pl.external.keywordIds.length, 1);
  assert.ok(kwStore.get(grp).some((k) => k.nccKeywordId === 'kw-manual'));
  ov = await owner.ok('GET', '/api/marketing/ad-ops');
  assert.deepEqual([ov.changes[0].kind, ov.changes[0].revert_of], ['keywords_remove', ka.id]);
  assert.equal((await owner.req('POST', `/api/marketing/ad-ops/changes/${ov.changes[0].id}/revert`, {})).status, 409, '빼기는 되돌리지 않음(다시 추가)');

  // 직원 403 · 공간 미배정 직원 404
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'region', region: ['09'] })).status, 403);
  assert.equal((await ctx.staffB.client.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'keywords_add', keywords: ['두정동 PT'] })).status, 404);
  assert.equal((await ctx.staffB.client.req('POST', '/api/marketing/ad-ops/local/keywords', { accountId: acc.id, areas: ['두정동'], services: ['PT'] })).status, 404);
});
