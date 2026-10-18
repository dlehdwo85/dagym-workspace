// V41 4-3 + V43 자동 제작: 설정(요금제·한도·마감·알림)·주간 규칙 → 2주 칸 → 제작(가짜 Claude)·품질 검사(금지어 → 수정 요청)·제작 요청 카드(한도 넘으면 승인 필요)·
// 수정 요청 분류(글자 = AI 새 버전 / 사진 재생성 = 카드)·크레딧 원장·사용량·마감 N시간 전 알림·마감 지난 자동 시안 정리·권한
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { FAKE, bootstrap, ensureTls, resetDb, startServer, testDb } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fake;
const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
before(async () => { await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

test('규칙 → 제작 → 승인함 → 수정 요청 → 원장', async () => {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['marketing'] });
  assert.equal((await ctx.staffA.client.req('PUT', '/api/marketing/auto', { leadDays: 1 })).status, 403, '설정은 관리자');
  assert.equal((await ctx.staffB.client.req('GET', '/api/marketing/auto')).status, 404, '공간 밖');
  // 요금제 프로(가격 결정 전), 영상 0편·재생성 0회로 덮어써 한도 시험, 무알림 끔(시험 시각과 무관하게)
  await ctx.owner.ok('PUT', '/api/marketing/auto', { planCode: 'pro', videoMonthly: 0, regenMonthly: 0, leadDays: 3, remindHours: 72, quietStart: 0, quietEnd: 0 });
  let v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.equal(v.plans.pro.price, null, '가격은 대표 결정 전 빈칸');
  assert.deepEqual([v.limits.monthlyCredits, v.limits.weeklyCredits, v.limits.videoMonthly, v.limits.regenMonthly], [250, 58.1, 0, 0]);
  const brand = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '다짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${brand.id}`, { tone: '친근하게', bannedWords: ['최저가'] });
  // 매일 23:00 피드 규칙 → 앞으로 2주 칸(오늘 23:00 이 지났으면 내일부터)
  const r1 = await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: brand.id, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:00', topicHint: '가을 이벤트' });
  assert.ok(r1.planned >= 13, String(r1.planned));
  assert.equal((await sql`select count(*)::int n from mkt_contents where rule_id = ${r1.id} and scheduled_at < now() + interval '1 hour'`)[0].n, 0, '마감 지난 칸은 안 만듦');
  // 제작: 가까운 칸(게시 D-3 이내)은 지금 바로. 첫 원고에 금지어 → 품질 검사 미통과
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 이벤트 최저가', body: '최저가로 모십니다', brief: '실사 사진 + 글자' }), say({ title: '가을 이벤트', body: '가을 맞이 안내', brief: '현관 실사' })] });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.ok(run.produced.length >= 2, JSON.stringify(run));
  const made = await sql`select id, status, quality, current_version from mkt_contents where auto and produced_at is not null order by produce_at, scheduled_at`;
  const bad = made.find((c) => c.status === 'changes'); const good = made.find((c) => c.status === 'pending');
  assert.ok(bad && bad.quality.issues.some((x) => x.includes('최저가')), '금지어 → 수정 요청');
  assert.ok(good, '통과본은 승인 대기');
  const [gv] = await sql`select body from mkt_versions where content_id = ${good.id} and version = 1`;
  assert.match(gv.body, /AI 도움을 받아 제작했습니다$/, 'AI 표기 자동');
  assert.ok((await sql`select 1 from mkt_production_requests where content_id = ${good.id} and kind = 'image' and status = 'open'`).length, '이미지 제작 요청 카드');
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and title like '제작 완료%'`).length, '제작 완료 알림');
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and title like '승인 마감 72시간 전%'`).length, '마감 N시간 전 알림');
  // 수정 요청: 글자 → AI 새 버전 / 사진 재생성 → 카드(재생성 0회 → 승인 필요)
  await ctl({ anthropicReset: true, anthropicQueue: [say({ title: '가을 이벤트', body: '짧게 고친 안내', brief: '' })] });
  const d1 = await ctx.owner.ok('POST', `/api/marketing/contents/${good.id}/decide`, { version: 1, decision: 'changes', comment: '첫 줄을 더 짧게' });
  assert.equal(d1.revision.kind, 'text'); assert.equal(d1.revision.version, 2);
  assert.equal((await sql`select status from mkt_contents where id = ${good.id}`)[0].status, 'pending', '새 버전은 다시 승인 대기');
  const d2 = await ctx.owner.ok('POST', `/api/marketing/contents/${good.id}/decide`, { version: 2, decision: 'changes', comment: '사진을 다시 만들어 주세요' });
  assert.equal(d2.revision.kind, 'regen_image'); assert.match(d2.revision.card.reason, /재생성 0회/);
  v = await ctx.owner.ok('GET', '/api/marketing/auto');
  const regen = v.requests.find((q) => q.kind === 'regen_image');
  assert.equal(regen.status, 'needs_approval');
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/marketing/auto/requests/${regen.id}`, { action: 'approve' })).status, 403, '한도 초과 승인은 관리자');
  assert.equal((await ctx.owner.req('PATCH', `/api/marketing/auto/requests/${regen.id}`, { action: 'done' })).status, 400, '승인 전 완료 불가');
  await ctx.owner.ok('PATCH', `/api/marketing/auto/requests/${regen.id}`, { action: 'approve' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/requests/${regen.id}`, { action: 'done', credits: 6.5 });
  v = await ctx.owner.ok('GET', '/api/marketing/auto');
  assert.equal(v.usage.weekCredits, 6.5); assert.equal(v.usage.monthRegens, 1);
  assert.ok(v.ledger.some((l) => l.kind === 'regen_image' && l.credits === 6.5), '원장: 게시물·버전별');
  // 마감 지난 자동 시안은 정리(취소), 규칙 지우면 아직 안 만든 칸만 같이 지움
  await sql`update mkt_contents set scheduled_at = now() - interval '1 day' where id = ${bad.id}`;
  await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  assert.equal((await sql`select status from mkt_contents where id = ${bad.id}`)[0].status, 'canceled');
  const [rule] = await sql`select id from mkt_rules`;
  await ctx.owner.ok('DELETE', `/api/marketing/auto/rules/${rule.id}`);
  assert.equal((await sql`select count(*)::int n from mkt_contents where status = 'draft' and produced_at is null`)[0].n, 0);
  assert.ok((await sql`select count(*)::int n from mkt_contents where produced_at is not null`)[0].n >= 2, '만든 것은 남음');
});

