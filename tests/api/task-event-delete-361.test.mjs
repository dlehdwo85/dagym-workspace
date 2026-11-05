// 361차(대표 #977 '일정과 연동된 업무를 지우면 일정도 자연스럽게'): 업무 삭제 창 하나 — 연결된 일정 목록(기본 체크 = 이 업무가 주인인 일정) ·
// 참석자 취소 알림 · 반복 일정은 회차만(시리즈 전체는 안 지움) · 다른 업무와 함께 쓰는 일정·권한 없는 일정은 남김 ·
// 업무를 되살리면(되돌리기·휴지통·여러 건) 함께 지운 일정도 다시 · 묶음 삭제·여러 건 삭제도 같은 규칙 · 예전 앱 ?alsoEvent=1 그대로
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const at = (d, h, m = 0) => { const x = new Date(Date.now() + d * 864e5); x.setUTCHours(h, m, 0, 0); return x.toISOString(); };
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const plan = (c, id, batch) => c.ok('GET', `/api/tasks/${id}/delete-plan${batch ? '?batch=1' : ''}`);
const newTask = async (c, title, extra = {}) => (await c.ok('POST', '/api/tasks', { title, orgUnitId: ctx.hq, approvalRequired: false, ...extra })).id;
const notes = (userId, eventId, prefix) => sql`select title from notifications where user_id = ${userId} and entity_id = ${eventId} and title like ${prefix + '%'}`;

test('업무에서 만든 미팅 일정 = 기본 체크 · 함께 지우면 참석자 취소 알림 · 되살리면 일정도 다시(다시 잡힘 알림) · 체크 해제면 일정 남음 · 예전 앱 alsoEvent=1', async () => {
  const O = ctx.owner;
  const t = await newTask(O, '361 거래처 미팅', { assigneeId: ctx.staffA.id });
  const m = await O.ok('POST', `/api/tasks/${t}/meeting`, { location: '본사 회의실', start: at(2, 5), end: at(2, 6) });
  const p = await plan(O, t);
  assert.deepEqual([p.taskIds, p.subtasks], [[t], 0]);
  assert.equal(p.events.length, 1);
  const e = p.events[0];
  assert.deepEqual([e.key, e.id, e.kind, e.checked, e.disabled, e.attendees, e.occurrenceStart, e.note], [m.id, m.id, 'own', true, false, 1, null, null]);
  assert.equal(e.start, at(2, 5));

  const del = await O.ok('DELETE', `/api/tasks/${t}?events=${e.key}`);
  assert.deepEqual([del.eventsDeleted, del.eventsKept], [1, 0]);
  assert.equal((await O.req('GET', `/api/events/${m.id}`)).status, 404, '일정도 지워짐');
  assert.equal((await notes(ctx.staffA.id, m.id, '일정 취소')).length, 1, '참석자에게 일정 취소 알림');
  const [row] = await sql`select task_id, occurrence_start, restored_at from task_event_deletions where event_id = ${m.id}`;
  assert.deepEqual([row.task_id, row.occurrence_start, row.restored_at], [t, null, null]);
  assert.ok((await sql`select 1 from activities where entity_type = 'event' and entity_id = ${m.id} and action = 'deleted_with_task'`).length);

  // 업무 되살리기(되돌리기·휴지통) → 함께 지운 일정도 다시
  const back = await O.ok('POST', `/api/tasks/${t}/restore`, {});
  assert.equal(back.eventsRestored, 1);
  assert.equal((await O.ok('GET', `/api/events/${m.id}`)).event.title, '361 거래처 미팅');
  assert.equal((await notes(ctx.staffA.id, m.id, '일정 다시 잡힘')).length, 1, '참석자에게 다시 잡힘 알림');
  assert.ok((await sql`select restored_at from task_event_deletions where event_id = ${m.id}`)[0].restored_at);

  // 체크 해제(events=none) → 업무만 지움, 일정 남음 · 다시 되살려도 일정 쪽 변화 없음
  const only = await O.ok('DELETE', `/api/tasks/${t}?events=none`);
  assert.equal(only.eventsDeleted, undefined);
  await O.ok('GET', `/api/events/${m.id}`);
  assert.equal((await O.ok('POST', `/api/tasks/${t}/restore`, {})).eventsRestored, 0);
  // 주소에 아무것도 없으면 일정은 남김(예전 동작)
  await O.ok('DELETE', `/api/tasks/${t}`);
  await O.ok('GET', `/api/events/${m.id}`);
  await O.ok('POST', `/api/tasks/${t}/restore`, {});
  // 예전 앱 ?alsoEvent=1 = 기본 체크 그대로
  assert.equal((await O.ok('DELETE', `/api/tasks/${t}?alsoEvent=1`)).eventsDeleted, 1);
  assert.equal((await O.req('GET', `/api/events/${m.id}`)).status, 404);
  // 이상한 키는 무시
  const t2 = await newTask(O, '361 이상한 키');
  assert.equal((await O.ok('DELETE', `/api/tasks/${t2}?events=${encodeURIComponent("x' or 1=1,abc")}`)).eventsDeleted, undefined);
});

