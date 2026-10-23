// #499-2 파워링크 세팅안 보강(테크트리 EP.7, 네이버 가짜 서버 = 구조 시험 — 실계정 생성 확인 전):
// 자동 추적(캠페인 trackingMode) · PC/모바일 가중치·소재 노출 방식·확장 검색 비율·ADVoost Max(광고그룹, 네이버 기본값과 같으면 안 보냄)
// · 노출 매체 '네이버 매체만'(MEDIA_TARGET) · 확장 검색 제외 키워드(restricted-keywords EXP_SEARCH) · 실패하면 멈췄다가 이어서
// · 이전 세팅안(광고 설정 없음)은 요청 모양 그대로 · 키워드 300개(100개씩) · N단 조합기 검색량 · 권고(막지 않음) · 하루 예산 권장
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

const PORT = 3241;
let srv, ctx, sql, naver, calls = [], seq = 0, failMedia = false, failVol = '';
const kwStore = new Map(); // 그룹 → 키워드
const targets = new Map(); // 그룹 → 매체 타겟
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
    if (req.method === 'POST' && path === '/ncc/ads') return send(200, { nccAdId: `nad-${++seq}`, ...j });
    // 매체 타겟: 광고그룹마다 1개(새 그룹 = 모든 매체 type 1, target 은 JSON 문자열로 옴)
    if (req.method === 'GET' && path === '/ncc/targets') {
      const g = u.searchParams.get('ownerId');
      return send(200, [{ nccTargetId: `mtg-${g}`, ownerId: g, targetTp: 'MEDIA_TARGET', target: JSON.stringify(targets.get(g) ?? { type: 1, search: [], contents: [], white: { media: null, mediaGroup: null }, black: { media: null, mediaGroup: null } }) }]);
    }
    if (req.method === 'PUT' && path.startsWith('/ncc/targets/')) {
      if (failMedia) return send(400, { title: 'Invalid target.', code: 3820 });
      targets.set(j.ownerId, j.target); return send(200, { ...j, target: JSON.stringify(j.target) });
    }
    // 제외 키워드: '중고' 는 항목별로 거절(이유와 함께), 나머지는 id
    if (req.method === 'POST' && /^\/ncc\/adgroups\/[^/]+\/restricted-keywords$/.test(path)) return send(200, j.map((k) => (k.keyword === '중고'
      ? { keyword: k.keyword, resultStatus: { code: 3955, message: '등록할 수 없는 제외 키워드입니다(시험 사유)' } } : { ...k, nccAdgroupRestrictKwdId: `rst-${++seq}` })));
    if (req.method === 'GET' && path === '/keywordstool') {
      const hints = u.searchParams.get('hintKeywords').split(',');
      if (failVol && hints.some((h) => h.includes(failVol))) return send(429, { title: 'Too many requests', code: 1016 });
      return send(200, { keywordList: [...hints.map((h) => ({ relKeyword: h, monthlyPcQcCnt: h.includes('헬스장') ? 120 : '< 10', monthlyMobileQcCnt: h.includes('헬스장') ? 880 : '< 10' })),
        { relKeyword: '아파트헬스장추천', monthlyPcQcCnt: 300, monthlyMobileQcCnt: 2100 }] });
    }
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); naver?.close(); await sql?.end(); });

const SETUP = { tracking: true, media: 'naver', pcWeight: 60, mobileWeight: 120, rolling: 'PERFORMANCE', expSearch: true, expRatio: 100, aiMax: true, negatives: ['구인', '채 용', '채용'] };
const plan = (accountId, over = {}) => ({ accountId, name: '단지 커뮤니티 운영', dailyBudget: 10000, bidAmt: 300, channelId: 'bsn-1', keywords: ['아파트 커뮤니티 운영', '단지 헬스장 위탁운영'],
  ads: [{ headline: '커뮤니티 운영 고민?', description: '입주 앞둔 단지 관리소장님, 무료 운영 진단 받아 보세요', url: 'https://example.com/community' }], ...over });
const groupBody = () => calls.find((c) => c.method === 'POST' && c.path === '/ncc/adgroups')?.body;
let acc;