test('알림 받는 사람 고르기 · 브랜드 시험 모드', async () => {
  // 받는 사람 = 이직원만 → 일반 브랜드 수동 콘텐츠 승인 요청 알림은 이직원에게만
  await ctx.owner.ok('PUT', '/api/marketing/auto', { notifyUserIds: [ctx.staffA.id] });
  const plain = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '일반 브랜드' });
  const c1 = await ctx.staffB.client.req('POST', '/api/marketing/contents', { title: 'x', channel: 'instagram', body: 'x', mediaIds: [] });
  assert.equal(c1.status, 404, '공간 밖 직원');
  const made = await ctx.owner.ok('POST', '/api/marketing/contents', { title: '받는 사람 시험', channel: 'instagram', brandId: plain.id, body: '본문', mediaIds: [] });
  const to = (await sql`select user_id from notifications where entity_id = ${made.id}`).map((r) => r.user_id);
  assert.deepEqual(to, [ctx.staffA.id]);
  // 시험 모드 브랜드: [시험] 표시·알림은 실행한 사람(대표)만·게시 확인 안 됨
  const test = await ctx.owner.ok('POST', '/api/marketing/brands', { name: '[시험] 워크인' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${test.id}`, { testMode: true });
  await ctx.owner.ok('POST', '/api/marketing/auto/rules', { brandId: test.id, channel: 'instagram', kind: 'feed', weekdays: [0, 1, 2, 3, 4, 5, 6], postTime: '23:30' });
  await ctl({ anthropicReset: true });
  const run = await ctx.owner.ok('POST', '/api/marketing/auto/run', {});
  const tc = await sql`select id, title, is_test, status from mkt_contents where brand_id = ${test.id} and produced_at is not null`;
  assert.ok(tc.length >= 1, JSON.stringify(run));
  assert.ok(tc.every((c) => c.is_test && c.title.startsWith('[시험]')));
  const tn = await sql`select distinct user_id from notifications where entity_id = any(${tc.map((c) => c.id)}::uuid[])`;
  assert.deepEqual(tn.map((r) => r.user_id), [ctx.ownerId], '시험 알림은 실행한 사람에게만');
  await sql`update mkt_contents set status = 'approved', approved_version = current_version where id = ${tc[0].id}`;
  assert.equal((await ctx.owner.req('POST', `/api/marketing/contents/${tc[0].id}/publish`, { url: 'https://instagram.com/p/t' })).status, 400, '시험은 게시 확인 안 됨');
});
