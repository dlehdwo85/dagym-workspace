// R-16 팀 권한 계층(상위 팀 = 하위 팀 전체 권한, 하위 팀 → 상위 팀 비공개) · 다른 회사 팀 업무 차단 / R-15 체크리스트 항목 담당·처리 속도
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, seoulToday, addDays, BASE } from '../helpers.mjs';

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
  D.opsTeam = (await ctx.owner.ok('POST', '/api/teams', { name: '운영관리팀', parentId: D.hqTeam, isolated: false /* R-16 계층만 시험(격리는 team-isolation.test) */, members: [{ userId: D.opsA.id, lead: true }, { userId: ctx.staffA.id, lead: false }] })).id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('R-16 팀 권한 계층', () => {
  test('상위 팀(본사팀)은 하위 팀 업무를 보기만(V14 50: 수정·배정은 요청자·담당자), 하위 팀은 상위 팀 업무 404', async () => {
    const tOps = (await D.opsA.c.ok('POST', '/api/tasks', { title: '운영 점검 업무', orgUnitId: ctx.siteA, teamId: D.opsTeam, teamMode: 'tag', assigneeId: D.opsA.id, approvalRequired: false })).id;
    const tHq = (await D.hqA.c.ok('POST', '/api/tasks', { title: '본사 기획 업무', orgUnitId: ctx.hq, teamId: D.hqTeam, teamMode: 'tag', assigneeId: D.hqA.id, approvalRequired: false })).id;
    assert.equal((await D.hqA.c.ok('GET', `/api/tasks/${tOps}`)).task.title, '운영 점검 업무');
    const d = await D.hqA.c.ok('GET', `/api/tasks/${tOps}`);
    assert.equal((await D.hqA.c.req('PATCH', `/api/tasks/${tOps}`, { title: '운영 점검 업무(본사 수정)', version: d.task.version })).status, 403, '상위 팀이라도 요청자·담당자가 아니면 수정 불가');
    assert.equal((await D.hqA.c.req('PATCH', `/api/tasks/${tOps}`, { assigneeId: ctx.staffA.id, version: d.task.version })).status, 403);
    await D.opsA.c.ok('PATCH', `/api/tasks/${tOps}`, { title: '운영 점검 업무(담당 수정)', version: d.task.version });
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
  test('V14 50: 완료를 다시 진행으로 = 담당자만(요청자·그 외 403)', async () => {
    const tk = (await ctx.owner.ok('POST', '/api/tasks', { title: '해지 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    let v = (await ctx.staffA.client.ok('GET', `/api/tasks/${tk}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${tk}`, { status: 'done', version: v });
    v = (await ctx.owner.ok('GET', `/api/tasks/${tk}`)).task.version;
    assert.equal((await ctx.managerA.client.req('PATCH', `/api/tasks/${tk}`, { status: 'in_progress', version: v })).status, 403, '요청자도 담당자도 아니면 불가');
    assert.equal((await ctx.owner.req('PATCH', `/api/tasks/${tk}`, { status: 'in_progress', version: v })).status, 403, '요청자(만든 대표)도 상태 변경 불가');
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${tk}`, { status: 'in_progress', version: v }); // 담당자
  });
});

describe('V14 28번 검토 요청 → 요청자 검토 업무', () => {
  const rv = async (id) => (await sql`select id, title, status, assignee_id, due_date, deleted_at from tasks where review_of = ${id}`)[0];
  test('생성·승인으로 자동 완료·다시 요청하면 다시 열기(중복 없음)·반려·삭제 정리·요청자=담당자면 없음', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '계약서 정리', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'review' });
    let r = await rv(t);
    assert.equal(r.title, '[검토] 계약서 정리'); assert.equal(r.assignee_id, ctx.ownerId); assert.equal(r.status, 'todo');
    const d = await ctx.owner.ok('GET', `/api/tasks/${r.id}`);
    assert.equal(d.reviewTarget.id, t); assert.equal(d.reviewTarget.status, 'review');
    assert.ok((await ctx.owner.ok('GET', '/api/tasks?view=my')).tasks.some((x) => x.id === r.id), '요청자의 내 업무에 보임');
    // 반려 → 검토 업무 자동 완료
    await ctx.owner.ok('PATCH', `/api/tasks/${t}`, { status: 'in_progress', reviewNote: '서명란 확인' });
    assert.equal((await rv(t)).status, 'done');
    // 다시 요청 → 같은 검토 업무를 다시 연다
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'review' });
    const again = await rv(t);
    assert.equal(again.id, r.id); assert.equal(again.status, 'todo');
    assert.equal((await sql`select count(*)::int n from tasks where review_of = ${t}`)[0].n, 1);
    // 승인 → 원 업무 완료, 검토 업무 완료
    await ctx.owner.ok('PATCH', `/api/tasks/${t}`, { status: 'done' });
    assert.equal((await rv(t)).status, 'done');
    // 원 업무 삭제 → 열린 검토 업무도 삭제
    const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '삭제될 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t2}`, { status: 'review' });
    await ctx.owner.ok('DELETE', `/api/tasks/${t2}`);
    assert.ok((await rv(t2)).deleted_at, '검토 업무도 정리');
    // 요청자 = 담당자 → 만들지 않음
    const t3 = (await ctx.owner.ok('POST', '/api/tasks', { title: '내가 할 일', assigneeId: ctx.ownerId, approvalRequired: false })).id;
    await ctx.owner.ok('PATCH', `/api/tasks/${t3}`, { status: 'review' });
    assert.equal(await rv(t3), undefined);
    // 검토 업무의 마감: 원 업무 마감이 더 빠르면 그 날
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    const t4 = (await ctx.owner.ok('POST', '/api/tasks', { title: '오늘 마감', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: today, approvalRequired: false })).id;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t4}`, { status: 'review' });
    assert.equal((await rv(t4)).due_date, today);
  });
});

describe('검수 3·12번 알림 정리', () => {
  test('검토 요청 알림은 요청자에게만(승인권 있는 관리자 제외)', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '알림 대상 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: true })).id;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'review' });
    const to = (await sql`select user_id from notifications where entity_id = ${t} and type = 'review_requested'`).map((r) => r.user_id);
    assert.deepEqual(to, [ctx.ownerId]);
  });
  test('시각 있는 오늘 마감 업무는 "오늘 마감" 대신 시각 알림 1건만', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
    const timed = (await ctx.owner.ok('POST', '/api/tasks', { title: '시각 있는 오늘 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: today, dueTime: '23:45' })).id;
    const plain = (await ctx.owner.ok('POST', '/api/tasks', { title: '날짜만 오늘 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: today })).id;
    await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } });
    const n = async (id) => (await sql`select title from notifications where entity_id = ${id} and user_id = ${ctx.staffA.id} and title like '오늘 마감:%'`).length;
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date()));
    assert.equal(await n(timed), 0, '오늘 22:45 에 울리는 시각 알림이 있으므로 "오늘 마감" 생략');
    if (hour >= 9 && hour < 23) assert.equal(await n(plain), 1, '날짜만 있는 업무는 "오늘 마감" 1건');
    const r = await ctx.staffA.client.ok('GET', '/api/reminders/upcoming');
    assert.ok(!(r.reminders ?? []).some((x) => x.link === `/tasks/${timed}` && /^오늘 마감/.test(x.title)), '휴대폰 예약에도 "오늘 마감" 없음');
  });
});

describe('검수 20 등록 창 마지막 설정(사용자 단위)', () => {
  test('저장·읽기, 본인 것만', async () => {
    assert.equal((await ctx.staffA.client.ok('GET', '/api/me/quick-last')).last, null);
    await ctx.staffA.client.ok('PUT', '/api/me/quick-last', { assigneeId: ctx.managerA.id, priority: 'high', remind: [30], projectId: '' });
    const l = (await ctx.staffA.client.ok('GET', '/api/me/quick-last')).last;
    assert.equal(l.assigneeId, ctx.managerA.id); assert.equal(l.priority, 'high'); assert.deepEqual(l.remind, [30]);
    assert.equal((await ctx.managerA.client.ok('GET', '/api/me/quick-last')).last, null, '다른 사람 값은 안 보임');
    assert.equal((await ctx.staffA.client.req('PUT', '/api/me/quick-last', { priority: 'x' })).status, 400);
  });
});

describe('대표 10/22 팀 소속 직원의 "여러 명에게 각각"', () => {
  test('내 팀 태그(teamMode tag)가 붙어 있어도 고른 3명(본인·대표 포함) 각각 1건씩 + 팀 태그 유지 · 팀장 배정 모드(lead)도 각각으로', async () => {
    const who = [D.opsA.id, ctx.ownerId, ctx.staffA.id];
    const r = await D.opsA.c.ok('POST', '/api/tasks', { title: '팀원 각각 만들기 시험', orgUnitId: ctx.siteA, teamId: D.opsTeam, teamMode: 'tag', assigneeId: who[0], assigneeIds: who, approvalRequired: false });
    assert.equal(r.ids?.length, 3, '3건');
    const rows = await sql`select assignee_id, team_id from tasks where id = any(${r.ids}::uuid[])`;
    assert.deepEqual(rows.map((x) => x.assignee_id).sort(), [...who].sort(), '고른 사람마다 1건');
    assert.ok(rows.every((x) => x.team_id === D.opsTeam), '팀 태그 유지');
    const l = await D.opsA.c.ok('POST', '/api/tasks', { title: '팀장 모드 각각 시험', orgUnitId: ctx.siteA, teamId: D.opsTeam, teamMode: 'lead', assigneeIds: who.slice(0, 2), approvalRequired: false });
    assert.equal(l.ids?.length, 2);
    assert.deepEqual((await sql`select assignee_id from tasks where id = any(${l.ids}::uuid[])`).map((x) => x.assignee_id).sort(), who.slice(0, 2).sort());
  });
});
