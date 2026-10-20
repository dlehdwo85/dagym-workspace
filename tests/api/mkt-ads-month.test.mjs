// 대표 10/21 06:30 ①: 광고 성과 월별 보기(월 선택·전월 대비·매체/캠페인/브랜드 월 집계) + AI 마케터 월 분석(좋았던 점·나빴던 점·다음 달 제안 3개) → 승인 요청 카드
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const today = seoulToday(); const month = today.slice(0, 7);
const shift = (m, k) => { const [y, mo] = m.split('-').map(Number); return new Date(Date.UTC(y, mo - 1 + k, 1)).toISOString().slice(0, 7); };
const prevM = shift(month, -1);
const P = {};
before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer({}); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
  for (const n of ['하이링크', '바디랩']) P[n] = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: n })).id;
  const t = 'default';
  const acc = async (provider, external_id, label, brand) => (await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, brand_id, created_by) values (${t}, ${provider}, ${external_id}, ${label}, ${brand}, ${ctx.ownerId}) returning id`)[0].id;
  P.naver = await acc('naver', '1234567', '하이링크 검색', P['하이링크']); P.meta = await acc('meta', '998877', '바디랩 메타', P['바디랩']);
  const row = (account, day, cid, name, imp, clk, cost, conv) => sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw, conversions) values (${account}, ${day}::date, ${cid}, ${name}, ${imp}, ${clk}, ${cost}, ${conv})`;
  // 이달: 네이버 2일 + 메타 1일 / 전월: 네이버 1일(비용 더 큼·전환 적음)
  await row(P.naver, `${month}-01`, 'n1', '파워링크 본점', 1000, 50, 25000, 2);
  await row(P.naver, `${month}-02`, 'n1', '파워링크 본점', 800, 40, 20000, 1);
  await row(P.meta, `${month}-02`, 'm1', '가을 리드', 2000, 40, 30000, 3);
  await row(P.naver, `${prevM}-15`, 'n1', '파워링크 본점', 3000, 100, 90000, 1);
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('월별 보기: 합계·전월·매체별·브랜드별·캠페인·월 목록 / days 모드 유지 / 권한', async () => {
  const v = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`);
  assert.equal(v.month, month); assert.equal(v.prevMonth, prevM); assert.equal(v.days, null);
  assert.equal(v.totals.cost, 75000); assert.equal(v.totals.conversions, 6); assert.equal(v.totals.clicks, 130);
  assert.equal(v.prev.cost, 90000); assert.equal(v.prev.conversions, 1);
  assert.deepEqual(v.byProvider.map((r) => [r.provider, r.cost]), [['naver', 45000], ['meta', 30000]]);
  assert.deepEqual(v.byBrand.map((r) => [r.brand, r.cost]), [['하이링크', 45000], ['바디랩', 30000]]);
  assert.equal(v.campaigns.length, 2); assert.equal(v.campaigns[0].campaign_name, '파워링크 본점'); assert.equal(v.campaigns[0].brand, '하이링크');
  assert.equal(v.daily.length, 2, '이달 날짜별(1·2일)');
  assert.ok(v.months.includes(month) && v.months.includes(prevM) && v.months.length >= 6, JSON.stringify(v.months));
  assert.equal(v.analysis, null, '아직 분석 없음');
  const pv = await ctx.owner.ok('GET', `/api/marketing/ads?month=${prevM}`);
  assert.equal(pv.totals.cost, 90000); assert.equal(pv.prev.cost, 0);
  const d = await ctx.owner.ok('GET', '/api/marketing/ads?days=7');
  assert.equal(d.month, null); assert.equal(d.days, 7); assert.equal(d.byProvider, undefined, 'days 모드는 예전 모양 그대로');
  assert.equal((await ctx.owner.req('GET', '/api/marketing/ads?month=2026-13')).status, 200, '잘못된 month 는 days 모드로');
  assert.equal((await ctx.staffA.client.ok('GET', `/api/marketing/ads?month=${month}`)).totals.cost, 75000, '공간 멤버 직원도 읽기');
  assert.equal((await ctx.staffB.client.req('GET', `/api/marketing/ads?month=${month}`)).status, 404, '미배정 직원');
});

test('AI 월 분석: 좋았던 점·나빴던 점·제안 3개 → 보관(같은 숫자면 재사용) → 다시 분석은 관리자 → AI 답이 비면 숫자 기본 분석', async () => {
  await ctl({ anthropicReset: true, anthropicQueue: [say({ summary: '이달 광고비 7.5만 원으로 전환 6건, 전월보다 비용은 줄고 전환은 늘었습니다. 메타 리드 캠페인이 효율이 좋았습니다.', good: ['전환 1→6건', 'CPC 900→577원'], bad: ['노출이 줄었습니다'],
    proposals: [{ title: '가을 리드 예산 20% 증액', detail: '대표 승인 뒤 메타 하루 예산 1만→1.2만 원', expected: '전환 +1건/주' }, { title: '파워링크 키워드 3개 교체', detail: '전환 없는 키워드 3개를 지역 키워드로', expected: 'CPA 하락' }, { title: '랜딩 전화 버튼 점검', detail: '휴대폰에서 2번 안에 전화', expected: '문의율 개선' }] })] });
  const a = await ctx.staffA.client.ok('POST', '/api/marketing/ads/analysis', { month });
  assert.equal(a.source, 'ai'); assert.equal(a.proposals.length, 3); assert.equal(a.good.length, 2); assert.match(a.summary, /전환 6건/);
  const sent = JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {});
  assert.ok(sent.includes('파워링크 본점'), 'AI 재료에 캠페인·매체·브랜드·전월 숫자');
  assert.ok(sent.includes('바디랩') && sent.includes(prevM), sent.slice(0, 300));
  const v = await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`);
  assert.equal(v.analysis.generatedAt, a.generatedAt, '보관된 분석을 화면에');
  await ctl({ anthropicReset: true, anthropicQueue: [say({ summary: '다시', good: ['x'], bad: ['y'], proposals: [{ title: '1', detail: '', expected: '' }, { title: '2', detail: '', expected: '' }, { title: '3', detail: '', expected: '' }] })] });
  assert.equal((await ctx.owner.ok('POST', '/api/marketing/ads/analysis', { month })).generatedAt, a.generatedAt, '숫자가 같으면 AI 를 다시 부르지 않음');
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ads/analysis', { month, force: true })).status, 403, '다시 분석은 관리자');
  const b = await ctx.owner.ok('POST', '/api/marketing/ads/analysis', { month, force: true });
  assert.equal(b.summary, '다시'); assert.notEqual(b.generatedAt, a.generatedAt);
  // AI 답이 비면(proposals 없음) 숫자만으로 만든 기본 분석 — 전월 대비 사실만
  await ctl({ anthropicReset: true, anthropicQueue: [say({})] });
  const c = await ctx.owner.ok('POST', '/api/marketing/ads/analysis', { month: prevM });
  assert.equal(c.source, 'template'); assert.equal(c.proposals.length, 3); assert.match(c.summary, new RegExp(`${prevM} 광고 합계`));
  assert.ok(c.bad.some((s) => /눈에 띄는 문제|전환 추적/.test(s)) || c.good.length, JSON.stringify(c));
});

