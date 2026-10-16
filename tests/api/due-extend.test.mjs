// V32 4 마감 연장: 담당자는 마감을 직접 미룰 수 없고 [마감 연장] 요청(사유 필수) → 지시자 알림·"연장 요청" 목록 → 승인(마감 변경·연장 1회)·반려, 지시자는 바로 연장
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql, taskId;
const today = seoulToday();
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '거래처 제안서 마감', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, dueDate: addDays(today, 1), approvalRequired: false })).id; });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const due = async () => (await sql`select to_char(due_date, 'YYYY-MM-DD') d, due_extend_count n from tasks where id = ${taskId}`)[0];

describe('V32 4 마감 연장', () => {
  test('담당자: 직접 미루기 403(extend_required)·앞당기기는 됨, 사유 없으면 400, 요청 → 지시자 알림·연장 요청 목록·칩', async () => {
    const r = await ctx.staffA.client.req('PATCH', `/api/tasks/${taskId}`, { dueDate: addDays(today, 5) });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'extend_required');
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${taskId}`, { dueDate: null })).status, 403, '지우기도 미루기');
    assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 3), reason: ' ' })).status, 400);
    assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: today, reason: '이유' })).status, 400, '지금보다 뒤 날짜만');
    const x = await ctx.staffA.client.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 3), reason: '거래처 자료 회신 지연' });
    assert.equal(x.applied, false);
    assert.equal((await due()).d, addDays(today, 1), '승인 전에는 그대로');
    const [n] = await sql`select title, body from notifications where user_id = ${ctx.ownerId} and title like '마감 연장 요청%'`;
    assert.match(n.body, /거래처 자료 회신 지연/);
    const list = (await ctx.owner.ok('GET', '/api/tasks?view=extend')).tasks;
    const row = list.find((t) => t.id === taskId);
    assert.equal(row.ext_pending.to, addDays(today, 3)); assert.equal(row.ext_pending.reason, '거래처 자료 회신 지연');
    assert.equal((await ctx.owner.ok('GET', '/api/tasks/counts')).counts.extend, 1);
    assert.equal((await ctx.staffB.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 9), reason: 'x' })).status, 404, '못 보는 사람');
    // 담당자는 자기 요청을 승인할 수 없음
    assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${taskId}/extend/${row.ext_pending.id}`, { approve: true })).status, 403);
    await ctx.owner.ok('POST', `/api/tasks/${taskId}/extend/${row.ext_pending.id}`, { approve: true });
    assert.deepEqual(await due(), { d: addDays(today, 3), n: 1 });
    assert.equal((await ctx.owner.req('POST', `/api/tasks/${taskId}/extend/${row.ext_pending.id}`, { approve: true })).status, 409, '두 번 처리 안 됨');
    assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'due_extended'`).length);
  });
  test('반려: 마감 그대로·담당자에게 반려 알림, 앞당기기는 담당자가 직접, 지시자는 바로 연장', async () => {
    const x = await ctx.staffA.client.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 10), reason: '너무 바쁨' });
    await ctx.owner.ok('POST', `/api/tasks/${taskId}/extend/${x.id}`, { approve: false });
    assert.equal((await due()).d, addDays(today, 3));
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and title like '마감 연장 반려%'`).length);
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${taskId}`, { dueDate: addDays(today, 2) });
    const b = await ctx.owner.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 6), reason: '범위 추가' });
    assert.equal(b.applied, true);
    assert.deepEqual(await due(), { d: addDays(today, 6), n: 2 });
  });
});