test('추천 설정: 추적·가중치·성과 기반 → 만들 때 보냄, 네이버 매체만·제외 키워드는 꺼진 상태에서 맞춤(항목별 거절은 표시)', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  acc = await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '본점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { setup: { ...SETUP, negatives: [...SETUP.negatives, '중고'] } }));
  assert.deepEqual(p.issues, []);
  calls = [];
  const ok = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  const camp = calls.find((c) => c.method === 'POST' && c.path === '/ncc/campaigns').body;
  assert.equal(camp.trackingMode, 'AUTO_TRACKING_MODE', '자동 추적 URL 파라미터');
  assert.equal(camp.userLock, true, '여전히 꺼진 상태로');
  const g = groupBody();
  assert.deepEqual([g.adRollingType, g.pcNetworkBidWeight, g.mobileNetworkBidWeight], ['PERFORMANCE', 60, 120]);
  for (const k of ['useExpSearch', 'expSearchBudgetRatio', 'aiAdsOptIn']) assert.equal(k in g, false, `${k} = 네이버 기본값과 같으면 안 보냄`);
  const gid = ok.external.adgroupId;
  assert.deepEqual(calls.filter((c) => c.path === '/ncc/targets').map((c) => c.q), [{ ownerId: gid, types: 'MEDIA_TARGET' }]);
  const put = calls.find((c) => c.method === 'PUT' && c.path.startsWith('/ncc/targets/'));
  assert.deepEqual(put, { method: 'PUT', path: `/ncc/targets/mtg-${gid}`, q: {}, body: { nccTargetId: `mtg-${gid}`, ownerId: gid, targetTp: 'MEDIA_TARGET',
    target: { type: 2, search: ['naver'], contents: ['naver'], black: { media: [], mediaGroup: [] }, white: { media: null, mediaGroup: null } } } }, '공식 FAQ 네트워크 선택 예시에서 파트너만 뺌');
  const neg = calls.find((c) => c.method === 'POST' && c.path === `/ncc/adgroups/${gid}/restricted-keywords`);
  assert.deepEqual(neg.body, ['구인', '채용', '중고'].map((keyword) => ({ nccAdgroupId: gid, keyword, type: 'EXP_SEARCH' })), '띄어쓰기 빼고 겹치는 것 하나로');
  // 순서: 캠페인 → 그룹 → 키워드 → 소재 → 매체 → 제외 키워드
  const order = calls.filter((c) => c.method !== 'GET').map((c) => c.path.replace(/\/[^/]*\d[^/]*/g, '/:id'));
  assert.deepEqual(order, ['/ncc/campaigns', '/ncc/adgroups', '/ncc/keywords', '/ncc/ads', '/ncc/targets/:id', '/ncc/adgroups/:id/restricted-keywords']);
  assert.equal(ok.external.mediaSet, true); assert.equal(ok.external.negSet, true);
  assert.deepEqual(ok.external.negFailed, ['중고 [code 3955] 등록할 수 없는 제외 키워드입니다(시험 사유)'], '거절된 것만 이유와 함께 — 나머지는 그대로 만듦');
  const ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  const row = ov.plans.find((x) => x.id === p.id);
  assert.equal(row.status, 'created'); assert.deepEqual(row.external.negFailed, ok.external.negFailed);
  assert.deepEqual(row.plan.setup, { ...SETUP, negatives: [...SETUP.negatives, '중고'] }, '세팅안에 그대로 남음');
});

