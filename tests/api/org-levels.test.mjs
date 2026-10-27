// P2 조직 개편(대표 확정 10/26 · 로컬 #679~#681 · 16:40 ⑧): 본사 › 사업부 › 부서 › 팀 4단.
// 종류별 위 단위 규칙(본사 1곳·맨 위, 사업부는 본사 아래, 팀 아래 조직 없음) · [일반 기업 조직도로 시작] · 위는 아래 업무를 보고 아래는 위를 못 봄 ·
// '함께하는 부서'(그 부서와 위 단위가 같이 봄) · 격리 팀원도 위 단위 장에게 업무 요청(그 업무만 봄) · 장이던 곳에서 빠질 때 '장 비게 됨'과 새 장.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
const T = {};
const teams = async () => (await ctx.owner.ok('GET', '/api/teams')).teams;
const byName = async () => Object.fromEntries((await teams()).map((t) => [t.name, t]));
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  for (const [k, name] of [['hqStaff', '본사기획'], ['divLead', '사업부장'], ['salesLead', '영업부장'], ['t1Lead', '영업1팀장'], ['t1Mem', '영업1팀원'], ['t2Mem', '영업2팀원'],
    ['mktLead', '마케팅부장'], ['mktMem', '마케팅부원'], ['acct', '회계팀원']]) {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: `${k}@dagym.test`, name, role: 'staff', orgUnitIds: [ctx.hq] });
    const c = new Client(k); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${k}-pass-1234` });
    P[k] = { id: inv.userId, c };
  }
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('조직 4단: 본사 › 사업부 › 부서 › 팀', () => {
  test('[일반 기업 조직도로 시작]: 조직이 없을 때만 · 본사(만든 사람이 대표) › 경영지원부(회계팀·총무팀) · 영업부(영업1팀·영업2팀) · 마케팅부', async () => {
    const r = await ctx.owner.ok('POST', '/api/teams/template', {});
    assert.equal(r.created, 8);
    const m = await byName();
    for (const [k, v] of Object.entries(m)) T[k] = v.id;
    assert.deepEqual(['본사', '경영지원부', '회계팀', '영업부', '영업1팀', '마케팅부'].map((n) => m[n]?.kind), ['hq', 'dept', 'team', 'dept', 'team', 'dept']);
    assert.equal(m['영업1팀'].path, '본사 › 영업부 › 영업1팀');
    assert.equal(m['영업2팀'].isolated, false, '틀의 팀은 격리 꺼짐');
    assert.deepEqual(m['본사'].members.map((x) => [x.id, x.lead]), [[ctx.ownerId, true]], '본사 장 = 만든 사람');
    assert.deepEqual(m['마케팅부'].members, [], '나머지는 구성원 없이(장 없음)');
    assert.ok((await sql`select 1 from calendars where type = 'team' and team_id = ${m['영업1팀'].id}`).length, '팀 일정 캘린더도');
    assert.ok((await sql`select 1 from chat_rooms where team_id = ${m['마케팅부'].id}`).length, '대화방도');
    const again = await ctx.owner.req('POST', '/api/teams/template', {});
    assert.equal(again.status, 400, '조직이 있으면 다시 못 만듦');
    assert.equal((await P.hqStaff.c.req('POST', '/api/teams/template', {})).status, 404, '사용자 관리 편집 권한이 없으면 숨김');
  });

  test('종류 규칙(#679·#680): 본사 1곳·맨 위 · 사업부는 본사 아래 · 본사가 있으면 맨 위 부서 안 됨 · 팀 아래 조직 없음 · 아래 단위와 안 맞는 종류 변경 막기', async () => {
    const lead = (id) => [{ userId: id, lead: true }];
    assert.equal((await ctx.owner.req('POST', '/api/teams', { name: '둘째 본사', kind: 'hq', members: [] })).status, 400, '본사는 1곳');
    assert.equal((await ctx.owner.req('POST', '/api/teams', { name: '위가 있는 본사', kind: 'hq', parentId: T['본사'], members: [] })).status, 400, '본사는 맨 위');
    assert.equal((await ctx.owner.req('POST', '/api/teams', { name: '맨위사업부', kind: 'division', members: [] })).status, 400, '본사가 있으면 사업부도 본사 아래');
    assert.equal((await ctx.owner.req('POST', '/api/teams', { name: '맨위부', kind: 'dept', members: [] })).status, 400, '본사가 있으면 부서는 맨 위 안 됨');
    assert.equal((await ctx.owner.req('POST', '/api/teams', { name: '부서아래사업부', kind: 'division', parentId: T['영업부'], members: [] })).status, 400, '사업부는 본사 아래만');
    const tt = await ctx.owner.req('POST', '/api/teams', { name: '팀아래부', kind: 'dept', parentId: T['영업1팀'], members: [] });
    assert.equal(tt.status, 400); assert.match(tt.body?.error?.message ?? '', /팀 아래에는 조직을 둘 수 없습니다/);
    T['플랫폼사업부'] = (await ctx.owner.ok('POST', '/api/teams', { name: '플랫폼사업부', kind: 'division', parentId: T['본사'], members: lead(P.divLead.id) })).id;
    T['본사직속팀'] = (await ctx.owner.ok('POST', '/api/teams', { name: '본사직속팀', kind: 'team', parentId: T['본사'], members: [] })).id; // 본사·사업부 바로 아래 팀도 됨
    // 영업부를 플랫폼사업부 아래로 옮김(경로 바뀜)
    await ctx.owner.ok('PATCH', `/api/teams/${T['영업부']}`, { parentId: T['플랫폼사업부'] });
    const m = await byName();
    assert.equal(m['영업1팀'].path, '본사 › 플랫폼사업부 › 영업부 › 영업1팀', '4단 경로');
    // 아래에 팀이 있는 부서를 팀으로 바꾸면 막힘, 사업부 아래 부서를 사업부로 바꾸면(사업부는 본사 아래만) 막힘
    const toTeam = await ctx.owner.req('PATCH', `/api/teams/${T['영업부']}`, { kind: 'team' });
    assert.equal(toTeam.status, 400); assert.match(toTeam.body?.error?.message ?? '', /팀 아래에는 조직을 둘 수 없습니다/);
    assert.equal((await ctx.owner.req('PATCH', `/api/teams/${T['영업부']}`, { kind: 'division' })).status, 400);
    // 구성원이 있으면 장 1명(종류에 맞는 이름), 구성원이 없으면 장 없이 저장
    const noLead = await ctx.owner.req('PATCH', `/api/teams/${T['영업2팀']}`, { members: [{ userId: P.t2Mem.id, lead: false }] });
    assert.equal(noLead.status, 400); assert.match(noLead.body?.error?.message ?? '', /팀장을 1명 정하세요/);
    const noLeadHq = await ctx.owner.req('PATCH', `/api/teams/${T['플랫폼사업부']}`, { members: [{ userId: P.divLead.id, lead: false }] });
    assert.match(noLeadHq.body?.error?.message ?? '', /사업부장을 1명 정하세요/);
    // 아래 단위가 있으면 보관 안 됨, 잎은 보관됨
    assert.equal((await ctx.owner.req('PATCH', `/api/teams/${T['경영지원부']}`, { archived: true })).status, 400, '아래에 회계팀·총무팀');
    await ctx.owner.ok('PATCH', `/api/teams/${T['총무팀']}`, { archived: true });
    assert.equal((await ctx.owner.req('PATCH', `/api/teams/${T['본사직속팀']}`, { archived: true })).status, 200);
    // 격리는 팀만 — 부서로 만들 때 isolated:true 를 보내도 꺼짐
    const isoDept = (await ctx.owner.ok('POST', '/api/teams', { name: '격리시험부', kind: 'dept', parentId: T['본사'], isolated: true, members: [] })).id;
    assert.equal((await byName())['격리시험부'].isolated, false);
    await ctx.owner.ok('PATCH', `/api/teams/${isoDept}`, { archived: true });
  });

  test('예전 맨 위 부서는 이름만 고칠 때 그대로 저장되고, 본사로 바꾸면서 맨 위 부서를 본사 아래로 옮길 수 있음(이관)', async () => {
    // 본사가 생기기 전 규칙으로 만든 맨 위 부서(운영 데이터 모양)
    const [{ id: legacy }] = await sql`insert into teams (tenant, name, color, kind) values ('default', '예전운영부', '#475569', 'dept') returning id`;
    // 화면은 이름을 고칠 때도 종류·위 단위를 같이 보냄 — 바뀌지 않았으면 위치 검사 없이 저장
    await ctx.owner.ok('PATCH', `/api/teams/${legacy}`, { name: '예전운영부2', parentId: null, kind: 'dept', members: [] });
    // 본사를 보관하고(아래 단위는 먼저 옮겨야 하므로 직접 끔), 예전 부서를 본사로 바꾸며 맨 위 사업부·부서를 아래로
    await sql`update teams set kind = 'dept' where id = ${T['본사']}`; // 시험용: 본사를 부서로 되돌려 '본사 없는 회사' 모양
    const r = await ctx.owner.ok('PATCH', `/api/teams/${legacy}`, { kind: 'hq', parentId: null, adoptTopLevel: true });
    assert.deepEqual(r.moved, ['본사'], '맨 위에 있던 (옛) 본사 부서가 새 본사 아래로');
    assert.equal((await sql`select parent_id from teams where id = ${T['본사']}`)[0].parent_id, legacy);
    // 원래대로: 옛 본사 부서를 다시 본사로(새 본사를 부서로 바꾸고 아래로 넣은 뒤)
    await sql`update teams set parent_id = null where id = ${T['본사']}`;
    await sql`update teams set kind = 'dept', parent_id = ${T['본사']} where id = ${legacy}`;
    await ctx.owner.ok('PATCH', `/api/teams/${T['본사']}`, { kind: 'hq', parentId: null });
    await ctx.owner.ok('PATCH', `/api/teams/${legacy}`, { archived: true });
    assert.equal((await byName())['본사'].kind, 'hq');
  });

  test('구성원 배치(시험 준비): 영업1팀 격리 · 각 단위 장', async () => {
    const set = (id, members) => ctx.owner.ok('PATCH', `/api/teams/${id}`, { members });
    await set(T['본사'], [{ userId: ctx.ownerId, lead: true }, { userId: P.hqStaff.id, lead: false }]);
    await set(T['영업부'], [{ userId: P.salesLead.id, lead: true }]);
    await set(T['영업1팀'], [{ userId: P.t1Lead.id, lead: true }, { userId: P.t1Mem.id, lead: false }]);
    await ctx.owner.ok('PATCH', `/api/teams/${T['영업1팀']}`, { isolated: true });
    await set(T['영업2팀'], [{ userId: P.t2Mem.id, lead: true }]);
    await set(T['마케팅부'], [{ userId: P.mktLead.id, lead: true }, { userId: P.mktMem.id, lead: false }]);
    await set(T['회계팀'], [{ userId: P.acct.id, lead: true }]);
    const m = await byName();
    assert.equal(m['영업1팀'].isolated, true);
    assert.equal(m['경영지원부'].members.length, 0, '장 없는 부서는 구성원 0(화면에 장 없음)');
  });

  test('위 단위는 아래 단위 업무를 보고, 아래 단위는 위 단위·옆 단위 업무를 못 봄', async () => {
    P.taskT1 = (await P.t1Mem.c.ok('POST', '/api/tasks', { title: '영업1팀 제안서', teamId: T['영업1팀'], assigneeId: P.t1Mem.id, approvalRequired: false })).id;
    P.taskSales = (await P.salesLead.c.ok('POST', '/api/tasks', { title: '영업부 분기 계획', teamId: T['영업부'], assigneeId: P.salesLead.id, approvalRequired: false })).id;
    P.taskDiv = (await P.divLead.c.ok('POST', '/api/tasks', { title: '사업부 예산', teamId: T['플랫폼사업부'], assigneeId: P.divLead.id, approvalRequired: false })).id;
    const see = async (who, id) => (await who.get(`/api/tasks/${id}`)).status;
    // 영업1팀 업무: 팀장·영업부장·사업부장·본사 구성원·대표는 봄, 옆 팀·다른 부서는 못 봄
    for (const w of [P.t1Lead.c, P.salesLead.c, P.divLead.c, P.hqStaff.c, ctx.owner]) assert.equal(await see(w, P.taskT1), 200);
    for (const w of [P.t2Mem.c, P.mktMem.c, P.acct.c]) assert.equal(await see(w, P.taskT1), 404);
    // 영업부 업무: 아래(영업1팀·영업2팀)는 못 봄, 위(사업부·본사)는 봄
    for (const w of [P.t1Mem.c, P.t1Lead.c, P.t2Mem.c]) assert.equal(await see(w, P.taskSales), 404, '아래는 위를 못 봄');
    for (const w of [P.divLead.c, P.hqStaff.c]) assert.equal(await see(w, P.taskSales), 200);
    // 사업부 업무: 영업부장도 못 봄
    assert.equal(await see(P.salesLead.c, P.taskDiv), 404);
    assert.equal(await see(P.hqStaff.c, P.taskDiv), 200);
    // 목록에서도 같음
    const ids = (await P.t2Mem.c.ok('GET', '/api/tasks?view=all')).tasks.map((x) => x.id);
    assert.ok(!ids.includes(P.taskSales) && !ids.includes(P.taskT1) && !ids.includes(P.taskDiv));
  });

  test("함께하는 부서: 붙이면 그 부서와 위 단위가 같이 봄 · 장에게 알림 · 부서 목록에 · 바꾸기는 요청자·담당자 · 다른 회사·없는 부서는 400", async () => {
    const r = await P.salesLead.c.ok('POST', '/api/tasks', { title: '공동 캠페인', teamId: T['영업부'], assigneeId: P.salesLead.id, collabTeamIds: [T['마케팅부']], approvalRequired: false });
    P.joint = r.id;
    assert.equal((await P.mktMem.c.get(`/api/tasks/${P.joint}`)).status, 200, '함께하는 부서 구성원');
    assert.equal((await P.hqStaff.c.get(`/api/tasks/${P.joint}`)).status, 200, '위 단위(본사)');
    assert.equal((await P.acct.c.get(`/api/tasks/${P.joint}`)).status, 404, '상관없는 부서');
    assert.equal((await P.t2Mem.c.get(`/api/tasks/${P.joint}`)).status, 404, '주관 부서의 아래 팀은 못 봄');
    const n = await sql`select title from notifications where user_id = ${P.mktLead.id} and type = 'task_assigned' and entity_id = ${P.joint}`;
    assert.ok(n.some((x) => x.title === '함께하는 부서 업무: 공동 캠페인'), JSON.stringify(n));
    // 마케팅부 보드(목록 teamId)에도
    assert.ok((await P.mktMem.c.ok('GET', `/api/tasks?teamId=${T['마케팅부']}`)).tasks.some((x) => x.id === P.joint));
    const d = await P.mktMem.c.ok('GET', `/api/tasks/${P.joint}`);
    assert.deepEqual(d.collabTeams.map((x) => x.name), ['마케팅부']);
    assert.equal(d.orgHasTeams, true);
    assert.ok(!d.perms.edit, '함께하는 부서 구성원은 보기·댓글만');
    assert.equal((await P.mktMem.c.req('PATCH', `/api/tasks/${P.joint}`, { collabTeamIds: [] })).status, 403, '바꾸기는 요청자·담당자');
    assert.equal((await P.salesLead.c.req('PATCH', `/api/tasks/${P.joint}`, { collabTeamIds: ['00000000-0000-4000-8000-000000000000'] })).status, 400);
    // 회계팀을 더하고 마케팅부를 빼면 바로 바뀜(기록은 이름으로)
    await P.salesLead.c.ok('PATCH', `/api/tasks/${P.joint}`, { collabTeamIds: [T['회계팀']] });
    assert.equal((await P.mktMem.c.get(`/api/tasks/${P.joint}`)).status, 404, '뺀 부서는 다시 못 봄');
    assert.equal((await P.acct.c.get(`/api/tasks/${P.joint}`)).status, 200);
    const h = (await P.salesLead.c.ok('GET', `/api/tasks/${P.joint}`)).history.find((x) => x.changes?.collabTeams);
    assert.deepEqual(h.changes.collabTeams, { from: ['마케팅부'], to: ['회계팀'] });
    // 격리 팀도 함께하는 부서로 붙이면 그 팀원이 봄
    const iso = (await P.mktLead.c.ok('POST', '/api/tasks', { title: '마케팅·영업1팀 공동', teamId: T['마케팅부'], assigneeId: P.mktLead.id, collabTeamIds: [T['영업1팀']], approvalRequired: false })).id;
    assert.equal((await P.t1Mem.c.get(`/api/tasks/${iso}`)).status, 200);
    assert.ok((await P.t1Mem.c.ok('GET', '/api/tasks?view=all')).tasks.some((x) => x.id === iso));
  });

  test('하위 → 상위 업무 요청: 격리 팀원도 위 단위 장(영업부장·사업부장)을 사람 목록에서 고를 수 있고, 그 업무만 봄', async () => {
    const people = (await P.t1Mem.c.ok('GET', '/api/org')).users.map((x) => x.name);
    for (const n of ['영업부장', '사업부장', '영업1팀장', '김대표']) assert.ok(people.includes(n), `${n}: ${JSON.stringify(people)}`);
    for (const n of ['마케팅부장', '영업2팀원', '본사기획']) assert.ok(!people.includes(n), `${n} 빠져야: ${JSON.stringify(people)}`);
    const up = (await P.t1Mem.c.ok('POST', '/api/tasks', { title: '견적 승인 부탁드립니다', assigneeId: P.salesLead.id, approvalRequired: false })).id;
    assert.equal((await P.salesLead.c.get(`/api/tasks/${up}`)).status, 200, '받은 위 단위 장');
    assert.equal((await P.t1Mem.c.get(`/api/tasks/${up}`)).status, 200, '요청한 사람');
    assert.equal((await P.t1Mem.c.get(`/api/tasks/${P.taskSales}`)).status, 404, '위 단위의 다른 업무는 그대로 못 봄');
    assert.equal((await P.t1Mem.c.get(`/api/tasks/${P.taskDiv}`)).status, 404);
  });

  test('#681 장이던 곳에서 빠지면 응답에 \'장 비게 됨\' · 새 장을 같이 정하면 그 사람이 장 · 사용자 목록 소속에 종류', async () => {
    const r = await ctx.owner.ok('PATCH', `/api/admin/users/${P.t1Lead.id}`, { teamIds: [] });
    assert.deepEqual(r.leadless.map((x) => [x.name, x.kind]), [['영업1팀', 'team']]);
    assert.ok(!(await byName())['영업1팀'].members.some((x) => x.lead), '장 없음');
    await ctx.owner.ok('PATCH', `/api/admin/users/${P.t1Lead.id}`, { teamIds: [T['영업1팀']] });
    await ctx.owner.ok('PATCH', `/api/teams/${T['영업1팀']}`, { members: [{ userId: P.t1Lead.id, lead: true }, { userId: P.t1Mem.id, lead: false }] });
    const r2 = await ctx.owner.ok('PATCH', `/api/admin/users/${P.t1Lead.id}`, { teamIds: [], newLeads: [{ teamId: T['영업1팀'], userId: P.t1Mem.id }] });
    assert.deepEqual(r2.leadless, [], '새 장을 정했으니 빈 곳 없음');
    const m = (await byName())['영업1팀'];
    assert.deepEqual(m.members.map((x) => [x.name, x.lead]), [['영업1팀원', true]]);
    const u = (await ctx.owner.ok('GET', '/api/admin/users')).users.find((x) => x.id === P.t1Mem.id);
    assert.deepEqual(u.teams.map((x) => [x.name, x.kind, x.lead]), [['영업1팀', 'team', true]]);
    assert.equal((await ctx.owner.req('PATCH', `/api/admin/users/${P.t1Lead.id}`, { newLeads: [{ teamId: '00000000-0000-4000-8000-000000000000', userId: P.t1Mem.id }] })).status, 400);
  });
});
