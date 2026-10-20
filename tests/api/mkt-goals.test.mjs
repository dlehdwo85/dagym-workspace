// 대표 10/20 18:00: ① 콘텐츠 근거(목적·목표 지표·핵심 메시지·왜) ② 월 운영 목표(초안 → 승인 → 주간 주제 달력 → 주간 리뷰 → 결산, 홈 막대) ③ AI 작업 큐 '목표' 줄 ④ 근거 소급
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);
const P = {};
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', quietStart: 0, quietEnd: 0, leadDays: 3 });
  P.brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${P.brand}`, { intro: '아파트 커뮤니티 운영', products: 'PT·GX', weeklyTopic: '가을 이벤트' });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('② 초안(AI 없으면 기본 초안) → 목록·홈 막대(승인 대기)·큐 줄 → 고치기 → 승인 → 홈 막대 승인됨', async () => {
  await ctl({ anthropicReset: true }); // 큐가 비면 가짜 AI 는 짧은 글 → JSON 아님 → 기본 초안
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/goals', { month })).status, 403, '초안은 관리자');
  const r = await ctx.owner.ok('POST', '/api/marketing/goals', { month });
  assert.equal(r.source, 'template'); assert.equal(r.status, 'pending'); assert.ok(r.weekly.length >= 4 && r.goals.objectives.length === 3, JSON.stringify(r.goals));
  P.goal = r.id;
  const l = await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`);
  assert.equal(l.goals.length, 1); assert.equal(l.goals[0].status, 'pending'); assert.ok(l.goals[0].numbers && typeof l.goals[0].numbers.posts === 'number'); assert.ok(l.months.includes(month));
  const h = await ctx.owner.ok('GET', '/api/marketing/home');
  assert.equal(h.goal.status, 'pending'); assert.ok(h.queue.some((q) => q.kind === 'goal' && q.note === '대표 승인 필요'), '큐에 목표 줄');
  // 고치기: 1주 주제·목표 수치
  const weekly = r.weekly.map((w, i) => (i === 0 ? { ...w, topic: '가을 신규 회원 이벤트' } : w));
  await ctx.owner.ok('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'update', goals: { ...r.goals, targets: { posts: 12, inquiries: 6, adBudget: 300000 } }, weekly });
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'approve' })).status, 403);
  await ctx.owner.ok('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'approve' });
  const g = (await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`)).goals[0];
  assert.deepEqual([g.status, g.source, g.weekly[0].topic, g.goals.targets.posts], ['approved', 'user', '가을 신규 회원 이벤트', 12]);
  const h2 = await ctx.owner.ok('GET', '/api/marketing/home');
  assert.deepEqual([h2.goal.status, h2.goal.posts.target, h2.goal.inquiries.target], ['approved', 12, 6]);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'mkt.goal_approve' and target_id = ${P.goal}`)[0].n, 1);
});
test('① 자동 제작은 그 주 주제·목표로 근거(왜 이 글인가)를 붙임 / 손으로 만든 콘텐츠의 근거 칸 / 목록·상세에 rationale', async () => {
  const rule = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: P.brand, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00' });
  const [c] = await sql`select id, scheduled_at from mkt_contents where rule_id = ${rule.id} order by scheduled_at limit 1`;
  await sql`update mkt_contents set produce_at = now() where id = ${c.id}`;
  await sql`update mkt_contents set produce_at = now() + interval '30 days' where rule_id = ${rule.id} and id <> ${c.id}`;
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 이벤트 안내', body: '가을 신규 회원 이벤트를 소개합니다.', brief: '실사 사진 + 글자', why: '이달 목표 신규 회원 문의 — 1주 주제 이벤트 안내' })] });
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const [p] = await sql`select rationale, status from mkt_contents where id = ${c.id}`;
  assert.ok(p.rationale, '근거 붙음'); assert.equal(p.rationale.source, 'goal'); assert.equal(p.rationale.goalId, P.goal);
  assert.equal(p.rationale.why, '이달 목표 신규 회원 문의 — 1주 주제 이벤트 안내'); assert.ok(p.rationale.topic && p.rationale.week >= 1, JSON.stringify(p.rationale));
  assert.match(p.rationale.metric, /게시 12건/);
  const text = JSON.stringify(fake.state.anthropic.at(-1)?.body ?? {}); // 가짜 AI 가 받은 마지막 요청
  assert.ok(text.includes('이달 운영 목표'), '재료에 이달 목표'); P.auto = c.id;
  // 손으로: 근거 칸
  const m = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '수동 글', channel: 'instagram', body: '본문', mediaIds: [], rationale: { purpose: '신규 문의', metric: '전화 5건', message: '가을 30%', why: '2주 주제 이벤트' } });
  const list = await ctx.owner.ok('GET', '/api/marketing/contents?view=approvals');
  const mine = list.contents.find((x) => x.id === m.id);
  assert.deepEqual([mine.rationale.purpose, mine.rationale.source], ['신규 문의', 'user']);
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/contents/${m.id}`)).content.rationale.why, '2주 주제 이벤트');
  const none = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '근거 없는 글', channel: 'instagram', body: '본문', mediaIds: [], rationale: {} });
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/contents/${none.id}`)).content.rationale, null, '빈 근거는 저장 안 함'); P.none = none.id;
});
test('④ 근거 소급: 비어 있는 자동 제작분·규칙 칸에 목표·규칙 문장(AI 비용 0) / ② 주간 리뷰·월말 결산 / AI 초안(JSON) 은 source ai', async () => {
  await sql`update mkt_contents set rationale = null where id = ${P.auto}`;
  const b = await ctx.owner.ok('POST', '/api/marketing/goals/backfill', { month });
  assert.ok(b.updated >= 1, JSON.stringify(b));
  const [p] = await sql`select rationale from mkt_contents where id = ${P.auto}`;
  assert.equal(p.rationale.source, 'backfill'); assert.match(p.rationale.why, /운영 목표/);
  assert.equal((await sql`select rationale from mkt_contents where id = ${P.none}`)[0].rationale, null, '규칙도 목표도 자동도 아닌 손 글은 그대로'); // 회사 전체 목표가 있으면 채움 — 수동 글도 목표가 있으면 대상
  assert.equal((await ctx.staffA.client.req('POST', '/api/marketing/goals/backfill', { month })).status, 403);
  // 주간 리뷰(가짜 AI 3문장 — 시험 환경은 AI 켜짐. AI 가 꺼진 회사는 숫자 요약)
  await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: '1주 게시가 주 목표에 못 미쳤습니다. 문의는 0건입니다. 다음 주 릴스 1편을 더 제안합니다.' }], stop_reason: 'end_turn' }] });
  const rv = await ctx.owner.ok('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'review', week: 1 });
  assert.equal(rv.week, 1); assert.match(rv.summary, /1주 게시가 주 목표/); assert.ok(typeof rv.numbers.posts === 'number');
  const g = (await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`)).goals[0];
  assert.equal(g.reviews.length, 1);
  await ctx.owner.ok('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'review', week: 1 });
  assert.equal((await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`)).goals[0].reviews.length, 1, '같은 주 다시 = 덮어씀');
  await ctx.owner.ok('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'close' });
  const closed = (await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`)).goals[0];
  assert.equal(closed.status, 'closed'); assert.match(closed.closing.summary, /결산/); assert.ok('posts' in closed.closing.achieved);
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/goals/${P.goal}`, { action: 'approve' })).status, 400, '결산 뒤 승인 불가');
  // AI 초안: 다음 달, JSON 응답 → source ai, 주 수만큼 주제
  const next = (() => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
  await ctl({ anthropicReset: true, anthropicQueue: [say({ objectives: ['문의 8건', '게시 15건', '말투 통일'], message: '가까운 곳에서 믿고', targets: { posts: 15, inquiries: 8, adBudget: null }, weeks: [{ topic: 'A', channels: ['instagram'], kinds: ['feed'], note: '' }, { topic: 'B', channels: ['instagram'], kinds: ['reels'], note: '' }] })] });
  const ai = await ctx.owner.ok('POST', '/api/marketing/goals', { month: next, brandId: P.brand });
  assert.equal(ai.source, 'ai'); assert.deepEqual([ai.goals.targets.posts, ai.weekly[0].topic, ai.weekly[1].topic], [15, 'A', 'B']); assert.ok(ai.weekly.length >= 4 && ai.weekly[2].topic, '모자란 주는 기본 주제');
  assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'marketing_goal'`)[0].n >= 1, true);
  const ln = await ctx.owner.ok('GET', `/api/marketing/goals?month=${next}`);
  assert.equal(ln.goals[0].brand, '다짐');
  assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/goals')).status, 404, '공간 밖');
});
