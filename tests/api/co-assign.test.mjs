// 대표 10/23 11:30 #475 업무 공동 배정: 한 업무에 담당자 여러 명 — 첫 담당자(tasks.assignee_id) + 함께 맡는 담당자(task_assignees, 추가형)
// 대표 10/24 다시 설계: 담당자 모두 같은 무게 — 누구나 [완료] = 내 몫 완료, 남은 사람이 있으면 모두의 내 업무에 그대로, 마지막 사람이 끝내면 업무 완료
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
  assert.match((await notes(ctx.staffA.id, r.id))[0].title, /^업무 배정\(함께 담당\): 공동 점검 A/);
  assert.match((await notes(ctx.staffB.id, r.id))[0].title, /^새 업무 배정: 공동 점검 A/);
  assert.deepEqual((await acts(r.id))[0].changes.coAssigneeIds.sort(), [ctx.staffA.id, ctx.managerA.id].sort());
  const d = await ctx.staffA.client.ok('GET', `/api/tasks/${r.id}`);
  assert.equal(d.perms.co, true); assert.equal(d.perms.edit, true, '공동 담당도 내용·일정 수정');
  assert.deepEqual(d.task.co_assignees.map((c) => c.name).sort(), ['이직원', '최매니저']);
  assert.equal(d.task.assignee_done, false, '첫 담당자 내 몫 완료 전');
  assert.ok((await ctx.staffA.client.ok('GET', '/api/tasks?view=my')).tasks.some((t) => t.id === r.id), '내 업무');
  assert.ok((await ctx.owner.ok('GET', `/api/tasks?assigneeId=${ctx.managerA.id}`)).tasks.some((t) => t.id === r.id), '사람 필터');
  assert.ok((await ctx.staffA.client.ok('GET', '/api/tasks/counts')).counts.my >= 1);
  // 다른 회사 사용자는 공동 담당으로 못 넣고(400), 업무도 404
  assert.equal((await ctx.owner.req('PATCH', `/api/tasks/${r.id}`, { coAssigneeIds: [ctx.staffA.id, other.id] })).status, 400);
  assert.equal((await other.c.req('GET', `/api/tasks/${r.id}`)).status, 404);
});

test("대표 10/24: 대표가 첫 담당자여도 [완료] = 내 몫 완료(예전 '모두 완료' 규칙에 막히지 않음) · 남은 사람이 있으면 둘 다 내 업무에 그대로 · 마지막 사람이 끝내면 업무 완료·요청자 알림 · 내 몫 취소 = 그 사람 몫만 다시", async () => {
  // 예전 완료 규칙(all)을 보내도 쓰지 않음 — 대표(첫 담당자) + 이직원
  const r = await ctx.managerA.client.ok('POST', '/api/tasks', { title: '공동 점검 B', assigneeId: ctx.ownerId, coAssigneeIds: [ctx.staffA.id], orgUnitId: ctx.siteA, approvalRequired: false, completeRule: 'all' });
  const a = await ctx.owner.ok('PATCH', `/api/tasks/${r.id}`, { status: 'done', version: 999 }); // 목록이 옛 버전이어도
  assert.deepEqual([a.part, a.left, a.partsDone, a.partsTotal, a.status], ['done', ['이직원'], 1, 2, 'todo']);
  let row = (await sql`select status, assignee_done_at from tasks where id = ${r.id}`)[0];
  assert.equal(row.status, 'todo', '업무는 그대로'); assert.ok(row.assignee_done_at, '대표 몫 완료');
  assert.ok((await acts(r.id)).some((x) => x.action === 'part_done'));
  const mineOwner = (await ctx.owner.ok('GET', '/api/tasks?view=my')).tasks.find((x) => x.id === r.id);
  assert.ok(mineOwner, '내 몫을 끝내도 대표 내 업무에 남음'); assert.equal(mineOwner.assignee_done, true);
  assert.ok((await ctx.staffA.client.ok('GET', '/api/tasks?view=my')).tasks.some((x) => x.id === r.id), '이직원 내 업무에도');
  // 함께 맡은 사람도 진행 단계는 바꿀 수 있음(같은 무게) — 단계 바꾸기는 내 몫과 상관없음
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'in_progress' });
  row = (await sql`select status, assignee_done_at from tasks where id = ${r.id}`)[0];
  assert.equal(row.status, 'in_progress'); assert.ok(row.assignee_done_at, '대표 몫 그대로');
  // 다른 칸과 함께 완료를 보내면(내 몫 버튼이 아닌 길) 남은 사람 이름으로 막음
  const v0 = (await ctx.staffA.client.ok('GET', `/api/tasks/${r.id}`)).task.version;
  const blocked = await ctx.staffA.client.req('PATCH', `/api/tasks/${r.id}`, { status: 'done', title: '공동 점검 B', version: v0 });
  assert.equal(blocked.status, 409); assert.match(blocked.body.error.message, /담당자 이직원님이 아직 완료하지 않았어요/);
  // 마지막 사람(이직원)이 끝내면 업무 완료 → 요청자(최매니저) 알림, 모두의 내 업무에서 빠짐
  const last = await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.id}`, { myPart: 'done' });
  assert.equal(last.part, undefined); assert.equal(last.status, 'done');
  assert.equal((await sql`select status from tasks where id = ${r.id}`)[0].status, 'done');
  assert.ok((await notes(ctx.managerA.id, r.id)).some((n) => /^완료: 공동 점검 B/.test(n.title)), '요청자에게 완료 알림');
  for (const c of [ctx.owner, ctx.staffA.client]) assert.ok(!(await c.ok('GET', '/api/tasks?view=my')).tasks.some((x) => x.id === r.id), '모두의 내 업무에서 빠짐');
  // 이직원이 내 몫 취소 = 다시 열기 — 이직원 몫만 처음부터(대표 몫은 그대로) → 이직원 다시 완료 = 업무 완료
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.id}`, { myPart: 'open' });
  row = (await sql`select status, assignee_done_at from tasks where id = ${r.id}`)[0];
  assert.equal(row.status, 'in_progress'); assert.ok(row.assignee_done_at, '대표 몫 그대로');
  assert.equal((await sql`select done_at from task_assignees where task_id = ${r.id} and user_id = ${ctx.staffA.id}`)[0].done_at, null);
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'done' });
  assert.equal((await sql`select status from tasks where id = ${r.id}`)[0].status, 'done');
  // 완료된 업무에서 대표가 내 몫 취소 = 다시 열기(대표 몫만) → 대표가 다시 끝내면 바로 완료(이직원은 이미 끝냄)
  const back = await ctx.owner.ok('PATCH', `/api/tasks/${r.id}`, { myPart: 'open' });
  assert.equal(back.status, 'in_progress');
  row = (await sql`select status, assignee_done_at from tasks where id = ${r.id}`)[0];
  assert.equal(row.assignee_done_at, null, '대표 몫만 처음부터');
  assert.ok((await sql`select done_at from task_assignees where task_id = ${r.id} and user_id = ${ctx.staffA.id}`)[0].done_at, '이직원 몫 그대로');
  assert.equal((await ctx.owner.ok('PATCH', `/api/tasks/${r.id}`, { myPart: 'done' })).status, 'done');
  // 담당자가 아니면(요청자라도) 내 몫 완료 없음
  assert.equal((await ctx.managerA.client.req('PATCH', `/api/tasks/${r.id}`, { myPart: 'done' })).status, 403);
});

