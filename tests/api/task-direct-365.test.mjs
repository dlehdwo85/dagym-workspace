// 365차 #988(대표 11/05): 대표·부서장·팀장은 [마감 연장]·마감 바꾸기를 승인 없이 바로(사유 필수·applied 기록·요청자·담당자 알림), 일반 관리자는 빠짐(대표 확인 중)
// #989: [완료] 하나 — 자격자(요청자·대표·관리자·부서장·팀장) = 남은 몫까지 업무 완료, 그 밖 함께 담당이 finish 를 보내면 내 몫 완료로만
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays, Client } from '../helpers.mjs';

let srv, ctx, sql, admin;
const today = seoulToday();
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'admin365@dagym.test', name: '관리자365', role: 'admin', orgUnitIds: [ctx.hq] });
  const c = new Client('admin365');
  await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'admin365-pass-1234' });
  admin = { client: c, id: (await c.ok('GET', '/api/auth/me')).user.id };
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const due = async (id) => (await sql`select to_char(due_date, 'YYYY-MM-DD') d, due_extend_count n from tasks where id = ${id}`)[0];

describe('365차 #988 마감 바로 연장(대표·부서장·팀장)', () => {
  let taskId;
  before(async () => {
    // 요청자 = 최매니저(만든 사람), 담당 = 이직원 — 대표는 요청자가 아님
    taskId = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '365 연장 시험', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, dueDate: addDays(today, 2), approvalRequired: false })).id;
  });

  test('대표: 사유 필수 → 바로 연장(applied)·요청자·담당자 알림(대표 본인 제외)·연장 횟수·화면 권한 dueNow', async () => {
    const d = await ctx.owner.ok('GET', `/api/tasks/${taskId}`);
    assert.equal(d.perms.dueNow, '대표');
    assert.equal((await ctx.owner.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 4), reason: ' ' })).status, 400, '사유 없으면 400');
    const r = await ctx.owner.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 4), reason: '거래처 일정 변경' });
    assert.equal(r.applied, true); assert.equal(r.as, '대표');
    assert.deepEqual(await due(taskId), { d: addDays(today, 4), n: 1 });
    const [x] = await sql`select status, requested_by, decided_by, reason from task_due_extensions where task_id = ${taskId} order by created_at desc limit 1`;
    assert.equal(x.status, 'applied'); assert.equal(x.requested_by, ctx.ownerId); assert.equal(x.reason, '거래처 일정 변경');
    const ns = await sql`select user_id, title, body from notifications where entity_id = ${taskId} and title like '마감 연장:%'`;
    assert.deepEqual(ns.map((n) => n.user_id).sort(), [ctx.managerA.id, ctx.staffA.id].sort(), '요청자·담당자에게만');
    assert.ok(ns[0].body.endsWith(`님이 마감을 ${md(addDays(today, 2))} → ${md(addDays(today, 4))} 로 연장(거래처 일정 변경)`), ns[0].body);
    // 앞당기기도 바로(변경) — 연장 횟수는 그대로
    const r2 = await ctx.owner.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 3), reason: '앞당김 요청' });
    assert.equal(r2.applied, true);
    assert.deepEqual(await due(taskId), { d: addDays(today, 3), n: 1 });
    assert.ok((await sql`select 1 from notifications where entity_id = ${taskId} and title like '마감 변경:%' and user_id = ${ctx.staffA.id}`).length, '앞당기면 마감 변경 알림');
    assert.equal((await ctx.owner.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 3), reason: '같은 날' })).status, 400, '같은 날짜');
    // 사유 창 없이 마감만 바꾸는 PATCH 는 여전히 막힘(요청자·담당자만) — 사유 기록 길만
    assert.equal((await ctx.owner.req('PATCH', `/api/tasks/${taskId}`, { dueDate: addDays(today, 9) })).status, 403);
  });

  test('일반 관리자는 바로 연장 대상 아님(403) · 담당자는 그대로 요청 · 요청자는 바로', async () => {
    assert.equal((await admin.client.ok('GET', `/api/tasks/${taskId}`)).perms.dueNow ?? null, null);
    assert.equal((await admin.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 8), reason: '관리자' })).status, 403);
    const a = await ctx.staffA.client.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 6), reason: '자료 늦음' });
    assert.equal(a.applied, false, '담당자는 요청');
    assert.equal((await ctx.staffA.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 1), reason: '앞당김' })).status, 400, '담당자 요청은 뒤 날짜만');
    const b = await ctx.managerA.client.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 7), reason: '요청자 연장' });
    assert.equal(b.applied, true); assert.equal(b.as, '요청자');
    assert.equal((await sql`select status from task_due_extensions where task_id = ${taskId} and reason = '자료 늦음'`)[0].status, 'cancelled', '대기 요청은 정리');
    assert.ok((await sql`select 1 from notifications where entity_id = ${taskId} and title like '마감 연장:%' and user_id = ${ctx.staffA.id} and body like '%요청자 연장%'`).length, '요청자 연장도 담당자에게 알림');
  });

  test('부서장(담당자가 속한 팀의 팀장) = 바로 · 팀 업무의 팀장 = 바로 · 상관없는 직원은 못 봄(404)', async () => {
    const [team] = await sql`insert into teams (tenant, name) values ('default', '365 영업팀') returning id`;
    await sql`insert into team_members (team_id, user_id, is_lead) values (${team.id}, ${ctx.staffA.id}, false), (${team.id}, ${ctx.staffB.id}, true)`;
    const d = await ctx.staffB.client.ok('GET', `/api/tasks/${taskId}`);
    assert.equal(d.perms.dueNow, '부서장');
    const r = await ctx.staffB.client.ok('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 10), reason: '부서 일정 조정' });
    assert.equal(r.applied, true); assert.equal(r.as, '부서장');
    assert.equal((await due(taskId)).d, addDays(today, 10));
    assert.ok((await sql`select 1 from notifications where entity_id = ${taskId} and user_id = ${ctx.managerA.id} and body like '박직원님이 마감을%부서 일정 조정)'`).length);
    await sql`delete from team_members where team_id = ${team.id}`;
    assert.equal((await ctx.staffB.client.req('POST', `/api/tasks/${taskId}/extend`, { toDate: addDays(today, 11), reason: 'x' })).status, 404, '팀장이 아니면 못 봄');
  });
});

