// 대표 10/21 02:30: ① 승인함 통합(건수·목록·사이드바 배지) ② 반려 사유 → AI 고친 안 v2 재요청(최대 3회, 알림 1회) — 제안·예산·월 목표 ③ 광고 예산 브랜드 축(비중·우선순위·메모·대표 총액·목표 연동·브랜드 세팅안 집행·'세팅안 필요')
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

const PORT = 3227;
let srv, ctx, sql, fake, naver, calls = [];
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const today = seoulToday(); const month = today.slice(0, 7);
const P = {};
const PLAN = (over = {}) => ({ plan: [{ provider: 'naver', monthly: 600000, note: 'CPC 좋음' }, { provider: 'meta', monthly: 300000, note: '시작' }, { provider: 'google', monthly: 100000, note: '' }, { provider: 'youtube', monthly: 0, note: '' }], rationale: '네이버 중심', brands: [], changes: '', ...over });
before(async () => {
  naver = http.createServer(async (req, res) => { // 구조 시험용 가짜 네이버(서명 검사 + 캠페인 예산 PUT) — 실제 연동 완료가 아님
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const path = u.pathname.slice('/naver'.length); res.setHeader('content-type', 'application/json');
    const send = (code, j) => { res.statusCode = code; res.end(JSON.stringify(j)); };
    const sig = createHmac('sha256', 'naver-secret-key-xyz').update(`${req.headers['x-timestamp']}.${req.method}.${path}`).digest('base64');
    if (req.headers['x-signature'] !== sig || req.headers['x-customer'] !== '1234567') return send(403, { title: 'Forbidden', code: 1018 });
    const j = body ? JSON.parse(body) : null; calls.push({ method: req.method, path, body: j });
    if (req.method === 'GET' && path === '/ncc/campaigns') return send(200, [{ nccCampaignId: 'cmp-1', name: '하이링크 파워링크' }, { nccCampaignId: 'cmp-2', name: '공용' }]);
    if (req.method === 'GET' && path === '/stats') return send(200, { data: [] });
    if (req.method === 'PUT' && path.startsWith('/ncc/campaigns/')) return send(200, { ...j });
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
  for (const n of ['하이링크', '워크인', '바디랩', '다짐']) P[n] = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: n })).id;
  P.acc = (await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '본점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' })).id;
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 5000000 });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); naver?.close(); await sql?.end(); });

