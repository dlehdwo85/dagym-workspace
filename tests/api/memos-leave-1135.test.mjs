// #1135 2단계(대표 11/23 위임): 퇴사 처리 연동
// ① 인수인계 '공유한 메모' = 그 사람이 만든 메모 중 볼 사람이 있는 것만 받는 사람이 만든 사람이 됨(나만 보는 메모는 넘기지 않음)
// ② 그 사람이 볼 수 있던 주요 메모(만든 것·사람 공유·부서 공유) → 맡을 사람(만든 사람 → 인수자 → 처리한 관리자)별 '비밀번호 바꾸기' 업무 1건, 메모는 체크리스트 한 줄씩 — 값은 넣지 않음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx; const M = {};
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('퇴사 처리: 공유한 메모는 인수자에게, 나만 보는 메모는 그대로 · 볼 수 있던 주요 메모마다 맡을 사람별 비밀번호 바꾸기 업무', async () => {
  const A = ctx.staffA.client, B = ctx.staffB.client, MA = ctx.managerA.client;
  M.m1 = (await B.ok('POST', '/api/memos', { kind: 'secret', title: '세금계산서 사이트', siteUrl: 'tax.example.com', username: 'u1', password: 'PW-ONE-1135', access: [{ userId: ctx.staffA.id, level: 'view' }] })).id;
  M.n1 = (await A.ok('POST', '/api/memos', { kind: 'note', title: '거래처 응대 요령', body: '공유 메모', access: [{ userId: ctx.managerA.id, level: 'view' }] })).id;
  M.p1 = (await A.ok('POST', '/api/memos', { kind: 'note', title: '개인 메모', body: '나만' })).id;
  M.m2 = (await A.ok('POST', '/api/memos', { kind: 'secret', title: '택배 사이트', username: 'u2', password: 'PW-TWO-1135' })).id;
  M.m3 = (await MA.ok('POST', '/api/memos', { kind: 'secret', title: '지점 CCTV', siteUrl: 'https://cctv.example.com', username: 'u3', password: 'PW-THREE-1135', access: [{ unitId: ctx.siteA, level: 'view' }] })).id;
  M.other = (await B.ok('POST', '/api/memos', { kind: 'secret', title: '직원 A 가 못 보는 사이트', username: 'x', password: 'PW-X' })).id;

  const s = await ctx.owner.ok('GET', `/api/admin/users/${ctx.staffA.id}/handover`);
  assert.equal(s.items.find((x) => x.key === 'memos')?.count, 1, '인수인계 항목: 공유한 메모 1건(나만 보는 메모·주요 메모는 빼고)');

  const r = await ctx.owner.ok('POST', `/api/admin/users/${ctx.staffA.id}/leave`, { toUserId: ctx.managerA.id, items: ['memos'] });
  assert.equal(r.handover.counts.memos, 1);
  assert.deepEqual(r.passwordTasks, { tasks: 2, memos: 3 }, '주요 메모 3건(만든 것·사람 공유·부서 공유) → 맡을 사람 2명');

  const owner = async (id) => (await sql`select created_by from memos where id = ${id}`)[0].created_by;
  assert.equal(await owner(M.n1), ctx.managerA.id, '공유한 메모는 인수자가 만든 사람');
  assert.equal(await owner(M.p1), ctx.staffA.id, '나만 보는 메모는 넘기지 않음');
  assert.equal(await owner(M.m2), ctx.staffA.id, '나만 보는 주요 메모도 넘기지 않음(업무로 사이트 비밀번호만 바꾸게)');
  assert.equal((await sql`select count(*)::int n from memo_access where memo_id = ${M.n1} and user_id = ${ctx.managerA.id}`)[0].n, 0, '만든 사람이 된 사람의 따로 둔 줄은 정리');
  assert.equal((await MA.req('GET', `/api/memos/${M.n1}`)).status, 200);

  const tasks = await sql`select t.id, t.assignee_id, t.title, t.priority, t.description,
      (select json_agg(ci.text order by ci.sort) from task_checklist_items ci where ci.task_id = t.id) items
    from tasks t where t.title like '[보안] 퇴사한%' and t.deleted_at is null order by t.created_at`;
  const by = Object.fromEntries(tasks.map((t) => [t.assignee_id, t]));
  assert.deepEqual(by[ctx.staffB.id]?.items, ['세금계산서 사이트 (tax.example.com)'], '공유해 준 사람(만든 사람)이 맡음');
  assert.deepEqual([...(by[ctx.managerA.id]?.items ?? [])].sort(), ['지점 CCTV (https://cctv.example.com)', '택배 사이트'].sort(), '퇴사자가 만든 것은 인수자, 부서 공유는 만든 사람');
  assert.ok(tasks.every((t) => t.priority === 'high' && /이직원님이 볼 수 있던 주요 메모/.test(t.title)));
  const all = JSON.stringify(tasks);
  for (const v of ['PW-ONE-1135', 'PW-TWO-1135', 'PW-THREE-1135', 'u1', '직원 A 가 못 보는 사이트']) assert.ok(!all.includes(v), `업무에 ${v} 없음`);
  const [a] = await sql`select detail from audit_logs where action = 'memo.leave_password_tasks' order by id desc limit 1`;
  assert.deepEqual([a.detail.memos, a.detail.tasks], [3, 2]);
});

test('인수자 없이 퇴사: 퇴사자가 만든 주요 메모의 비밀번호 바꾸기는 처리한 관리자가 맡음 · 주요 메모가 없으면 업무 없음', async () => {
  const B = ctx.staffB.client;
  await B.ok('POST', '/api/memos', { kind: 'secret', title: '영업 자료 사이트', username: 'b', password: 'PW-B' });
  const r = await ctx.owner.ok('POST', `/api/admin/users/${ctx.staffB.id}/leave`, {});
  assert.equal(r.handover, null);
  assert.equal(r.passwordTasks.tasks >= 1, true);
  const [t] = await sql`select assignee_id, (select json_agg(ci.text) from task_checklist_items ci where ci.task_id = t.id) items from tasks t
    where t.title like '[보안] 퇴사한 박직원님%' order by t.created_at desc limit 1`;
  assert.equal(t.assignee_id, ctx.ownerId, '인수자가 없으면 처리한 사람');
  assert.ok(t.items.includes('영업 자료 사이트'));
  const r2 = await ctx.owner.ok('POST', `/api/admin/users/${ctx.managerA.id}/leave`, { toUserId: ctx.ownerId, items: ['memos'] });
  assert.equal(r2.passwordTasks.memos, 1, '최매니저는 자기가 만든 지점 CCTV 1건');
});