test('일정에서 만든 업무 = 기본 해제 · 다른 업무와 함께 쓰는 일정은 남김 · 반복 일정 전체는 고를 수 없음 · 회차에서 만든 업무는 그 회차만 지우고 되살림', async () => {
  const O = ctx.owner;
  // 일정에서 만든 업무 → 일정이 주인(기본 해제)
  const ev = await O.ok('POST', '/api/events', { title: '361 정기 점검', start: at(3, 1), end: at(3, 2) });
  const fromEv = (await O.ok('POST', `/api/events/${ev.id}/tasks`, { title: '361 점검 준비' })).id;
  let p = await plan(O, fromEv);
  assert.deepEqual(p.events.map((x) => [x.id, x.kind, x.checked, x.disabled]), [[ev.id, 'from_event', false, false]]);
  assert.match(p.events[0].note, /일정에서 만든 업무/);
  assert.equal((await O.ok('DELETE', `/api/tasks/${fromEv}?events=default`)).eventsDeleted, undefined, '기본이면 일정 남음');
  await O.ok('GET', `/api/events/${ev.id}`);
  // 이미 있던 일정에 나중에 연결한 업무도 일정이 주인
  const later = await newTask(O, '361 나중 연결');
  const ev2 = await O.ok('POST', '/api/events', { title: '361 나중 회의', start: at(3, 3), end: at(3, 4) });
  await sql`update events set created_at = now() - interval '5 minutes' where id = ${ev2.id}`;
  await sql`update tasks set created_at = now() - interval '10 minutes' where id = ${later}`;
  await O.ok('POST', `/api/events/${ev2.id}/tasks`, { taskId: later });
  assert.deepEqual((await plan(O, later)).events.map((x) => [x.kind, x.checked]), [['from_event', false]]);

  // 업무 둘이 함께 쓰는 미팅 → 남김(체크 해제), 다른 쪽 업무가 지워진 뒤면 다시 주인
  const a = await newTask(O, '361 공유 A');
  const m = await O.ok('POST', `/api/tasks/${a}/meeting`, { location: '현장', start: at(4, 1), end: at(4, 2) });
  const b = await newTask(O, '361 공유 B');
  await O.ok('POST', `/api/events/${m.id}/tasks`, { taskId: b });
  p = await plan(O, a);
  assert.deepEqual([p.events[0].kind, p.events[0].checked, p.events[0].disabled], ['shared', false, false]);
  assert.match(p.events[0].note, /다른 업무 1개에도 연결/);
  await O.ok('DELETE', `/api/tasks/${b}`);
  assert.deepEqual((await plan(O, a)).events.map((x) => [x.kind, x.checked]), [['own', true]]);

  // 반복 일정 전체에 연결 → 고를 수 없음(키를 보내도 안 지움)
  const s0 = at(5, 1), e0 = at(5, 2);
  const r = await O.ok('POST', '/api/events', { title: '361 주간 회의', start: s0, end: e0, rrule: 'FREQ=WEEKLY;COUNT=4' });
  const occ = (k) => new Date(Date.parse(s0) + k * 7 * 864e5).toISOString();
  const whole = await newTask(O, '361 주간 회의 정리');
  await O.ok('POST', `/api/events/${r.id}/tasks`, { taskId: whole });
  p = await plan(O, whole);
  assert.deepEqual([p.events[0].kind, p.events[0].disabled, p.events[0].checked], ['series', true, false]);
  assert.equal((await O.ok('DELETE', `/api/tasks/${whole}?events=${r.id}`)).eventsDeleted, undefined);
  assert.equal((await O.ok('GET', `/api/events/${r.id}`)).event.deleted_at ?? null, null);

  // 회차에서 만든 업무 → 그 회차만(체크하면), 되살리면 회차도 다시
  const occTask = (await O.ok('POST', `/api/events/${r.id}/tasks`, { title: '361 2회차 자료', occurrenceStart: occ(1) })).id;
  p = await plan(O, occTask);
  const k = p.events[0];
  assert.deepEqual([k.key, k.occurrenceStart, k.kind, k.checked, k.disabled, k.start], [`${r.id}@${occ(1)}`, occ(1), 'from_event', false, false, occ(1)]);
  assert.match(k.note, /이 회차만/);
  assert.equal((await O.ok('DELETE', `/api/tasks/${occTask}?events=${encodeURIComponent(k.key)}`)).eventsDeleted, 1);
  let x = (await sql`select exdates, deleted_at from events where id = ${r.id}`)[0];
  assert.equal(x.deleted_at, null, '시리즈는 그대로');
  assert.deepEqual((x.exdates ?? []).map((d) => new Date(d).toISOString()), [occ(1)], '그 회차만 빠짐');
  assert.equal((await O.ok('POST', `/api/tasks/${occTask}/restore`, {})).eventsRestored, 1);
  x = (await sql`select exdates from events where id = ${r.id}`)[0];
  assert.deepEqual(x.exdates ?? [], [], '회차 다시');
});

