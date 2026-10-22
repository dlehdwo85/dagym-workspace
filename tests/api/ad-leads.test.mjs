// 광고 최적화 1차 ③ 통화 기반 최적화 (네이버 가짜 서버 = 구조 시험 — 키워드 userLock 은 실계정 확인 전)
// 사이트 비콘 전화 클릭(랜딩 주소의 n_keyword_id·n_keyword·gclid+utm_term, 광고 아닌 유입은 안 셈) · 웹 문의 유입 주소 · 전화 기록 '광고 키워드'
// → 키워드별 광고비 × 전화(클릭·기록 중 큰 값)·문의 → 전환당 비용 = 손 계산 · 판단(0건 끄기 제안·비용 높음·잘 됨, 추적 절반 미만이면 0건 판단 안 함)
// → 목표 전환당 비용(회사 설정) · 워크인 세팅안 키워드만 [끄기]·되돌리기 · 직원은 보기만 · 공간 미배정 404
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

const PORT = 3234;
let srv, ctx, sql, naver, calls = [], seq = 0;
const kwStore = new Map();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
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
    if (req.method === 'POST' && path === '/ncc/keywords') { const g = kwStore.get(u.searchParams.get('nccAdgroupId')) ?? []; for (const k of j) g.push({ nccKeywordId: `nkw-${++seq}`, keyword: k.keyword }); kwStore.set(u.searchParams.get('nccAdgroupId'), g); return send(200, j.map((k) => ({ keyword: k.keyword }))); }
    if (req.method === 'GET' && path === '/ncc/keywords') return send(200, kwStore.get(u.searchParams.get('nccAdgroupId')) ?? []);
    if (req.method === 'POST' && path === '/ncc/ads') return send(200, { nccAdId: `nad-${++seq}`, ...j });
    if (req.method === 'PUT' && (path.startsWith('/ncc/keywords/') || path.startsWith('/ncc/campaigns/'))) return send(200, { ...j });
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb();
  srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` });
  sql = testDb(); ctx = await bootstrap();
});
after(async () => { srv?.proc.kill(); naver?.close(); await sql?.end(); });

const beacon = (k, b) => fetch(`${BASE}/api/public/site-event?k=${k}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.status);
const inquiry = (tok, b) => fetch(`${BASE}/api/integrations/inquiries`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify(b) }).then((r) => r.status);