test('이전 세팅안(광고 설정 없음)은 요청 모양 그대로 · 3안 테스트 = 동일 비중 · 확장 검색 끄기·비율·ADVoost Max 끄기', async () => {
  const old = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '이전 세팅안' }));
  calls = [];
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${old.id}/approve`, {});
  assert.deepEqual(Object.keys(calls.find((c) => c.method === 'POST' && c.path === '/ncc/campaigns').body).sort(), ['campaignTp', 'customerId', 'dailyBudget', 'name', 'useDailyBudget', 'userLock']);
  assert.deepEqual(Object.keys(groupBody()).sort(), ['adgroupType', 'bidAmt', 'mobileChannelId', 'name', 'nccCampaignId', 'pcChannelId', 'useDailyBudget', 'userLock']);
  assert.equal(calls.some((c) => c.path === '/ncc/targets' || c.path.includes('restricted')), false, '매체·제외 키워드 요청 없음');

  const ab = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '3안 테스트', setup: { ...SETUP, media: 'all', pcWeight: 100, mobileWeight: 100, expSearch: false, negatives: ['구인'] },
    ads: [{ headline: '커뮤니티 운영 고민?', description: '무료 운영 진단', url: 'https://example.com/a' }, { headline: '운영사 바꿀 때', description: '무료 비교표 드림', url: 'https://example.com/b' }], test: { on: true } }));
  calls = [];
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${ab.id}/approve`, {});
  const g = groupBody();
  assert.equal(g.adRollingType, 'ROUND_ROBIN', '3안 테스트는 같은 비중으로 노출해야 비교가 공정');
  assert.deepEqual([g.useExpSearch, g.aiAdsOptIn, 'pcNetworkBidWeight' in g, 'expSearchBudgetRatio' in g], [false, false, false, false], '확장 검색 끄면 ADVoost Max 도 끔');
  assert.equal(calls.some((c) => c.path === '/ncc/targets' || c.path.includes('restricted')), false, '전체 매체 = 요청 없음, 확장 검색 끔 = 제외 키워드 안 보냄');

  const ratio = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '비율 50', setup: { ...SETUP, media: 'all', expRatio: 50, aiMax: false, negatives: [] } }));
  calls = [];
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${ratio.id}/approve`, {});
  assert.deepEqual([groupBody().expSearchBudgetRatio, groupBody().aiAdsOptIn, 'useExpSearch' in groupBody()], [50, false, false]);
  // 범위 밖 값은 저장 전에 400
  for (const bad of [{ pcWeight: 5 }, { mobileWeight: 501 }, { expRatio: 0 }, { media: 'partner' }, { negatives: Array.from({ length: 101 }, (_, i) => `x${i}`) }])
    assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { setup: { ...SETUP, ...bad } }))).status, 400, JSON.stringify(bad));
});

test('매체 맞추기 실패 → 멈춤(만든 것 기록) → 다시 누르면 매체·제외 키워드만 이어서', async () => {
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '이어서 만들기', setup: { ...SETUP, negatives: ['구인'] } }));
  failMedia = true; calls = [];
  const r = await ctx.owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.equal(r.status, 502); assert.match(r.body.error.message, /3820/);
  const [f] = await sql`select status, external from mkt_ad_plans where id = ${p.id}`;
  assert.equal(f.status, 'failed');
  assert.ok(f.external.campaignId && f.external.adgroupId && f.external.keywordIds?.length && f.external.adIds?.length && !f.external.mediaSet && !f.external.negSet, JSON.stringify(f.external));
  failMedia = false; calls = [];
  await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => c.method + ' ' + c.path.replace(/\/[^/]*\d[^/]*/g, '/:id')), ['PUT /ncc/targets/:id', 'POST /ncc/adgroups/:id/restricted-keywords'], '캠페인·그룹·키워드·소재는 다시 안 만듦');
  assert.equal((await sql`select status from mkt_ad_plans where id = ${p.id}`)[0].status, 'created');
});

test('키워드 300개까지(네이버에 100개씩) · 301개 400 · 직원 403', async () => {
  const many = Array.from({ length: 250 }, (_, i) => `아파트 커뮤니티 ${i}`);
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '롱테일 250', keywords: many, setup: { ...SETUP, media: 'all', negatives: [] } }));
  calls = [];
  const ok = await ctx.owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  assert.deepEqual(calls.filter((c) => c.method === 'POST' && c.path === '/ncc/keywords').map((c) => c.body.length), [100, 100, 50]);
  assert.equal(ok.external.keywordIds.length, 250);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { keywords: Array.from({ length: 300 }, (_, i) => `키워드 ${i}`) }))).status, 200);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { keywords: Array.from({ length: 301 }, (_, i) => `키워드 ${i}`) }))).status, 400);
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { setup: SETUP }))).status, 403);
  // 네이버는 띄어쓰기를 구분하지 않음 — 띄어쓰기만 다른 키워드도 겹침(같은 키워드 id 로 묶여 버림)
  const sp = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { keywords: ['헬스장 운영', '헬스장운영', '단지 운영'] }));
  assert.deepEqual(sp.issues, ['겹치는 키워드(띄어쓰기만 다른 것 포함): 헬스장운영']);
});

test('N단 조합기: 그룹 곱 + 빼도 됨 → 월 검색량·낮음 표시·연관 키워드 · 일부 묶음 실패는 자료 없음 · 직원 403 · 없는 계정 404', async () => {
  const groups = [{ words: ['아파트', '단지'], optional: true }, { words: ['커뮤니티', '헬스장'] }, { words: ['운영', '위탁운영'] }];
  const r = await ctx.owner.ok('POST', '/api/marketing/ad-ops/keywords/combine', { accountId: acc.id, groups });
  assert.equal(r.rows.length, 12, '2×2×2 + (그룹 1 없이) 2×2');
  assert.equal(r.truncated, false);
  const by = Object.fromEntries(r.rows.map((x) => [x.keyword, x]));
  assert.deepEqual([by['아파트 헬스장 운영'].total, by['아파트 헬스장 운영'].low, by['단지 커뮤니티 위탁운영'].total, by['단지 커뮤니티 위탁운영'].low], [1000, false, 10, true], "'< 10' 은 5 로 셈");
  assert.ok(by['헬스장 운영'], '빼도 됨 그룹 없는 조합');
  assert.equal(r.rows[0].total >= r.rows.at(-1).total, true, '검색량 많은 순');
  assert.deepEqual(r.related.map((x) => x.keyword), ['아파트헬스장추천']);
  failVol = '단지';
  const part = await ctx.owner.ok('POST', '/api/marketing/ad-ops/keywords/combine', { accountId: acc.id, groups });
  assert.ok(part.failed > 0, '실패한 묶음 수');
  assert.equal(part.rows.length, 12, '실패해도 조합은 모두');
  assert.ok(part.rows.some((x) => x.pc === null), '읽지 못한 것은 자료 없음');
  failVol = '';
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ad-ops/keywords/combine', { accountId: acc.id, groups })).status, 403);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/keywords/combine', { accountId: '00000000-0000-4000-8000-000000000000', groups })).status, 404);
  assert.equal((await ctx.owner.req('POST', '/api/marketing/ad-ops/keywords/combine', { accountId: acc.id, groups: [groups[0]] })).status, 400, '그룹 2개 이상');
});

test('권고(시작을 막지 않음)·하루 예산 권장(이번 달 승인된 네이버 예산 ÷ 30 × 1.5 의 재료)', async () => {
  const p = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { name: '권고 시험', setup: { ...SETUP, negatives: [] },
    ads: [{ headline: '가을 소식', description: '좋은 서비스를 만나 보세요', url: 'https://example.com' }, { headline: '가을 특가', description: '지금 바로 확인', url: 'https://example.com/b' }] }));
  assert.deepEqual(p.issues, [], '권고는 검사(막는 것)와 따로');
  assert.ok(p.advice.some((x) => /소재 1 연결 주소가 홈페이지 첫 화면/.test(x)), JSON.stringify(p.advice));
  assert.ok(!p.advice.some((x) => /소재 1·2 연결 주소/.test(x)), '경로가 있으면 첫 화면 아님');
  assert.ok(p.advice.some((x) => /^소재 1 광고형 점수 \d+점 — 제안이 없음/.test(x)), JSON.stringify(p.advice));
  assert.ok(p.advice.some((x) => /질문형 제목\(물음표\) 안이 없습니다/.test(x)));
  assert.ok(p.advice.some((x) => /제외 키워드\(예: 구인, 채용, 알바\)/.test(x)));
  const good = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', plan(acc.id, { setup: SETUP }));
  assert.deepEqual(good.advice, [], '대상·제안이 있는 문구 + 서비스 페이지 + 제외 키워드 = 권고 없음');
  // 하루 예산 권장의 '월': 이번 달 승인된 광고 예산의 네이버 몫, 브랜드는 집행과 같은 비율
  const [br] = await sql`insert into mkt_brands (tenant, name) values ('default', '다짐') returning id`;
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
  await sql`insert into mkt_ad_budgets (tenant, month, status, plan, total, brand_plan) values ('default', ${month}, 'approved',
    ${sql.json([{ provider: 'naver', monthly: 600000 }, { provider: 'meta', monthly: 400000 }])}, 1000000, ${sql.json([{ brandId: br.id, name: '다짐', monthly: 500000 }])})`;
  const ov = await ctx.owner.ok('GET', '/api/marketing/ad-ops');
  assert.deepEqual(ov.budgetHint, { naver: 600000, brands: { [br.id]: 300000 } });
  assert.ok(ov.plans.find((x) => x.id === p.id).advice.length >= 3, '목록에도 권고');
});