test('대표 10/24: 검토 필수 업무는 마지막 사람이 끝내면 검토 요청 → 요청자 반려 = 모두 다시 · 다시 모두 끝내면 검토 요청 → 승인 = 완료', async () => {
  const r = await ctx.managerA.client.ok('POST', '/api/tasks', { title: '공동 검토 C', assigneeId: ctx.staffA.id, coAssigneeIds: [ctx.ownerId], orgUnitId: ctx.siteA, approvalRequired: true });
  assert.equal((await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'review' })).part, 'done');
  const fin = await ctx.owner.ok('PATCH', `/api/tasks/${r.id}`, { status: 'done' });
  assert.equal(fin.status, 'review', '검토 필수 — 마지막 사람이 끝내면 검토 요청');
  let v = (await ctx.managerA.client.ok('GET', `/api/tasks/${r.id}`)).task.version;
  await ctx.managerA.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'in_progress', reviewNote: '사진 다시', version: v }); // 반려
  assert.equal((await sql`select assignee_done_at from tasks where id = ${r.id}`)[0].assignee_done_at, null, '반려 = 모두 다시');
  assert.equal((await sql`select count(*)::int n from task_assignees where task_id = ${r.id} and done_at is not null`)[0].n, 0);
  await ctx.owner.ok('PATCH', `/api/tasks/${r.id}`, { myPart: 'done' });
  assert.equal((await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.id}`, { myPart: 'done' })).status, 'review');
  v = (await ctx.managerA.client.ok('GET', `/api/tasks/${r.id}`)).task.version;
  await ctx.managerA.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'done', version: v }); // 승인
  assert.equal((await sql`select status from tasks where id = ${r.id}`)[0].status, 'done');
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
  assert.equal((await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'done' })).part, 'done'); // 대표 10/24: 담당자 모두 끝내야 완료
  const done = await ctx.staffB.client.ok('PATCH', `/api/tasks/${r.id}`, { status: 'done', version: w });
  assert.ok(done.spawned);
  assert.equal((await sql`select assignee_done_at from tasks where id = ${done.spawned}`)[0].assignee_done_at, null, '다음 회차는 처음부터');
  assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${done.spawned}`).map((x) => x.user_id).sort(), [ctx.staffA.id, ctx.managerA.id].sort());
  const dup = await ctx.owner.ok('POST', `/api/tasks/${r.id}/duplicate`, {});
  assert.equal((await sql`select count(*)::int n from task_assignees where task_id = ${dup.id}`)[0].n, 2);
});
