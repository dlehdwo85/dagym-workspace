// V30 ⑤ 관리자 이용 현황: 사용자·팀별 최근 접속·접속일(DAU/WAU/MAU)·만든/끝낸 업무·저장, 날짜별, 엑셀 — 사용량 권한(직원 403), 기간 7/30/90
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V30 ⑤ 이용 현황', () => {
  test('직원 403 · 관리자: 요약(오늘 접속·사용자 수)·날짜별 days 칸·사용자 표(접속일·만든/끝낸 업무)·팀 표', async () => {
    assert.equal((await ctx.staffA.client.req('GET', '/api/usage/stats')).status, 403);
    const teamId = (await ctx.owner.ok('POST', '/api/teams', { name: '현장팀', members: [{ userId: ctx.staffA.id, lead: true }, { userId: ctx.staffB.id }] })).id;
    const t1 = await ctx.owner.ok('POST', '/api/tasks', { title: '이용 현황 업무 1', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, teamId });
    await ctx.owner.ok('POST', '/api/tasks', { title: '이용 현황 업무 2', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false });
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t1.id}`, { status: 'done' });
    // 접속한 날 기록은 요청과 따로 들어감 → 잠깐 기다림
    for (let i = 0; i < 20 && (await sql`select count(*)::int n from user_active_days where user_id = ${ctx.staffA.id}`)[0].n === 0; i++) await new Promise((r) => setTimeout(r, 100));
    const s = await ctx.owner.ok('GET', '/api/usage/stats?days=7');
    assert.equal(s.days, 7); assert.equal(s.daily.length, 7); assert.equal(s.daily[6].day, s.today);
    assert.ok(s.summary.dau >= 2 && s.summary.wau >= s.summary.dau && s.summary.mau >= s.summary.wau, `오늘 접속 ${s.summary.dau}`);
    assert.ok(s.summary.users >= 4); assert.equal(s.summary.tasksCreated >= 2, true); assert.ok(s.summary.tasksDone >= 1);
    const a = s.users.find((x) => x.id === ctx.staffA.id);
    assert.deepEqual([a.active_days, a.tasks_done, a.teams], [1, 1, ['현장팀']]); assert.ok(a.last_active, '최근 접속');
    const o = s.users.find((x) => x.id === ctx.ownerId);
    assert.ok(o.tasks_created >= 2, '대표가 만든 업무');
    const tm = s.teams.find((x) => x.id === teamId);
    assert.deepEqual([tm.members, tm.tasks_created, tm.tasks_done], [2, 1, 1]); assert.ok(tm.active_users >= 1);
    assert.equal(s.daily[6].active, s.summary.dau);
    assert.equal((await ctx.owner.ok('GET', '/api/usage/stats?days=999')).days, 30, '모르는 기간은 30일');
  });
  test('엑셀 내려받기(관리자) · 직원 403', async () => {
    const x = await fetch(`${BASE}/api/usage/stats/export?days=30`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(x.status, 200); assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    assert.match(x.headers.get('content-disposition'), /%EC%9D%B4%EC%9A%A9/, '파일명 이용현황');
    assert.equal((await fetch(`${BASE}/api/usage/stats/export`, { headers: { cookie: ctx.staffA.client.cookie, origin: BASE } })).status, 403);
  });
});
