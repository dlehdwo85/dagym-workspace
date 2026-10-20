// 대표 10/21 03:00: ① 월 매출 목표 AI 추천(보수/기본/도전, 근거 재료) → 고른 값 [설정] · 월 운영 목표 초안 매출 칸·승인 시 연동 ② AI 마케터 상시 운영: 지표 스냅숏 → 신호(CPC 급등·문의 0·게시 지연) → '운영 신호' 카드(3일 중복 없음) → 상태·최근 검토·아침 브리핑(홈 큐)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const today = seoulToday(); const month = today.slice(0, 7);
const shift = (k) => { const d = new Date(`${month}-15T00:00:00+09:00`); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 7); };
const P = {};
before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
  // 지난 3달 계약: 300만·500만·400만 / 파이프라인: 제안 200만(열림) · 이달 계약 예정 100만
  const lead = (await sql`insert into sales_leads (tenant, name, status, expected_revenue) values ('default', '파이프 거래처', '제안', 1500000) returning id`)[0].id;
  for (const [k, amt] of [[-3, 3000000], [-2, 5000000], [-1, 4000000]]) await sql`insert into sales_lead_records (tenant, kind, src_id, occurred_at, data) values ('default', 'contracts', ${`c${k}`}, now(), ${sql.json({ amount: amt, contract_date: `${shift(k)}-10` })})`;
  await sql`insert into sales_lead_records (tenant, kind, src_id, lead_id, occurred_at, data) values ('default', 'proposals', 'p1', ${lead}, now(), ${sql.json({ amount: 2000000, status: '제안', proposal_date: addDays(today, -20) })})`;
  await sql`insert into sales_lead_records (tenant, kind, src_id, occurred_at, data) values ('default', 'contracts', 'due1', now(), ${sql.json({ amount: 1000000, expected_contract_date: `${month}-25` })})`;
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('① 매출 목표 추천: AI 없으면 기본 계산 3안(보수<기본<도전, 근거 요약) → 보관(revenue GET suggest) · 직원 403 / AI 있으면 AI 숫자', async () => {
  await ctl({ anthropicReset: true });
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ops/revenue/recommend', { month })).status, 403);
  const r = await ctx.owner.ok('POST', '/api/marketing/ops/revenue/recommend', { month });
  assert.equal(r.source, 'template'); assert.deepEqual(r.options.map((o) => o.key), ['conservative', 'base', 'stretch']);
  const [c, b, s] = r.options.map((o) => o.target);
  assert.ok(c < b && b < s && c > 0, JSON.stringify(r.options));
  assert.deepEqual([r.basis.avg3, r.basis.last, r.basis.pipeline], [4000000, 4000000, 3000000], JSON.stringify(r.basis));
  assert.equal(b, 5700000, '기본 = max(3달 평균 400만, 지난달 400만) ×1.05 + 파이프라인 300만 ×0.5 = 570만(10만 단위)');
  assert.ok(r.summary.includes('제안 1건') && r.summary.includes('계약 예정 1건'), r.summary);
  const g = await ctx.owner.ok('GET', `/api/marketing/ops/revenue?month=${month}`);
  assert.equal(g.target, null, '추천만으로는 목표가 정해지지 않음'); assert.equal(g.suggest.options.length, 3);
  // AI 추천
  await ctl({ anthropicReset: true, anthropicQueue: [say({ options: [{ key: 'conservative', target: 5000000, rationale: '보수' }, { key: 'base', target: 7000000, rationale: '지난 3달 평균 + 파이프라인' }, { key: 'stretch', target: 9000000, rationale: '광고 집행 전제' }], summary: '3달 평균 400만, 파이프라인 300만.' })] });
  const a = await ctx.owner.ok('POST', '/api/marketing/ops/revenue/recommend', { month });
  assert.equal(a.source, 'ai'); assert.equal(a.options.find((o) => o.key === 'base').target, 7000000);
  assert.ok(JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {}).includes('파이프라인: 제안 1건 2000000원'), 'AI 재료에 파이프라인');
  // 대표가 고른 값으로 [설정]
  await ctx.owner.ok('PUT', '/api/marketing/ops/revenue', { month, target: 7000000 });
  const g2 = await ctx.owner.ok('GET', `/api/marketing/ops/revenue?month=${month}`);
  assert.equal(g2.target, 7000000); assert.equal(g2.suggest.options.length, 3, '추천은 그대로 보관');
});