test('③ 브랜드 비중 기본값(하이링크 40·워크인 35·바디랩 15·다짐 10, 바디랩 지역 메모) → 우선순위·비중·메모 직접 → 총액: 대표 입력 > 목표 광고비 > 지난달 ×1.5 → 월 목표 광고비 연동', async () => {
  const v = await ctx.owner.ok('GET', `/api/marketing/ops?month=${month}`);
  assert.deepEqual(v.brands.map((b) => [b.name, b.share]), [['하이링크', 40], ['워크인', 35], ['바디랩', 15], ['다짐', 10]], JSON.stringify(v.brands));
  assert.ok(v.brands.find((b) => b.name === '바디랩').note.includes('천안'), '바디랩 지역 한정 메모 기본값');
  assert.deepEqual([v.ownerTotal, v.totalDefault.source, v.totalDefault.total], [null, 'min', 300000], '총액 출처: 아무것도 없으면 최소 30만');
  // 브랜드 설정: 다짐 우선순위 1 · 비중 20 · 메모
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P['다짐']}`, { adPriority: 1, adShare: 20, adNote: '본점 중심' });
  const v2 = await ctx.owner.ok('GET', `/api/marketing/ops?month=${month}`);
  assert.deepEqual(v2.brands[0], { brandId: P['다짐'], name: '다짐', share: 20, priority: 1, note: '본점 중심' }, JSON.stringify(v2.brands[0]));
  assert.equal(Math.round(v2.brands.reduce((a, b) => a + b.share, 0)), 100, '비중 합 100');
  assert.deepEqual(v2.brands.slice(1).map((b) => [b.name, b.share]), [['하이링크', 35.6], ['워크인', 31.1], ['바디랩', 13.3]], '직접 적은 20 은 그대로, 나머지 80 을 기본 가중치(40·35·15)대로');
  assert.ok((await ctx.owner.ok('GET', '/api/marketing/auto')).brands.find((b) => b.name === '다짐').ad_share === 20, '자동화 화면 브랜드 줄에 광고 비중');
  // 지난달 지출 ×1.5
  const prev = new Date(`${month}-01T12:00:00+09:00`); prev.setUTCMonth(prev.getUTCMonth() - 1); const pm = prev.toISOString().slice(0, 7);
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw, conversions) values (${P.acc}, ${`${pm}-10`}, 'cmp-1', '하이링크 파워링크', 4000, 120, 200000, 3)`;
  assert.deepEqual((await ctx.owner.ok('GET', `/api/marketing/ops?month=${month}`)).totalDefault, { total: 300000, source: 'last' }, '지난달 20만 ×1.5');
  // 월 목표 광고비 → 총액
  await ctl({ anthropicReset: true });
  P.goal = (await ctx.owner.ok('POST', '/api/marketing/goals', { month })).id;
  const g = (await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`)).goals[0];
  await ctx.owner.ok('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'update', goals: { ...g.goals, targets: { ...g.goals.targets, adBudget: 800000 } }, weekly: g.weekly });
  assert.deepEqual((await ctx.owner.ok('GET', `/api/marketing/ops?month=${month}`)).totalDefault, { total: 800000, source: 'goal' });
  // 대표 입력 총액 → 최우선 + 목표 광고비 같이 바뀜
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/ops/budget/total', { monthly: 1000000, month })).status, 403);
  await ctx.owner.ok('PUT', '/api/marketing/ops/budget/total', { monthly: 1000000, month });
  const v3 = await ctx.owner.ok('GET', `/api/marketing/ops?month=${month}`);
  assert.deepEqual([v3.ownerTotal, v3.totalDefault], [1000000, { total: 1000000, source: 'owner' }]);
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`)).goals[0].goals.targets.adBudget, 1000000, '월 운영 목표 광고비 연동');
});

