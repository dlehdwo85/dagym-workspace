// V32 4 마감 연장 → 378차(대표 11/06 "업무 연장할 때 담당자 승인을 기다리다 딜레이 … 담당자가 마감연장을 할 수 있도록 · 승인 없이도 ·
// 단 사유를 남겨놓으면 지시자와 담당자가 해당 업무에서 사유를 확인 · 마감연장할 때 시간 선택"):
// 담당자는 마감일 칸으로 직접 미루면 403(extend_required — [마감 연장]에서 사유) · [마감 연장]은 승인 없이 바로(뒤로만, 사유 필수, 날짜·시각) →
// 요청자 알림(사유)·업무 상세 '마감 연장 기록' · 예전에 남은 '대기' 요청은 요청자가 승인·반려(그대로) · 요청자는 앞당기기도
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql, taskId;
const today = seoulToday();
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  taskId = (await ctx.owner.ok('POST', '/api/tasks', { title: '거래처 제안서 마감', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, dueDate: addDays(today, 1), dueTime: '18:00', approvalRequired: false })).id; });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const due = async () => (await sql`select to_char(due_date, 'YYYY-MM-DD') d, to_char(due_time, 'HH24:MI') t, due_extend_count n from tasks where id = ${taskId}`)[0];

describe('378차 마감 연장 — 담당자 바로·사유·시각·기록', () => {
  test('담당자: 마감일 칸으로 미루기 403 · 사유 없으면 400 · 앞당기기·같은 날짜시각 400 · [마감 연장] = 승인 없이 바로(날짜+시각) · 요청자 알림 사유', async () => {
    const r = await ctx.staffA.client.req('PATCH', `/api/tasks/${taskId}`, { dueDate: addDays(today, 5) });
    assert.equal(r.status, 403); assert.equal(r.body.error.code, 'extend_required'); assert.match(r.body.error.message, /사유/);
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${taskId}`, { dueDate: null })).status, 403, '지우기도 미루기');
    assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 3), reason: ' ' })).status, 400);
    assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: today, reason: '이유' })).status, 400, '앞당기기는 마감일 칸에서');
    assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 1), toTime: '18:00', reason: '이유' })).status, 400, '같은 날짜·시각');
    assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 3), toTime: '25:00', reason: '이유' })).status, 400, '시각 꼴');
    const x = await ctx.staffA.client.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 3), toTime: '10:30', reason: '거래처 자료 회신 지연' });
    assert.deepEqual([x.applied, x.as], [true, '담당자']);
    assert.deepEqual(await due(), { d: addDays(today, 3), t: '10:30', n: 1 }, '승인 없이 바로 · 시각까지');
    const [n] = await sql`select title, body from notifications where user_id = ${ctx.ownerId} and title like '마감 연장:%' order by created_at desc limit 1`;
    assert.match(n.body, /이직원님이 마감을 \d+\/\d+ 18:00 → \d+\/\d+ 10:30 로 연장\(사유: 거래처 자료 회신 지연\)/, n.body);
    assert.equal((await ctx.owner.ok('GET', '/api/tasks/counts')).counts.extend, 0, '승인할 요청이 없음');
    assert.equal((await ctx.staffB.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 9), reason: 'x' })).status, 404, '못 보는 사람');
    // 같은 날 시각만 늦추는 연장 · 시각 안 보내면 지금 시각 그대로
    await ctx.staffA.client.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 3), toTime: '17:00', reason: '회의 뒤로 밀림' });
    await ctx.staffA.client.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 4), reason: '하루 더' });
    assert.deepEqual(await due(), { d: addDays(today, 4), t: '17:00', n: 3 });
    assert.ok((await sql`select 1 from activities where entity_id = ${taskId} and action = 'due_extended' and changes->>'as' = '담당자'`).length);
  });
  test('업무 상세 마감 연장 기록: 지시자·담당자 둘 다 사유·앞뒤 날짜시각·누가 · 최근 것이 맨 위', async () => {
    for (const who of [ctx.owner, ctx.staffA.client]) {
      const d = await who.ok('GET', `/api/tasks/${taskId}`);
      const h = d.task.ext_history;
      assert.equal(h.length, 3);
      assert.deepEqual([h[0].from, h[0].fromTime, h[0].to, h[0].toTime, h[0].reason, h[0].byName, h[0].status], [addDays(today, 3), '17:00', addDays(today, 4), '17:00', '하루 더', '이직원', 'applied']);
      assert.deepEqual([h[2].fromTime, h[2].toTime, h[2].reason], ['18:00', '10:30', '거래처 자료 회신 지연']);
    }
  });
  test('예전에 남은 대기 요청: 요청자 승인(시각까지)·반려 그대로 · 요청자는 앞당기기도 바로', async () => {
    const [p] = await sql`insert into task_due_extensions (task_id, requested_by, from_date, to_date, to_time, reason) values (${taskId}, ${ctx.staffA.id}, ${addDays(today, 4)}, ${addDays(today, 8)}, '09:00', '예전 요청') returning id`;
    const row = (await ctx.owner.ok('GET', '/api/tasks?view=extend')).tasks.find((t) => t.id === taskId);
    assert.deepEqual([row.ext_pending.to, row.ext_pending.toTime], [addDays(today, 8), '09:00']);
    assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${taskId}/extend/${p.id}`, { approve: true })).status, 403, '담당자는 승인 못 함');
    await ctx.owner.ok('POST', `/api/tasks/${taskId}/extend/${p.id}`, { approve: true });
    assert.deepEqual(await due(), { d: addDays(today, 8), t: '09:00', n: 4 });
    assert.equal((await ctx.owner.req('POST', `/api/tasks/${taskId}/extend/${p.id}`, { approve: true })).status, 409, '두 번 처리 안 됨');
    const [q] = await sql`insert into task_due_extensions (task_id, requested_by, from_date, to_date, reason) values (${taskId}, ${ctx.staffA.id}, ${addDays(today, 8)}, ${addDays(today, 12)}, '너무 바쁨') returning id`;
    await ctx.owner.ok('POST', `/api/tasks/${taskId}/extend/${q.id}`, { approve: false });
    assert.equal((await due()).d, addDays(today, 8));
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and title like '마감 연장 반려%'`).length);
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${taskId}`, { dueDate: addDays(today, 2) }); // 앞당기기는 담당자가 마감일 칸에서
    const b = await ctx.owner.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 1), toTime: null, reason: '일정 당김' });
    assert.deepEqual([b.applied, b.as], [true, '요청자']);
    assert.deepEqual(await due(), { d: addDays(today, 1), t: null, n: 4 }, '앞당기기는 연장 횟수 안 셈 · 시각 없음');
    const h = (await ctx.owner.ok('GET', `/api/tasks/${taskId}`)).task.ext_history;
    assert.ok(h.some((x) => x.status === 'rejected' && x.reason === '너무 바쁨'), '반려도 기록에');
  });
});