describe('365차 #989 [완료] 하나', () => {
  test('함께 담당(자격 없음)이 finish 를 보내도 내 몫 완료만 · 요청자(대표) [완료] = 남은 몫까지 업무 완료·남은 담당 알림', async () => {
    const t = await ctx.owner.ok('POST', '/api/tasks', { title: '365 완료 하나', assigneeId: ctx.managerA.id, coAssigneeIds: [ctx.staffA.id], orgUnitId: ctx.siteA, approvalRequired: false, dueDate: addDays(today, 3) });
    const p = await ctx.staffA.client.ok('PATCH', `/api/tasks/${t.id}`, { status: 'done', finish: true });
    assert.equal(p.part, 'done', '내 몫 완료');
    assert.notEqual((await sql`select status from tasks where id = ${t.id}`)[0].status, 'done', '업무는 그대로');
    assert.deepEqual(p.left, ['최매니저'], '남은 담당');
    const d = await ctx.owner.ok('GET', `/api/tasks/${t.id}`);
    assert.equal(d.perms.finish, '요청자');
    await ctx.owner.ok('PATCH', `/api/tasks/${t.id}`, { status: 'done', finish: true });
    assert.equal((await sql`select status from tasks where id = ${t.id}`)[0].status, 'done');
    assert.ok((await sql`select 1 from activities where entity_id = ${t.id} and action = 'closed_by'`).length, '남은 몫 기록');
    assert.ok((await sql`select 1 from notifications where entity_id = ${t.id} and type = 'task_closed' and user_id = ${ctx.managerA.id}`).length, '남은 담당 알림');
  });
});