test('③ 예산 초안: 브랜드 축(AI brands 반영·비중 재계산) → 승인·집행: 브랜드 세팅안(brand_id)에 브랜드 네이버 몫, 세팅안 없는 브랜드는 "세팅안 필요", 브랜드 없는 세팅안은 남은 몫', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say(PLAN({ brands: [{ brandId: P['하이링크'], monthly: 400000, note: '파워링크 중심' }, { brandId: P['바디랩'], monthly: 150000, note: '지역 한정(천안 두정·성정)' }] }))] });
  const d = await ctx.owner.ok('POST', '/api/marketing/ops/budget', { month });
  assert.deepEqual([d.source, d.total, d.totalSource, d.version], ['ai', 1000000, 'owner', 1]);
  const sent = JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {});
  assert.ok(sent.includes('브랜드 비중') && sent.includes('천안') && sent.includes('우선순위 1'), 'AI 재료에 브랜드 비중·메모·우선순위');
  const hl = d.brandPlan.find((b) => b.name === '하이링크'); const bl = d.brandPlan.find((b) => b.name === '바디랩');
  assert.deepEqual([hl.monthly, hl.note, bl.monthly, bl.needsPlan, d.brandPlan[0].name], [400000, '파워링크 중심', 150000, true, '다짐'], JSON.stringify(d.brandPlan));
  assert.ok(Math.abs(d.brandPlan.reduce((a, b) => a + b.share, 0) - 100) < 1, '비중 재계산 합 100');
  P.budget = d.id;
  // 고치기: 브랜드 월 예산 직접
  await ctx.owner.ok('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'update', brands: [{ brandId: P['워크인'], monthly: 250000 }] });
  const bv = (await ctx.owner.ok('GET', `/api/marketing/ops?month=${month}`)).budget;
  assert.equal(bv.brand_plan.find((b) => b.name === '워크인').monthly, 250000);
  // 세팅안: 하이링크 브랜드 1건(cmp-1) + 브랜드 없음 1건(cmp-2)
  const plan = await ctx.owner.ok('POST', '/api/marketing/ad-ops/plans', { accountId: P.acc, brandId: P['하이링크'], name: '하이링크 파워링크', dailyBudget: 5000, channelId: 'ch-1', bidAmt: 300, keywords: ['아파트 커뮤니티'], ads: [{ headline: '하이링크', description: '커뮤니티 운영', url: 'https://example.com' }] });
  await sql`update mkt_ad_plans set status = 'active', external = ${sql.json({ campaignId: 'cmp-1', adgroupId: 'ag-1' })} where id = ${plan.id}`;
  const [plain] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, name, plan, status, external, created_by) values ('default', ${P.acc}, 'naver', '공용', ${sql.json({ dailyBudget: 3000, bidAmt: 300, channelId: 'ch-1', keywords: ['공용'], ads: [] })}, 'active', ${sql.json({ campaignId: 'cmp-2', adgroupId: 'ag-2' })}, ${ctx.ownerId}) returning id`;
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/ad-ops')).plans.find((p) => p.id === plan.id).brand, '하이링크', '세팅안 목록에 브랜드');
  calls = [];
  const ap = await ctx.owner.ok('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'approve' });
  assert.equal(ap.status, 'approved');
  const days = Number(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate());
  const hlx = ap.executed.find((e) => e.brand === '하이링크' && e.planId === plan.id);
  assert.ok(hlx?.ok, JSON.stringify(ap.executed));
  assert.equal(hlx.dailyBudget, Math.round(400000 * 0.6 / days / 10) * 10, '하이링크 월 40만 × 네이버 비중 60% ÷ 일수');
  const need = ap.executed.filter((e) => e.needsPlan).map((e) => e.brand).sort();
  assert.deepEqual(need, ['다짐', '바디랩', '워크인'], '세팅안 없는 브랜드는 세팅안 필요');
  assert.ok(ap.executed.find((e) => e.needsPlan && e.brand === '바디랩').note.includes('세팅안 필요'));
  const px = ap.executed.find((e) => e.planId === plain.id);
  assert.ok(px?.ok && px.brand === null && px.dailyBudget === Math.round((600000 - 400000 * 0.6) / days / 10) * 10, `브랜드 없는 세팅안은 남은 네이버 몫(60만 − 하이링크 몫 24만) ÷ 일수 ${JSON.stringify(px)}`);
  assert.equal(calls.filter((c) => c.method === 'PUT' && c.path.startsWith('/ncc/campaigns/')).length, 2, '네이버 캠페인 2건 PUT');
});

test('② 반려 사유 → AI 고친 안 v2 재요청(revised_from·thread·반영 요약·알림 1회) → v3 → 3회째는 반려로 끝 / 예산·월 목표도 v2 / AI 없으면 반려', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ cards: [{ kind: 'collab', title: '인근 필라테스 공동 이벤트', summary: '같은 고객층과 상호 소개.', items: [{ title: '공동 할인', detail: '서로 10%', expected: '신규 10명', cost: '없음' }], rationale: '지역 상권' }] })] });
  await ctx.owner.ok('POST', '/api/marketing/ops', { kinds: ['collab'] });
  const v1 = (await ctx.owner.ok('GET', '/api/marketing/ops')).proposals.find((p) => p.kind === 'collab' && p.status === 'pending');
  // 반려 → AI 고친 안
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '인근 필라테스 공동 이벤트(비용 0·기간 2주)', summary: '비용 없이 2주만 시험.', items: [{ title: '상호 소개 게시물 1건', detail: '서로 스토리 1회', expected: '신규 5명', cost: '없음' }], rationale: '비용 부담 지적 반영', changes: '반려 사유(비용 부담) → 유료 할인 대신 상호 소개 게시물만, 기간 2주로 한정' })] });
  const r = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${v1.id}`, { action: 'reject', note: '비용 부담 — 할인은 빼고' });
  assert.equal(r.status, 'rejected'); assert.equal(r.revised.version, 2, JSON.stringify(r));
  assert.ok(JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {}).includes('비용 부담'), 'AI 에 반려 사유 전달');
  const all = (await ctx.owner.ok('GET', '/api/marketing/ops')).proposals;
  const v2 = all.find((p) => p.id === r.revised.id);
  assert.deepEqual([v2.status, v2.version, v2.revised_from, v2.thread_id, v2.title.includes('기간 2주')], ['pending', 2, v1.id, v1.id, true]);
  assert.ok(v2.revision_note.startsWith('반려 사유'), v2.revision_note);
  assert.equal(all.find((p) => p.id === v1.id).status, 'rejected');
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and entity_id = ${v2.id} and type = 'review_requested'`)[0].n, 1, '승인자 알림 1회');
  // v2 반려 → v3, v3 반려 → 끝(재요청 없음)
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: 'v3', summary: 's', items: [{ title: 'a', detail: 'b', expected: 'c', cost: '없음' }], rationale: 'r', changes: '반려 사유 → 반영' })] });
  const r2 = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${v2.id}`, { action: 'reject', note: '더 줄여' });
  assert.equal(r2.revised.version, 3);
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: 'v4', summary: 's', items: [], rationale: 'r', changes: 'x' })] });
  const r3 = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${r2.revised.id}`, { action: 'reject', note: '그만' });
  assert.equal(r3.revised, null, '3회째는 재요청 없음');
  assert.equal((await sql`select count(*)::int n from mkt_proposals where thread_id = ${v1.id}`)[0].n, 2, '같은 줄기 v2·v3 (v1 은 뿌리)');
  // 예산: 승인된 계획을 새 초안 → 반려 → v2(반영 요약·반려 사유·같은 줄 덮어씀)
  await ctl({ anthropicReset: true, anthropicQueue: [say(PLAN())] });
  const d = await ctx.owner.ok('POST', '/api/marketing/ops/budget', { month });
  assert.equal(d.version, 1);
  await ctl({ anthropicReset: true, anthropicQueue: [say(PLAN({ plan: [{ provider: 'naver', monthly: 500000, note: '' }, { provider: 'meta', monthly: 400000, note: '메타 늘림' }, { provider: 'google', monthly: 100000, note: '' }, { provider: 'youtube', monthly: 0, note: '' }], changes: '반려 사유(메타 비중 낮음) → 메타 30만 → 40만, 네이버 60만 → 50만' }))] });
  const br = await ctx.owner.ok('PATCH', `/api/marketing/ops/budget/${d.id}`, { action: 'reject', note: '메타 비중이 낮다' });
  assert.deepEqual([br.status, br.version], ['revised', 2], JSON.stringify(br));
  assert.ok(JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {}).includes('[반려 사유] 메타 비중이 낮다'), 'AI 에 이전 계획 + 반려 사유');
  const b2 = (await ctx.owner.ok('GET', `/api/marketing/ops?month=${month}`)).budget;
  assert.deepEqual([b2.id, b2.status, b2.version, b2.reject_note, b2.plan.find((p) => p.provider === 'meta').monthly], [d.id, 'pending', 2, '메타 비중이 낮다', 400000]);
  assert.ok(b2.revision_note.includes('메타'), b2.revision_note);
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and dedupe_key = ${`mktbudget:default:${month}:v2`}`)[0].n, 1, '승인자 알림 1회');
  // AI 없으면 반려로 끝
  await ctl({ anthropicReset: true });
  assert.deepEqual((await ctx.owner.ok('PATCH', `/api/marketing/ops/budget/${d.id}`, { action: 'reject', note: '다음에' })).status, 'rejected');
  // 월 목표: 반려 → v2(반영 요약) / 3회째 반려
  const GOAL = (changes) => ({ objectives: ['문의 10건', '게시 12건', '리뷰 5건'], message: '가까운 곳에서 시작', targets: { posts: 12, inquiries: 10, adBudget: 1000000 }, weeks: [{ topic: '가을 이벤트', channels: ['instagram'], kinds: ['feed'], note: '' }, { topic: 'PT 후기', channels: ['instagram'], kinds: ['reels'], note: '' }, { topic: '시설', channels: ['blog'], kinds: ['blog'], note: '' }, { topic: '월말 리뷰', channels: ['instagram'], kinds: ['story'], note: '' }, { topic: '예비', channels: [], kinds: [], note: '' }], changes });
  await ctl({ anthropicReset: true, anthropicQueue: [say(GOAL('반려 사유(문의 목표 낮음) → 문의 6 → 10'))] });
  const gr = await ctx.owner.ok('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'reject', note: '문의 목표가 낮다' });
  assert.deepEqual([gr.status, gr.version], ['revised', 2], JSON.stringify(gr));
  const g2 = (await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`)).goals.find((g) => g.id === P.goal);
  assert.deepEqual([g2.status, g2.version, g2.reject_note, g2.goals.targets.inquiries], ['pending', 2, '문의 목표가 낮다', 10]);
  assert.ok(g2.revision_note.includes('문의'), g2.revision_note);
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and entity_id = ${P.goal} and title like '%v2%'`)[0].n, 1, '목표 v2 알림 1회');
  await ctl({ anthropicReset: true });
  assert.equal((await ctx.owner.ok('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'reject', note: '그만' })).status, 'rejected');
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`)).goals.find((g) => g.id === P.goal).status, 'rejected');
});

test('① 승인함 통합: 건수(콘텐츠·제안·예산·목표·제작 의뢰) + 목록 + 사이드바 배지에 운영 건수 포함 · 직원도 보기(승인은 관리자)', async () => {
  // 제안 1(새 카드) · 예산 0(반려됨) · 목표 0(반려됨) · 제작 의뢰: 프롬프트 준비 1
  await ctl({ anthropicReset: true, anthropicQueue: [say({ cards: [{ kind: 'direction', title: '다음 4주 게시 방향', summary: 's', items: [{ title: 'a', detail: 'b', expected: 'c', cost: '없음' }], rationale: 'r' }] })] });
  await ctx.owner.ok('POST', '/api/marketing/ops', { kinds: ['direction'] });
  await ctl({ anthropicReset: true, anthropicQueue: [say({ promptEn: 'A bright community gym at golden hour, 4:5', negativeEn: '', summaryKo: '아침 헬스장', caption: '가을 시작', refMediaIds: [], aspect: '4:5', model: 'gpt_image' })] });
  const brief = await ctx.staffA.client.ok('POST', '/api/marketing/studio', { brandId: P['다짐'], kind: 'feed', purpose: 'inquiry', message: '가을 신규 PT 할인', refs: { mediaIds: [], contentIds: [], links: [] }, quantity: 1 });
  await ctx.owner.ok('POST', '/api/marketing/contents', { title: '승인함 콘텐츠', channel: 'instagram', scheduledAt: new Date(Date.now() + 2 * 864e5).toISOString(), body: '본문' });
  const ib = await ctx.owner.ok('GET', '/api/marketing/inbox');
  assert.deepEqual(ib.counts, { contents: 1, proposals: 1, budget: 0, goals: 0, briefs: 1 }, JSON.stringify(ib.counts));
  assert.equal(ib.total, 3);
  assert.ok(ib.proposals[0].kind === 'direction' && ib.briefs[0].id === brief.id && ib.briefs[0].status === 'ready' && ib.briefs[0].brand === '다짐', JSON.stringify([ib.proposals[0].version, ib.briefs[0]]));
  assert.equal(ib.canEdit, true); assert.equal((await ctx.staffA.client.ok('GET', '/api/marketing/inbox')).canEdit, false);
  const sp = await ctx.owner.ok('GET', '/api/spaces');
  assert.equal(sp.summary.marketing.badge, 3, JSON.stringify(sp.summary.marketing));
  assert.ok(sp.summary.marketing.text.includes('운영 2'), sp.summary.marketing.text);
  // 제안 승인·의뢰 취소 → 건수 줄어듦
  await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${ib.proposals[0].id}`, { action: 'approve' });
  await ctx.owner.ok('PATCH', `/api/marketing/studio/${brief.id}`, { action: 'cancel' });
  const ib2 = await ctx.owner.ok('GET', '/api/marketing/inbox');
  assert.deepEqual([ib2.counts.proposals, ib2.counts.briefs, ib2.total], [0, 0, 1]);
});
