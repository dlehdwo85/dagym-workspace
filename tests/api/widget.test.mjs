// 로컬 10/20 바탕화면 위젯 API: GET /api/widget/today(오늘·지난 업무 5·남은 일정 3·수·다음 일정·딥링크, 2KB 안, private 15분 캐시, 권한 범위) · POST /api/widget/tasks/{id}/done(완료 토글, 남의 업무 403)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('위젯 API', () => {
  test('오늘: 지난 업무 먼저·높음 먼저·최대 5, 오늘 남은 일정·다음 일정, 지남/오늘/승인 대기 수, 딥링크, 2KB 안·private 캐시', async () => {
    for (let i = 0; i < 6; i++) await ctx.owner.ok('POST', '/api/tasks', { title: `위젯 업무 ${i}`, assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: today, priority: i === 3 ? 'high' : 'normal' });
    await ctx.owner.ok('POST', '/api/tasks', { title: '위젯 지난 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: addDays(today, -2) });
    await ctx.owner.ok('POST', '/api/tasks', { title: '남의 업무', assigneeId: ctx.staffB.id, orgUnitId: ctx.siteB, approvalRequired: false, dueDate: today });
    const cal = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
    const start = new Date(Date.now() + 2 * 3600e3), end = new Date(start.getTime() + 3600e3);
    await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '위젯 일정', start: start.toISOString(), end: end.toISOString() });
    const r = await fetch(`${BASE}/api/widget/today`, { headers: { cookie: ctx.staffA.client.cookie } });
    assert.equal(r.status, 200); assert.match(r.headers.get('cache-control'), /private, max-age=900/);
    const text = await r.text(); assert.ok(Buffer.byteLength(text) <= 2048, `2KB 안 (${Buffer.byteLength(text)})`);
    const w = JSON.parse(text);
    assert.equal(w.tasks.length, 5); assert.deepEqual([w.tasks[0].title, w.tasks[0].late, w.tasks[0].due], ['위젯 지난 업무', true, '지남']);
    assert.equal(w.tasks[1].title, '위젯 업무 3', '높음 업무 먼저'); assert.ok(w.tasks.every((t) => t.color === '#0F766E' && !t.title.includes('남의')));
    assert.deepEqual(w.counts, { late: 1, today: 6, approvals: 0 });
    const sameDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(start) === today;
    if (sameDay) { assert.equal(w.events[0].title, '위젯 일정'); assert.ok(w.next && /^\d\d:\d\d$/.test(w.next.time)); }
    assert.equal(w.links.task, 'workos://tasks/{id}');
    assert.equal((await fetch(`${BASE}/api/widget/today`)).status, 401);
  });
  test('완료 체크: 내 업무 → done, 다시 → in_progress, 검토 필요 업무 → review, 남의 업무 403', async () => {
    const [t] = await sql`select id from tasks where title = '위젯 업무 0'`;
    const [other] = await sql`select id from tasks where title = '남의 업무'`;
    assert.equal((await ctx.staffA.client.ok('POST', `/api/widget/tasks/${t.id}/done`)).status, 'done');
    assert.equal((await ctx.staffA.client.ok('POST', `/api/widget/tasks/${t.id}/done`)).status, 'in_progress');
    assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', `/api/widget/tasks/${other.id}/done`)).status), '남의 업무(다른 현장은 404로 숨김)');
    const rv = (await ctx.owner.ok('POST', '/api/tasks', { title: '위젯 검토 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: true, dueDate: today })).id;
    assert.equal((await ctx.staffA.client.ok('POST', `/api/widget/tasks/${rv}/done`)).status, 'review');
    const w = await ctx.staffA.client.ok('GET', '/api/widget/today');
    assert.ok(w.tasks.some((x) => x.done === false), '완료 아닌 업무가 먼저');
  });
});