test('[승인 요청 카드로 보내기] → 운영실 카드(analysis) → 승인함 운영 제안 탭 · 같은 달 중복 없음 · 승인자 알림 · 직원은 못 보냄', async () => {
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ads/analysis/card', { month })).status, 403);
  const r = await ctx.owner.ok('POST', '/api/marketing/ads/analysis/card', { month });
  assert.equal(r.created, true);
  const [p] = await sql`select kind, title, summary, body, source, month, status from mkt_proposals where id = ${r.id}`;
  assert.equal(p.kind, 'analysis'); assert.equal(p.month, month); assert.equal(p.status, 'pending'); assert.equal(p.body.adsMonth, month);
  assert.equal(p.body.items.length, 3); assert.match(p.title, new RegExp(`${month} 광고 성과 분석`)); assert.match(p.body.rationale, /좋았던 점/); assert.equal(p.body.link, `/s/marketing/ads?month=${month}`);
  const r2 = await ctx.owner.ok('POST', '/api/marketing/ads/analysis/card', { month });
  assert.equal(r2.created, false); assert.equal(r2.id, r.id, '대기 중 카드가 있으면 그 카드');
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/ads?month=${month}`)).analysis.cardId, r.id, '화면에 "승인함에서 보기"');
  const inbox = await ctx.owner.ok('GET', '/api/marketing/inbox');
  assert.ok(inbox.proposals.some((x) => x.id === r.id), '승인함 운영 제안 탭에');
  // 승인 → 업무 생성(운영실 흐름 그대로)
  const ok = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${r.id}`, { action: 'approve' });
  assert.ok(ok, JSON.stringify(ok));
  assert.equal((await sql`select status from mkt_proposals where id = ${r.id}`)[0].status, 'approved');
});
