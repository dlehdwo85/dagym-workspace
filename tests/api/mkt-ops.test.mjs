// 대표 10/20 20:00: ① 운영실 AI 마케터 승인 요청 카드(제안/분석/계획 → 승인 → 실행: 계획·방향은 제작의뢰, 분석·협업은 업무) ② 채널별 월 광고 예산 계획 → 승인 → 네이버 집행 · 소진율 '충전 필요' 알림 ③ 월 매출 목표 vs 실적(계약 + 워크인 결제) · CAC·ROI 월간 보고
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb, seoulToday, tick } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

const PORT = 3226;
let srv, ctx, sql, fake, naver, calls = [];
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const today = seoulToday(); const month = today.slice(0, 7);
const P = {};
before(async () => {
  // 가짜 네이버(서명 검사 + 캠페인 예산 PUT 만) — 구조 시험이며 실제 연동 완료가 아님
  naver = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x'); let body = ''; for await (const c of req) body += c;
    const path = u.pathname.slice('/naver'.length); res.setHeader('content-type', 'application/json');
    const send = (code, j) => { res.statusCode = code; res.end(JSON.stringify(j)); };
    const sig = createHmac('sha256', 'naver-secret-key-xyz').update(`${req.headers['x-timestamp']}.${req.method}.${path}`).digest('base64');
    if (req.headers['x-signature'] !== sig || req.headers['x-customer'] !== '1234567') return send(403, { title: 'Forbidden', code: 1018 });
    const j = body ? JSON.parse(body) : null; calls.push({ method: req.method, path, body: j });
    if (req.method === 'GET' && path === '/ncc/campaigns') return send(200, [{ nccCampaignId: 'cmp-1', name: '가을 회원 모집' }]);
    if (req.method === 'GET' && path === '/stats') return send(200, { data: [] });
    if (req.method === 'PUT' && path.startsWith('/ncc/campaigns/')) return send(200, { ...j });
    send(404, { title: 'nope' });
  }).listen(PORT);
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({ ADS_TEST_BASE: `http://localhost:${PORT}` }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '아파트 커뮤니티 운영', products: 'PT·GX', weeklyTopic: '가을 이벤트' });
  P.acc = (await ctx.owner.ok('POST', '/api/marketing/ads/accounts', { label: '본점', customerId: '1234567', apiKey: 'naver-license-abc', secretKey: 'naver-secret-key-xyz' })).id;
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw, conversions) values (${P.acc}, ${today}, 'cmp-1', '가을 회원 모집', 4000, 120, 90000, 3)`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); naver?.close(); await sql?.end(); });

test('① AI 마케터 제안 → 카드(대기) → 홈 큐 줄 → 반려(사유 필수) / 승인 → 실행(분석 = 업무, 계획 = 제작의뢰) → 실행 완료 · 직원 403', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ cards: [
    { kind: 'analysis', title: '네이버 파워링크 CPC 750원 — 문의당 3만원', summary: '지난 30일 광고비 9만원으로 클릭 120, 전환 3. 소재 비교로 CTR 을 올리면 문의당 비용이 내려갑니다.', items: [{ title: '소재 2개 비교', detail: '가을 회원 모집에 소재 B 추가', expected: 'CTR +20%', cost: '제작 크레딧' }], rationale: 'CTR 3%·CPC 750원' },
    { kind: 'plan', title: '다음 4주 계획', summary: '1~2주 인스타 피드 안정화, 3주 소재 비교, 4주 리뷰.', items: [{ title: '1주 인스타 피드 2건', detail: '현장 사진', expected: '팔로워', cost: '없음' }, { title: '2주 릴스 1건', detail: '15초', expected: '도달', cost: '크레딧' }], rationale: '이달 목표 게시 수' },
  ] })] });
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ops', { kinds: ['analysis'] })).status, 403, '제안 받기는 관리자');
  const r = await ctx.owner.ok('POST', '/api/marketing/ops', { kinds: ['analysis', 'plan'] });
  assert.equal(r.created, 2);
  const v = await ctx.owner.ok('GET', '/api/marketing/ops');
  assert.equal(v.proposals.length, 2); assert.ok(v.proposals.every((p) => p.status === 'pending' && p.source === 'ai'));
  P.analysis = v.proposals.find((p) => p.kind === 'analysis'); P.plan = v.proposals.find((p) => p.kind === 'plan');
  assert.ok(P.analysis.title.includes('CPC') && P.analysis.body.items.length === 1 && P.analysis.body.numbers.posts === 0, JSON.stringify(P.analysis.body));
  assert.ok(JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {}).includes('90,000원'), 'AI 재료에 매체별 30일 광고비');
  const h = await ctx.owner.ok('GET', '/api/marketing/home');
  assert.ok(h.queue.some((q) => q.kind === 'ops' && q.note === '대표 승인 필요'), '홈 큐에 운영실 카드');
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and type = 'review_requested' and link = '/s/marketing/ops'`).length >= 1, '승인자 알림');
  // 같은 종류 대기 중이면 다시 안 만듦
  assert.equal((await ctx.owner.ok('POST', '/api/marketing/ops', { kinds: ['analysis'] })).created, 0);
  // 직원은 보기만
  assert.equal((await ctx.staffA.client.ok('GET', '/api/marketing/ops')).canEdit, false);
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/ops/proposals/${P.analysis.id}`, { action: 'approve' })).status, 403);
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/ops/proposals/${P.analysis.id}`, { action: 'reject' })).status, 400, '반려는 사유 필수');
  // 승인: 분석 → 업무(마케팅 공간), 계획 → 제작의뢰 2건(queued)
  const a = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${P.analysis.id}`, { action: 'approve', note: '소재 B 진행' });
  assert.equal(a.status, 'approved'); assert.equal(a.executed.tasks.length, 1, JSON.stringify(a.executed));
  const [t] = await sql`select title, space, assignee_id from tasks where id = ${a.executed.tasks[0]}`;
  assert.ok(t.title.startsWith('[마케팅] ') && t.space === 'marketing' && t.assignee_id === ctx.ownerId);
  const b = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${P.plan.id}`, { action: 'approve' });
  assert.equal(b.executed.briefs.length, 2);
  const briefs = await sql`select status, message, refs from mkt_briefs where id = any(${b.executed.briefs})`;
  assert.ok(briefs.every((x) => x.status === 'queued' && x.refs.proposalId === P.plan.id) && briefs.some((x) => x.message.includes('인스타 피드')));
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/ops/proposals/${P.plan.id}`, { action: 'approve' })).status, 400, '승인된 카드 다시 승인 안 됨');
  await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${P.analysis.id}`, { action: 'done' });
  const v2 = await ctx.owner.ok('GET', '/api/marketing/ops');
  assert.deepEqual(v2.proposals.map((p) => p.status).sort(), ['approved', 'done']);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'mkt.proposal_approve'`)[0].n, 2);
  // AI 없으면(큐 비면 짧은 글) 기본 카드 — 종류별 1장
  await ctl({ anthropicReset: true });
  const r2 = await ctx.owner.ok('POST', '/api/marketing/ops', { kinds: ['direction', 'collab'] });
  assert.equal(r2.created, 2);
  const v3 = await ctx.owner.ok('GET', '/api/marketing/ops');
  assert.deepEqual(v3.proposals.filter((p) => p.status === 'pending').map((p) => [p.kind, p.source]).sort(), [['collab', 'template'], ['direction', 'template']]);
  const rej = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${v3.proposals.find((p) => p.kind === 'collab').id}`, { action: 'reject', note: '지금은 안 함' });
  assert.equal(rej.status, 'rejected');
  // 다른 회사 카드 404
  assert.equal((await ctx.owner.req('PATCH', '/api/marketing/ops/proposals/00000000-0000-0000-0000-000000000001', { action: 'approve' })).status, 404);
});