test('통화 기반 최적화: 광고 유입 전화·문의·전화 기록 → 키워드별 전환당 비용·판단·키워드 끄기', async () => {
  const owner = ctx.owner;
  await owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  const acc = await owner.ok('POST', '/api/marketing/ads/accounts', { label: '두정점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' });
  await owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 3000000 });
  // 워크인 세팅안(키워드 3개) → 만들기
  const p = await owner.ok('POST', '/api/marketing/ad-ops/plans', { accountId: acc.id, name: '두정 전화', dailyBudget: 10000, bidAmt: 300, channelId: 'bsn-1', keywords: ['두정동 헬스장', '두정역 PT', '천안 PT'],
    ads: [{ headline: '가을 PT 상담', description: '첫 상담 무료, 가까운 헬스장에서 시작하세요', url: 'https://example.com' }] });
  const made = await owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/approve`, {});
  const [k1, k2, k3] = made.external.keywordIds;
  // 키워드 성과(하루 한 번 읽는 표): 워크인 3개 + 사람이 만든 캠페인 키워드 1개(kx)
  for (const [id, name, clicks, cost] of [[k1, '두정동헬스장', 100, 30000], [k2, '두정역PT', 120, 80000], [k3, '천안PT', 20, 8000], ['nkw-x', '헬스장가격', 150, 60000]]) {
    await sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, campaign_name, impressions, clicks, cost_krw) values (${acc.id}, ${today}, 'keyword', ${id}, ${name}, '두정 전화', ${clicks * 20}, ${clicks}, ${cost})`;
  }
  // 사이트 비콘(문의 연동 토큰): 광고로 들어온 사람의 전화 클릭만 키워드별로 셈
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const tok = (await owner.ok('POST', '/api/platform/inquiries/tokens', { site: 'dagym', name: '다짐 웹' })).token;
  const land = (q) => `https://dagym.example/pt?${q}`;
  assert.equal(await beacon(tok, { event: 'cta', label: 'tel', landing: land(`n_media=27758&n_query=%EB%91%90%EC%A0%95%EB%8F%99%ED%97%AC%EC%8A%A4&n_keyword_id=${k1}&n_keyword=%EB%91%90%EC%A0%95%EB%8F%99%ED%97%AC%EC%8A%A4%EC%9E%A5`) }), 200);
  assert.equal(await beacon(tok, { event: 'cta', label: '전화 걸기', landing: land(`n_keyword_id=${k1}`) }), 200);
  assert.equal(await beacon(tok, { event: 'cta', label: 'tel', landing: land('n_media=27758&n_keyword=%ED%97%AC%EC%8A%A4%EC%9E%A5%20%EA%B0%80%EA%B2%A9') }), 200); // id 없이 글자로 → kx
  assert.equal(await beacon(tok, { event: 'cta', label: 'tel' }), 200); // 랜딩 없음 → 키워드 모름
  assert.equal(await beacon(tok, { event: 'cta', label: 'tel', landing: land('utm_source=instagram&utm_medium=social') }), 200); // 광고 아님 → 안 셈
  assert.equal(await beacon(tok, { event: 'cta', label: '상담 신청', landing: land('gclid=abc&utm_term=%EB%91%90%EC%A0%95%20%ED%94%BC%ED%8B%B0') }), 200); // 구글 버튼 클릭
  const leadsRows = await sql`select provider, keyword_key, keyword_id, kind, n from mkt_ad_leads order by provider, kind, keyword_key`;
  assert.deepEqual(leadsRows.map((r) => [r.provider, r.keyword_key, r.keyword_id, r.kind, r.n]),
    [['google', '두정피티', '', 'cta', 1], ['naver', '', k1, 'tel', 1], ['naver', '두정동헬스장', k1, 'tel', 1], ['naver', '헬스장가격', '', 'tel', 1]]);
  // 웹 문의: 유입 주소에 광고 키워드 id → k1, utm 만(광고 아님) → 키워드 모름
  assert.equal(await inquiry(tok, { lead_id: 'DG-1', inquiry_type: 'PT 상담', name: '김손님', phone: '010-1111-2222', landing_page: land(`n_keyword_id=${k1}`) }), 200);
  assert.equal(await inquiry(tok, { lead_id: 'DG-2', inquiry_type: 'PT 상담', name: '이손님', phone: '010-3333-4444', utm: { utm_source: 'naver', utm_medium: 'blog' } }), 200);
  // 전화 기록: "어떻게 알고 전화하셨어요?" → 광고 키워드(띄어쓰기 달라도 같은 키워드), 없으면 키워드 모름
  await owner.ok('POST', '/api/marketing/calls', { phone: '010-5555-6666', adKeyword: '두정동 헬스장' });
  const c2 = await owner.ok('POST', '/api/marketing/calls', { phone: '010-7777-8888' });
  const list = await owner.ok('GET', '/api/marketing/calls');
  assert.deepEqual(list.adKeywords.slice(0, 2), ['두정역PT', '헬스장가격'], '최근 광고비 많은 키워드 순 고르기 목록');
  assert.equal(list.calls.find((c) => c.phone === '010-5555-6666').ad_keyword, '두정동 헬스장');

  // 보고서: k1 전화 max(클릭 2, 기록 1) = 2 + 문의 1 = 3건 → 30,000 ÷ 3 = 10,000원 / kx 1건 → 60,000원 / k2·k3 0건
  let r = await owner.ok('GET', '/api/marketing/ad-ops/leads?days=30');
  const row = (k) => r.rows.find((x) => x.itemId === k);
  assert.deepEqual([row(k1).tel, row(k1).calls, row(k1).phone, row(k1).inquiries, row(k1).leads, row(k1).cpa], [2, 1, 2, 1, 3, 10000]);
  assert.deepEqual([row('nkw-x').leads, row('nkw-x').cpa, row('nkw-x').planId], [1, 60000, null], '사람이 만든 캠페인 키워드는 끄기 단추 없음');
  assert.equal(row(k1).planId, p.id);
  assert.deepEqual(r.totals, { cost: 178000, clicks: 390, tel: 3, calls: 1, phone: 3, inquiries: 1, cta: 1, leads: 4, cpa: 44500 });
  assert.deepEqual(r.unknown, { tel: 2, calls: 1, inquiries: 1 }, '전화 클릭 중 랜딩 없는 것·광고 아닌 것(인스타 일반) = 키워드 모름');
  assert.equal(r.coverage, 57, '키워드를 아는 리드 4 / (4 + 모름 문의 1 + max(전화 클릭 2, 기록 1))'); assert.equal(r.judge, true);
  assert.deepEqual(r.target, { cpa: 44500, custom: false, avg: 44500 });
  // 판단(목표 = 평균 44,500): k2 0건·80,000원(≥ 66,750) → 끄기 제안, k1 10,000원(≤ 31,150) → 잘 됨, k3 8,000원은 판단 안 함(2만 원 미만)
  assert.deepEqual(r.rows.map((x) => [x.keyword, x.flag]).slice(0, 4), [['두정역PT', 'waste'], ['두정동헬스장', 'good'], ['헬스장가격', null], ['천안PT', null]]);
  const g = r.rows.find((x) => x.provider === 'google'); assert.deepEqual([g.keyword, g.cost, g.leads], ['두정 피티', 0, 0], '광고비 자료 없는 구글 키워드도 줄로');
  // 목표 20,000원(회사 설정) → kx 60,000원 = 3배 → 비용 높음, 순서 = 끄기 제안 · 비용 높음 · 잘 됨
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/ad-ops/target-cpa', { cpa: 20000 })).status, 403);
  assert.equal((await owner.req('PUT', '/api/marketing/ad-ops/target-cpa', { cpa: 500 })).status, 400);
  await owner.ok('PUT', '/api/marketing/ad-ops/target-cpa', { cpa: 20000 });
  r = await owner.ok('GET', '/api/marketing/ad-ops/leads');
  assert.deepEqual(r.target, { cpa: 20000, custom: true, avg: 44500 });
  assert.deepEqual(r.rows.map((x) => x.flag).slice(0, 3), ['waste', 'high', 'good']);
  // 추적이 절반이 안 되면(키워드 모르는 전화 기록이 많으면) 0건 판단을 하지 않음
  for (let i = 0; i < 5; i++) await owner.ok('POST', '/api/marketing/calls', { phone: `010-9000-000${i}` });
  r = await owner.ok('GET', '/api/marketing/ad-ops/leads');
  assert.equal(r.judge, false); assert.equal(r.rows.some((x) => x.flag === 'waste'), false);
  await sql`update mkt_calls set status = 'excluded' where phone like '010-9000-%'`;
  // 전화 기록에 나중에 광고 키워드 적기(지우기는 null)
  await owner.ok('PATCH', `/api/marketing/calls/${c2.id}`, { adKeyword: '헬스장 가격' });
  r = await owner.ok('GET', '/api/marketing/ad-ops/leads');
  assert.equal(row('nkw-x').calls, 1); assert.equal(r.unknown.calls, 0);
  await owner.ok('PATCH', `/api/marketing/calls/${c2.id}`, { adKeyword: null });
  assert.equal((await sql`select ad_keyword from mkt_calls where id = ${c2.id}`)[0].ad_keyword, null);

  // 끄기 제안 키워드 [끄기] = 네이버 키워드 userLock → 표에 '꺼짐' → 되돌리기 = 켬
  calls = [];
  await owner.ok('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'kw_pause', keywordIds: [k2] });
  assert.deepEqual(calls.map((c) => [c.method, c.path, c.q.fields, c.body]), [['PUT', `/ncc/keywords/${k2}`, 'userLock', { nccKeywordId: k2, userLock: true }]]);
  r = await owner.ok('GET', '/api/marketing/ad-ops/leads');
  assert.equal(row(k2).paused, true);
  let ov = await owner.ok('GET', '/api/marketing/ad-ops');
  const kp = ov.changes.find((c) => c.kind === 'kw_pause');
  assert.deepEqual([kp.after.keywords, kp.money_up], [['두정역 PT'], false]);
  await owner.ok('POST', `/api/marketing/ad-ops/changes/${kp.id}/revert`, {});
  assert.deepEqual(calls.at(-1).body, { nccKeywordId: k2, userLock: false });
  ov = await owner.ok('GET', '/api/marketing/ad-ops');
  assert.deepEqual([ov.changes[0].kind, ov.changes[0].revert_of], ['kw_resume', kp.id]);
  assert.equal((await owner.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'kw_pause', keywordIds: ['nkw-x'] })).status, 400, '세팅안 밖 키워드');
  // 직원: 보기만(끄기 403) · 공간 미배정 404
  const sv = await ctx.staffA.client.ok('GET', '/api/marketing/ad-ops/leads');
  assert.equal(sv.canEdit, false); assert.equal(sv.rows.length, r.rows.length);
  assert.equal((await ctx.staffA.client.req('POST', `/api/marketing/ad-ops/plans/${p.id}/action`, { action: 'kw_pause', keywordIds: [k2] })).status, 403);
  assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/ad-ops/leads')).status, 404);
});
