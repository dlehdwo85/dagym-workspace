// 대표 10/20 오후 4) 팀 업무 보기 — 전체(team_tasks_all) / 자기 팀만 / 지정 팀(team_view_grants): 목록·건수·상세·팀 칩(visible) 이 같은 규칙, 격리 팀원은 지정 팀을 줘도 자기 팀만
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  for (const [k, name] of [['a1', '영업팀원'], ['b1', '개발팀원'], ['iso', '격리팀원']]) {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: `${k}@dagym.test`, name, role: 'staff', orgUnitIds: [ctx.hq] });
    const c = new Client(k); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${k}-pass-1234` });
    P[k] = { id: inv.userId, c };
  }
  P.dept = (await ctx.owner.ok('POST', '/api/teams', { name: '본사', members: [{ userId: ctx.ownerId, lead: true }] })).id;
  P.sales = (await ctx.owner.ok('POST', '/api/teams', { name: '영업팀', parentId: P.dept, isolated: false, members: [{ userId: P.a1.id, lead: true }] })).id;
  P.dev = (await ctx.owner.ok('POST', '/api/teams', { name: '개발팀', parentId: P.dept, isolated: false, members: [{ userId: P.b1.id, lead: true }] })).id;
  P.isoTeam = (await ctx.owner.ok('POST', '/api/teams', { name: '운영팀(격리)', parentId: P.dept, isolated: true, members: [{ userId: P.iso.id, lead: true }] })).id;
  P.tSales = (await ctx.owner.ok('POST', '/api/tasks', { title: '영업팀 업무', teamId: P.sales, orgUnitId: ctx.hq, approvalRequired: false })).id;
  P.tDev = (await ctx.owner.ok('POST', '/api/tasks', { title: '개발팀 업무', teamId: P.dev, orgUnitId: ctx.hq, approvalRequired: false })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const titles = async (c, q = '') => (await c.ok('GET', `/api/tasks?limit=100${q}`)).tasks.map((t) => t.title).filter((t) => /팀 업무$/.test(t)).sort();
const chips = async (c) => (await c.ok('GET', '/api/teams')).teams.filter((t) => t.visible).map((t) => t.name).sort();

describe('팀 업무 보기', () => {
  test('기본(자기 팀만): 자기 팀 업무·팀 칩만, 다른 팀 상세 404', async () => {
    assert.deepEqual(await titles(P.a1.c), ['영업팀 업무']);
    assert.deepEqual(await chips(P.a1.c), ['영업팀']);
    assert.equal((await P.a1.c.req('GET', `/api/tasks/${P.tDev}`)).status, 404);
    assert.deepEqual(await chips(ctx.owner), ['개발팀', '본사', '영업팀', '운영팀(격리)'], '관리자는 모든 팀');
  });

  test('지정 팀: 대표가 사람별로 팀을 고르면 그 팀 업무·칩이 보임(조회), 목록 통째로 바꿈·빈 목록이면 지움·없는 팀 403·직원은 못 바꿈', async () => {
    assert.equal((await P.a1.c.req('POST', '/api/admin/menu-perms', { userId: P.a1.id, teamIds: [P.dev] })).status, 403);
    assert.equal((await ctx.owner.req('POST', '/api/admin/menu-perms', { userId: P.a1.id, teamIds: ['00000000-0000-0000-0000-000000000009'] })).status, 403);
    await ctx.owner.ok('POST', '/api/admin/menu-perms', { userId: P.a1.id, teamIds: [P.dev] });
    assert.deepEqual(await titles(P.a1.c), ['개발팀 업무', '영업팀 업무']);
    assert.deepEqual(await chips(P.a1.c), ['개발팀', '영업팀']);
    assert.deepEqual(await titles(P.a1.c, `&teamId=${P.dev}`), ['개발팀 업무'], '팀 칩 = teamId 필터');
    const d = await P.a1.c.ok('GET', `/api/tasks/${P.tDev}`);
    assert.equal(d.perms.view, true); assert.equal(d.perms.edit, false, '지정 팀은 조회만');
    const m = await ctx.owner.ok('GET', '/api/admin/menu-perms');
    assert.deepEqual(m.teamGrants.map((g) => [g.name, g.team_name]), [['영업팀원', '개발팀']]);
    await ctx.owner.ok('POST', '/api/admin/menu-perms', { userId: P.a1.id, teamIds: [] });
    assert.deepEqual(await titles(P.a1.c), ['영업팀 업무']);
    assert.equal((await ctx.owner.ok('GET', '/api/admin/menu-perms')).teamGrants.length, 0);
  });

  test('전체: 사람별 예외로 team_tasks_all 조회 → 모든 팀 업무·칩', async () => {
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'team_tasks_all', userId: P.b1.id, level: 'view' });
    assert.deepEqual(await titles(P.b1.c), ['개발팀 업무', '영업팀 업무']);
    assert.deepEqual(await chips(P.b1.c), ['개발팀', '본사', '영업팀', '운영팀(격리)']);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'team_tasks_all', userId: P.b1.id, level: null });
    assert.deepEqual(await titles(P.b1.c), ['개발팀 업무']);
  });

  test('격리 팀원: 전체·지정 팀을 줘도 자기 팀만(격리 규칙 우선)', async () => {
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'team_tasks_all', userId: P.iso.id, level: 'view' });
    await ctx.owner.ok('POST', '/api/admin/menu-perms', { userId: P.iso.id, teamIds: [P.dev, P.sales] });
    assert.deepEqual(await titles(P.iso.c), []);
    assert.deepEqual(await chips(P.iso.c), ['운영팀(격리)']);
    assert.equal((await P.iso.c.req('GET', `/api/tasks/${P.tDev}`)).status, 404);
  });
});