test('② 광고 예산 계획: AI 초안(채널 4·연결 표시·하루 예산) → 고치기 → 승인·집행(네이버 세팅안 하루 예산, 다른 매체 안내) → 소진율 80% 알림 한 번 → 반려', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ plan: [{ provider: 'naver', monthly: 300000, note: 'CPC 좋음' }, { provider: 'meta', monthly: 100000, note: '시작 제안' }, { provider: 'google', monthly: 0, note: '' }, { provider: 'youtube', monthly: 0, note: '' }], rationale: '네이버 CPC 750원·전환 3 → 네이버 집중' })] });
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ops/budget', { month })).status, 403);
  const d = await ctx.owner.ok('POST', '/api/marketing/ops/budget', { month, total: 400000 });
  assert.equal(d.source, 'ai'); assert.equal(d.total, 400000);
  const nv = d.plan.find((p) => p.provider === 'naver');
  assert.deepEqual([nv.monthly, nv.connected, nv.note, d.plan.find((p) => p.provider === 'meta').connected], [300000, true, 'CPC 좋음', false]);
  assert.ok(nv.daily > 0 && nv.daily <= 300000 / 28, '하루 예산 = 월 ÷ 일수');
  P.budget = d.id;
  const v = await ctx.owner.ok('GET', `/api/marketing/ops?month=${month}`);
  assert.equal(v.budget.status, 'pending'); assert.equal(v.budget.plan.find((p) => p.provider === 'naver').used, 90000); assert.equal(v.budget.plan.find((p) => p.provider === 'naver').rate, 30);
  assert.ok(v.budget.plan.every((p) => p.charge), '채널마다 충전 링크');
  assert.ok((await ctx.owner.ok('GET', '/api/marketing/home')).queue.some((q) => q.kind === 'ops' && q.title.includes('광고 예산 계획')), '홈 큐');
  // 고치기(네이버 200,000) → 상태 대기 유지, source user
  await ctx.owner.ok('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'update', plan: [{ provider: 'naver', monthly: 200000 }] });
  const v2 = (await ctx.owner.ok('GET', `/api/marketing/ops?month=${month}`)).budget;
  assert.deepEqual([v2.status, v2.source, v2.total, v2.plan.find((p) => p.provider === 'naver').rate], ['pending', 'user', 300000, 45]);
  // 로컬 23:00 🟡: 0원 계획은 승인·집행 불가(캠페인 예산 0 위험) + AI 숫자 '14,000원' 도 읽음·작은 총액은 1천 원 단위
  await ctx.owner.ok('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'update', plan: [{ provider: 'naver', monthly: 0 }, { provider: 'meta', monthly: 0 }, { provider: 'google', monthly: 0 }, { provider: 'youtube', monthly: 0 }] });
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'approve' })).status, 400, '0원 승인 불가');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ plan: [{ provider: 'naver', monthly: '14,000원', note: '' }, { provider: 'google', monthly: 3000, note: '' }, { provider: 'meta', monthly: 3000, note: '' }, { provider: 'youtube', monthly: 0, note: '' }], rationale: '총액 20,000원 안에서 네이버 비중 크게' })] });
  const small = await ctx.owner.ok('POST', '/api/marketing/ops/budget', { month, total: 20000 });
  assert.deepEqual(small.plan.map((p) => [p.provider, p.monthly]), [['naver', 14000], ['google', 3000], ['youtube', 0], ['meta', 3000]], JSON.stringify(small.plan));
  // 로컬 23:20: '1만원 단위' 숫자(1 = 1만원)·'약 1만원' 글자·숫자 0 + 비고 '약 2천원' 도 원 단위로 복구
  await ctl({ anthropicReset: true, anthropicQueue: [say({ plan: [{ provider: 'naver', monthly: 1, note: '1만원 단위 기준 약 1만원' }, { provider: 'google', monthly: 0.5, note: '' }, { provider: 'meta', monthly: 0, note: '' }, { provider: 'youtube', monthly: 0, note: '' }], rationale: '만원 단위' })] });
  const man = await ctx.owner.ok('POST', '/api/marketing/ops/budget', { month, total: 20000 });
  assert.deepEqual(man.plan.map((p) => [p.provider, p.monthly]), [['naver', 10000], ['google', 5000], ['youtube', 0], ['meta', 0]], JSON.stringify(man.plan));
  await ctl({ anthropicReset: true, anthropicQueue: [say({ plan: [{ provider: 'naver', monthly: '약 1.5만원', note: '' }, { provider: 'google', monthly: 0, note: '시작은 약 2천원 정도' }, { provider: 'meta', monthly: 0, note: '연결 없음' }, { provider: 'youtube', monthly: 0, note: '' }], rationale: '글자' })] });
  const txt = await ctx.owner.ok('POST', '/api/marketing/ops/budget', { month, total: 20000 });
  assert.deepEqual(txt.plan.map((p) => [p.provider, p.monthly]), [['naver', 15000], ['google', 2000], ['youtube', 0], ['meta', 0]], JSON.stringify(txt.plan));
  await ctx.owner.ok('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'update', plan: [{ provider: 'naver', monthly: 200000 }, { provider: 'meta', monthly: 100000 }, { provider: 'google', monthly: 0 }, { provider: 'youtube', monthly: 0 }] });
  // 네이버 세팅안(활성) 하나 → 승인 시 하루 예산 집행(가짜 네이버: actPlan budget)
  const [plan] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, name, plan, status, external, created_by) values ('default', ${P.acc}, 'naver', '가을 회원 모집', ${sql.json({ dailyBudget: 5000 })}, 'active', ${sql.json({ campaignId: 'cmp-1', adgroupId: 'ag-1' })}, ${ctx.ownerId}) returning id`;
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 1000000 }); // 돈이 늘면 상한 검사 — 상한 없으면 집행이 막힘
  calls = [];
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'approve' })).status, 403);
  const ap = await ctx.owner.ok('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'approve' });
  assert.equal(ap.status, 'approved');
  const nvx = ap.executed.find((e) => e.provider === 'naver' && e.planId); // 대표 02:30 ③: 세팅안 없는 브랜드('다짐')는 '세팅안 필요' 줄이 앞에 붙음
  assert.ok(nvx && nvx.planId === plan.id && nvx.dailyBudget > 0, JSON.stringify(ap.executed));
  assert.ok(ap.executed.find((e) => e.provider === 'meta')?.note?.includes('직접 설정'), '연결 없는 매체는 안내');
  assert.equal(nvx.ok, true, JSON.stringify(nvx));
  const [pl] = await sql`select plan from mkt_ad_plans where id = ${plan.id}`;
  assert.equal(Number(pl.plan.dailyBudget), nvx.dailyBudget, '세팅안 하루 예산 반영');
  assert.ok(calls.some((c) => c.method === 'PUT' && c.path === '/ncc/campaigns/cmp-1' && c.body.dailyBudget === nvx.dailyBudget), '네이버 캠페인 예산 PUT');
  assert.equal((await sql`select count(*)::int n from mkt_ad_changes where plan_id = ${plan.id} and kind = 'budget'`)[0].n, 1, '변경 기록');
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'mkt.budget_approve'`)[0].n, 1);
  // 소진율: 네이버 200,000 중 90,000 (45%) → 아직 알림 없음 → 지출 추가(총 170,000 = 85%) → '충전 필요' 1번, 두 번 돌려도 1번
  const run = tick;
  await run();
  assert.equal((await sql`select count(*)::int n from notifications where dedupe_key like 'mktcharge:%'`)[0].n, 0, '45% 는 알림 없음');
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${P.acc}, ${today}, 'cmp-2', '추가', 100, 10, 80000)`;
  await run(); await run();
  const al = await sql`select title, body from notifications where dedupe_key like 'mktcharge:%'`;
  assert.equal(al.length, 1, JSON.stringify(al));
  assert.ok(al[0].title.includes('충전 필요') && al[0].title.includes('85%') && al[0].body.includes('searchad.naver.com'), al[0].title + al[0].body);
  // 승인된 계획 다시 승인 400, 반려는 새 초안에서
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'approve' })).status, 400);
  await ctl({ anthropicReset: true });
  const d2 = await ctx.owner.ok('POST', '/api/marketing/ops/budget', { month });
  assert.equal(d2.source, 'template'); assert.equal(d2.id, P.budget, '같은 달은 한 줄(덮어씀)');
  assert.equal((await ctx.owner.ok('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'reject', note: '다음 달에' })).status, 'rejected');
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/ops/budget/${P.budget}`, { action: 'approve' })).status, 400);
});

