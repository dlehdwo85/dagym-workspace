// 로컬 10/19(대표): 부서 › 팀 2단 + 팀 격리('회사 안의 작은 회사') — 운영팀 구성원은 본사(다른 부서)의 업무·일정·사람·자료·대화방 404/없음,
// 자기 팀 것과 자기에게 배정된 것만. 팀장 = 팀 일정 편집·팀원 = 조회, 부서(상위)·대표는 전체. AI 비서 도구(list_people)도 같은 결과.
// 초대하면서 부서·팀에 넣기 + 기본 공간 제안. 격리를 끄면 예전처럼.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const P = {};
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  for (const [k, name] of [['opsLead', '운영팀장'], ['ops1', '운영팀원'], ['hqOther', '본사기획']]) {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: `${k}@dagym.test`, name, role: 'staff', orgUnitIds: [ctx.hq] });
    const c = new Client(k); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${k}-pass-1234` });
    P[k] = { id: inv.userId, c };
  }
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('부서 › 팀 2단 + 격리', () => {
  test('종류 규칙: 상위 없으면 부서·있으면 팀, 팀은 부서 아래만, 부서는 상위 없음', async () => {
    assert.equal((await ctx.owner.req('POST', '/api/teams', { name: 'x', kind: 'team', members: [{ userId: P.opsLead.id, lead: true }] })).status, 400, '팀은 부서 필요');
    P.dept = (await ctx.owner.ok('POST', '/api/teams', { name: '본사운영부', members: [{ userId: ctx.ownerId, lead: true }], defaultSpaces: ['work', 'sales'] })).id;
    assert.equal((await ctx.owner.req('POST', '/api/teams', { name: 'y', kind: 'dept', parentId: P.dept, members: [{ userId: P.opsLead.id, lead: true }] })).status, 400, '부서는 상위 없음');
    P.team = (await ctx.owner.ok('POST', '/api/teams', { name: '운영팀', parentId: P.dept, members: [{ userId: P.opsLead.id, lead: true }, { userId: P.ops1.id, lead: false }] })).id;
    assert.equal((await ctx.owner.req('POST', '/api/teams', { name: 'z', parentId: P.team, members: [{ userId: P.opsLead.id, lead: true }] })).status, 400, '팀 아래 팀 불가');
    const list = (await ctx.owner.ok('GET', '/api/teams')).teams;
    const d = list.find((t) => t.id === P.dept), t = list.find((t) => t.id === P.team);
    assert.deepEqual([d.kind, d.isolated, d.default_spaces], ['dept', false, ['work', 'sales']]);
    assert.deepEqual([t.kind, t.isolated, t.parent_name], ['team', true, '본사운영부'], '팀은 기본 격리·부서 이름');
    assert.ok((await sql`select 1 from calendars where type = 'team' and team_id = ${P.team}`).length, '팀 일정 캘린더');
  });

  test('격리: 본사 업무·일정·사람·자료·회사 전체방 없음, 자기 팀·배정된 것만, 부서·대표는 전체', async () => {
    const hqTask = (await P.hqOther.c.ok('POST', '/api/tasks', { title: '본사 기획안', teamId: null, orgUnitId: ctx.hq, assigneeId: P.hqOther.id, approvalRequired: false })).id;
    assert.equal((await P.ops1.c.get(`/api/tasks/${hqTask}`)).status, 404, '본사 업무 404');
    assert.ok(!(await P.ops1.c.ok('GET', '/api/tasks?view=all')).tasks.some((x) => x.id === hqTask));
    const mine = (await P.opsLead.c.ok('POST', '/api/tasks', { title: '운영팀 점검', assigneeId: P.ops1.id, approvalRequired: false })).id;
    assert.equal((await sql`select team_id from tasks where id = ${mine}`)[0].team_id, P.team, '팀장이 만들면 팀 업무');
    assert.equal((await P.ops1.c.get(`/api/tasks/${mine}`)).status, 200, '팀원은 팀 업무');
    assert.equal((await P.hqOther.c.get(`/api/tasks/${mine}`)).status, 404, '본사 직원은 팀 업무 못 봄');
    assert.equal((await ctx.owner.get(`/api/tasks/${mine}`)).status, 200, '대표(부서 구성원)는 봄');
    const assigned = (await ctx.owner.ok('POST', '/api/tasks', { title: '대표가 운영팀원에게', teamId: null, orgUnitId: ctx.hq, assigneeId: P.ops1.id, approvalRequired: false })).id;
    assert.equal((await P.ops1.c.get(`/api/tasks/${assigned}`)).status, 200, '자기에게 배정된 건 보임');
    // 사람: 같은 팀 + 대표·관리자 + 본인, 본사기획은 없음
    const people = (await P.ops1.c.ok('GET', '/api/org')).users.map((x) => x.name);
    assert.ok(people.includes('운영팀장') && people.includes('운영팀원') && !people.includes('본사기획'), JSON.stringify(people));
    assert.ok(people.includes('김대표'), '대표는 보임');
    // 일정: 회사·본사 조직 캘린더 없음, 팀 캘린더 있음, 본사 동료 개인 일정 없음
    const cals = (await P.ops1.c.ok('GET', '/api/calendars')).calendars;
    assert.ok(!cals.some((c) => c.type === 'company' || c.type === 'org_unit'), JSON.stringify(cals.map((c) => c.type)));
    const teamCal = cals.find((c) => c.type === 'team');
    assert.deepEqual([teamCal.name, teamCal.perms.view, teamCal.perms.edit], ['운영팀 일정', true, false], '팀원은 팀 일정 조회만');
    const leadCal = (await P.opsLead.c.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'team');
    assert.equal(leadCal.perms.edit, true, '팀장은 팀 일정 편집');
    const [cc] = await sql`select id from calendars where type = 'company' and tenant = 'default'`;
    await ctx.owner.ok('POST', '/api/events', { calendarId: cc.id, title: '본사 전체 회의', start: '2026-11-03T10:00:00+09:00', end: '2026-11-03T11:00:00+09:00' });
    const ev = (await P.opsLead.c.ok('POST', '/api/events', { calendarId: teamCal.id, title: '운영팀 주간', start: '2026-11-03T14:00:00+09:00', end: '2026-11-03T15:00:00+09:00' })).id;
    assert.equal((await P.ops1.c.req('POST', '/api/events', { calendarId: teamCal.id, title: 'x', start: '2026-11-04T14:00:00+09:00', end: '2026-11-04T15:00:00+09:00' })).status, 403, '팀원은 팀 일정 못 만듦');
    const titles = (await P.ops1.c.ok('GET', '/api/events?from=2026-11-01&to=2026-11-08')).events.map((e) => e.title);
    assert.ok(titles.includes('운영팀 주간') && !titles.includes('본사 전체 회의'), JSON.stringify(titles));
    assert.ok((await ctx.owner.ok('GET', '/api/events?from=2026-11-01&to=2026-11-08')).events.some((e) => e.id === ev), '대표는 팀 일정 봄');
    // 자료: 본사기획이 올린 파일 없음·404, 팀장이 올린 파일은 보임
    const up = async (c, name) => { const lf = await c.ok('POST', '/api/library', { fileName: name, mimeType: 'text/plain', size: 2 }); await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: 'ab' }); await c.ok('POST', `/api/library/${lf.id}/complete`); return lf.id; };
    const hqFile = await up(P.hqOther.c, '본사 규정.txt'); const teamFile = await up(P.opsLead.c, '운영팀 매뉴얼.txt');
    const files = (await P.ops1.c.ok('GET', '/api/library')).files.map((f) => f.id);
    assert.ok(files.includes(teamFile) && !files.includes(hqFile), '같은 팀 자료만');
    assert.equal((await P.ops1.c.get(`/api/library/${hqFile}`)).status, 404);
    assert.equal((await P.ops1.c.get(`/api/library/${teamFile}`)).status, 200);
    // 메시지: 회사 전체방 없음, 팀 대화방 있음, 본사기획과 1:1 불가, 팀장과는 가능, 대표와도 가능
    const rooms = (await P.ops1.c.ok('GET', '/api/chat/rooms')).rooms;
    assert.ok(!rooms.some((r) => r.kind === 'company') && rooms.some((r) => r.name === '운영팀'), JSON.stringify(rooms.map((r) => [r.kind, r.name])));
    assert.ok((await ctx.owner.ok('GET', '/api/chat/rooms')).rooms.some((r) => r.kind === 'company'), '대표는 회사 전체방');
    assert.equal((await P.ops1.c.req('POST', '/api/chat/rooms', { kind: 'dm', userId: P.hqOther.id })).status, 400);
    assert.equal((await P.ops1.c.req('POST', '/api/chat/rooms', { kind: 'dm', userId: P.opsLead.id })).status, 200);
    assert.equal((await P.ops1.c.req('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.ownerId })).status, 200);
    // AI 비서 도구 결과도 같은 규칙(list_people → 본사기획 없음)
    await queue([toolUse('t1', 'list_people', {}), say('네')]);
    const n0 = (await fakeState()).anthropic.length;
    await P.ops1.c.ok('POST', '/api/ai/chat', { text: '우리 팀 사람 누구야' });
    const reqs = (await fakeState()).anthropic.slice(n0);
    const toolResult = JSON.stringify(reqs[reqs.length - 1].body.messages);
    assert.ok(toolResult.includes('운영팀장') && !toolResult.includes('본사기획'), 'AI 도구 결과에 본사 사람 없음');
  });

  test('초대: 부서·팀에 넣기 + 기본 공간 제안, 격리 끄면 예전처럼', async () => {
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'ops2@dagym.test', name: '운영신입', role: 'staff', orgUnitIds: [ctx.hq], teamIds: [P.dept] });
    assert.ok((await sql`select 1 from team_members where team_id = ${P.dept} and user_id = ${inv.userId}`).length, '팀원으로');
    assert.deepEqual((await sql`select spaces from space_members where user_id = ${inv.userId}`)[0].spaces, ['work', 'sales'], '부서 기본 공간');
    assert.equal((await ctx.owner.req('POST', '/api/admin/users', { email: 'ops3@dagym.test', name: 'x', role: 'staff', orgUnitIds: [ctx.hq], teamIds: ['00000000-0000-4000-8000-000000000000'] })).status, 400);
    const inv2 = await ctx.owner.ok('POST', '/api/admin/users', { email: 'ops3@dagym.test', name: '운영신입2', role: 'staff', orgUnitIds: [ctx.hq], teamIds: [P.team], spaces: ['work'] });
    assert.deepEqual((await sql`select spaces from space_members where user_id = ${inv2.userId}`)[0].spaces, ['work'], '직접 고른 공간이 우선');
    // 격리 끄기 → 본사 업무 다시 보임, 회사 전체방 복귀
    await ctx.owner.ok('PATCH', `/api/teams/${P.team}`, { isolated: false });
    const [hq] = await sql`select id from tasks where title = '본사 기획안'`;
    assert.equal((await P.ops1.c.get(`/api/tasks/${hq.id}`)).status, 200);
    assert.ok((await P.ops1.c.ok('GET', '/api/chat/rooms')).rooms.some((r) => r.kind === 'company'));
    await ctx.owner.ok('PATCH', `/api/teams/${P.team}`, { isolated: true });
    assert.equal((await P.ops1.c.get(`/api/tasks/${hq.id}`)).status, 404);
  });
});
