// 부서별 업무 환경(대표 10/16, 팀 = 부서): 부서를 고르지 않아도 만든 사람의 부서 업무가 되고, 같은 본사라도 다른 부서 직원에게는 안 보임.
// 부서 간 협업(다른 부서 사람에게 배정)은 참여자와 양쪽 부서장에게만, 대표는 전체, 부서 대화방은 부서원만
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  for (const [k, name] of [['mkLead', '마케팅부장'], ['mk1', '마케팅사원'], ['slLead', '영업부장'], ['sl1', '영업사원']]) {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: `${k}@dagym.test`, name, role: 'staff', orgUnitIds: [ctx.hq] });
    const c = new Client(k); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${k}-pass-1234` });
    P[k] = { c, id: (await c.ok('GET', '/api/auth/me')).user.id };
  }
  P.mk = (await ctx.owner.ok('POST', '/api/teams', { name: '마케팅부', members: [{ userId: P.mkLead.id, lead: true }, { userId: P.mk1.id, lead: false }] })).id;
  P.sl = (await ctx.owner.ok('POST', '/api/teams', { name: '영업부', members: [{ userId: P.slLead.id, lead: true }, { userId: P.sl1.id, lead: false }] })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const sees = async (c, id) => (await c.get(`/api/tasks/${id}`)).status === 200;
const inList = async (c, id) => (await c.ok('GET', '/api/tasks?view=all')).tasks.some((t) => t.id === id);

describe('부서별 업무 환경', () => {
  test('부서를 안 골라도 내 부서 업무 → 같은 본사라도 다른 부서 직원은 목록·상세 모두 안 보임, 부서원·부서장·대표는 보임', async () => {
    const t = (await P.mk1.c.ok('POST', '/api/tasks', { title: '가을 캠페인 시안', assigneeId: P.mk1.id, approvalRequired: false })).id;
    assert.equal((await sql`select team_id from tasks where id = ${t}`)[0].team_id, P.mk, '만든 사람의 부서');
    for (const who of [P.mkLead.c, ctx.owner]) { assert.ok(await sees(who, t)); assert.ok(await inList(who, t)); }
    assert.ok(!(await sees(P.sl1.c, t)), '다른 부서 직원 404'); assert.ok(!(await inList(P.sl1.c, t)));
    assert.ok(!(await sees(P.slLead.c, t)), '다른 부서장도 자기 부서원 관련이 아니면 안 보임');
    // 하위 업무는 상위 업무의 부서
    const sub = (await P.mk1.c.ok('POST', '/api/tasks', { title: '시안 1차', parentId: t, assigneeId: P.mk1.id, approvalRequired: false })).id;
    assert.equal((await sql`select team_id from tasks where id = ${sub}`)[0].team_id, P.mk);
  });
  test('부서 간 협업: 마케팅 → 영업사원 배정 = 담당자·양쪽 부서장 보임, 영업부 다른 직원·마케팅 다른 직원은 부서 규칙대로', async () => {
    const t = (await P.mkLead.c.ok('POST', '/api/tasks', { title: '영업 자료 요청', assigneeId: P.sl1.id, approvalRequired: false })).id;
    assert.equal((await sql`select team_id from tasks where id = ${t}`)[0].team_id, P.mk, '지시한 쪽 부서');
    assert.ok(await sees(P.sl1.c, t), '담당자'); assert.ok(await sees(P.slLead.c, t), '담당자의 부서장'); assert.ok(await inList(P.slLead.c, t));
    assert.ok(await sees(P.mk1.c, t), '마케팅 부서원(부서 업무)');
  });
  test('부서 없음(teamId: null)을 고르면 예전처럼 같은 조직 사람에게 보임', async () => {
    const t = (await P.mk1.c.ok('POST', '/api/tasks', { title: '본사 공용 비품 정리', teamId: null, assigneeId: P.mk1.id, approvalRequired: false })).id;
    assert.equal((await sql`select team_id from tasks where id = ${t}`)[0].team_id, null);
    assert.ok(await sees(P.sl1.c, t), '같은 본사 직원');
  });
  test('부서 대화방: 부서를 만들면 부서원만 있는 대화방', async () => {
    const rooms = (await P.mk1.c.ok('GET', '/api/chat/rooms')).rooms;
    assert.ok(rooms.some((r) => r.name === '마케팅부'), '마케팅 대화방');
    assert.ok(!(await P.sl1.c.ok('GET', '/api/chat/rooms')).rooms.some((r) => r.name === '마케팅부'), '영업사원은 마케팅 대화방 없음');
  });
});
