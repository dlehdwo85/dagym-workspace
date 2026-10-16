// V35 2·V36 1·2: 근무 상태 자동(휴가·출장·외근/장소 있는 일정 진행 중), 같은 회사에만·상태만, 일괄 배정은 연차자 포함 + 부재 안내
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const personal = async (c) => (await c.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
const iso = (min) => new Date(Date.now() + min * 60000).toISOString();

describe('V36 근무 상태·연차자 배정', () => {
  test('휴가 진행 중 = leave, 장소 있는 일정 진행 중 = out(그 시간만), 끝난 일정·장소 없는 일정은 근무 중(생략), 제목·장소는 안 돌려줌', async () => {
    await ctx.staffA.client.ok('POST', '/api/events', { calendarId: await personal(ctx.staffA.client), title: '가족 여행 비밀', kind: 'vacation', start: iso(-60), end: iso(48 * 60) });
    await ctx.managerA.client.ok('POST', '/api/events', { calendarId: await personal(ctx.managerA.client), title: '고객사 미팅', location: '음성 아이파크', start: iso(-10), end: iso(50) });
    await ctx.managerA.client.ok('POST', '/api/events', { calendarId: await personal(ctx.managerA.client), title: '지난 외근', kind: 'outside', start: iso(-300), end: iso(-200) });
    await ctx.owner.ok('POST', '/api/events', { calendarId: await personal(ctx.owner), title: '사무실 회의', start: iso(-10), end: iso(50) });
    const r = await ctx.staffB.client.ok('GET', '/api/people/presence');
    assert.equal(r.people[ctx.staffA.id].s, 'leave'); assert.match(r.people[ctx.staffA.id].label, /^휴가 ~/);
    assert.equal(r.people[ctx.managerA.id].s, 'out'); assert.match(r.people[ctx.managerA.id].label, /^외근·미팅 ~/);
    assert.equal(r.people[ctx.ownerId], undefined, '장소 없는 회의는 근무 중');
    const raw = JSON.stringify(r);
    assert.ok(!raw.includes('가족 여행') && !raw.includes('음성 아이파크') && !raw.includes('고객사'), '일정 내용은 안 보냄');
  });
  test('여러 명에게 각각: 휴가 중인 사람도 빼지 않고 만들고, 휴가·출장인 사람만 away 로 알려 줌(외근·미팅은 안내 안 함)', async () => {
    const r = await ctx.owner.ok('POST', '/api/tasks', { title: '연차자 포함 일괄', assigneeIds: [ctx.staffA.id, ctx.managerA.id], orgUnitId: ctx.siteA, approvalRequired: false });
    assert.equal(r.ids.length, 2, '연차자 포함 2건');
    const owners = (await sql`select assignee_id from tasks where batch_id = ${r.batchId}`).map((x) => x.assignee_id).sort();
    assert.deepEqual(owners, [ctx.staffA.id, ctx.managerA.id].sort());
    assert.deepEqual(r.away.map((a) => a.id), [ctx.staffA.id]);
    assert.match(r.away[0].label, /휴가/);
    const one = await ctx.owner.ok('POST', '/api/tasks', { title: '연차자 한 명', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false });
    assert.equal(one.away.length, 1);
    const none = await ctx.owner.ok('POST', '/api/tasks', { title: '미팅 중 한 명', assigneeId: ctx.managerA.id, orgUnitId: ctx.siteA, approvalRequired: false });
    assert.equal(none.away.length, 0);
  });
});
