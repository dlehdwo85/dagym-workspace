// 대표 10/21 13:50 #410: 모든 업무에서 담당자가 [검토 요청] → 요청자(없으면 만든 사람)에게 알림 → 요청자 [승인(최종 완료)]/[반려(보완 요청)] · '검토 필수'는 요청자도 켜고 끔(직원은 403) · 켜면 담당자 바로 완료 403
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
  t = await get(ctx.owner, id); assert.equal(t.status, 'review'); assert.equal(t.review_requested_by, ctx.staffA.id);
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and type = 'review_requested' and entity_id = ${id}`).length, '요청자 알림');
  assert.ok((await sql`select 1 from activities where entity_type = 'task' and entity_id = ${id} and action = 'review_requested'`).length, '활동 기록 review_requested');
  // 담당자는 검토 중 완료 불가, 요청자가 반려(보완 요청)
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${id}`, { status: 'done', version: t.version })).status, 403, '검토 중 담당자 완료 불가');
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

test("'검토 필수': 요청자가 켬 → 담당자 바로 완료 403·검토 요청만 → 요청자 승인 · 직원(담당자)은 토글 403 · 만들 때 체크(approvalRequired) 그대로", async () => {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '검토 필수 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  let t = await get(ctx.staffA.client, id);
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${id}`, { approvalRequired: true, version: t.version })).status, 403, '담당 직원은 검토 필수 토글 불가');
  await ctx.owner.ok('PATCH', `/api/tasks/${id}`, { approvalRequired: true, version: t.version });
  t = await get(ctx.staffA.client, id); assert.equal(t.approval_required, true);
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${id}`, { status: 'done', version: t.version })).status, 403, '검토 필수면 바로 완료 불가');
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review', version: t.version });
  t = await get(ctx.owner, id); assert.equal(t.status, 'review');
  await ctx.owner.ok('PATCH', `/api/tasks/${id}`, { status: 'done', version: t.version });
  t = await get(ctx.owner, id); assert.equal(t.status, 'done'); assert.equal(t.approved_by, ctx.ownerId);
  const id2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '만들 때 검토 필수', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: true })).id;
  assert.equal((await get(ctx.staffA.client, id2)).approval_required, true);
  // 요청자가 끄면 담당자가 바로 완료 가능
  const t2 = await get(ctx.owner, id2); await ctx.owner.ok('PATCH', `/api/tasks/${id2}`, { approvalRequired: false, version: t2.version });
  const t3 = await get(ctx.staffA.client, id2); await ctx.staffA.client.ok('PATCH', `/api/tasks/${id2}`, { status: 'done', version: t3.version });
  assert.equal((await get(ctx.staffA.client, id2)).status, 'done');
});
