// 대표 10/23 11:30 #475 업무 공동 배정: 한 업무에 담당자 여러 명 — 주 담당(tasks.assignee_id) + 공동 담당(task_assignees, 추가형)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick, seoulToday, addDays, Client } from '../helpers.mjs';

let srv, ctx, sql, other;
const today = seoulToday();
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('co@other.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'co@other.test', password: 'signup-pass-1234', name: '다른대표', mode: 'team', company: '다른회사', agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  other = { c, id: (await c.ok('GET', '/api/auth/me')).user.id };
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const notes = (uid, entity) => sql`select type, title from notifications where user_id = ${uid} and entity_id = ${entity} order by created_at`;
const acts = (entity) => sql`select action, changes from activities where entity_type = 'task' and entity_id = ${entity} order by created_at`;

test('만들기 = 업무 1건(주 담당 + 공동 담당 2명) · 공동 담당에게 배정 알림 · 다른 현장 직원도 보고 내 업무·사람 필터·건수에 나옴', async () => {
  // 하이링크 현장(siteB) 업무에 강남점 직원(staffA)·매니저를 공동 담당으로 — staffA 는 원래 이 업무를 볼 수 없는 소속
  const r = await ctx.owner.ok('POST', '/api/tasks', { title: '공동 점검 A', assigneeId: ctx.staffB.id, coAssigneeIds: [ctx.staffA.id, ctx.managerA.id, ctx.staffB.id], orgUnitId: ctx.siteB, approvalRequired: false, dueDate: addDays(today, 3) });
  assert.equal((await sql`select count(*)::int n from tasks where title = '공동 점검 A'`)[0].n, 1, '한 건만');
  assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${r.id} order by added_at`).map((x) => x.user_id).sort(), [ctx.staffA.id, ctx.managerA.id].sort(), '주 담당은 공동 담당 줄에 안 들어감');
  assert.match((await notes(ctx.staffA.id, r.id))[0].title, /^업무 배정\(공동 담당\): 공동 점검 A/);
  assert.match((await notes(ctx.staffB.id, r.id))[0].title, /^새 업무 배정: 공동 점검 A/);
  assert.deepEqual((await acts(r.id))[0].changes.coAssigneeIds.sort(), [ctx.staffA.id, ctx.managerA.id].sort());
  const d = await ctx.staffA.client.ok('GET', `/api/tasks/${r.id}`);
  assert.equal(d.perms.co, true); assert.equal(d.perms.edit, true, '공동 담당도 내용·일정 수정');
  assert.deepEqual(d.task.co_assignees.map((c) => c.name).sort(), ['이직원', '최매니저']);
  assert.equal(d.task.complete_rule, 'primary');
  assert.ok((await ctx.staffA.client.ok('GET', '/api/tasks?view=my')).tasks.some((t) => t.id === r.id), '내 업무');
  assert.ok((await ctx.owner.ok('GET', `/api/tasks?assigneeId=${ctx.managerA.id}`)).tasks.some((t) => t.id === r.id), '사람 필터');
  assert.ok((await ctx.staffA.client.ok('GET', '/api/tasks/counts')).counts.my >= 1);
  // 다른 회사 사용자는 공동 담당으로 못 넣고(400), 업무도 404
  assert.equal((await ctx.owner.req('PATCH', `/api/tasks/${r.id}`, { coAssigneeIds: [ctx.staffA.id, other.id] })).status, 400);
  assert.equal((await other.c.req('GET', `/api/tasks/${r.id}`)).status, 404);
});

test("공동 담당의 [완료] = '내 몫 완료'(업무 상태 그대로) · 주 담당 완료 규칙 · '모두 완료' 규칙은 남은 사람 이름으로 막고 마지막 사람이 끝내면 주 담당에게 알림 · 다시 열면 처음부터", async () => {
  const r = await ctx.owner.ok('POST', '/api/tasks', { title: '공동 점검 B', assigneeId: ctx.staffB.id, coAssigneeIds: [ctx.staffA.id, ctx.managerA.id], orgUnitId: ctx.siteB, approvalRequired: false });
  // 공동 담당이 상태 칩에서 완료 → 내 몫 완료(업무는 진행 전 그대로)
  const p = await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'done', version: 999 });
  assert.equal(p.part, 'done');
  assert.equal((await sql`select status from tasks where id = ${r.id}`)[0].status, 'todo');
  assert.ok((await sql`select done_at from task_assignees where task_id = ${r.id} and user_id = ${ctx.staffA.id}`)[0].done_at);
  assert.ok((await acts(r.id)).some((a) => a.action === 'part_done'));
  // 공동 담당은 업무 상태(다른 칸과 함께)를 바꿀 수 없고, 주 담당은 myPart 를 못 씀
  const st = await ctx.staffA.client.req('PATCH', `/api/tasks/${r.id}`, { status: 'in_progress', title: '공동 점검 B' });
  assert.equal(st.status, 403); assert.match(st.body.error.message, /주 담당 박직원님이 바꿔요/);
  assert.equal((await ctx.staffB.client.req('PATCH', `/api/tasks/${r.id}`, { myPart: 'done' })).status, 403);
  // 완료 규칙: 공동 담당은 못 바꾸고(요청자·관리자·주 담당만) → 주 담당이 '모두 완료'로
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${r.id}`, { completeRule: 'all' })).status, 403);
  let v = (await ctx.staffB.client.ok('GET', `/api/tasks/${r.id}`)).task.version;
  await ctx.staffB.client.ok('PATCH', `/api/tasks/${r.id}`, { completeRule: 'all', version: v });
  v = (await ctx.staffB.client.ok('GET', `/api/tasks/${r.id}`)).task.version;
  const blocked = await ctx.staffB.client.req('PATCH', `/api/tasks/${r.id}`, { status: 'done', version: v });
  assert.equal(blocked.status, 409); assert.match(blocked.body.error.message, /공동 담당 최매니저님이 아직 '내 몫 완료'/);
  assert.equal((await ctx.staffB.client.req('PATCH', `/api/tasks/${r.id}`, { status: 'review', version: v })).status, 409, '검토 요청도 같은 규칙');
  // 마지막 공동 담당이 끝내면 주 담당에게 '모두 완료' 알림 → 주 담당 완료
  const last = await ctx.managerA.client.ok('PATCH', `/api/tasks/${r.id}`, { myPart: 'done' });
  assert.equal(last.part, 'done');
  assert.ok((await notes(ctx.staffB.id, r.id)).some((n) => /^공동 담당 모두 완료: 공동 점검 B/.test(n.title)));
  await ctx.staffB.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'done', version: v });
  assert.equal((await sql`select status from tasks where id = ${r.id}`)[0].status, 'done');
  // 완료된 업무: 공동 담당은 다시 열 수 없고, 주 담당이 다시 열면 내 몫 완료도 처음부터
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${r.id}`, { myPart: 'open' })).status, 403);
  v = (await ctx.staffB.client.ok('GET', `/api/tasks/${r.id}`)).task.version;
  await ctx.staffB.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'in_progress', version: v });
  assert.equal((await sql`select count(*)::int n from task_assignees where task_id = ${r.id} and done_at is not null`)[0].n, 0);
});

test('추가·빼기: 요청자·관리자만(공동 담당·주 담당 직원은 403) · 새 사람만 배정 알림, 빠진 사람은 조용히 · 활동 기록 담당 추가/빼기 · 주 담당으로 올리면 공동 담당 줄 정리 · 주 담당을 비우면 첫 공동 담당이 주 담당', async () => {
  const r = await ctx.managerA.client.ok('POST', '/api/tasks', { title: '공동 점검 C', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false });
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${r.id}`, { coAssigneeIds: [ctx.staffB.id] })).status, 403, '주 담당 직원은 못 붙임');
  await ctx.managerA.client.ok('PATCH', `/api/tasks/${r.id}`, { coAssigneeIds: [ctx.staffB.id] }); // 요청자
  assert.equal((await ctx.staffB.client.req('PATCH', `/api/tasks/${r.id}`, { coAssigneeIds: [] })).status, 403, '공동 담당은 못 뺌');
  await ctx.owner.ok('PATCH', `/api/tasks/${r.id}`, { coAssigneeIds: [ctx.ownerId] }); // 관리자(대표) — 박직원 빼고 자기 추가
  assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${r.id}`).map((x) => x.user_id), [ctx.ownerId]);
  assert.equal((await notes(ctx.staffB.id, r.id)).length, 1, '빠질 때는 알림 없음(추가될 때 1건만)');
  const a = await acts(r.id);
  assert.deepEqual(a.filter((x) => x.action === 'assignee_added').map((x) => x.changes.users), [[ctx.staffB.id], [ctx.ownerId]]);
  assert.deepEqual(a.filter((x) => x.action === 'assignee_removed').map((x) => x.changes.users), [[ctx.staffB.id]]);
  const hist = (await ctx.owner.ok('GET', `/api/tasks/${r.id}`)).history.map((h) => h.action);
  assert.ok(hist.includes('assignee_added') && hist.includes('assignee_removed'));
  // 공동 담당(대표)을 주 담당으로 → 공동 담당 줄은 트리거가 지움
  await ctx.managerA.client.ok('PATCH', `/api/tasks/${r.id}`, { assigneeId: ctx.ownerId });
  assert.equal((await sql`select count(*)::int n from task_assignees where task_id = ${r.id}`)[0].n, 0);
  // 주 담당을 비우면 공동 담당 첫 사람이 주 담당
  await ctx.managerA.client.ok('PATCH', `/api/tasks/${r.id}`, { coAssigneeIds: [ctx.staffA.id, ctx.staffB.id] });
  await ctx.managerA.client.ok('PATCH', `/api/tasks/${r.id}`, { assigneeId: null });
  assert.equal((await sql`select assignee_id from tasks where id = ${r.id}`)[0].assignee_id, ctx.staffA.id);
  assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${r.id}`).map((x) => x.user_id), [ctx.staffB.id]);
  // 각자 1건씩(assigneeIds)은 공동 담당 없이 그대로
  const each = await ctx.owner.ok('POST', '/api/tasks', { title: '각자 점검', assigneeId: ctx.staffA.id, assigneeIds: [ctx.staffA.id, ctx.staffB.id], coAssigneeIds: [ctx.managerA.id], orgUnitId: ctx.hq, approvalRequired: false });
  assert.equal(each.ids.length, 2);
  assert.equal((await sql`select count(*)::int n from task_assignees where task_id = any(${each.ids}::uuid[])`)[0].n, 0);
});

