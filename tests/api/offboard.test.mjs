// 대표 10/20 오후 7) 사용자 관리 — 퇴사 처리 / 계정 인수인계 / 복직: 날짜·로그인 차단·세션 만료·팀/대화방 제거·라이선스 제외·알림 중지, 항목별 일괄 이전(개수), 30일 복직, 감사 기록, 권한
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'gone@dagym.test', name: '퇴사예정', role: 'staff', orgUnitIds: [ctx.hq] });
  const c = new Client('gone'); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'gone-pass-1234' });
  P.gone = { id: inv.userId, c };
  P.room = (await P.gone.c.ok('POST', '/api/chat/rooms', { kind: 'group', name: '퇴사자 방', userIds: [ctx.ownerId] })).id; // 퇴사자가 방장
  P.team = (await ctx.owner.ok('POST', '/api/teams', { name: '본사팀', members: [{ userId: ctx.ownerId, lead: true }, { userId: P.gone.id, lead: false }] })).id;
  P.t1 = (await ctx.owner.ok('POST', '/api/tasks', { title: '퇴사자 담당 업무', assigneeId: P.gone.id, orgUnitId: ctx.hq, approvalRequired: false })).id;
  P.t2 = (await P.gone.c.ok('POST', '/api/tasks', { title: '퇴사자가 지시한 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.hq, approvalRequired: false })).id;
  P.t3 = (await ctx.owner.ok('POST', '/api/tasks', { title: '완료된 업무', assigneeId: P.gone.id, orgUnitId: ctx.hq, approvalRequired: false })).id;
  await sql`update tasks set status = 'done', completed_at = now() where id = ${P.t3}`;
  await sql`insert into contacts (tenant, name, phone, owner_id, created_by) values ('default', '거래처 김', '010-0000-0001', ${P.gone.id}, ${ctx.ownerId})`.catch(async () => sql`insert into contacts (tenant, name, owner_id, created_by) values ('default', '거래처 김', ${P.gone.id}, ${ctx.ownerId})`);
});
after(async () => { if (process.env.DUMP_SERVER_LOG) console.log(srv.log().split('\n').slice(-60).join('\n')); srv?.proc.kill(); await sql?.end(); });

describe('퇴사 처리·인수인계·복직', () => {
  test('인수인계 요약: 항목별 개수(완료 업무 제외)·받을 사람 후보(본인·퇴사자 제외)', async () => {
    const s = await ctx.owner.ok('GET', `/api/admin/users/${P.gone.id}/handover`);
    const by = Object.fromEntries(s.items.map((i) => [i.key, i.count]));
    assert.deepEqual([by.tasks, by.requested, by.contacts, by.leads, by.approvals], [1, 1, 1, 0, 0]);
    assert.ok(s.candidates.some((c) => c.id === ctx.staffA.id) && !s.candidates.some((c) => c.id === P.gone.id));
    assert.equal((await ctx.staffA.client.req('GET', `/api/admin/users/${P.gone.id}/handover`)).status, 404, '권한 없는 직원');
  });

  test('퇴사 처리(날짜) + 바로 인수인계: 상태 퇴사(날짜)·세션 만료(401)·팀·대화방 제거·요금제 인원 제외·업무/연락처 이전·감사 기록, 본인·마지막 대표 불가', async () => {
    assert.equal((await ctx.owner.req('POST', `/api/admin/users/${ctx.ownerId}/leave`, {})).status, 400, '본인 불가');
    const r = await ctx.owner.ok('POST', `/api/admin/users/${P.gone.id}/leave`, { date: '2026-10-20', toUserId: ctx.staffA.id, items: ['tasks', 'requested', 'contacts'] });
    assert.deepEqual([r.leftAt, r.rejoinUntil], ['2026-10-20', '2026-11-19']);
    assert.deepEqual(r.handover.counts, { tasks: 1, requested: 1, contacts: 1 });
    assert.equal((await P.gone.c.req('GET', '/api/auth/me')).status, 401, '세션 만료·로그인 차단');
    const u = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.id === P.gone.id);
    assert.deepEqual([u.status, u.left_at, u.rejoin_until, u.handover_to], ['left', '2026-10-20', '2026-11-19', ctx.staffA.id]);
    assert.equal((await sql`select 1 from team_members where user_id = ${P.gone.id}`).length, 0, '팀에서 빠짐');
    assert.equal((await sql`select 1 from chat_members where user_id = ${P.gone.id}`).length, 0, '대화방에서 빠짐(메신저 자동 제거)');
    assert.ok((await sql`select 1 from chat_messages where room_id = ${P.room} and kind = 'system' and body like '%퇴사예정님이 퇴사하여 나갔습니다%'`).length, '방에 시스템 메시지');
    assert.equal((await sql`select owner_id from chat_rooms where id = ${P.room}`)[0].owner_id, ctx.ownerId, '방장이 퇴사하면 남은 사람에게');
    const [t1] = await sql`select assignee_id from tasks where id = ${P.t1}`; const [t2] = await sql`select requested_by from tasks where id = ${P.t2}`; const [t3] = await sql`select assignee_id from tasks where id = ${P.t3}`;
    assert.deepEqual([t1.assignee_id, t2.requested_by, t3.assignee_id], [ctx.staffA.id, ctx.staffA.id, P.gone.id], '진행 중만 이전, 완료 업무는 그대로(기록 보존)');
    assert.equal((await sql`select count(*)::int as n from users where tenant = 'default' and status = 'active' and not is_demo`)[0].n, 4, '요금제 인원(사용 중)에서 제외 — 대표·직원 2·매니저');
    const logs = await sql`select action from audit_logs where target_id = ${P.gone.id} order by created_at`;
    assert.ok(logs.some((l) => l.action === 'user.leave') && logs.some((l) => l.action === 'user.handover'), '감사 기록');
    assert.equal((await ctx.owner.req('POST', `/api/admin/users/${P.gone.id}/leave`, {})).status, 400, '이미 퇴사');
  });

  test('남은 항목 인수인계(퇴사 뒤): 받을 사람 검증·항목 없음 400 — 복직은 30일 안에만, 복직하면 다시 사용 중', async () => {
    assert.equal((await ctx.owner.req('POST', `/api/admin/users/${P.gone.id}/handover`, { toUserId: P.gone.id, items: ['tasks'] })).status, 400);
    assert.equal((await ctx.owner.req('POST', `/api/admin/users/${P.gone.id}/handover`, { toUserId: ctx.staffA.id, items: ['nope'] })).status, 400);
    const r = await ctx.owner.ok('POST', `/api/admin/users/${P.gone.id}/handover`, { toUserId: ctx.staffB.id, items: ['events', 'projects'] });
    assert.deepEqual(r.counts, { events: 0, projects: 0 });
    await sql`update users set rejoin_until = '2000-01-01' where id = ${P.gone.id}`;
    assert.equal((await ctx.owner.req('POST', `/api/admin/users/${P.gone.id}/rejoin`, {})).status, 400, '기한 지남');
    await sql`update users set rejoin_until = (now() at time zone 'Asia/Seoul')::date + 5 where id = ${P.gone.id}`;
    await ctx.owner.ok('POST', `/api/admin/users/${P.gone.id}/rejoin`, {});
    const u = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.id === P.gone.id);
    assert.deepEqual([u.status, u.left_at], ['active', null]);
    const c = new Client('gone2'); await c.ok('POST', '/api/auth/login', { email: 'gone@dagym.test', password: 'gone-pass-1234' });
    assert.equal((await c.req('GET', '/api/auth/me')).status, 200, '복직 뒤 로그인');
    assert.equal((await ctx.owner.req('POST', `/api/admin/users/${P.gone.id}/rejoin`, {})).status, 400, '퇴사 상태가 아니면 400');
  });
});