test('권한: 지울 권한 없는 일정은 고를 수 없음 · 볼 수 없는 일정은 목록에도 없음 · 볼 수 없는 업무의 계획은 404', async () => {
  const O = ctx.owner, A = ctx.staffA.client;
  const boss = await O.ok('POST', '/api/events', { title: '361 대표 일정(초대)', start: at(6, 1), end: at(6, 2), attendeeIds: [ctx.staffA.id] });
  const hidden = await O.ok('POST', '/api/events', { title: '361 대표 비공개', start: at(6, 3), end: at(6, 4), isPrivate: true });
  const mine = await newTask(A, '361 직원 업무', { assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA });
  for (const id of [boss.id, hidden.id]) await sql`insert into event_tasks (event_id, task_id, role, created_by) values (${id}, ${mine}, 'link', ${ctx.staffA.id})`;
  const p = await plan(A, mine);
  assert.deepEqual(p.events.map((e) => [e.id, e.kind, e.disabled, e.checked]), [[boss.id, 'no_perm', true, false]], '볼 수 없는 비공개 일정은 안 보임');
  assert.equal((await A.ok('DELETE', `/api/tasks/${mine}?events=${boss.id},${hidden.id}`)).eventsDeleted, undefined);
  await O.ok('GET', `/api/events/${boss.id}`);
  await O.ok('GET', `/api/events/${hidden.id}`);
  // 다른 지점 직원은 남의 업무 계획을 못 봄
  const t = await newTask(O, '361 대표 업무', { assigneeId: ctx.ownerId });
  assert.equal((await ctx.staffB.client.req('GET', `/api/tasks/${t}/delete-plan`)).status, 404);
  assert.deepEqual((await ctx.staffB.client.ok('POST', '/api/tasks/bulk', { ids: [t], action: 'plan' })).events, []);
});

test('같이 만든 묶음 지우기·여러 건 지우기도 같은 규칙 · 여러 건 되살리기면 일정도 다시', async () => {
  const O = ctx.owner;
  const r = await O.ok('POST', '/api/tasks', { title: '361 묶음 점검', orgUnitId: ctx.hq, assigneeIds: [ctx.staffA.id, ctx.managerA.id], approvalRequired: false });
  assert.equal(r.ids.length, 2);
  const m = await O.ok('POST', `/api/tasks/${r.ids[0]}/meeting`, { location: '강남점', start: at(7, 1), end: at(7, 2) });
  const sub = await newTask(O, '361 묶음 하위', { parentId: r.ids[1] });
  assert.ok(sub);
  assert.equal((await plan(O, r.ids[1])).events.length, 0, '이 업무만이면 연결 일정 없음');
  const pb = await plan(O, r.ids[1], true);
  assert.deepEqual([pb.taskIds.length, pb.subtasks], [2, 1]);
  assert.deepEqual(pb.events.map((e) => [e.id, e.checked]), [[m.id, true]]);
  const del = await O.ok('DELETE', `/api/tasks/batch/${r.batchId}?events=default`);
  assert.deepEqual([del.deleted, del.eventsDeleted], [2, 1]);
  assert.equal((await O.req('GET', `/api/events/${m.id}`)).status, 404);
  const back = await O.ok('POST', '/api/tasks/bulk', { ids: r.ids, action: 'restore' });
  assert.equal(back.eventsRestored, 1);
  await O.ok('GET', `/api/events/${m.id}`);

  // 여러 건: 지우기 전 확인(plan) → 기본 체크 일정 목록 · events:'default' 로 지움 · 없으면 일정 남김
  const pl = await O.ok('POST', '/api/tasks/bulk', { ids: r.ids, action: 'plan' });
  assert.deepEqual(pl.events.map((e) => [e.title, e.attendees]), [['361 묶음 점검', 1]]);
  const keep = await O.ok('POST', '/api/tasks/bulk', { ids: r.ids, action: 'delete' });
  assert.deepEqual([keep.done.length, keep.eventsDeleted], [2, 0]);
  await O.ok('GET', `/api/events/${m.id}`);
  await O.ok('POST', '/api/tasks/bulk', { ids: r.ids, action: 'restore' });
  const bd = await O.ok('POST', '/api/tasks/bulk', { ids: r.ids, action: 'delete', events: 'default' });
  assert.deepEqual([bd.done.length, bd.eventsDeleted], [2, 1]);
  assert.equal((await O.req('GET', `/api/events/${m.id}`)).status, 404);
});
