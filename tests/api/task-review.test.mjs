// 대표 10/21 13:50 #410: 모든 업무에서 담당자가 [검토 요청] → 요청자(없으면 만든 사람)에게 알림 → 요청자 [승인(최종 완료)]/[반려(보완 요청)]
// 대표 11/18: 검토는 담당자가 필요할 때 요청하는 것 — 완료의 조건이 아님('검토 필수'로 완료를 막던 #410 ②③ 은 없앰)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const get = async (c, id) => (await c.ok('GET', `/api/tasks/${id}`)).task;

test('일반 업무: 담당자 검토 요청 → 요청자 알림·검토 업무 → 반려(보완) → 다시 검토 요청 → 승인(최종 완료)', async () => {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '검토 흐름 일반 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  let t = await get(ctx.staffA.client, id); assert.equal(t.approval_required, false);
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review', version: t.version });
  t = await get(ctx.owner, id); assert.equal(t.status, 'review'); assert.ok(t.review_requested_at, '검토 요청 시각');
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and type = 'review_requested' and entity_id = ${id}`).length, '요청자 알림');
  assert.ok((await sql`select 1 from activities where entity_type = 'task' and entity_id = ${id} and action = 'review_requested'`).length, '활동 기록 review_requested');
  // 요청자가 반려(보완 요청) — 담당자는 검토 중에도 바로 완료할 수 있음(아래 시험)
  assert.equal((await ctx.managerA.client.req('PATCH', `/api/tasks/${id}`, { status: 'done', version: t.version })).status, 403, '담당·검토 담당이 아닌 사람(같은 현장 관리자)은 검토 중 완료 불가');
  await ctx.owner.ok('PATCH', `/api/tasks/${id}`, { status: 'in_progress', version: t.version, reviewNote: '사진 더 붙여 주세요' });
  t = await get(ctx.staffA.client, id); assert.equal(t.status, 'in_progress');
  assert.ok((await sql`select 1 from activities where entity_type = 'task' and entity_id = ${id} and action = 'review_rejected'`).length, '활동 기록 review_rejected');
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and type = 'review_result' and title like '보완 요청%'`).length, '담당자에게 보완 요청 알림');
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review', version: t.version });
  t = await get(ctx.owner, id);
  await ctx.owner.ok('PATCH', `/api/tasks/${id}`, { status: 'done', version: t.version });
  t = await get(ctx.owner, id); assert.equal(t.status, 'done');
  assert.ok((await sql`select 1 from activities where entity_type = 'task' and entity_id = ${id} and action = 'approved'`).length, '활동 기록 approved');
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and type = 'review_result' and title like '최종 완료 확인%'`).length, '담당자에게 최종 완료 알림');
});

// 대표 11/18 "검토 후에만 완료를 할 수 있음 — 지난번에 검토 없이도 완료를 할 수 있도록 구현해달라고 했음 —
//   검토는 담당자가 필요시에 요청자에게 검토를 요청하는 것이지 완료의 조건으로 두지는 않는다"
// 원인: 393차(11/13)는 '검토 필수가 아닌 업무'만 풀었는데, 업무를 만들 때 따로 적지 않으면 검토 필수가 켜졌다(후속 업무·옛 업무·서식).
//       그런 업무는 [완료]가 '검토 요청'으로 넘어가고, 검토 중에는 요청자 승인 전까지 완료가 막혔다.
// 이제: 검토 필수 표시(approval_required)가 켜져 있어도 담당자는 바로 완료 · 검토를 요청한 뒤에도 바로 완료 · 새 업무(후속 업무 포함) 기본은 꺼짐.
//       검토 담당자가 승인하면 예전처럼 '최종 완료 확인'으로 남는다. 결재선(전자결재) 업무만 결재를 거친다(approvals 시험).
test("대표 11/18 검토는 완료의 조건이 아님: 예전 '검토 필수' 표시가 있어도 담당자가 바로 완료 · 검토 요청 뒤에도 바로 완료 · 검토 담당자 승인은 그대로 · 새 업무·후속 업무 기본은 꺼짐", async () => {
  // ① 예전에 검토 필수가 켜진 업무 — 담당자가 검토 없이 바로 완료(예전: 403 '검토 필수 업무입니다')
  const a = (await ctx.owner.ok('POST', '/api/tasks', { title: '예전 검토 필수 업무 가', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: true })).id;
  let t = await get(ctx.staffA.client, a); assert.equal(t.approval_required, true, '예전 표시 그대로인 업무');
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${a}`, { status: 'done', version: t.version });
  t = await get(ctx.owner, a); assert.deepEqual([t.status, t.approved_by ?? null], ['done', null], '바로 완료 · 스스로 끝낸 것은 승인 기록 아님');
  assert.equal((await sql`select count(*)::int n from tasks where review_of = ${a}`)[0].n, 0, '[검토] 업무를 만들지 않음');
  // ② 같은 표시의 업무에서 담당자가 골라서 검토 요청 → 기다리지 않고 바로 완료(예전: 403 '승인·반려는 검토 담당자만')
  const b = (await ctx.owner.ok('POST', '/api/tasks', { title: '예전 검토 필수 업무 나', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: true })).id;
  t = await get(ctx.staffA.client, b);
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${b}`, { status: 'review', version: t.version });
  t = await get(ctx.staffA.client, b); assert.equal(t.status, 'review');
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${b}`, { status: 'done', version: t.version });
  t = await get(ctx.owner, b); assert.deepEqual([t.status, t.approved_by ?? null], ['done', null]);
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and entity_id = ${b} and title like '완료(검토 없이)%'`).length, '검토 담당자(요청자)에게 검토 없이 완료 알림');
  // ③ 검토 담당자가 승인하면 예전처럼 '최종 완료 확인'
  const c = (await ctx.owner.ok('POST', '/api/tasks', { title: '예전 검토 필수 업무 다', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: true })).id;
  t = await get(ctx.staffA.client, c);
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${c}`, { status: 'review', version: t.version });
  t = await get(ctx.owner, c);
  await ctx.owner.ok('PATCH', `/api/tasks/${c}`, { status: 'done', version: t.version });
  t = await get(ctx.owner, c); assert.deepEqual([t.status, t.approved_by], ['done', ctx.ownerId], '요청자 승인 = 최종 완료 확인');
  // ④ 새 업무는 따로 적지 않으면 검토 필수 꺼짐 — 후속 업무(대표 화면의 그 업무)도
  const d = (await ctx.owner.ok('POST', '/api/tasks', { title: '따로 안 적은 새 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA })).id;
  assert.equal((await get(ctx.owner, d)).approval_required, false);
  const f = (await ctx.owner.ok('POST', `/api/tasks/${a}/follow-up`, {})).id;
  t = await get(ctx.staffA.client, f); assert.deepEqual([t.approval_required, t.title], [false, '[후속] 예전 검토 필수 업무 가']);
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${f}`, { status: 'done', version: t.version });
  assert.equal((await get(ctx.owner, f)).status, 'done', '후속 업무도 담당자가 바로 완료');
});

test('대표 11/18: 담당자가 관리자여도, 요청자가 직원이어도 바로 완료 · 담당자 = 요청자도 바로 완료', async () => {
  const id = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '직원이 관리자에게 요청한 업무(예전 검토 필수)', assigneeId: ctx.managerA.id, orgUnitId: ctx.siteA, approvalRequired: true })).id;
  let t = await get(ctx.managerA.client, id); assert.equal(t.requested_by, ctx.staffA.id);
  await ctx.managerA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'done', version: t.version });
  t = await get(ctx.staffA.client, id); assert.deepEqual([t.status, t.approved_by ?? null], ['done', null]);
  const self = (await ctx.owner.ok('POST', '/api/tasks', { title: '내가 만들고 내가 하는 업무(예전 검토 필수)', assigneeId: ctx.ownerId, orgUnitId: ctx.hq, approvalRequired: true })).id;
  const s = await get(ctx.owner, self); await ctx.owner.ok('PATCH', `/api/tasks/${self}`, { status: 'done', version: s.version });
  assert.equal((await get(ctx.owner, self)).status, 'done');
});

test("393차(대표 11/13 '업무 담당자가 검토 승인 요청 후 완료 처리를 할 수 없는 상황'): 검토 필수가 아닌 업무는 검토를 기다리는 중에도 담당자가 바로 완료 · 검토 담당자에게 '검토 없이 완료' 알림 · [검토] 업무 닫힘", async () => {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '골라서 검토 요청한 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  let t = await get(ctx.staffA.client, id);
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review', version: t.version });
  const [rv] = await sql`select id, status, assignee_id from tasks where review_of = ${id} and deleted_at is null`;
  assert.deepEqual([rv?.status, rv?.assignee_id], ['todo', ctx.ownerId], '요청자에게 [검토] 업무');
  t = await get(ctx.staffA.client, id); assert.equal(t.status, 'review');
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'done', version: t.version });
  t = await get(ctx.owner, id);
  assert.deepEqual([t.status, t.approved_by ?? null], ['done', null], '담당자가 완료(승인 기록은 없음)');
  assert.equal((await sql`select status from tasks where id = ${rv.id}`)[0].status, 'done', '[검토] 업무 자동으로 닫힘');
  const acts = (await sql`select action from activities where entity_type = 'task' and entity_id = ${id} order by created_at`).map((a) => a.action);
  assert.ok(acts.includes('review_skipped') && acts.includes('completed') && !acts.includes('approved'), acts.join(','));
  const [n] = await sql`select title from notifications where user_id = ${ctx.ownerId} and entity_id = ${id} and title like '완료(검토 없이)%'`;
  assert.ok(n, '검토 담당자(요청자)에게 검토 없이 완료 알림');
  // 담당자가 다시 열어 다시 검토 요청할 수 있음(그대로)
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'in_progress', version: t.version });
  t = await get(ctx.staffA.client, id); assert.equal(t.status, 'in_progress');
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review', version: t.version });
  assert.equal((await get(ctx.owner, id)).status, 'review');
});