test('③ 월 매출 목표(관리자) vs 실적(영업 계약 등록 + 플랫폼 회사 워크인 결제) → 마케팅·영업 홈 공용 API → 월간 보고 CAC·ROI', async () => {
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const lead = await ctx.owner.ok('POST', '/api/sales/leads', { name: 'E2E 매출 거래처' });
  await ctx.owner.ok('POST', `/api/sales/leads/${lead.id}/records`, { kind: 'contracts', title: '커뮤니티 운영 계약', amount: 5000000, date: today });
  await ctx.owner.ok('POST', `/api/sales/leads/${lead.id}/records`, { kind: 'proposals', title: '제안', amount: 99000000 });
  let r = await ctx.owner.ok('GET', `/api/marketing/ops/revenue?month=${month}`);
  assert.deepEqual([r.target, r.actual, r.contracts.n, r.workin?.n ?? 0], [null, 5000000, 1, 0], JSON.stringify(r));
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/ops/revenue', { month, target: 10000000 })).status, 403, '목표는 대표·관리자');
  r = await ctx.owner.ok('PUT', '/api/marketing/ops/revenue', { month, target: 10000000 });
  assert.deepEqual([r.target, r.rate], [10000000, 50]);
  // 플랫폼 운영자(워크인 회사)는 워크인 결제도 합산
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await sql`insert into payments (tenant, kind, plan_code, moid, amount, status, paid_at) values ('default', 'subscription', 'pro', 'E2E-PAY-1', 55000, 'paid', now())`;
  r = await ctx.owner.ok('GET', `/api/marketing/ops/revenue?month=${month}`);
  assert.deepEqual([r.actual, r.workin.n, r.rate], [5055000, 1, 51]);
  // 영업 공간만 있는 사람도 읽기 가능(영업 홈 막대), 공간 없는 사람 404
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['sales'] });
  assert.equal((await ctx.staffB.client.ok('GET', `/api/marketing/ops/revenue?month=${month}`)).actual, 5000000);
  assert.equal((await ctx.managerA.client.req('GET', `/api/marketing/ops/revenue?month=${month}`)).status, 404);
  // 월간 보고 CAC·ROI: 광고비 170,000 ÷ 새 리드 1 = 170,000 · ROI = (5,000,000 − 170,000) ÷ 170,000
  const rep = await ctx.owner.ok('GET', `/api/marketing/report?month=${month}`);
  assert.ok(rep.roi, 'roi 없음'); assert.deepEqual([rep.roi.newLeads, rep.roi.cac, rep.roi.roi, rep.roi.revenue.target], [1, 170000, 2841.2, 10000000]);
});
