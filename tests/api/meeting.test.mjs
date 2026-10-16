// V37 8 미팅 업무의 장소(대표 10/17): 업무에 장소 칸 대신 [미팅 일정 만들기] — 장소 있는 일정(담당·지시자 참석, 30분 전 알림) + 업무 연결,
// 목록에 📍장소·시간, 다른 현장 직원 404, 업무를 고칠 수 없는 사람은 403, 장소 없으면 400
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V37 8 미팅 일정', () => {
  test('업무 → 미팅 일정: 일정 장소·참석·알림·연결, 목록 📍, 권한', async () => {
    const d = addDays(seoulToday(), 2);
    const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '판교 아파트 현장 미팅', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, dueDate: d, approvalRequired: false })).id;
    assert.equal((await ctx.owner.req('POST', `/api/tasks/${id}/meeting`, { location: ' ', start: `${d}T10:00:00+09:00`, end: `${d}T11:00:00+09:00` })).status, 400, '장소 필수');
    assert.equal((await ctx.staffB.client.req('POST', `/api/tasks/${id}/meeting`, { location: '판교', start: `${d}T10:00:00+09:00`, end: `${d}T11:00:00+09:00` })).status, 404, '다른 현장 404');
    const ev = await ctx.owner.ok('POST', `/api/tasks/${id}/meeting`, { location: '판교 OO아파트 관리사무소', start: `${d}T10:00:00+09:00`, end: `${d}T11:00:00+09:00`, title: '판교 아파트 현장 미팅' });
    const [e] = await sql`select location, kind, reminder_minutes, task_id from events where id = ${ev.id}`;
    assert.equal(e.location, '판교 OO아파트 관리사무소'); assert.equal(e.kind, 'normal'); assert.deepEqual(e.reminder_minutes, [30]); assert.equal(e.task_id, null, '업무 시간 블록이 아닌 일정');
    assert.equal((await sql`select role from event_tasks where event_id = ${ev.id} and task_id = ${id}`)[0].role, 'link');
    assert.ok((await sql`select 1 from event_attendees where event_id = ${ev.id} and user_id = ${ctx.staffA.id}`).length, '담당자 참석');
    const t = (await ctx.staffA.client.ok('GET', '/api/tasks?view=my')).tasks.find((x) => x.id === id);
    assert.equal(t.meeting.location, '판교 OO아파트 관리사무소'); assert.equal(t.meeting.id, ev.id);
    assert.ok((await ctx.staffA.client.ok('GET', `/api/tasks/${id}/events`)).events.some((x) => x.id === ev.id), '연결 일정에 보임');
    // 같은 현장이지만 업무와 관계없는 매니저는 볼 수만 있음(고칠 수 없음) → 403
    const r = await ctx.managerA.client.req('POST', `/api/tasks/${id}/meeting`, { location: '판교', start: `${d}T13:00:00+09:00`, end: `${d}T14:00:00+09:00` });
    assert.ok([403, 404].includes(r.status), `관계없는 사람은 못 만듦 (${r.status})`);
  });
});
