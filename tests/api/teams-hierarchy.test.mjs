// R-16 팀 권한 계층(상위 팀 = 하위 팀 전체 권한, 하위 팀 → 상위 팀 비공개) · 다른 회사 팀 업무 차단 / R-15 체크리스트 항목 담당·처리 속도
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const D = {};
const today = seoulToday();
before(async () => {
  await resetDb();
  srv = await startServer();
  sql = testDb();
  ctx = await bootstrap();
  for (const [k, name, unit] of [['hqA', '본사직원', ctx.hq], ['opsA', '운영팀장', ctx.siteA]]) {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: `${k}@dagym.test`, name, role: 'staff', orgUnitIds: [unit] });
    const c = new Client(k); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${k}-pass-1234` });
    D[k] = { c, id: (await c.ok('GET', '/api/auth/me')).user.id };
  }
  D.hqTeam = (await ctx.owner.ok('POST', '/api/teams', { name: '본사팀', members: [{ userId: D.hqA.id, lead: true }] })).id;
  D.opsTeam = (await ctx.owner.ok('POST', '/api/teams', { name: '운영관리팀', parentId: D.hqTeam, members: [{ userId: D.opsA.id, lead: true }, { userId: ctx.staffA.id, lead: false }] })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('R-16 팀 권한 계층', () => {
  test('상위 팀(본사팀)은 하위 팀 업무를 보고·고치고·배정, 하위 팀은 상위 팀 업무 404', async () => {
    const tOps = (await D.opsA.c.ok('POST', '/api/tasks', { title: '운영 점검 업무', orgUnitId: ctx.siteA, teamId: D.opsTeam, teamMode: 'tag', assigneeId: D.opsA.id, approvalRequired: false })).id;
    const tHq = (await D.hqA.c.ok('POST', '/api/tasks', { title: '본사 기획 업무', orgUnitId: ctx.hq, teamId: D.hqTeam, teamMode: 'tag', assigneeId: D.hqA.id, approvalRequired: false })).id;
    assert.equal((await D.hqA.c.ok('GET', `/api/tasks/${tOps}`)).task.title, '운영 점검 업무');
    const d = await D.hqA.c.ok('GET', `/api/tasks/${tOps}`);
    await D.hqA.c.ok('PATCH', `/api/tasks/${tOps}`, { title: '운영 점검 업무(본사 수정)', version: d.task.version });
    const d2 = await D.hqA.c.ok('GET', `/api/tasks/${tOps}`);
    await D.hqA.c.ok('PATCH', `/api/tasks/${tOps}`, { assigneeId: ctx.staffA.id, version: d2.task.version });
    assert.equal((await sql`select assignee_id from tasks where id = ${tOps}`)[0].assignee_id, ctx.staffA.id, '상위 팀 구성원이 재배정');
    assert.ok((await D.hqA.c.ok('GET', `/api/tasks?teamId=${D.opsTeam}`)).tasks.some((t) => t.id === tOps));
    // 하위 팀 → 상위 팀 비공개 (같은 본사 소속 조직이라도)
    for (const c of [D.opsA.c, ctx.staffA.client]) {
      assert.equal((await c.get(`/api/tasks/${tHq}`)).status, 404);
      assert.ok(!(await c.ok('GET', '/api/tasks?view=all')).tasks.some((t) => t.id === tHq));
      assert.equal(JSON.stringify(await c.ok('GET', `/api/search?q=${encodeURIComponent('본사 기획')}`)).includes(tHq), false);
    }
  });
  test('상위 팀 순환 금지', async () => {
    assert.equal((await ctx.owner.req('PATCH', `/api/teams/${D.hqTeam}`, { parentId: D.opsTeam })).status, 400);
    assert.equal((await ctx.owner.req('PATCH', `/api/teams/${D.hqTeam}`, { parentId: D.hqTeam })).status, 400);
  });
  test('다른 회사의 팀 업무는 "다른 팀 업무 보기" 권한이 있어도 404·목록 제외', async () => {
    await sql`insert into tenants (id, name) values ('t_other', '남의회사') on conflict do nothing`;
    const [o] = await sql`insert into org_units (type, name, tenant) values ('hq', '남의본사', 't_other') returning id`;
    const [tm] = await sql`insert into teams (tenant, name, color) values ('t_other', '남의팀', '#000000') returning id`;
    const [t] = await sql`insert into tasks (title, org_unit_id, team_id, created_by, status, priority) values ('남의 팀 업무', ${o.id}, ${tm.id}, ${ctx.ownerId}, 'todo', 'normal') returning id`
      .catch(async () => sql`insert into tasks (title, org_unit_id, team_id, created_by) values ('남의 팀 업무', ${o.id}, ${tm.id}, ${(await sql`select id from users where email = 'hqA@dagym.test'`)[0].id}) returning id`);
    // 만든 사람이 아닌 우리 회사 관리자로 확인
    const adm = await ctx.owner.ok('POST', '/api/admin/users', { email: 'adm2@dagym.test', name: '관리자2', role: 'admin', orgUnitIds: [] });
    const a = new Client('adm2'); await a.ok('POST', `/api/invitations/${adm.path.split('/').pop()}/accept`, { password: 'adm2-pass-1234' });
    assert.equal((await a.get(`/api/tasks/${t.id}`)).status, 404);
    assert.ok(!(await a.ok('GET', '/api/tasks?view=all')).tasks.some((x) => x.id === t.id));
  });
});

describe('R-15 체크리스트 항목 담당 · 처리 속도', () => {
  test('항목 담당자에게 업무가 보이고 "내 업무"에 내 몫으로, 다른 회사 사람은 지정 불가', async () => {
    const tk = (await ctx.owner.ok('POST', '/api/tasks', { title: '항목 나눠 하기', orgUnitId: ctx.siteB, assigneeId: ctx.ownerId, approvalRequired: false })).id;
    assert.equal((await ctx.managerA.client.get(`/api/tasks/${tk}`)).status, 404, '배정 전에는 못 봄(다른 현장)');
    const it = (await ctx.owner.ok('POST', `/api/tasks/${tk}/checklist`, { text: '자재 확인', assigneeId: ctx.managerA.id })).id;
    const my = (await ctx.managerA.client.ok('GET', '/api/tasks?view=my')).tasks.find((t) => t.id === tk);
    assert.ok(my && my.my_items === 1, '내 업무에 내 몫 1개');
    assert.equal((await ctx.managerA.client.ok('GET', `/api/tasks/${tk}`)).checklist[0].assignee_name, '최매니저');
    await ctx.managerA.client.ok('PATCH', `/api/checklist/${it}`, { done: true });
    assert.ok(!(await ctx.managerA.client.ok('GET', '/api/tasks?view=my')).tasks.some((t) => t.id === tk), '내 몫을 끝내면 내 업무에서 빠짐');
    const [o] = await sql`select id from users where email = 'ceo@dagym.test'`;
    await sql`insert into users (email, name, role, status, tenant) values ('x@other.test', '남', 'staff', 'active', 't_other') on conflict do nothing`;
    const [x] = await sql`select id from users where email = 'x@other.test'`;
    assert.equal((await ctx.owner.req('PATCH', `/api/checklist/${it}`, { assigneeId: x.id })).status, 403);
    assert.ok(o);
  });
  test('처리 속도: 완료 업무로 중앙값·지연 비율, 업무 상세에 예상 처리 기간', async () => {
    const t1 = (await ctx.owner.ok('POST', '/api/tasks', { title: '속도 1', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, -1), approvalRequired: false })).id;
    await sql`update tasks set created_at = now() - interval '3 days' where id = ${t1}`;
    const v = (await ctx.staffA.client.ok('GET', `/api/tasks/${t1}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t1}`, { status: 'done', version: v });
    const sp = (await ctx.owner.ok('GET', '/api/insights/speed')).people.find((p) => p.user_id === ctx.staffA.id);
    assert.ok(sp && sp.done >= 1 && sp.median_days >= 2.9 && sp.late_rate === 100);
    const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '속도 2', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    assert.ok((await ctx.owner.ok('GET', `/api/tasks/${t2}`)).speed.median_days >= 2.9);
  });
});

describe('V14 20번 완료 해지', () => {
  test('담당자·지시자는 완료를 다시 진행으로, 그 외는 403', async () => {
    const tk = (await ctx.owner.ok('POST', '/api/tasks', { title: '해지 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    let v = (await ctx.staffA.client.ok('GET', `/api/tasks/${tk}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${tk}`, { status: 'done', version: v });
    v = (await ctx.owner.ok('GET', `/api/tasks/${tk}`)).task.version;
    assert.equal((await ctx.managerA.client.req('PATCH', `/api/tasks/${tk}`, { status: 'in_progress', version: v })).status, 403, '지시자도 담당자도 아니면 불가');
    await ctx.owner.ok('PATCH', `/api/tasks/${tk}`, { status: 'in_progress', version: v }); // 지시자(만든 사람)
    assert.equal((await sql`select status from tasks where id = ${tk}`)[0].status, 'in_progress');
    v = (await ctx.staffA.client.ok('GET', `/api/tasks/${tk}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${tk}`, { status: 'done', version: v });
    v = (await ctx.staffA.client.ok('GET', `/api/tasks/${tk}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${tk}`, { status: 'in_progress', version: v }); // 담당자
  });
});