test('① 월 운영 목표 초안에 매출 목표 칸(정한 값 → 없으면 AI 추천 기본안) · 승인하면 매출 목표에 반영(없을 때만)', async () => {
  await ctl({ anthropicReset: true });
  const d = await ctx.owner.ok('POST', '/api/marketing/goals', { month });
  assert.equal(d.goals.targets.revenue, 7000000, '이달은 정한 매출 목표');
  const next = shift(1);
  await ctl({ anthropicReset: true, anthropicQueue: [say({ options: [{ key: 'base', target: 8000000, rationale: 'b' }], summary: 's' })] });
  await ctx.owner.ok('POST', '/api/marketing/ops/revenue/recommend', { month: next });
  await ctl({ anthropicReset: true });
  const n = await ctx.owner.ok('POST', '/api/marketing/goals', { month: next });
  assert.equal(n.goals.targets.revenue, 8000000, '다음 달은 추천 기본안');
  await ctx.owner.ok('PATCH', `/api/marketing/goals/${n.id}`, { action: 'update', goals: { ...n.goals, targets: { ...n.goals.targets, revenue: 8500000 } }, weekly: n.weekly });
  await ctx.owner.ok('PATCH', `/api/marketing/goals/${n.id}`, { action: 'approve' });
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/ops/revenue?month=${next}`)).target, 8500000, '승인 → 매출 목표');
});

test('② 상시 운영: [지금 검토] → 오늘 지표·상태 정상 → 지연 게시·CPC 급등·문의 0 → 상태 조치 필요 + 운영 신호 카드(승인 요청·중복 없음) → 승인 → 업무 · 아침 브리핑 → 홈 AI 큐 · 직원 403', async () => {
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/ops/review', {})).status, 403);
  const r0 = await ctx.owner.ok('POST', '/api/marketing/ops/review', {});
  assert.equal(r0.status, 'ok'); assert.deepEqual(r0.signals, []); assert.equal(r0.cards, 0);
  const v0 = await ctx.owner.ok('GET', '/api/marketing/ops');
  assert.equal(v0.review.status, 'ok'); assert.ok(v0.review.reviewedAt);
  // 7일 이력(CPC 500·문의 0) + 오늘 광고 CPC 900 + 승인됐는데 3시간 지나도 게시 안 된 글
  for (let k = 1; k <= 7; k++) await sql`insert into mkt_ops_daily (tenant, day, metrics) values ('default', ${addDays(today, -k)}::date, ${sql.json({ posts: 1, clicks: 100, cost: 50000, inquiries: 0 })})`;
  P.acc = (await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label) values ('default', 'naver', '1234567', '본점') returning id`)[0].id; // 연결 확인 없이 계정 줄만(지표 집계용)
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${P.acc}, ${today}, 'cmp-1', '가을', 5000, 100, 90000)`;
  const c = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '지연 글', channel: 'instagram', scheduledAt: new Date(Date.now() - 3 * 36e5).toISOString(), body: '본문' });
  await sql`update mkt_contents set status = 'approved' where id = ${c.id}`;
  const r1 = await ctx.owner.ok('POST', '/api/marketing/ops/review', {});
  assert.equal(r1.status, 'action');
  assert.deepEqual(r1.signals.map((s) => s.key).sort(), ['cpc_spike', 'no_inquiries', 'publish_delay'], JSON.stringify(r1.signals));
  assert.equal(r1.cards, 3); assert.equal(r1.metrics.cpc, 900);
  const cards = await sql`select id, kind, title, body, status from mkt_proposals where tenant = 'default' and kind = 'alert' order by created_at`;
  assert.equal(cards.length, 3); assert.ok(cards.every((x) => x.status === 'pending' && x.body.signal && x.body.items.length === 1));
  assert.ok(cards.find((x) => x.body.signal === 'cpc_spike').title.includes('900원'));
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and dedupe_key = ${`mktops:alert:default:${today}`}`)[0].n, 1, '승인자 알림 1회(묶음)');
  // 다시 검토해도 같은 신호 카드 중복 없음, 승인함 건수에 포함
  const r2 = await ctx.owner.ok('POST', '/api/marketing/ops/review', {});
  assert.equal(r2.cards, 0); assert.equal((await sql`select count(*)::int n from mkt_proposals where kind = 'alert'`)[0].n, 3);
  assert.equal((await ctx.owner.ok('GET', '/api/marketing/inbox')).counts.proposals, 3);
  assert.ok((await ctx.owner.ok('GET', '/api/marketing/ops')).review.signals.length === 3);
  // 승인 → 업무(담당 = 승인자)
  const ap = await ctx.owner.ok('PATCH', `/api/marketing/ops/proposals/${cards[0].id}`, { action: 'approve' });
  assert.equal(ap.executed.tasks.length, 1);
  // 아침 브리핑(07시 이후 하루 1번) → 운영실·홈 AI 큐
  const kst = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(new Date())) % 24;
  const st = (await ctx.owner.ok('GET', '/api/marketing/ops/review')).review;
  if (kst >= 7) {
    assert.ok(st.brief && st.brief.startsWith('어제 게시') && st.brief.includes('— 상태 정상'), `브리핑은 그날 첫 검토(상태 정상이던 때) 한 번만: ${st.brief}`);
    const h = await ctx.owner.ok('GET', '/api/marketing/home');
    const row = h.queue.find((q) => q.kind === 'ops' && q.title.startsWith('아침 브리핑'));
    assert.ok(row && row.state === 'done' && row.note === '조치 필요' && h.queue[0].id === row.id, `브리핑 줄은 맨 위, 메모는 지금 상태 ${JSON.stringify(h.queue.filter((q) => q.kind === 'ops'))}`);
  } else assert.equal(st.brief, null, '07시 전에는 브리핑 없음');
  assert.equal(st.status, 'action');
});
