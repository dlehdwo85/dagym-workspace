// 대표 10/20 15:15 부서·팀 재정비: 트리(부서 › 하위 부서 › 팀, 경로·깊이), 사람의 소속 = 주 소속 1 + 겸직 n(초대·편집 '소속' 하나), 접근 조직 자동(본사), 팀 대화방 동기화
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('부서·팀 재정비(트리·주 소속)', () => {
  test('트리: 영업부 › 영업1팀, 영업부 › 수도권영업부 › 수도권1팀 — 경로·깊이·상위 경로, 순환·팀 아래 생성 금지', async () => {
    P.sales = (await ctx.owner.ok('POST', '/api/teams', { name: '영업부', kind: 'dept', members: [{ userId: ctx.managerA.id, lead: true }] })).id;
    P.s1 = (await ctx.owner.ok('POST', '/api/teams', { name: '영업1팀', parentId: P.sales, members: [{ userId: ctx.staffA.id, lead: true }] })).id;
    P.metro = (await ctx.owner.ok('POST', '/api/teams', { name: '수도권영업부', kind: 'dept', parentId: P.sales, members: [{ userId: ctx.managerA.id, lead: true }] })).id;
    P.m1 = (await ctx.owner.ok('POST', '/api/teams', { name: '수도권1팀', parentId: P.metro, members: [{ userId: ctx.staffB.id, lead: true }] })).id;
    const list = (await ctx.owner.ok('GET', '/api/teams')).teams;
    const by = Object.fromEntries(list.map((t) => [t.id, t]));
    assert.deepEqual([by[P.sales].path, by[P.sales].depth, by[P.sales].parent_path], ['영업부', 0, null]);
    assert.deepEqual([by[P.s1].path, by[P.s1].depth, by[P.s1].parent_path], ['영업부 › 영업1팀', 1, '영업부']);
    assert.deepEqual([by[P.m1].path, by[P.m1].depth, by[P.m1].parent_path], ['영업부 › 수도권영업부 › 수도권1팀', 2, '영업부 › 수도권영업부']);
    assert.deepEqual(list.map((t) => t.name), ['영업부', '수도권영업부', '수도권1팀', '영업1팀'], '경로순(트리 순서)');
    assert.equal((await ctx.owner.req('PATCH', `/api/teams/${P.sales}`, { parentId: P.metro })).status, 400, '자기 하위를 상위로 못 둠');
    assert.equal((await ctx.owner.req('POST', '/api/teams', { name: 'x', parentId: P.m1, members: [{ userId: ctx.staffA.id, lead: true }] })).status, 400, '팀 아래는 못 만듦');
  });

  test('초대: 소속(주 소속 + 겸직)만 고르고 접근 조직은 비움 → 본사 자동, 팀원·팀 대화방·주 소속 표시(users GET teams)', async () => {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'tree@dagym.test', name: '이트리', role: 'staff', teamIds: [P.s1, P.m1], primaryTeamId: P.m1 });
    const c = new Client('tree'); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'tree-pass-1234' });
    const u = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.id === inv.userId);
    assert.deepEqual(u.org_unit_ids, [ctx.hq], '접근 조직 자동 = 본사');
    assert.deepEqual(u.teams.map((t) => [t.path, t.primary]), [['영업부 › 수도권영업부 › 수도권1팀', true], ['영업부 › 영업1팀', false]], '주 소속 먼저');
    const rooms = await sql`select r.team_id from chat_members cm join chat_rooms r on r.id = cm.room_id where cm.user_id = ${inv.userId} and r.team_id is not null`;
    assert.deepEqual(rooms.map((r) => r.team_id).sort(), [P.s1, P.m1].sort(), '두 팀 대화방');
    assert.equal((await sql`select count(*)::int n from team_members where user_id = ${inv.userId} and is_primary`)[0].n, 1, '주 소속은 하나');
    // 편집: 겸직 빼고 주 소속 바꾸기 → 방에서도 빠짐
    await ctx.owner.ok('PATCH', `/api/admin/users/${inv.userId}`, { teamIds: [P.s1], primaryTeamId: P.s1 });
    const u2 = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.id === inv.userId);
    assert.deepEqual(u2.teams.map((t) => [t.path, t.primary]), [['영업부 › 영업1팀', true]]);
    assert.equal((await sql`select count(*)::int n from chat_members cm join chat_rooms r on r.id = cm.room_id where cm.user_id = ${inv.userId} and r.team_id = ${P.m1}`)[0].n, 0, '뺀 팀 대화방에서 나감');
    assert.equal((await ctx.owner.req('PATCH', `/api/admin/users/${inv.userId}`, { teamIds: ['00000000-0000-4000-8000-000000000000'] })).status, 400, '없는 팀');
    assert.equal((await ctx.owner.req('POST', '/api/admin/users', { email: 'nohq@dagym.test', name: '없음', role: 'staff', orgUnitIds: [ctx.siteA] })).status, 200, '고급: 접근 조직 직접 고르기도 그대로');
    P.tree = { id: inv.userId, c };
  });

  test('팀 편집(members)에서 소속 하나뿐인 사람은 주 소속 자동, 기존 사람 이전(migration 129 backfill 규칙)', async () => {
    const [m] = await sql`select is_primary from team_members where user_id = ${ctx.staffA.id} and team_id = ${P.s1}`;
    assert.equal(m.is_primary, true, '팀 만들 때 넣은 사람(소속 1개)은 주 소속');
    await ctx.owner.ok('PATCH', `/api/teams/${P.m1}`, { members: [{ userId: ctx.staffB.id, lead: true }, { userId: ctx.staffA.id, lead: false }] });
    const rows = await sql`select team_id, is_primary from team_members where user_id = ${ctx.staffA.id} order by is_primary desc`;
    assert.deepEqual(rows.map((r) => [r.team_id, r.is_primary]), [[P.s1, true], [P.m1, false]], '기존 주 소속 유지, 새 팀은 겸직');
    const list = (await ctx.owner.ok('GET', '/api/teams')).teams;
    assert.equal(list.find((t) => t.id === P.m1).members.find((x) => x.id === ctx.staffA.id).primary, false);
  });
});