test('알림·리마인더: 마감 알림·마감일 변경·댓글이 공동 담당에게도 — 내 몫 완료하면 마감 알림 빠짐 · 기기 예약 목록·반복 다음 회차·복제에도 공동 담당', async () => {
  // 내일 09:00 마감 · 이틀 전 알림(이미 지난 시각 → 정기 실행이 바로 보냄) — 시험 시각과 상관없이 같은 결과
  const r = await ctx.owner.ok('POST', '/api/tasks', { title: '공동 마감 D', assigneeId: ctx.staffB.id, coAssigneeIds: [ctx.staffA.id, ctx.managerA.id], orgUnitId: ctx.siteB, approvalRequired: false, dueDate: addDays(today, 1), dueTime: '09:00', reminderMinutes: [2880], recurrenceRule: 'FREQ=WEEKLY' });
  await ctx.managerA.client.ok('PATCH', `/api/tasks/${r.id}`, { myPart: 'done' });
  await tick();
  const got = await sql`select user_id from notifications where entity_id = ${r.id} and type = 'due_soon'`;
  const who = new Set(got.map((x) => x.user_id));
  assert.ok(who.has(ctx.staffB.id) && who.has(ctx.staffA.id), '주 담당·공동 담당 마감 알림');
  assert.ok(!who.has(ctx.managerA.id), '내 몫 완료한 공동 담당은 빠짐');
  assert.ok((await ctx.staffA.client.ok('GET', '/api/reminders/upcoming?days=2')).reminders.some((x) => x.entityId === r.id), '기기 로컬 예약 목록');
  // 마감일 변경 알림·댓글 알림
  const v = (await ctx.owner.ok('GET', `/api/tasks/${r.id}`)).task.version;
  await ctx.owner.ok('PATCH', `/api/tasks/${r.id}`, { dueDate: addDays(today, 2), version: v });
  assert.ok((await notes(ctx.staffA.id, r.id)).some((n) => /^마감일 변경/.test(n.title)));
  await ctx.staffB.client.ok('POST', `/api/tasks/${r.id}/comments`, { body: '내일 같이 가요' });
  assert.ok((await notes(ctx.staffA.id, r.id)).some((n) => n.type === 'comment'));
  // 반복 다음 회차·복제도 같은 공동 담당
  const w = (await ctx.staffB.client.ok('GET', `/api/tasks/${r.id}`)).task.version;
  const done = await ctx.staffB.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'done', version: w });
  assert.ok(done.spawned);
  assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${done.spawned}`).map((x) => x.user_id).sort(), [ctx.staffA.id, ctx.managerA.id].sort());
  const dup = await ctx.owner.ok('POST', `/api/tasks/${r.id}/duplicate`, {});
  assert.equal((await sql`select count(*)::int n from task_assignees where task_id = ${dup.id}`)[0].n, 2);
});
