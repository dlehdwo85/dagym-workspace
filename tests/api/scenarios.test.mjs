// 필수 시나리오 API 통합 시험: 실제 next start 서버 + 실제 PostgreSQL + 가짜 Google/FCM/웹푸시 서버
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, tick, testDb, seoulToday, addDays, BASE, FAKE, FAKE_TLS, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql;
const today = seoulToday();

before(async () => {
  await resetDb();
  await ensureTls();
  fake = await startFakeGoogle();
  srv = await startServer({ FEATURE_GOOGLE_SYNC: '1' }); // 선택 모듈(Google 동기화)도 함께 시험
  sql = testDb();
  ctx = await bootstrap();
});
after(async () => {
  srv?.proc.kill();
  fake?.server.close();
  await sql?.end();
});

function weekMonday() { const d = new Date(today + 'T00:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; return addDays(today, -dow); }
const notifs = async (c) => (await c.ok('GET', '/api/notifications')).items;

describe('① 초대 → 로그인 → 허용된 현장만 조회', () => {
  test('직원은 초대 링크로 가입 후 로그인할 수 있다', async () => {
    const c = new Client('loginA');
    const r = await c.post('/api/auth/login', { email: ctx.staffA.email, password: ctx.staffA.password });
    assert.equal(r.status, 200);
    const me = await c.ok('GET', '/api/auth/me');
    assert.equal(me.user.role, 'staff');
    assert.deepEqual(me.orgUnits.map((o) => o.name), ['다짐 강남점']);
  });
  test('잘못된 비밀번호는 거부된다', async () => {
    const r = await new Client().post('/api/auth/login', { email: ctx.staffA.email, password: 'wrong-password' });
    assert.equal(r.status, 401);
  });
  test('직원의 조직 목록에는 자기 현장만 보인다', async () => {
    const dir = await ctx.staffA.client.ok('GET', '/api/org');
    assert.deepEqual(dir.orgUnits.map((o) => o.name), ['다짐 강남점']);
    const dirOwner = await ctx.owner.ok('GET', '/api/org');
    assert.ok(dirOwner.orgUnits.length >= 3);
  });
  test('초대 링크는 한 번만 쓸 수 있다', async () => {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'once@dagym.test', name: '한번', role: 'staff', orgUnitIds: [ctx.siteA] });
    const t = inv.path.split('/').pop();
    await new Client().ok('POST', `/api/invitations/${t}/accept`, { password: 'once-pass-123' });
    const r2 = await new Client().post(`/api/invitations/${t}/accept`, { password: 'again-pass-123' });
    assert.equal(r2.status, 400);
  });
});

describe('⑥ 다른 직원·현장 데이터 접근 차단 (서버 권한 검증)', () => {
  let taskA, eventA, attA;
  before(async () => {
    taskA = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '강남점 비밀 업무', orgUnitId: ctx.siteA, dueDate: addDays(today, 3) })).id;
    const cals = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars;
    const siteCal = cals.find((c) => c.type === 'org_unit');
    eventA = (await ctx.staffA.client.ok('POST', '/api/events', { calendarId: siteCal.id, title: '강남점 회의', start: `${addDays(today, 1)}T10:00:00+09:00`, end: `${addDays(today, 1)}T11:00:00+09:00` })).id;
    attA = (await ctx.staffA.client.ok('POST', '/api/attachments', { taskId: taskA, kind: 'link', url: 'https://docs.google.com/document/d/abc', docTitle: '운영 매뉴얼' })).id;
  });
  test('다른 현장 직원은 업무 상세를 볼 수 없다 (404)', async () => {
    assert.equal((await ctx.staffB.client.get(`/api/tasks/${taskA}`)).status, 404);
  });
  test('다른 현장 직원의 목록·검색에 나타나지 않는다', async () => {
    const l = await ctx.staffB.client.ok('GET', '/api/tasks?q=비밀');
    assert.equal(l.tasks.length, 0);
    const all = await ctx.staffB.client.ok('GET', '/api/tasks?view=all');
    assert.ok(!all.tasks.some((t) => t.id === taskA));
  });
  test('다른 현장 직원은 수정·댓글·첨부·삭제 불가', async () => {
    assert.equal((await ctx.staffB.client.patch(`/api/tasks/${taskA}`, { title: 'x' })).status, 404);
    assert.equal((await ctx.staffB.client.post(`/api/tasks/${taskA}/comments`, { body: 'x' })).status, 404);
    assert.equal((await ctx.staffB.client.post('/api/attachments', { taskId: taskA, kind: 'link', url: 'https://a.b' })).status, 404);
    assert.equal((await ctx.staffB.client.get(`/api/attachments/${attA}/download`)).status, 404);
    assert.equal((await ctx.staffB.client.del(`/api/tasks/${taskA}`)).status, 404);
  });
  test('다른 현장 일정은 캘린더·상세에서 보이지 않는다', async () => {
    const r = await ctx.staffB.client.ok('GET', `/api/events?from=${addDays(today, -1)}T00:00:00Z&to=${addDays(today, 5)}T00:00:00Z`);
    assert.ok(!r.events.some((e) => e.id === eventA));
    assert.equal((await ctx.staffB.client.get(`/api/events/${eventA}`)).status, 404);
  });
  test('같은 현장 관리자·대표는 볼 수 있다', async () => {
    assert.equal((await ctx.managerA.client.get(`/api/tasks/${taskA}`)).status, 200);
    assert.equal((await ctx.owner.get(`/api/tasks/${taskA}`)).status, 200);
  });
  test('직원은 관리자 API 를 쓸 수 없다', async () => {
    assert.equal((await ctx.staffA.client.get('/api/admin/users')).status, 403);
    assert.equal((await ctx.staffA.client.post('/api/admin/org-units', { name: 'x', type: 'site' })).status, 403);
    assert.equal((await ctx.managerA.client.get('/api/admin/audit')).status, 403);
  });
  test('직원은 다른 현장에 업무를 만들 수 없다', async () => {
    assert.equal((await ctx.staffA.client.post('/api/tasks', { title: 'x', orgUnitId: ctx.siteB })).status, 403);
  });
  test('외부 출처(CSRF) 요청은 거부된다', async () => {
    const r = await fetch(BASE + '/api/tasks', { method: 'POST', headers: { cookie: ctx.staffA.client.cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'csrf' }) });
    assert.equal(r.status, 403);
  });
  test('로그인하지 않으면 401', async () => {
    assert.equal((await new Client().get('/api/tasks')).status, 401);
  });
});

describe('② 등록 → 배정 → 알림 → 댓글·자료 → 검토 요청 → 최종 완료', () => {
  let id;
  test('대표가 업무를 등록·배정하면 직원에게 알림이 간다', async () => {
    id = (await ctx.owner.ok('POST', '/api/tasks', { title: 'GX 시간표 개편', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 5), approvalRequired: true })).id;
    const n = await notifs(ctx.staffA.client);
    assert.ok(n.some((x) => x.type === 'task_assigned' && x.link === `/tasks/${id}`));
  });
  test('직원 댓글 멘션 → 관리자 멘션 알림', async () => {
    await ctx.staffA.client.ok('POST', `/api/tasks/${id}/comments`, { body: `초안 올렸습니다 @[최매니저](${ctx.managerA.id}) 확인 부탁드립니다` });
    const n = await notifs(ctx.managerA.client);
    assert.ok(n.some((x) => x.type === 'mention' && x.link.startsWith(`/tasks/${id}`)));
    const own = await notifs(ctx.owner);
    assert.ok(own.some((x) => x.type === 'comment'), '작성자(대표)에게 댓글 알림');
  });
  test('다른 현장 직원은 멘션해도 알림을 받지 못한다 (권한 우회 방지)', async () => {
    const r = await ctx.staffA.client.ok('POST', `/api/tasks/${id}/comments`, { body: `@[박직원](${ctx.staffB.id}) 참고` });
    assert.deepEqual(r.mentions, []);
    assert.ok(!(await notifs(ctx.staffB.client)).some((x) => x.type === 'mention'));
  });
  test('파일 업로드(서명 URL) + 문서 링크 첨부', async () => {
    const init = await ctx.staffA.client.ok('POST', '/api/attachments', { taskId: id, kind: 'file', fileName: '시간표 초안.pdf', mimeType: 'application/pdf', size: 12 });
    const put = await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from('%PDF-1.4 abc') });
    assert.equal(put.status, 200);
    await ctx.staffA.client.ok('POST', `/api/attachments/${init.id}/complete`, {});
    await ctx.staffA.client.ok('POST', '/api/attachments', { taskId: id, kind: 'link', url: 'https://chatgpt.com/share/abc', docTitle: 'GX 분석 결과', docVersion: 'v2', docBaseDate: today, docOwner: '이직원' });
    const d = await ctx.managerA.client.ok('GET', `/api/tasks/${id}`);
    assert.equal(d.attachments.length, 2);
    const link = d.attachments.find((a) => a.kind === 'link');
    assert.equal(link.source, 'chatgpt');
    assert.equal(link.doc_version, 'v2');
    // 권한 있는 사람은 서명된 다운로드로 이동 → 실제 파일 수신
    const file = d.attachments.find((a) => a.kind === 'file');
    const dl = await ctx.managerA.client.get(`/api/attachments/${file.id}/download`);
    assert.equal(dl.status, 302);
    const content = await fetch(new URL(dl.headers.get('location'), BASE)).then((r) => r.text());
    assert.equal(content, '%PDF-1.4 abc');
  });
  test('직원은 바로 완료할 수 없고 검토 요청만 가능', async () => {
    const r = await ctx.staffA.client.patch(`/api/tasks/${id}`, { status: 'done' });
    assert.equal(r.status, 403);
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review' });
    const n = await notifs(ctx.managerA.client);
    assert.ok(n.some((x) => x.type === 'review_requested' && x.link === `/tasks/${id}`), '현장 관리자에게 검토 요청 알림');
  });
  test('관리자가 최종 완료 확인 → 직원에게 결과 알림, 이력 기록', async () => {
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'done' });
    const d = await ctx.staffA.client.ok('GET', `/api/tasks/${id}`);
    assert.equal(d.task.status, 'done');
    assert.equal(d.task.approved_by, ctx.managerA.id);
    const actions = d.history.map((h) => h.action);
    for (const a of ['created', 'review_requested', 'approved', 'file_attached', 'link_attached']) assert.ok(actions.includes(a), a);
    assert.ok((await notifs(ctx.staffA.client)).some((x) => x.type === 'review_result'));
  });
  test('동시 수정 시 오래된 버전은 409', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '버전 시험', orgUnitId: ctx.siteA })).id;
    const v = (await ctx.owner.ok('GET', `/api/tasks/${t}`)).task.version;
    await ctx.owner.ok('PATCH', `/api/tasks/${t}`, { title: '먼저 수정', version: v });
    assert.equal((await ctx.owner.patch(`/api/tasks/${t}`, { title: '늦은 수정', version: v })).status, 409);
  });
});

describe('③ 마감일 변경 → 목록·보드·캘린더 동일 반영', () => {
  test('같은 원본 데이터가 모든 보기 조회에 반영된다', async () => {
    const id = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '마감 이동 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 2) })).id;
    const newDue = addDays(today, 9);
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { dueDate: newDue });
    const list = await ctx.staffA.client.ok('GET', '/api/tasks?view=all');
    assert.equal(list.tasks.find((t) => t.id === id).due_date, newDue);
    const board = await ctx.staffA.client.ok('GET', '/api/tasks?view=my');
    assert.equal(board.tasks.find((t) => t.id === id).due_date, newDue);
    const cal = await ctx.staffA.client.ok('GET', `/api/tasks?from=${newDue}&to=${newDue}`);
    assert.ok(cal.tasks.some((t) => t.id === id));
    const old = await ctx.staffA.client.ok('GET', `/api/tasks?from=${addDays(today, 2)}&to=${addDays(today, 2)}`);
    assert.ok(!old.tasks.some((t) => t.id === id));
    const mgr = await ctx.managerA.client.ok('GET', `/api/tasks/${id}`);
    assert.equal(mgr.task.due_date, newDue);
  });
  test('시작일이 마감일보다 늦으면 거부', async () => {
    const id = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: 'x', orgUnitId: ctx.siteA, dueDate: addDays(today, 2) })).id;
    assert.equal((await ctx.staffA.client.patch(`/api/tasks/${id}`, { startDate: addDays(today, 5) })).status, 400);
  });
});

describe('④ 반복 업무·반복 일정 생성·수정·취소', () => {
  test('반복 업무: 완료 시 다음 회차 1회만 생성, 반복 중지 가능', async () => {
    const due = addDays(today, 1);
    const id = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '주간 시설 점검', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: due, recurrenceRule: 'FREQ=WEEKLY', approvalRequired: false, checklist: ['소방 설비', '기구'] })).id;
    const r = await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'done' });
    assert.ok(r.spawned);
    const next = await ctx.staffA.client.ok('GET', `/api/tasks/${r.spawned}`);
    assert.equal(next.task.due_date, addDays(due, 7));
    assert.equal(next.task.status, 'todo');
    assert.equal(next.checklist.length, 2);
    assert.ok(next.checklist.every((c) => !c.done));
    // 다시 열고 완료해도 중복 생성 없음
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'in_progress' });
    const r2 = await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'done' });
    assert.equal(r2.spawned, null);
    const [{ c }] = await sql`select count(*)::int c from tasks where (recurrence_source_id = ${id} or id = ${id}) and deleted_at is null`;
    assert.equal(c, 2);
    assert.ok((await notifs(ctx.staffA.client)).some((x) => x.type === 'recurring_created'));
    // 반복 중지
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.spawned}`, { recurrenceRule: null });
    const r3 = await ctx.managerA.client.ok('PATCH', `/api/tasks/${r.spawned}`, { status: 'done' });
    assert.equal(r3.spawned, null);
  });
  test('반복 업무: 서버 스케줄러가 기한 7일 전 다음 회차를 미리 만든다', async () => {
    const id = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '일일 마감 정산', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: today, recurrenceRule: 'FREQ=DAILY' })).id;
    await tick();
    await tick();
    const rows = await sql`select due_date from tasks where recurrence_source_id = ${id} order by due_date`;
    assert.ok(rows.length >= 1, '다음 회차 생성');
    const dues = rows.map((r) => r.due_date);
    assert.equal(new Set(dues).size, dues.length, '같은 날짜 중복 없음');
  });

  describe('반복 일정 (매주, 4회)', () => {
    let calId, ev, starts;
    const rangeQ = () => `/api/events?from=${addDays(today, -1)}T00:00:00%2B09:00&to=${addDays(today, 40)}T00:00:00%2B09:00`;
    before(async () => {
      calId = (await ctx.managerA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'org_unit').id;
      const d = addDays(today, 1);
      ev = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: calId, title: '주간 회의', start: `${d}T09:00:00+09:00`, end: `${d}T10:00:00+09:00`, rrule: 'FREQ=WEEKLY;COUNT=4', attendeeIds: [ctx.staffA.id] })).id;
    });
    const mine = async () => (await ctx.managerA.client.ok('GET', rangeQ())).events.filter((e) => e.title.startsWith('주간 회의'));
    test('4회 전개되고 참석자에게 초대 알림', async () => {
      const list = await mine();
      assert.equal(list.length, 4);
      starts = list.map((e) => e.originalStart);
      assert.ok((await notifs(ctx.staffA.client)).some((x) => x.type === 'event_changed' && x.title.includes('주간 회의')));
      // 참석자는 다른 현장이 아니어도 일정을 본다
      const a = await ctx.staffA.client.ok('GET', rangeQ());
      assert.equal(a.events.filter((e) => e.title === '주간 회의').length, 4);
    });
    test('이번 일정만: 2회차 시간 이동', async () => {
      const occ = starts[1];
      const ns = new Date(new Date(occ).getTime() + 2 * 3600e3);
      await ctx.managerA.client.ok('PATCH', `/api/events/${ev}`, { scope: 'this', occurrenceStart: occ, start: ns.toISOString(), end: new Date(ns.getTime() + 3600e3).toISOString() });
      const list = await mine();
      assert.equal(list.length, 4);
      const moved = list.find((e) => e.exception);
      assert.equal(new Date(moved.start).toISOString(), ns.toISOString());
    });
    test('이후 일정: 3회차부터 제목 변경 → 시리즈 분할', async () => {
      const r = await ctx.managerA.client.ok('PATCH', `/api/events/${ev}`, { scope: 'following', occurrenceStart: starts[2], title: '주간 회의(개편)' });
      assert.ok(r.newSeriesId);
      const list = await mine();
      assert.equal(list.length, 4);
      assert.equal(list.filter((e) => e.title === '주간 회의(개편)').length, 2);
      assert.equal(list.filter((e) => e.title === '주간 회의').length, 2);
      starts.push(r.newSeriesId);
    });
    test('이번 일정만 삭제(4회차) → 3회 남음, 전체 삭제 → 0', async () => {
      const newSeries = starts[4];
      await ctx.managerA.client.ok('DELETE', `/api/events/${newSeries}?scope=this&occurrenceStart=${encodeURIComponent(starts[3])}`);
      assert.equal((await mine()).length, 3);
      await ctx.managerA.client.ok('DELETE', `/api/events/${ev}?scope=all`);
      await ctx.managerA.client.ok('DELETE', `/api/events/${newSeries}?scope=all`);
      assert.equal((await mine()).length, 0);
    });
    test('충돌 안내: 같은 참석자 시간이 겹치면 알려 준다', async () => {
      const d = addDays(today, 20);
      await ctx.managerA.client.ok('POST', '/api/events', { calendarId: calId, title: '거래처 미팅', start: `${d}T14:00:00+09:00`, end: `${d}T15:00:00+09:00`, attendeeIds: [ctx.staffA.id] });
      const c = await ctx.managerA.client.ok('GET', `/api/events/conflicts?start=${encodeURIComponent(`${d}T14:30:00+09:00`)}&end=${encodeURIComponent(`${d}T15:30:00+09:00`)}&userIds=${ctx.staffA.id}`);
      assert.equal(c.conflicts.length, 1);
      assert.ok(c.conflicts[0].who.includes('이직원'));
    });
    test('종일 휴가 일정은 서울 날짜 기준으로 저장된다', async () => {
      const personal = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
      const d = addDays(today, 10);
      const id = (await ctx.staffA.client.ok('POST', '/api/events', { calendarId: personal, title: '연차', kind: 'vacation', allDay: true, start: `${d}T00:00:00+09:00`, end: `${addDays(d, 1)}T00:00:00+09:00` })).id;
      const [row] = await sql`select to_char(start_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') s from events where id = ${id}`;
      assert.equal(row.s, `${d} 00:00`);
      // 개인 일정은 남이 못 본다
      assert.equal((await ctx.managerA.client.get(`/api/events/${id}`)).status, 404);
    });
  });
});

describe('로컬 검수 요청 반영 (R-3·R-6·R-7)', () => {
  test('R-3 멘션 대상 목록은 업무를 볼 수 있는 사람만', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '멘션 목록 시험', orgUnitId: ctx.siteA })).id;
    const r = await ctx.owner.ok('GET', `/api/tasks/${t}/mentionable`);
    const ids = r.users.map((u) => u.id);
    assert.ok(ids.includes(ctx.staffA.id) && ids.includes(ctx.managerA.id), '같은 현장 직원·관리자 포함');
    assert.ok(!ids.includes(ctx.staffB.id), '다른 현장 직원 제외');
    assert.equal((await ctx.staffB.client.get(`/api/tasks/${t}/mentionable`)).status, 404, '볼 수 없는 업무는 목록도 404');
  });
  test('R-7 매월 N번째 요일 + 횟수 / 종료일 반복', async () => {
    const cal = (await ctx.managerA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'org_unit').id;
    // 2026-11-10 은 둘째 화요일
    const id = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '월간 운영 회의', start: '2026-11-10T10:00:00+09:00', end: '2026-11-10T11:00:00+09:00', rrule: 'FREQ=MONTHLY;BYDAY=2TU;COUNT=3' })).id;
    const ev = (await ctx.managerA.client.ok('GET', '/api/events?from=2026-11-01T00:00:00%2B09:00&to=2027-04-01T00:00:00%2B09:00')).events.filter((e) => e.id === id);
    const days = ev.map((e) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(e.start)));
    assert.deepEqual(days, ['2026-11-10', '2026-12-08', '2027-01-12']);
    // 종료일 2026-12-15 (23:59:59 KST = 14:59:59Z) 까지 매주 화요일 → 11/10·17·24, 12/1·8·15 = 6회
    const id2 = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '주간 점검', start: '2026-11-10T09:00:00+09:00', end: '2026-11-10T09:30:00+09:00', rrule: 'FREQ=WEEKLY;BYDAY=TU;UNTIL=20261215T145959Z' })).id;
    const ev2 = (await ctx.managerA.client.ok('GET', '/api/events?from=2026-11-01T00:00:00%2B09:00&to=2027-02-01T00:00:00%2B09:00')).events.filter((e) => e.id === id2);
    assert.equal(ev2.length, 6);
    assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(ev2.at(-1).start)), '2026-12-15', '종료일 당일 포함');
  });
  test('R-6 일정별 알림: 여러 개, 지난 알림 중 가장 가까운 것 1회, 기본 설정 덮어씀', async () => {
    const cal = (await ctx.managerA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'org_unit').id;
    const start = new Date(Date.now() + 50 * 60000);
    // 120분·60분·10분 전 알림 → 지금(50분 전)은 60분 알림이 "가장 가까운 지난 알림"
    const id = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '일정별 알림 시험', start: start.toISOString(), end: new Date(start.getTime() + 3600e3).toISOString(), attendeeIds: [ctx.staffA.id], reminderMinutes: [10, 120, 60, 60] })).id;
    const [row] = await sql`select reminder_minutes from events where id = ${id}`;
    assert.deepEqual(row.reminder_minutes, [10, 60, 120], '중복 제거·정렬');
    await tick(); await tick();
    const n = await sql`select user_id, dedupe_key from notifications where type = 'event_reminder' and entity_id = ${id} order by user_id`;
    assert.equal(n.length, 2, '작성자·참석자 각 1회');
    assert.ok(n.every((x) => x.dedupe_key.endsWith(':60')));
    // 알림 없음([]) 으로 바꾸면 더 이상 생성되지 않음
    await ctx.managerA.client.ok('PATCH', `/api/events/${id}`, { reminderMinutes: [] });
    assert.deepEqual((await ctx.managerA.client.ok('GET', `/api/events/${id}`)).event.reminder_minutes, []);
  });
});

describe('Asana 이상 P0 (B-2·B-3·B-4)', () => {
  let proj, proj2, secA, secB;
  before(async () => {
    proj = (await ctx.managerA.client.ok('POST', '/api/projects', { name: '강남점 리뉴얼', orgUnitId: ctx.siteA })).id;
    proj2 = (await ctx.owner.ok('POST', '/api/projects', { name: '판교 개강', orgUnitId: ctx.siteB })).id;
  });
  test('B-3 섹션 생성·순서·이름·업무 이동, 권한 검사', async () => {
    secA = (await ctx.managerA.client.ok('POST', `/api/projects/${proj}/sections`, { name: '준비' })).id;
    secB = (await ctx.managerA.client.ok('POST', `/api/projects/${proj}/sections`, { name: '시공' })).id;
    const list = (await ctx.staffA.client.ok('GET', `/api/projects/${proj}/sections`)).sections;
    assert.deepEqual(list.map((x) => x.name), ['준비', '시공'], '직원은 조회 가능, 추가 순서대로');
    assert.equal((await ctx.staffA.client.post(`/api/projects/${proj}/sections`, { name: 'x' })).status, 403, '직원은 섹션 편집 불가');
    assert.equal((await ctx.staffB.client.get(`/api/projects/${proj}/sections`)).status, 404, '다른 현장은 프로젝트 자체가 보이지 않음');
    await ctx.managerA.client.ok('PATCH', `/api/sections/${secB}`, { sort: 0, name: '시공(1차)' });
    const l2 = (await ctx.managerA.client.ok('GET', `/api/projects/${proj}/sections`)).sections;
    assert.deepEqual(l2.map((x) => x.name), ['시공(1차)', '준비']);
    const t = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '자재 발주', projectId: proj, sectionId: secA })).id;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { sectionId: secB });
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).task.section_id, secB);
    const sec2 = (await ctx.owner.ok('POST', `/api/projects/${proj2}/sections`, { name: '판교 섹션' })).id;
    assert.equal((await ctx.staffA.client.patch(`/api/tasks/${t}`, { sectionId: sec2 })).status, 400, '다른 프로젝트 섹션 지정 불가');
    await ctx.managerA.client.ok('DELETE', `/api/sections/${secB}`);
    const after = (await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).task;
    assert.equal(after.section_id, null, '섹션 삭제 시 업무는 남고 섹션 없음으로');
  });
  test('B-2 새로 배정된 업무는 담당자 확인 전까지 표시, 재배정 시 다시 확인 필요', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '확인 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id })).id;
    const mine = async () => (await ctx.staffA.client.ok('GET', '/api/tasks?view=my')).tasks.find((x) => x.id === t);
    assert.equal((await mine()).assignee_ack_at, null);
    assert.equal((await ctx.managerA.client.post(`/api/tasks/${t}/ack`, {})).status, 403, '담당자만 확인');
    await ctx.staffA.client.ok('POST', `/api/tasks/${t}/ack`, {});
    assert.ok((await mine()).assignee_ack_at);
    await ctx.owner.ok('PATCH', `/api/tasks/${t}`, { assigneeId: ctx.managerA.id });
    await ctx.owner.ok('PATCH', `/api/tasks/${t}`, { assigneeId: ctx.staffA.id });
    assert.equal((await mine()).assignee_ack_at, null, '다시 배정되면 확인 전');
    const self = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '내가 나에게', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id })).id;
    assert.ok((await ctx.staffA.client.ok('GET', `/api/tasks/${self}`)).task.assignee_ack_at, '본인 배정은 자동 확인');
  });
  test('B-4 빠른 검색은 권한 범위 안에서만', async () => {
    await ctx.owner.ok('POST', '/api/tasks', { title: '검색키워드 강남', orgUnitId: ctx.siteA });
    await ctx.owner.ok('POST', '/api/tasks', { title: '검색키워드 판교', orgUnitId: ctx.siteB });
    const own = await ctx.owner.ok('GET', '/api/search?q=' + encodeURIComponent('검색키워드'));
    assert.equal(own.tasks.length, 2);
    const a = await ctx.staffA.client.ok('GET', '/api/search?q=' + encodeURIComponent('검색키워드'));
    assert.deepEqual(a.tasks.map((x) => x.title), ['검색키워드 강남']);
    const pr = await ctx.staffA.client.ok('GET', '/api/search?q=' + encodeURIComponent('판교 개강'));
    assert.equal(pr.projects.length, 0, '다른 현장 프로젝트 제외');
    const people = await ctx.staffA.client.ok('GET', '/api/search?q=' + encodeURIComponent('박직원'));
    assert.equal(people.people.length, 0, '다른 현장 직원 제외');
    assert.equal((await new Client().get('/api/search?q=a')).status, 401);
  });
});

describe('Asana 이상 P1 (B-7~B-13)', () => {
  const upPhoto = async (c, taskId, name = 'p.jpg') => {
    const init = await c.ok('POST', '/api/attachments', { taskId, kind: 'file', fileName: name, mimeType: 'image/jpeg', size: 4, capturedAt: new Date().toISOString() });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
    await c.ok('POST', `/api/attachments/${init.id}/complete`, {});
  };
  test('B-7 사진 증빙 2장 필수: 모자라면 검토 요청 거부, 채우면 통과', async () => {
    const id = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '현장 점검 사진', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, taskType: 'inspection', photoRequired: 2 })).id;
    const r1 = await ctx.staffA.client.patch(`/api/tasks/${id}`, { status: 'review' });
    assert.equal(r1.status, 409);
    assert.match(r1.body.error.message, /사진 2장/);
    assert.equal((await ctx.staffA.client.patch(`/api/tasks/${id}`, { photoRequired: 0 })).status, 403, '직원은 사진 조건을 못 바꿈');
    await upPhoto(ctx.staffA.client, id); await upPhoto(ctx.staffA.client, id, 'p2.jpg');
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review' });
    const d = await ctx.staffA.client.ok('GET', `/api/tasks/${id}`);
    assert.equal(d.task.photo_count, 2);
    assert.ok(d.attachments.every((a) => a.captured_at), '촬영 시각 기록');
  });
  test('B-12 마일스톤은 시작일 없이 저장', async () => {
    const id = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '개강일', orgUnitId: ctx.siteA, taskType: 'milestone', startDate: addDays(today, 1), dueDate: addDays(today, 5) })).id;
    const t = (await ctx.staffA.client.ok('GET', `/api/tasks/${id}`)).task;
    assert.equal(t.task_type, 'milestone'); assert.equal(t.start_date, null);
  });
  test('B-9 2단계 결재: 현장 관리자 → 대표, 반려 사유 필수, 결재자 아니면 거부, 최종 승인 시 완료', async () => {
    const line = (await ctx.owner.ok('POST', '/api/approval-lines', { name: '현장→대표', steps: [{ label: '현장 관리자', type: 'role', role: 'site_manager' }, { label: '대표', type: 'role', role: 'owner' }] })).id;
    assert.equal((await ctx.managerA.client.post('/api/approval-lines', { name: 'x', steps: [{ label: 'a', type: 'role', role: 'owner' }] })).status, 403);
    const id = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: 'GX 강사 계약', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, taskType: 'approval', approvalLineId: line })).id;
    assert.equal((await ctx.managerA.client.patch(`/api/tasks/${id}`, { status: 'done' })).status, 403, '결재선 업무는 바로 완료 불가');
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review' });
    assert.ok((await notifs(ctx.managerA.client)).some((n) => n.title.includes('결재 요청 (현장 관리자)')));
    assert.equal((await ctx.owner.post(`/api/tasks/${id}/approval`, { decision: 'approve' })).status, 403, '1단계는 현장 관리자만');
    assert.equal((await ctx.managerA.client.post(`/api/tasks/${id}/approval`, { decision: 'reject' })).status, 400, '반려 사유 필수');
    await ctx.managerA.client.ok('POST', `/api/tasks/${id}/approval`, { decision: 'reject', comment: '계약 기간 확인 필요' });
    let d = await ctx.staffA.client.ok('GET', `/api/tasks/${id}`);
    assert.equal(d.task.status, 'in_progress');
    assert.ok(d.comments.some((c) => c.body.includes('계약 기간 확인 필요')));
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review' });
    assert.deepEqual((await ctx.managerA.client.ok('POST', `/api/tasks/${id}/approval`, { decision: 'approve' })).status, 'next');
    assert.equal((await ctx.managerA.client.post(`/api/tasks/${id}/approval`, { decision: 'approve' })).status, 403, '2단계는 대표');
    assert.equal((await ctx.owner.ok('POST', `/api/tasks/${id}/approval`, { decision: 'approve' })).status, 'done');
    d = await ctx.staffA.client.ok('GET', `/api/tasks/${id}`);
    assert.equal(d.task.status, 'done'); assert.equal(d.task.approved_by, ctx.ownerId);
    assert.deepEqual(d.approvals.filter((a) => a.round === 2).map((a) => a.status), ['approved', 'approved']);
    assert.equal(d.approvals.find((a) => a.round === 1).status, 'rejected');
    const audit = await ctx.owner.ok('GET', '/api/admin/audit');
    assert.ok(audit.logs.filter((l) => l.action === 'approval.decide' && l.target_id === id).length >= 3, '결재 이력 감사 기록');
  });
  test('B-11 사용자 지정 필드: 퍼센트는 평균, 숫자는 합계, 형식·권한 검사', async () => {
    const pid = (await ctx.managerA.client.ok('POST', '/api/projects', { name: '필드 시험', orgUnitId: ctx.siteA })).id;
    const pct = (await ctx.managerA.client.ok('POST', `/api/projects/${pid}/fields`, { name: '달성률', type: 'percent' })).id;
    const num = (await ctx.managerA.client.ok('POST', `/api/projects/${pid}/fields`, { name: '비용', type: 'number' })).id;
    const sel = (await ctx.managerA.client.ok('POST', `/api/projects/${pid}/fields`, { name: '단계', type: 'select', options: [{ id: 'a', label: '계획', color: '#2563eb' }] })).id;
    assert.equal((await ctx.staffA.client.post(`/api/projects/${pid}/fields`, { name: 'x', type: 'text' })).status, 403);
    const vals = [[80, 100000], [90, 250000]];
    for (const [p, c] of vals) {
      const t = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: `필드 업무 ${p}`, projectId: pid })).id;
      await ctx.staffA.client.ok('PUT', `/api/tasks/${t}/fields/${pct}`, { value: p });
      await ctx.staffA.client.ok('PUT', `/api/tasks/${t}/fields/${num}`, { value: c });
      if (p === 80) {
        assert.equal((await ctx.staffA.client.req('PUT', `/api/tasks/${t}/fields/${pct}`, { value: 170 })).status, 400, '퍼센트 100 초과 거부');
        assert.equal((await ctx.staffA.client.req('PUT', `/api/tasks/${t}/fields/${sel}`, { value: 'zz' })).status, 400, '없는 선택지 거부');
        await ctx.staffA.client.ok('PUT', `/api/tasks/${t}/fields/${sel}`, { value: 'a' });
      }
    }
    const sum = (await ctx.staffA.client.ok('GET', `/api/projects/${pid}/field-summary`)).summary;
    assert.equal(sum.find((x) => x.name === '달성률').total, 85, '퍼센트는 평균 85% (합계 170% 아님)');
    assert.equal(sum.find((x) => x.name === '비용').total, 350000);
    const list = (await ctx.staffA.client.ok('GET', `/api/tasks?projectId=${pid}`)).tasks;
    assert.ok(list.some((t) => t.fields[sel] === 'a'));
  });
  test('B-10 자동화: 검토 요청 → 현장 관리자 알림 + 완료 → 후속 업무 생성, 규칙당 1회·재귀 없음', async () => {
    const pid = (await ctx.managerA.client.ok('POST', '/api/projects', { name: '자동화 시험', orgUnitId: ctx.siteA })).id;
    await ctx.managerA.client.ok('POST', '/api/automations', { name: '검토 알림', projectId: pid, trigger: 'status_changed', conditions: { toStatus: 'review' }, actions: [{ type: 'notify', to: 'unit_managers', message: '검토 필요' }] });
    await ctx.managerA.client.ok('POST', '/api/automations', { name: '완료 후 정산', projectId: pid, trigger: 'task_completed', actions: [{ type: 'create_follow_up', title: '비용 정산', dueInDays: 3, assignTo: 'creator' }, { type: 'set_priority', priority: 'high' }] });
    assert.equal((await ctx.staffA.client.post('/api/automations', { name: 'x', projectId: pid, trigger: 'task_created', actions: [{ type: 'set_priority', priority: 'high' }] })).status, 403);
    assert.equal((await ctx.managerA.client.post('/api/automations', { name: 'x', trigger: 'task_created', actions: [{ type: 'set_priority', priority: 'high' }] })).status, 403, '전사 규칙은 관리자만');
    const id = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '자동화 대상', projectId: pid, approvalRequired: false })).id;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review' });
    assert.ok((await notifs(ctx.managerA.client)).some((n) => n.title.includes('[자동화] 검토 필요')));
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'done' });
    const follow = await sql`select t.id, t.title, t.assignee_id, d.depends_on_id from tasks t join task_dependencies d on d.task_id = t.id where d.depends_on_id = ${id}`;
    assert.equal(follow.length, 1); assert.equal(follow[0].title, '비용 정산'); assert.equal(follow[0].assignee_id, ctx.staffA.id);
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${id}`)).task.priority, 'high');
    const { runs } = await ctx.managerA.client.ok('GET', '/api/automations');
    assert.ok(runs.filter((r) => r.task_id === id).every((r) => r.status === 'ok'));
    // 후속 업무 생성이 task_created 규칙을 부르지 않음 (재귀 없음) — 규칙 실행 기록은 원 업무 2건뿐
    assert.equal(runs.filter((r) => r.task_id === id).length, 2);
  });
  test('B-13 후속 업무 · 복제 · 중복 통합', async () => {
    const a = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '원 업무', orgUnitId: ctx.siteA, checklist: ['하나'] })).id;
    const f = (await ctx.staffA.client.ok('POST', `/api/tasks/${a}/follow-up`, {})).id;
    assert.deepEqual((await ctx.staffA.client.ok('GET', `/api/tasks/${f}`)).dependencies.map((x) => x.id), [a]);
    const dup = (await ctx.staffA.client.ok('POST', `/api/tasks/${a}/duplicate`, {})).id;
    const dd = await ctx.staffA.client.ok('GET', `/api/tasks/${dup}`);
    assert.equal(dd.task.title, '원 업무 (복제)'); assert.equal(dd.checklist.length, 1);
    await ctx.staffA.client.ok('POST', `/api/tasks/${dup}/comments`, { body: '복제 쪽 댓글' });
    await ctx.staffA.client.ok('POST', `/api/tasks/${dup}/merge`, { intoId: a });
    assert.equal((await ctx.staffA.client.get(`/api/tasks/${dup}`)).status, 404, '통합된 원본은 사라짐');
    const da = await ctx.staffA.client.ok('GET', `/api/tasks/${a}`);
    assert.ok(da.comments.some((c) => c.body === '복제 쪽 댓글')); assert.ok(da.comments.some((c) => c.body.includes('[중복 통합]')));
  });
  test('B-8 현장 QR 신고: 비로그인 접수 → 현장 업무 자동 생성·관리자 배정, 동의·민원 연락처, 미끼 필드, 속도 제한', async () => {
    const fid = (await ctx.managerA.client.ok('POST', '/api/forms', { orgUnitId: ctx.siteA, kind: 'facility' })).id;
    const cid = (await ctx.managerA.client.ok('POST', '/api/forms', { orgUnitId: ctx.siteA, kind: 'complaint' })).id;
    assert.equal((await ctx.staffA.client.post('/api/forms', { orgUnitId: ctx.siteA, kind: 'supply' })).status, 403);
    const forms = (await ctx.managerA.client.ok('GET', '/api/forms')).forms;
    const ftok = forms.find((x) => x.id === fid).token, ctok = forms.find((x) => x.id === cid).token;
    const anon = new Client('anon');
    const info = await anon.ok('GET', `/api/public/forms/${ftok}`);
    assert.equal(info.place, '다짐 강남점');
    const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
    const r = await anon.ok('POST', `/api/public/forms/${ftok}`, { content: '런닝머신 3번 벨트가 끊어졌어요', location: '2층 유산소존', photo: png }, { 'x-forwarded-for': '10.1.1.1' });
    assert.ok(r.receipt);
    const [t] = await sql`select id, title, assignee_id, task_type, photo_required, priority from tasks where title like '[시설 고장] 런닝머신%'`;
    assert.equal(t.assignee_id, ctx.managerA.id, '현장 관리자 자동 배정'); assert.equal(t.task_type, 'inspection');
    const att = await sql`select mime_type from attachments where task_id = ${t.id}`;
    assert.equal(att[0].mime_type, 'image/png', '신고 사진 첨부');
    assert.ok((await notifs(ctx.managerA.client)).some((n) => n.title.includes('현장 신고 접수')));
    assert.equal((await anon.req('POST', `/api/public/forms/${ctok}`, { content: '샤워실 온수가 안 나와요' }, { 'x-forwarded-for': '10.1.1.2' })).status, 400, '민원은 연락처 필요');
    assert.equal((await anon.req('POST', `/api/public/forms/${ctok}`, { content: '샤워실 온수가 안 나와요', name: '홍길동', phone: '010-1234-5678' }, { 'x-forwarded-for': '10.1.1.2' })).status, 400, '개인정보 동의 필요');
    await anon.ok('POST', `/api/public/forms/${ctok}`, { content: '샤워실 온수가 안 나와요', name: '홍길동', phone: '010-1234-5678', agree: true }, { 'x-forwarded-for': '10.1.1.2' });
    assert.equal((await anon.req('POST', `/api/public/forms/${ftok}`, { content: '봇입니다 봇', website: 'http://spam' }, { 'x-forwarded-for': '10.1.1.3' })).status, 400, '미끼 필드');
    for (let i = 0; i < 4; i++) await anon.ok('POST', `/api/public/forms/${ftok}`, { content: `반복 신고 ${i} 입니다` }, { 'x-forwarded-for': '10.9.9.9' });
    await anon.ok('POST', `/api/public/forms/${ftok}`, { content: '다섯 번째 신고' }, { 'x-forwarded-for': '10.9.9.9' });
    assert.equal((await anon.req('POST', `/api/public/forms/${ftok}`, { content: '여섯 번째 신고' }, { 'x-forwarded-for': '10.9.9.9' })).status, 429, '10분 5건 제한');
    // 다른 현장 직원은 양식 목록에서 보이지 않음, 끈 양식은 접수 불가
    assert.ok(!(await ctx.staffB.client.ok('GET', '/api/forms')).forms.some((x) => x.id === fid));
    await ctx.managerA.client.ok('PATCH', `/api/forms/${fid}`, { orgUnitId: ctx.siteA, kind: 'facility', enabled: false });
    assert.equal((await anon.get(`/api/public/forms/${ftok}`)).status, 404);
  });
});

describe('UI/UX 검수 버그 (U-0a·U-0b) · 개인정보 파기', () => {
  test('U-0a 목록 조회는 모르는 보기·옵션 값을 무시하고 200', async () => {
    for (const qs of ['view=board', 'view=xyz', 'includeDone=yes', 'from=not-a-date&to=2026-13-99', 'limit=abc']) {
      const r = await ctx.staffA.client.get(`/api/tasks?${qs}`);
      assert.equal(r.status, 200, qs);
    }
    assert.equal((await ctx.staffA.client.get('/api/tasks?projectId=not-a-uuid')).status, 400, '식별자 오류는 그대로 400');
  });
  test('U-0b 검증 오류 문구에 항목 이름과 한국어 이유', async () => {
    const r = await ctx.staffA.client.post('/api/tasks', { title: '', orgUnitId: ctx.siteA, priority: 'zzz' });
    assert.equal(r.status, 400);
    assert.match(r.body.error.message, /제목: 제목을 입력하세요/);
    assert.match(r.body.error.message, /우선순위: 허용되지 않는 값/);
    assert.ok(r.body.error.detail.fields.some((f) => f.label === '제목'));
    const l = await new Client('x').req('POST', '/api/auth/login', { email: 'not-an-email', password: '' });
    assert.match(l.body.error.message, /이메일/);
  });
  test('현장 신고자 이름·연락처는 처리 완료 1년 뒤 정기 실행에서 파기', async () => {
    const fid = (await ctx.managerA.client.ok('POST', '/api/forms', { orgUnitId: ctx.siteA, kind: 'complaint' })).id;
    const tok = (await ctx.managerA.client.ok('GET', '/api/forms')).forms.find((x) => x.id === fid).token;
    await new Client('anon2').ok('POST', `/api/public/forms/${tok}`, { content: '락커 열쇠가 고장났어요', name: '김회원', phone: '010-9999-0000', agree: true }, { 'x-forwarded-for': '10.7.7.7' });
    const [s1] = await sql`select s.id, s.task_id from form_submissions s where s.form_id = ${fid}`;
    await sql`update tasks set status = 'done', completed_at = now() - interval '400 days' where id = ${s1.task_id}`;
    await tick();
    const [s2] = await sql`select reporter_name, reporter_phone, purged_at from form_submissions where id = ${s1.id}`;
    assert.equal(s2.reporter_name, null); assert.equal(s2.reporter_phone, null); assert.ok(s2.purged_at);
    const [t] = await sql`select description from tasks where id = ${s1.task_id}`;
    assert.ok(!t.description.includes('010-9999-0000') && t.description.includes('보관 기간 경과로 삭제'));
  });
});

describe('Asana 이상 P2 (B-14~B-17)', () => {
  test('B-14 현장 비교: 기한 준수율·평균 처리·지연·점검 수행률, 직원 403, 다른 현장 관리자 범위', async () => {
    const mk = async (title, extra) => (await ctx.managerA.client.ok('POST', '/api/tasks', { title, orgUnitId: ctx.siteA, approvalRequired: false, ...extra })).id;
    const a = await mk('준수 업무', { dueDate: addDays(today, 2) });
    const b = await mk('늦은 업무', { dueDate: addDays(today, -3) });
    const c = await mk('점검 업무', { taskType: 'inspection', photoRequired: 0, dueDate: today });
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${a}`, { status: 'done' });
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${b}`, { status: 'done' }); // 마감 3일 지나 완료
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${c}`, { status: 'done' });
    await mk('아직 지연', { dueDate: addDays(today, -1) });
    const r = await ctx.managerA.client.ok('GET', '/api/insights/sites?weeks=4');
    const s = r.sites.find((x) => x.id === ctx.siteA);
    assert.ok(s.onTimeRate > 0 && s.onTimeRate < 100, `준수율 ${s.onTimeRate}`);
    assert.ok(s.overdue >= 1); assert.ok(s.done >= 3); assert.equal(typeof s.avgDays, 'number');
    assert.ok(s.inspection.total >= 1 && s.inspection.done >= 1);
    assert.equal(s.trend.length, 4);
    assert.ok(!r.sites.some((x) => x.id === ctx.siteB), '권한 밖 현장 제외');
    assert.equal((await ctx.staffA.client.get('/api/insights/sites')).status, 403);
    assert.ok((await ctx.owner.ok('GET', '/api/insights/sites')).sites.some((x) => x.id === ctx.siteB));
  });
  test('B-16 업무량: 마감 업무·일정 시간·휴가 반영, 직원은 자기 것만', async () => {
    const base = await ctx.staffA.client.ok('GET', '/api/insights/workload');
    const mon = base.weekStart, h0 = base.people[0].eventHours, a0 = base.people[0].awayDays;
    const fri = addDays(mon, 4);
    for (let i = 0; i < 3; i++) await ctx.managerA.client.ok('POST', '/api/tasks', { title: `업무량 ${i}`, orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: fri });
    const cal = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    // 오늘은 지난 시간을 빼고 계산하므로 미팅은 오늘이 아닌 날에 둔다 (시각에 따라 실패하던 문제)
    const meetDay = addDays(mon, 1) === today ? addDays(mon, 3) : addDays(mon, 1);
    await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '외부 미팅', start: `${meetDay}T10:00:00+09:00`, end: `${meetDay}T13:00:00+09:00` });
    await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '연차', kind: 'vacation', allDay: true, start: `${addDays(mon, 2)}T00:00:00+09:00`, end: `${addDays(mon, 3)}T00:00:00+09:00` });
    const mine = await ctx.staffA.client.ok('GET', '/api/insights/workload');
    assert.equal(mine.people.length, 1, '직원은 자기 것만');
    const me = mine.people[0];
    assert.ok(me.dueThisWeek >= 3); assert.equal(me.eventHours, h0 + 3, '3시간 미팅 합산'); assert.equal(me.awayDays, a0 + 1, '연차 1일');
    const team = await ctx.managerA.client.ok('GET', '/api/insights/workload');
    const p = team.people.find((x) => x.id === ctx.staffA.id);
    assert.equal(p.eventHours, me.eventHours, '관리자도 같은 시간 합계 (제목 없이)');
    assert.ok(!JSON.stringify(team).includes('외부 미팅'), '다른 사람 일정 제목은 노출하지 않음');
    assert.ok(!team.people.some((x) => x.id === ctx.staffB.id), '다른 현장 사람 제외');
  });
  test('B-15 주간 보고: 정기 실행이 주 1회만 만들고 관리자에게 알림, 관리자만 열람', async () => {
    await tick(); await tick();
    const { reports } = await ctx.owner.ok('GET', '/api/reports');
    assert.equal(reports.length, 1, '여러 번 실행해도 1건');
    const rep = (await ctx.owner.ok('GET', `/api/reports/${reports[0].id}`)).report;
    assert.ok(rep.data.weekStart && Array.isArray(rep.data.sites) && Array.isArray(rep.data.issues));
    assert.equal((await notifs(ctx.owner)).filter((n) => n.title.startsWith('주간 보고')).length, 1);
    assert.equal((await ctx.managerA.client.get('/api/reports')).status, 403);
    assert.equal((await ctx.managerA.client.get(`/api/reports/${reports[0].id}`)).status, 403);
    const again = await ctx.owner.ok('POST', '/api/reports', {});
    assert.equal(again.existed, true);
  });
  test('B-17 공휴일: 기본 목록, 관리자만 추가·삭제', async () => {
    const h = (await ctx.staffA.client.ok('GET', '/api/holidays?from=2026-01-01&to=2027-12-31')).holidays;
    assert.ok(h.some((x) => x.date === '2026-10-09' && x.name === '한글날'));
    assert.equal((await ctx.staffA.client.req('PUT', '/api/holidays/2026-11-20', { name: '임시' })).status, 403);
    await ctx.owner.ok('PUT', '/api/holidays/2026-11-20', { name: '임시공휴일' });
    assert.ok((await ctx.staffA.client.ok('GET', '/api/holidays?from=2026-11-01&to=2026-11-30')).holidays.some((x) => x.name === '임시공휴일'));
    await ctx.owner.ok('DELETE', '/api/holidays/2026-11-20');
    assert.ok(!(await ctx.staffA.client.ok('GET', '/api/holidays?from=2026-11-01&to=2026-11-30')).holidays.length);
  });
});

describe('일정 × 업무 통합 (S-1~S-10)', () => {
  const at = (date, hm) => `${date}T${hm}:00+09:00`;
  const siteCal = async (c) => (await c.ok('GET', '/api/calendars')).calendars.find((x) => x.org_unit_id === ctx.siteA).id;
  test('S-1 일정–업무 N:M: 참석자가 연결, 업무 쪽에서도 보임, 권한 밖 업무는 숨김, 다른 현장은 404', async () => {
    const cal = await siteCal(ctx.managerA.client);
    const d = addDays(today, 2);
    const ev = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '주간 운영 점검 회의', start: at(d, '10:00'), end: at(d, '11:00'), attendeeIds: [ctx.staffA.id] })).id;
    const t1 = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '회의 자료 준비', orgUnitId: ctx.siteA })).id;
    await ctx.staffA.client.ok('POST', `/api/events/${ev}/tasks`, { taskId: t1 });
    const hidden = (await ctx.owner.ok('POST', '/api/tasks', { title: '본사 내부 검토', orgUnitId: ctx.hq })).id;
    await ctx.owner.ok('POST', `/api/events/${ev}/tasks`, { taskId: hidden });
    const seen = (await ctx.staffA.client.ok('GET', `/api/events/${ev}/tasks`)).tasks.map((t) => t.id);
    assert.ok(seen.includes(t1)); assert.ok(!seen.includes(hidden), '권한 밖 업무는 목록에 없음');
    assert.equal((await ctx.owner.ok('GET', `/api/events/${ev}/tasks`)).tasks.length, 2);
    assert.ok((await ctx.staffA.client.ok('GET', `/api/tasks/${t1}/events`)).events.some((e) => e.id === ev), '업무에서 연결 일정 보임');
    assert.equal((await ctx.staffB.client.get(`/api/events/${ev}/tasks`)).status, 404);
    assert.equal((await ctx.staffA.client.post(`/api/events/${ev}/tasks`, { taskId: hidden })).status, 404, '볼 수 없는 업무 연결 불가');
    await ctx.staffA.client.ok('DELETE', `/api/events/${ev}/tasks/${t1}`);
    assert.ok(!(await ctx.staffA.client.ok('GET', `/api/events/${ev}/tasks`)).tasks.some((t) => t.id === t1));
  });
  test('S-2 회의 메모 저장 → 메모 줄로 후속 업무(담당=참석자, 마감 회의+3일) 자동 연결·알림', async () => {
    const cal = await siteCal(ctx.managerA.client);
    const d = addDays(today, 1);
    const ev = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '시설 개선 회의', start: at(d, '14:00'), end: at(d, '15:00'), attendeeIds: [ctx.staffA.id] })).id;
    await ctx.staffA.client.ok('PUT', `/api/events/${ev}/notes`, { body: '- 샤워실 배수구 교체 견적\n- 락커 번호판 재부착' });
    assert.match((await ctx.managerA.client.ok('GET', `/api/events/${ev}/notes`)).body, /배수구/);
    assert.equal((await ctx.staffB.client.req('PUT', `/api/events/${ev}/notes`, { body: 'x' })).status, 404);
    const r = await ctx.managerA.client.ok('POST', `/api/events/${ev}/tasks`, { title: '샤워실 배수구 교체 견적', assigneeId: ctx.staffA.id, noteLine: '샤워실 배수구 교체 견적' });
    const t = (await ctx.staffA.client.ok('GET', `/api/tasks/${r.id}`)).task;
    assert.equal(t.due_date, addDays(d, 3)); assert.equal(t.org_unit_id, ctx.siteA); assert.equal(t.assignee_id, ctx.staffA.id);
    const lk = (await ctx.staffA.client.ok('GET', `/api/events/${ev}/tasks`)).tasks.find((x) => x.id === r.id);
    assert.equal(lk.link_role, 'followup'); assert.equal(lk.note_line, '샤워실 배수구 교체 견적');
    assert.ok((await notifs(ctx.staffA.client)).some((n) => n.title.includes('샤워실 배수구')));
  });
  test('S-3·S-6 업무 시간 블록은 N:M 연결·배정 시간 합산, 예상 시간 대비 마감 위험', async () => {
    const t = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '월말 정산 보고서', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 1), estimateMinutes: 3000 })).id;
    const cal = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    const d = addDays(today, 1);
    const b = (await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '월말 정산 보고서', start: at(d, '09:00'), end: at(d, '11:00'), taskId: t, kind: 'task_block' })).id;
    const det = await ctx.staffA.client.ok('GET', `/api/tasks/${t}`);
    assert.equal(det.task.scheduled_minutes, 120); assert.equal(det.task.estimate_minutes, 3000);
    assert.equal(det.risk.risk, true, '50시간 예상, 마감 내일 → 위험');
    assert.ok((await ctx.staffA.client.ok('GET', `/api/tasks/${t}/events`)).events.some((e) => e.id === b && e.role === 'block'));
    assert.ok((await ctx.staffA.client.ok('GET', '/api/tasks?view=risk')).tasks.some((x) => x.id === t));
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { estimateMinutes: 60 });
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).risk.risk, false, '배정 시간이 예상보다 많으면 위험 아님');
  });
  test('S-7 가용 시간: 회의·업무 블록 반영, 본인·관리자만', async () => {
    const d = addDays(weekMonday(), 7 + 2); // 다음 주 수요일
    const cal = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '외부 교육', start: at(d, '09:00'), end: at(d, '12:00') });
    const me = (await ctx.staffA.client.ok('GET', `/api/availability?date=${d}`)).days[0];
    assert.equal(me.meetingMinutes, 180); assert.equal(me.capacity, 480); assert.equal(me.freeMinutes, 300);
    assert.equal((await ctx.managerA.client.ok('GET', `/api/availability?userId=${ctx.staffA.id}&date=${d}`)).days[0].freeMinutes, 300);
    assert.equal((await ctx.staffB.client.get(`/api/availability?userId=${ctx.staffA.id}&date=${d}`)).status, 403);
  });
  test('S-8 준비 업무: 묶음으로 D-n 업무 생성, 일정 날짜를 옮기면 미완료 준비 업무 마감도 이동', async () => {
    const cal = await siteCal(ctx.managerA.client);
    const d = addDays(today, 20);
    const ev = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '봄 GX 개강', start: at(d, '10:00'), end: at(d, '11:00') })).id;
    const { ids } = await ctx.managerA.client.ok('POST', `/api/events/${ev}/prep`, { preset: 'gx_open', assigneeId: ctx.staffA.id });
    assert.equal(ids.length, 3);
    const dues = await Promise.all(ids.map(async (id) => (await ctx.managerA.client.ok('GET', `/api/tasks/${id}`)).task));
    assert.deepEqual(dues.map((t) => t.due_date).sort(), [addDays(d, -7), addDays(d, -5), addDays(d, -1)].sort());
    const doneId = dues.find((t) => t.due_date === addDays(d, -1)).id;
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${doneId}`, { status: 'done' });
    const nd = addDays(d, 3);
    await ctx.managerA.client.ok('PATCH', `/api/events/${ev}`, { start: at(nd, '10:00'), end: at(nd, '11:00'), scope: 'all' });
    const after = await Promise.all(ids.map(async (id) => (await ctx.managerA.client.ok('GET', `/api/tasks/${id}`)).task));
    assert.ok(after.some((t) => t.due_date === addDays(nd, -7)) && after.some((t) => t.due_date === addDays(nd, -5)), '미완료 준비 업무 이동');
    assert.equal(after.find((t) => t.id === doneId).due_date, addDays(d, -1), '완료한 준비 업무는 그대로');
  });
  test('S-9 반복 회의 회차마다 업무 1건(중복 없음), 회차 취소 시 그 업무 정리', async () => {
    const cal = await siteCal(ctx.managerA.client);
    const first = addDays(today, 1);
    const ev = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '주간 매니저 회의', start: at(first, '09:00'), end: at(first, '10:00'), rrule: 'FREQ=WEEKLY;COUNT=6', attendeeIds: [ctx.staffA.id] })).id;
    await ctx.managerA.client.ok('POST', `/api/events/${ev}/series`, { title: '주간 보고 작성', daysBefore: 1, assigneeId: ctx.staffA.id });
    await tick(); await tick();
    const mk = async () => (await sql`select et.task_id, et.occurrence_start, t.deleted_at, t.due_date from event_tasks et join tasks t on t.id = et.task_id where et.event_id = ${ev} and et.role = 'series' order by et.occurrence_start`);
    let rows = await mk();
    assert.equal(rows.length, 2, '14일 안 회차 2건 (중복 없음)');
    assert.equal(new Date(rows[0].due_date).toISOString().slice(0, 10) <= first, true);
    const second = rows[1].occurrence_start.toISOString();
    await ctx.managerA.client.ok('DELETE', `/api/events/${ev}?scope=this&occurrenceStart=${encodeURIComponent(second)}`);
    await tick();
    rows = await mk();
    assert.ok(rows.find((r) => r.occurrence_start.toISOString() === second).deleted_at, '취소한 회차 업무 정리');
    assert.equal(rows.filter((r) => !r.deleted_at).length, 1);
  });
  test('S-10 일정 알림에 연결 업무 맥락 (건수만)', async () => {
    const cal = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    const s = new Date(Date.now() + 20 * 60000), e = new Date(Date.now() + 80 * 60000);
    const ev = (await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '협력사 미팅', start: s.toISOString(), end: e.toISOString(), reminderMinutes: [30] })).id;
    const late = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '견적서 회신', orgUnitId: ctx.siteA, dueDate: addDays(today, -1) })).id;
    await ctx.staffA.client.ok('POST', `/api/events/${ev}/tasks`, { taskId: late });
    await tick();
    const n = (await notifs(ctx.staffA.client)).find((x) => x.title.includes('협력사 미팅'));
    assert.ok(n, '알림 생성'); assert.match(n.body, /연결 업무 1건 중 미완료 1건\(지연 1건\)/);
  });
});

describe('네트워크 재시도 중복 방지 (Idempotency-Key)', () => {
  test('같은 키로 두 번 보내도 업무는 하나', async () => {
    const h = { 'idempotency-key': 'retry-key-1' };
    const a = await ctx.staffA.client.req('POST', '/api/tasks', { title: '중복 방지 시험', orgUnitId: ctx.siteA }, h);
    const b = await ctx.staffA.client.req('POST', '/api/tasks', { title: '중복 방지 시험', orgUnitId: ctx.siteA }, h);
    assert.equal(a.body.id, b.body.id);
    assert.equal(b.headers.get('idempotent-replay'), 'true');
    const [{ c }] = await sql`select count(*)::int c from tasks where title = '중복 방지 시험'`;
    assert.equal(c, 1);
  });
  test('댓글도 같은 키 재전송 시 1건', async () => {
    const t = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '댓글 중복', orgUnitId: ctx.siteA })).id;
    const h = { 'idempotency-key': 'retry-comment-1' };
    await ctx.staffA.client.req('POST', `/api/tasks/${t}/comments`, { body: '한 번만' }, h);
    await ctx.staffA.client.req('POST', `/api/tasks/${t}/comments`, { body: '한 번만' }, h);
    const d = await ctx.staffA.client.ok('GET', `/api/tasks/${t}`);
    assert.equal(d.comments.length, 1);
  });
});

describe('알림: 서버 정기 실행·중복 방지·푸시 발송·실패 기록', () => {
  test('기한 초과·마감 임박 알림은 정기 실행을 반복해도 1번만', async () => {
    const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '어제 마감', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, -1) })).id;
    const soon = (await ctx.owner.ok('POST', '/api/tasks', { title: '곧 마감', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 1), dueTime: '00:30' })).id;
    await tick(); await tick();
    const [{ c }] = await sql`select count(*)::int c from notifications where entity_id = ${id} and type = 'overdue' and user_id = ${ctx.staffA.id}`;
    assert.equal(c, 1);
    const [{ r }] = await sql`select count(*)::int r from notifications where entity_id = ${id} and type = 'overdue' and user_id = ${ctx.ownerId}`;
    assert.equal(r, 1, '지시자(만든 사람)에게도 하루 1번');
    const todayTask = (await ctx.owner.ok('POST', '/api/tasks', { title: '오늘 마감 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: today })).id;
    await tick(); await tick();
    const [{ dt }] = await sql`select count(*)::int dt from notifications where entity_id = ${todayTask} and title like '오늘 마감:%'`;
    assert.equal(dt, 1, '오늘 마감 알림 하루 1번');
    const [{ s }] = await sql`select count(*)::int s from notifications where entity_id = ${soon} and type = 'due_soon'`;
    assert.equal(s, 1);
    const [run] = await sql`select status, trigger from job_runs where job = 'tick' order by id desc limit 1`;
    assert.equal(run.status, 'ok');
  });
  test('스케줄러 인증 없으면 401', async () => {
    assert.equal((await fetch(`${BASE}/api/cron/tick`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${BASE}/api/cron/tick`, { method: 'POST', headers: { authorization: 'Bearer wrong' } })).status, 401);
  });
  test('앱(FCM)·웹 푸시 발송, 무효 토큰은 비활성화하고 실패 기록', async () => {
    const c = ctx.staffB.client;
    await c.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-token-good', platform: 'android' });
    await c.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-token-dead', platform: 'ios' });
    const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
    await c.ok('POST', '/api/push/subscribe', { kind: 'webpush', endpoint: `${FAKE_TLS}/webpush/abc`, keys });
    await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fcmUnregister: 'fcm-token-dead' }) });
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '푸시 시험 업무', orgUnitId: ctx.siteB, assigneeId: ctx.staffB.id })).id;
    await new Promise((r) => setTimeout(r, 1500));
    await tick();
    const st = await fetch(`${FAKE}/__state`).then((r) => r.json());
    const msg = st.fcm.find((m) => m.token === 'fcm-token-good');
    assert.ok(msg, 'FCM 수신');
    assert.equal(msg.data.link, `/tasks/${t}`, '알림 탭 → 해당 업무로 이동할 링크');
    assert.ok(msg.data.notificationId, '탭 시 읽음 처리할 알림 id');
    assert.equal(msg.android.notification.click_action, undefined, 'click_action 없음(앱 기본 activity 로 열려야 탭 데이터가 전달됨)');
    assert.ok(st.webpush.some((w) => w.path === '/webpush/abc'), '웹 푸시 수신');
    const dead = await sql`select disabled_at from push_subscriptions where endpoint = 'fcm-token-dead'`;
    assert.ok(dead[0].disabled_at, '무효 토큰 비활성화');
    const failed = await sql`select status, error from notification_deliveries d join push_subscriptions p on p.id = d.subscription_id where p.endpoint = 'fcm-token-dead'`;
    assert.equal(failed[0].status, 'failed');
    // 같은 알림 재발송 없음
    await tick();
    const st2 = await fetch(`${FAKE}/__state`).then((r) => r.json());
    assert.equal(st2.fcm.filter((m) => m.data.link === `/tasks/${t}`).length, 1, '중복 발송 없음');
  });
  test('일정 시작 전 알림: 설정 시간 안에 1회, 불참·끔 사용자는 제외', async () => {
    const cal = (await ctx.managerA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'org_unit').id;
    const start = new Date(Date.now() + 20 * 60000), end = new Date(start.getTime() + 3600e3);
    // staffA: 기본 30분 → 대상, owner: 끔(0) → 제외
    await ctx.owner.ok('PUT', '/api/notifications/prefs', { settings: { dueSoonHours: 24, eventReminderMinutes: 0, quietStart: null, quietEnd: null } });
    const id = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '현장 안전 회의', start: start.toISOString(), end: end.toISOString(), attendeeIds: [ctx.staffA.id, ctx.ownerId] })).id;
    await tick(); await tick();
    const rows = await sql`select user_id from notifications where type = 'event_reminder' and entity_id = ${id}`;
    const users = rows.map((r) => r.user_id).sort();
    assert.deepEqual(users, [ctx.managerA.id, ctx.staffA.id].sort(), '작성자·참석자에게 1회씩, 끈 사용자 제외');
    // 먼 일정은 아직 보내지 않음
    const far = new Date(Date.now() + 5 * 3600e3);
    const id2 = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '먼 회의', start: far.toISOString(), end: new Date(far.getTime() + 3600e3).toISOString(), attendeeIds: [ctx.staffA.id] })).id;
    await tick();
    assert.equal((await sql`select 1 from notifications where type = 'event_reminder' and entity_id = ${id2}`).length, 0);
  });
  test('알림 설정에서 끈 종류는 생성되지 않는다', async () => {
    await ctx.staffB.client.ok('PUT', '/api/notifications/prefs', { types: [{ type: 'task_assigned', inApp: false, push: false }] });
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '알림 끔 시험', orgUnitId: ctx.siteB, assigneeId: ctx.staffB.id })).id;
    const [{ c }] = await sql`select count(*)::int c from notifications where entity_id = ${t}`;
    assert.equal(c, 0);
  });
});

describe('[선택 기능] Google Calendar 양방향 동기화 (가짜 Google API) — 필수 완료 기준 아님', () => {
  let c, linkId, personal;
  const fctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  const fstate = () => fetch(`${FAKE}/__state`).then((r) => r.json());
  const sync = async (full = false) => c.ok('POST', `/api/google/links/${linkId}/sync`, { full });
  before(() => { c = ctx.managerA.client; });

  test('OAuth 연결(사용자가 범위 선택) → 캘린더 선택 → 연결', async () => {
    const r1 = await c.get('/api/google/connect?mode=both');
    assert.equal(r1.status, 302);
    const auth = new URL(r1.headers.get('location'));
    assert.ok(auth.searchParams.get('scope').includes('calendar.events'));
    assert.equal(auth.searchParams.get('access_type'), 'offline');
    const r2 = await fetch(auth, { redirect: 'manual' });
    const cb = new URL(r2.headers.get('location'));
    const r3 = await c.get(cb.pathname + cb.search);
    assert.equal(r3.status, 302);
    assert.ok(r3.headers.get('location').includes('connected=1'));
    const cals = await c.ok('GET', '/api/google/calendars');
    assert.ok(cals.calendars.some((g) => g.primary));
    personal = (await c.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    // 읽기 전용 Google 캘린더는 양방향 불가
    assert.equal((await c.post('/api/google/links', { googleCalendarId: 'readonly@group', localCalendarId: personal, direction: 'both' })).status, 400);
    linkId = (await c.ok('POST', '/api/google/links', { googleCalendarId: 'primary', localCalendarId: personal, direction: 'both' })).id;
  });
  test('기존 Google 일정 가져오기(페이지 여러 개) + 반복 일정 + 참석 상태', async () => {
    const d = addDays(today, 3);
    for (let i = 0; i < 3; i++) await fctl({ googleCreate: { cal: 'primary', event: { summary: `구글 일정 ${i}`, start: { dateTime: `${d}T0${i + 1}:00:00+09:00` }, end: { dateTime: `${d}T0${i + 2}:00:00+09:00` } } } });
    await fctl({ googleCreate: { cal: 'primary', event: { summary: '구글 반복', start: { dateTime: `${d}T18:00:00+09:00`, timeZone: 'Asia/Seoul' }, end: { dateTime: `${d}T19:00:00+09:00` }, recurrence: ['RRULE:FREQ=DAILY;COUNT=3'], attendees: [{ email: ctx.managerA.email, responseStatus: 'accepted' }] } } });
    await fctl({ googleCreate: { cal: 'primary', event: { summary: '구글 종일', start: { date: d }, end: { date: addDays(d, 1) } } } });
    const r = await sync();
    assert.ok(!r.error, JSON.stringify(r));
    const [{ n }] = await sql`select count(*)::int n from google_event_map where link_id = ${linkId}`;
    assert.equal(n, 5, '5건 가져옴 (연결 직후 자동 동기화 또는 수동 동기화)');
    const ev = await c.ok('GET', `/api/events?from=${d}T00:00:00%2B09:00&to=${addDays(d, 4)}T00:00:00%2B09:00`);
    assert.equal(ev.events.filter((e) => e.title === '구글 반복').length, 3);
    const allDay = ev.events.find((e) => e.title === '구글 종일');
    assert.ok(allDay.allDay);
    const rep = ev.events.find((e) => e.title === '구글 반복');
    assert.equal(rep.attendees[0].response, 'accepted');
    // 다시 동기화해도 중복 없음
    const r2 = await sync();
    assert.equal(r2.pulled.created, 0);
  });
  test('회사에서 만든 일정 → Google 생성, 수정 → Google 반영, 삭제 → Google 취소', async () => {
    const d = addDays(today, 4);
    const id = (await c.ok('POST', '/api/events', { calendarId: personal, title: '회사 쪽 일정', start: `${d}T13:00:00+09:00`, end: `${d}T14:00:00+09:00` })).id;
    await sync();
    let st = await fstate();
    let g = Object.values(st.events.primary).find((e) => e.extendedProperties?.private?.workosId === id);
    assert.ok(g, 'Google 에 생성');
    assert.equal(g.summary, '회사 쪽 일정');
    assert.equal(g.start.timeZone, 'Asia/Seoul');
    await c.ok('PATCH', `/api/events/${id}`, { title: '회사 쪽 일정(수정)' });
    await sync();
    st = await fstate();
    g = st.events.primary[g.id];
    assert.equal(g.summary, '회사 쪽 일정(수정)');
    await c.ok('DELETE', `/api/events/${id}?scope=all`);
    await sync();
    st = await fstate();
    assert.equal(st.events.primary[g.id].status, 'cancelled');
  });
  test('Google 에서 수정·삭제 → 웹훅 수신 → 회사 캘린더 반영', async () => {
    const st = await fstate();
    const g = Object.values(st.events.primary).find((e) => e.summary === '구글 일정 0');
    await fctl({ googleEdit: { cal: 'primary', id: g.id, patch: { summary: '구글에서 수정됨' } } });
    const link = (await sql`select channel_id, channel_token from google_calendar_links where id = ${linkId}`)[0];
    assert.ok(link.channel_id, '웹훅 채널 등록됨');
    // 잘못된 토큰 웹훅은 거부
    const bad = await fetch(`${BASE}/api/google/webhook`, { method: 'POST', headers: { 'x-goog-channel-id': link.channel_id, 'x-goog-channel-token': 'wrong', 'x-goog-resource-state': 'exists' } });
    assert.equal(bad.status, 404);
    const ok = await fetch(`${BASE}/api/google/webhook`, { method: 'POST', headers: { 'x-goog-channel-id': link.channel_id, 'x-goog-channel-token': link.channel_token, 'x-goog-resource-state': 'exists' } });
    assert.equal(ok.status, 200);
    let found = false;
    for (let i = 0; i < 20 && !found; i++) {
      await new Promise((r) => setTimeout(r, 300));
      found = (await sql`select 1 from events where title = '구글에서 수정됨' and deleted_at is null`).length > 0;
    }
    assert.ok(found, '웹훅 후 회사 일정 갱신');
    await fctl({ googleDelete: { cal: 'primary', id: g.id } });
    await sync();
    const [row] = await sql`select deleted_at from events where title = '구글에서 수정됨'`;
    assert.ok(row.deleted_at, 'Google 삭제 → 회사 삭제');
  });
  test('양쪽 동시 수정 충돌: 최근 수정이 우선, 충돌 기록 (Google 우선 / 회사 우선)', async () => {
    const st = await fstate();
    const g1 = Object.values(st.events.primary).find((e) => e.summary === '구글 일정 1');
    const g2 = Object.values(st.events.primary).find((e) => e.summary === '구글 일정 2');
    const [m1] = await sql`select local_event_id from google_event_map where google_event_id = ${g1.id}`;
    const [m2] = await sql`select local_event_id from google_event_map where google_event_id = ${g2.id}`;
    // (가) 회사 쪽 수정(아직 Google 미반영) 후 Google 에서 더 나중에 수정 → Google 우선
    await sql`update events set title = '회사에서 먼저 수정', version = version + 1, updated_at = now() - interval '5 seconds' where id = ${m1.local_event_id}`;
    await fctl({ googleEdit: { cal: 'primary', id: g1.id, patch: { summary: 'Google 에서 나중에 수정' } } });
    // (나) Google 에서 먼저 수정 후 회사 쪽에서 더 나중에 수정 → 회사 우선, Google 로 덮어씀
    await fctl({ googleEdit: { cal: 'primary', id: g2.id, patch: { summary: 'Google 에서 먼저 수정' } } });
    await new Promise((r) => setTimeout(r, 50));
    await sql`update events set title = '회사에서 나중에 수정', version = version + 1, updated_at = now() + interval '5 seconds' where id = ${m2.local_event_id}`;
    await sync();
    const [e1] = await sql`select title from events where id = ${m1.local_event_id}`;
    assert.equal(e1.title, 'Google 에서 나중에 수정');
    const [e2] = await sql`select title from events where id = ${m2.local_event_id}`;
    assert.equal(e2.title, '회사에서 나중에 수정');
    const st2 = await fstate();
    assert.equal(st2.events.primary[g2.id].summary, '회사에서 나중에 수정');
    const logs = await sql`select detail from sync_logs where status = 'conflict' and link_id = ${linkId}`;
    assert.ok(logs.some((l) => l.detail.winner === 'google'));
    assert.ok(logs.some((l) => l.detail.winner === 'local'));
  });
  test('동기화 토큰 만료(410) → 전체 재동기화, 중복 없음', async () => {
    const [{ before: n1 }] = await sql`select count(*)::int as before from events where calendar_id = ${personal} and deleted_at is null`;
    await fctl({ expireSyncToken: true });
    const r = await sync();
    assert.ok(!r.error, JSON.stringify(r));
    const [{ after: n2 }] = await sql`select count(*)::int as after from events where calendar_id = ${personal} and deleted_at is null`;
    assert.equal(n2, n1);
  });
  test('권한 만료(invalid_grant) → 재연결 필요 표시 + 알림 → 다시 연결로 복구', async () => {
    await fctl({ invalidGrant: true });
    const r = await sync();
    assert.ok(r.error);
    const s = await c.ok('GET', '/api/google/status');
    assert.equal(s.account.status, 'reauth_required');
    assert.ok((await notifs(c)).some((x) => x.type === 'sync_error'));
    await fctl({ invalidGrant: false });
    const r1 = await c.get('/api/google/connect?mode=both');
    const r2 = await fetch(new URL(r1.headers.get('location')), { redirect: 'manual' });
    const cb = new URL(r2.headers.get('location'));
    await c.get(cb.pathname + cb.search);
    const ok = await sync();
    assert.ok(!ok.error, JSON.stringify(ok));
    assert.equal((await c.ok('GET', '/api/google/status')).account.status, 'active');
  });
  test('연결 해제: Google·회사 일정은 지우지 않는다', async () => {
    const before = (await fstate()).events.primary;
    const live = Object.values(before).filter((e) => e.status !== 'cancelled').length;
    await c.ok('POST', '/api/google/disconnect', {});
    const after = (await fstate()).events.primary;
    assert.equal(Object.values(after).filter((e) => e.status !== 'cancelled').length, live);
    assert.equal((await c.ok('GET', '/api/google/status')).account, null);
    const [{ n }] = await sql`select count(*)::int n from events where calendar_id = ${personal} and deleted_at is null`;
    assert.ok(n > 0);
  });
});

describe('직원 비활성화·퇴사 즉시 차단 + 감사 기록', () => {
  test('퇴사 처리하면 기존 세션이 즉시 끊기고 로그인도 막힌다', async () => {
    const before = await ctx.staffB.client.get('/api/auth/me');
    assert.equal(before.status, 200);
    await ctx.owner.ok('PATCH', `/api/admin/users/${ctx.staffB.id}`, { status: 'left' });
    assert.equal((await ctx.staffB.client.get('/api/auth/me')).status, 401);
    const r = await new Client().post('/api/auth/login', { email: ctx.staffB.email, password: ctx.staffB.password });
    assert.equal(r.status, 403);
    const audit = await ctx.owner.ok('GET', '/api/admin/audit');
    assert.ok(audit.logs.some((l) => l.action === 'user.update' && l.target_id === ctx.staffB.id));
    assert.ok(audit.logs.some((l) => l.action === 'auth.login_blocked'));
  });
  test('소속 변경 → 접근 범위 즉시 변경', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '판교 업무', orgUnitId: ctx.siteB })).id;
    assert.equal((await ctx.staffA.client.get(`/api/tasks/${t}`)).status, 404);
    await ctx.owner.ok('PATCH', `/api/admin/users/${ctx.staffA.id}`, { orgUnitIds: [ctx.siteA, ctx.siteB] });
    assert.equal((await ctx.staffA.client.get(`/api/tasks/${t}`)).status, 200);
    await ctx.owner.ok('PATCH', `/api/admin/users/${ctx.staffA.id}`, { orgUnitIds: [ctx.siteA] });
  });
  test('관리자는 대표 권한을 줄 수 없고, 마지막 대표는 강등 불가', async () => {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'adm@dagym.test', name: '관리자', role: 'admin', orgUnitIds: [] });
    const a = new Client('adm');
    await a.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'admin-pass-123' });
    assert.equal((await a.patch(`/api/admin/users/${ctx.staffA.id}`, { role: 'owner' })).status, 403);
    assert.equal((await a.patch(`/api/admin/users/${ctx.ownerId}`, { status: 'disabled' })).status, 403);
    assert.equal((await ctx.owner.patch(`/api/admin/users/${ctx.ownerId}`, { status: 'disabled' })).status, 400);
  });
});

describe('템플릿', () => {
  test('초기 템플릿 8종이 있고 복사해 업무를 만든다 (체크리스트 포함)', async () => {
    const t = await ctx.staffA.client.ok('GET', '/api/templates');
    const names = t.templates.map((x) => x.name);
    for (const n of ['현장 점검', '회원 민원', 'GX 개강 준비', '계약 갱신', '제안서 제출', '시설 보수', '신규 직원 교육', '월간 보고']) assert.ok(names.includes(n), n);
    const tpl = t.templates.find((x) => x.name === '회원 민원');
    const r = await ctx.staffA.client.ok('POST', `/api/templates/${tpl.id}/apply`, { title: '[회원 민원] 샤워실 온수', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id });
    const d = await ctx.staffA.client.ok('GET', `/api/tasks/${r.id}`);
    assert.equal(d.checklist.length, 5);
    assert.equal(d.task.priority, 'high');
    assert.equal(d.task.due_date, addDays(today, 2));
  });
});

describe('대표 대시보드', () => {
  test('대표는 전사, 직원은 자기 범위만 집계', async () => {
    const o = await ctx.owner.ok('GET', '/api/dashboard');
    assert.equal(o.scope, 'company');
    assert.ok(o.bySite.some((s) => s.name === '하이링크 판교 위탁현장'));
    const s = await ctx.staffA.client.ok('GET', '/api/dashboard');
    assert.equal(s.scope, 'units');
    assert.ok(!s.bySite.some((x) => x.name === '하이링크 판교 위탁현장'));
    for (const k of ['important', 'overdue', 'review', 'bySite', 'workload', 'completion', 'events', 'totals']) assert.ok(k in o, k);
  });
});

describe('WORKIN_V2 홈·매출', () => {
  test('홈: 오늘 할 일(전체)·최근 활동·담당자별 오늘 마감/주간 완료가 권한 범위로 나온다', async () => {
    const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '홈 오늘 마감 업무', orgUnitId: ctx.siteB, assigneeId: ctx.ownerId, dueDate: today })).id;
    await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: '홈 활동 댓글' });
    const o = await ctx.owner.ok('GET', '/api/dashboard');
    assert.ok(o.todayAll.some((t) => t.id === id));
    assert.ok(o.activity.some((a) => a.kind === 'comment' && a.task_id === id));
    assert.ok(o.activity.length <= 10);
    const w = o.workload.find((x) => x.id === ctx.ownerId);
    assert.ok(w.due_today >= 1 && 'done_week' in w);
    const s = await ctx.staffA.client.ok('GET', '/api/dashboard');
    assert.ok(!s.todayAll.some((t) => t.id === id), '다른 현장 업무는 직원에게 안 보임');
    assert.ok(!s.activity.some((a) => a.task_id === id));
  });
  test('매출: 본사만 열람·입력, 그 밖은 404', async () => {
    for (const c of [ctx.staffA.client, ctx.managerA.client]) {
      assert.equal((await c.get('/api/revenue')).status, 404);
      assert.equal((await c.req('PUT', '/api/revenue', { orgUnitId: ctx.siteA, month: '2026-01', revenue: 1 })).status, 404);
    }
    await ctx.owner.ok('PUT', '/api/revenue', { orgUnitId: ctx.siteA, month: '2026-03', revenue: 52000000, expense: 31000000, members: 820, target: 50000000 });
    await ctx.owner.ok('PUT', '/api/revenue', { orgUnitId: ctx.siteA, month: '2026-03', revenue: 53000000, expense: 31000000 }); // 같은 달은 덮어쓰기
    const r = await ctx.owner.ok('GET', '/api/revenue?year=2026');
    const rows = r.rows.filter((x) => x.org_unit_id === ctx.siteA && x.month === '2026-03');
    assert.equal(rows.length, 1); assert.equal(rows[0].revenue, 53000000); assert.equal(rows[0].source, 'manual');
    assert.ok(r.units.some((u) => u.id === ctx.siteB));
    const bad = await ctx.owner.req('PUT', '/api/revenue', { orgUnitId: ctx.siteA, month: '2026-13', revenue: -1 });
    assert.equal(bad.status, 400);
  });
  test('매출 CSV: 오류가 있으면 아무것도 저장하지 않고 줄 번호를 알려 준다, 정상이면 근거 파일명과 함께 저장', async () => {
    const badCsv = '현장,월,매출,지출\n다짐 강남점,2026-04,"41,000,000",20000000\n없는 현장,2026-04,100,0\n';
    const dry = await ctx.owner.ok('POST', '/api/revenue/import', { csv: badCsv, fileName: 'a.csv' });
    assert.equal(dry.ok, false); assert.equal(dry.errors[0].line, 3);
    assert.equal((await sql`select count(*)::int as n from revenue_entries where month = '2026-04-01'`)[0].n, 0);
    const good = '﻿현장,월,매출,지출,회원수,메모\n다짐 강남점,2026.4,"41,000,000",20000000,800,4월 정산표\n하이링크 판교 위탁현장,2026-04,9000000,7000000,,\n';
    const pre = await ctx.owner.ok('POST', '/api/revenue/import', { csv: good, fileName: '2026-04 실적.csv', dryRun: true });
    assert.equal(pre.ok, true); assert.equal(pre.count, 2);
    assert.equal((await sql`select count(*)::int as n from revenue_entries where month = '2026-04-01'`)[0].n, 0, 'dryRun 은 저장 안 함');
    const r = await ctx.owner.ok('POST', '/api/revenue/import', { csv: good, fileName: '2026-04 실적.csv' });
    assert.equal(r.count, 2);
    const [row] = await sql`select revenue::float8 as revenue, source, source_file, members from revenue_entries where org_unit_id = ${ctx.siteA} and month = '2026-04-01'`;
    assert.equal(row.revenue, 41000000); assert.equal(row.source, 'csv'); assert.equal(row.source_file, '2026-04 실적.csv'); assert.equal(row.members, 800);
    assert.equal((await ctx.staffA.client.req('POST', '/api/revenue/import', { csv: good })).status, 404);
  });
});

describe('매출 2·3단계 (대표 승인): 표준 CSV · GPT Action 토큰 · AI 분석', () => {
  test('표준 양식(현장·월·항목·금액·근거파일명): 들어온 항목만 바꾸고 근거 파일명 보관', async () => {
    await ctx.owner.ok('PUT', '/api/revenue', { orgUnitId: ctx.siteB, month: '2026-05', revenue: 7000000, expense: 5000000, members: 300 });
    const csv = '현장,월,항목,금액,근거파일명\n하이링크 판교 위탁현장,2026-05,매출,"8,000,000",5월 정산표.xlsx\n하이링크 판교 위탁현장,2026-05,목표,9000000,5월 목표.xlsx\n';
    const r = await ctx.owner.ok('POST', '/api/revenue/import', { csv, fileName: 'std.csv' });
    assert.equal(r.count, 1);
    const [row] = await sql`select revenue::float8 as revenue, expense::float8 as expense, members, target::float8 as target, source_file from revenue_entries where org_unit_id = ${ctx.siteB} and month = '2026-05-01'`;
    assert.equal(row.revenue, 8000000); assert.equal(row.expense, 5000000, '지출은 그대로'); assert.equal(row.members, 300); assert.equal(row.target, 9000000);
    assert.equal(row.source_file, '5월 정산표.xlsx, 5월 목표.xlsx');
    const bad = await ctx.owner.ok('POST', '/api/revenue/import', { csv: '현장,월,항목,금액\n하이링크 판교 위탁현장,2026-05,포인트,1\n' });
    assert.equal(bad.ok, false); assert.match(bad.errors[0].message, /매출·지출·회원수·목표/);
  });
  test('GPT Action 토큰: 본사만 발급, 원문은 한 번만, 입력만 가능, 폐기하면 401', async () => {
    assert.equal((await ctx.staffA.client.post('/api/revenue/tokens', { name: 'x' })).status, 404);
    const { id, token } = await ctx.owner.ok('POST', '/api/revenue/tokens', { name: 'GPT 자료 운영체계' });
    assert.match(token, /^wk_/);
    const list = await ctx.owner.ok('GET', '/api/revenue/tokens');
    assert.ok(!JSON.stringify(list).includes(token), '목록에 원문 없음');
    const [h] = await sql`select token_hash from api_tokens where id = ${id}`;
    assert.notEqual(h.token_hash, token);
    const send = (t, b) => fetch(BASE + '/api/public/revenue', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${t}`, origin: BASE }, body: JSON.stringify(b) });
    const entries = [{ site: '다짐 강남점', month: '2026-06', item: '매출', amount: 61000000, sourceFile: '6월 정산.xlsx' }, { site: '다짐 강남점', month: '2026-06', item: '회원수', amount: 850 }];
    assert.equal((await send('wk_wrong', { entries })).status, 401);
    const dry = await (await send(token, { entries: [...entries, { site: '없는 현장', month: '2026-06', item: '매출', amount: 1 }] })).json();
    assert.equal(dry.ok, false); assert.equal(dry.errors[0].line, 3);
    assert.equal((await sql`select count(*)::int as n from revenue_entries where month = '2026-06-01'`)[0].n, 0);
    const ok = await (await send(token, { entries })).json();
    assert.equal(ok.count, 1);
    const [row] = await sql`select revenue::float8 as revenue, members, source, source_file from revenue_entries where org_unit_id = ${ctx.siteA} and month = '2026-06-01'`;
    assert.equal(row.revenue, 61000000); assert.equal(row.members, 850); assert.equal(row.source, 'gpt'); assert.equal(row.source_file, '6월 정산.xlsx');
    assert.equal((await fetch(BASE + '/api/revenue', { headers: { authorization: `Bearer ${token}`, origin: BASE } })).status, 401, '토큰으로 조회 불가');
    const spec = await (await fetch(BASE + '/api/public/revenue/openapi.json')).json();
    assert.equal(spec.paths['/api/public/revenue'].post.operationId, 'submitMonthlyRevenue');
    await ctx.owner.ok('DELETE', `/api/revenue/tokens/${id}`);
    assert.equal((await send(token, { entries })).status, 401, '폐기 후 거부');
  });
  test('AI 분석: 집계 숫자만 전송(메모·파일명·개인정보 없음), 입력에 없는 현장 제안은 버림, 본사만', async () => {
    await ctx.owner.ok('PUT', '/api/revenue', { orgUnitId: ctx.siteA, month: '2026-07', revenue: 70000000, expense: 40000000, note: '비밀 메모 김대표 010-1234-5678' });
    assert.equal((await ctx.staffA.client.post('/api/revenue/ai', { period: '2026-07' })).status, 404);
    const { report } = await ctx.owner.ok('POST', '/api/revenue/ai', { period: '2026-07' });
    assert.equal(report.output.anomalies.length, 1, '없는 현장 제안 제거');
    assert.equal(report.output.anomalies[0].site, '다짐 강남점');
    const st = await (await fetch(FAKE + '/__state')).json();
    const sent = st.openai.at(-1);
    assert.equal(sent.auth, 'Bearer sk-fake-test');
    const payload = JSON.stringify(sent.body);
    for (const bad of ['비밀 메모', '010-1234-5678', '정산.xlsx', '@dagym.test', '김대표']) assert.ok(!payload.includes(bad), `보내면 안 되는 값: ${bad}`);
    assert.ok(payload.includes('70000000'));
    const again = await ctx.owner.ok('GET', '/api/revenue/ai?period=2026-07');
    assert.equal(again.report.id, report.id);
    assert.equal((await ctx.owner.post('/api/revenue/ai', { period: '2020-01' })).status, 400, '실적 없는 달');
  });
});

describe('데모(체험) 계정 격리 — is_demo 조직·계정은 밖을 못 보고, 대표 화면에도 섞이지 않음', () => {
  test('체험 계정: 회사 일정·관리자 명단·전사 템플릿·검색 사람 안 보임, 대표 목록에 데모 업무 없음', async () => {
    assert.equal((await ctx.owner.req('POST', '/api/admin/org-units', { name: 'x', type: 'branch', parentId: ctx.hq, isDemo: true })).status, 400, '격리 조직은 최상위만');
    const unit = (await ctx.owner.ok('POST', '/api/admin/org-units', { name: '격리 시험 지점', type: 'branch', parentId: null, isDemo: true })).id;
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'iso@dagym.test', name: '격리직원', role: 'staff', orgUnitIds: [unit] });
    const c = new Client('iso');
    await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'iso-pass-1234' });
    const [iso] = await sql`select is_demo from users where email = 'iso@dagym.test'`;
    assert.equal(iso.is_demo, true, '격리 조직에만 소속된 직원은 체험(격리) 계정이 됨 — 사용자 관리 화면 초대만으로');
    const compCal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'company');
    const ev = (await ctx.owner.ok('POST', '/api/events', { calendarId: compCal.id, title: '전사 비공개 회의', start: `${today}T15:00:00+09:00`, end: `${today}T16:00:00+09:00` })).id;
    await ctx.owner.ok('POST', '/api/templates', { name: '전사 템플릿 비공개', payload: { title: '전사' } }).catch(() => {});
    const org = await c.ok('GET', '/api/org');
    assert.ok(!org.users.some((u) => u.role === 'owner'), '대표 이름·이메일 안 보임');
    assert.deepEqual(org.orgUnits.map((o) => o.id), [unit]);
    assert.ok(!(await c.ok('GET', '/api/calendars')).calendars.some((x) => x.type === 'company'));
    assert.equal((await c.get(`/api/events/${ev}`)).status, 404);
    const evs = await c.ok('GET', `/api/events?from=${today}T00:00:00%2B09:00&to=${addDays(today, 1)}T00:00:00%2B09:00`);
    assert.ok(!evs.events.some((e) => e.id === ev));
    const sr = await c.ok('GET', '/api/search?q=' + encodeURIComponent('김'));
    assert.ok(!JSON.stringify(sr).includes('김대표'));
    assert.ok(!(await c.ok('GET', '/api/templates')).templates.some((t) => t.org_unit_id === null));
    assert.ok(!(await c.ok('GET', '/api/approval-lines')).lines?.some?.((l) => l.org_unit_id === null));
    // 밖의 사람에게 배정·밖의 프로젝트에 넣기 불가
    assert.equal((await c.post('/api/tasks', { title: 'x', orgUnitId: unit, assigneeId: ctx.ownerId })).status, 400);
    const proj = (await sql`select id from projects where org_unit_id <> ${unit} limit 1`)[0];
    if (proj) assert.ok([400, 403, 404].includes((await c.post('/api/tasks', { title: 'x', orgUnitId: unit, projectId: proj.id })).status));
    const t = (await c.ok('POST', '/api/tasks', { title: '데모 전용 업무', orgUnitId: unit })).id;
    // 대표 쪽: 데모 업무·데모 사람은 섞이지 않음
    assert.ok(!(await ctx.owner.ok('GET', '/api/tasks?limit=500')).tasks.some((x) => x.id === t));
    assert.ok(!(await ctx.owner.ok('GET', '/api/org')).users.some((u) => u.email === 'iso@dagym.test'));
    assert.ok(!(await ctx.owner.ok('GET', '/api/revenue')).units.some((u) => u.id === unit));
  });
});

describe('WORKIN_V3 서로 배정 · 지시자 · 직접 순서', () => {
  let hq2;
  test('본사 직원끼리 서로 배정 → 배정받은 사람이 보고, 본사 직원은 본사 아래 전체를 본다', async () => {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'hq2@dagym.test', name: '김민수', role: 'staff', orgUnitIds: [ctx.hq] });
    hq2 = new Client('hq2');
    await hq2.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'hq2-pass-1234' });
    const me = (await hq2.ok('GET', '/api/auth/me')).user;
    hq2.id = me.id;
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '본사 서로 배정', orgUnitId: ctx.hq, assigneeId: me.id })).id;
    assert.equal((await hq2.ok('GET', `/api/tasks/${t}`)).task.assignee_id, me.id);
    const back = (await hq2.ok('POST', '/api/tasks', { title: '대표님께 요청', orgUnitId: ctx.hq, assigneeId: ctx.ownerId })).id;
    assert.equal((await ctx.owner.ok('GET', `/api/tasks/${back}`)).task.requested_by, me.id, '지시자 기본 = 만든 사람');
    const list = await hq2.ok('GET', '/api/tasks?limit=500');
    assert.ok(list.tasks.some((x) => x.org_unit_id === ctx.siteA), '본사 직원은 현장 업무도 열람');
    assert.ok((await hq2.ok('GET', '/api/org')).users.some((u) => u.id === ctx.ownerId), '담당자 목록에 대표');
  });
  test('지시자: 직접 지정·변경 이력·"내가 지시한 업무"·지시자 필터, 완료·검토 요청 시 지시자 알림', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '지시자 시험', orgUnitId: ctx.hq, assigneeId: hq2.id, requestedById: ctx.managerA.id })).id;
    assert.equal((await ctx.owner.ok('GET', `/api/tasks/${t}`)).task.requested_by_name, '최매니저');
    assert.equal((await ctx.owner.req('POST', '/api/tasks', { title: 'x', orgUnitId: ctx.hq, requestedById: '00000000-0000-0000-0000-00000000dead' })).status, 400);
    const d0 = await ctx.owner.ok('GET', `/api/tasks/${t}`);
    await ctx.owner.ok('PATCH', `/api/tasks/${t}`, { requestedById: ctx.ownerId, version: d0.task.version });
    const d1 = await ctx.owner.ok('GET', `/api/tasks/${t}`);
    assert.ok(d1.history.some((h) => h.changes?.requestedById?.to === ctx.ownerId), '변경 이력');
    const mine = await ctx.owner.ok('GET', '/api/tasks?view=requested&limit=500');
    assert.ok(mine.tasks.every((x) => x.requested_by === ctx.ownerId) && mine.tasks.some((x) => x.id === t));
    assert.ok((await ctx.owner.ok('GET', `/api/tasks?requestedById=${ctx.ownerId}&limit=500`)).tasks.some((x) => x.id === t));
    await hq2.ok('PATCH', `/api/tasks/${t}`, { status: 'review', version: d1.task.version }); // 관리자 확인 업무 → 검토 요청
    const n = (await ctx.owner.ok('GET', '/api/notifications')).items;
    assert.ok(n.some((x) => x.type === 'task_done_for_requester' && x.link === `/tasks/${t}`), '지시자에게 완료 알림');
  });
  test('직접 순서: 보이는 순서대로 저장, 권한 밖 업무는 건너뜀', async () => {
    const ids = [];
    for (const n of ['순서 A', '순서 B', '순서 C']) ids.push((await ctx.owner.ok('POST', '/api/tasks', { title: n, orgUnitId: ctx.hq, assigneeId: ctx.ownerId })).id);
    const other = (await ctx.staffB.client.req('GET', '/api/tasks?limit=1')).status; // staffB 는 판교 소속
    const r = await ctx.owner.ok('POST', '/api/tasks/reorder', { ids: [ids[2], ids[0], ids[1]] });
    assert.equal(r.updated, 3);
    const rows = await sql`select id, sort_order from tasks where id = any(${ids}::uuid[]) order by sort_order`;
    assert.deepEqual(rows.map((x) => x.id), [ids[2], ids[0], ids[1]]);
    const s = await ctx.staffA.client.ok('POST', '/api/tasks/reorder', { ids: [ids[1], ids[0]] });
    assert.equal(s.updated, 0, '다른 조직 직원은 본사 업무 순서를 못 바꿈');
    assert.ok(other >= 200);
  });
});

describe('심사용 체험 계정 (대표 결정 A — 비밀번호 없는 로그인 없음)', () => {
  test('대표만 → 격리 조직·예시 데이터·초대 링크, 심사 계정은 예시만 보고 회사 데이터는 404, 대표 화면엔 안 섞임, 다시 누르면 예시 초기화', async () => {
    assert.equal((await ctx.managerA.client.post('/api/admin/review-account', { email: 'review@workin.test' })).status, 403);
    assert.equal((await ctx.owner.req('POST', '/api/admin/review-account', { email: ctx.staffA.email })).status, 400, '회사 계정 이메일 불가');
    const r = await ctx.owner.ok('POST', '/api/admin/review-account', { email: 'review@workin.test' });
    assert.ok(r.invitePath.startsWith('/invite/'));
    assert.equal(r.sample.tasks, 7);
    const c = new Client('review');
    await c.ok('POST', `/api/invitations/${r.invitePath.split('/').pop()}/accept`, { password: 'review-pass-1234' }); // 비밀번호는 대표가 링크에서 직접
    const me = await c.ok('GET', '/api/auth/me');
    assert.equal(me.user.role, 'site_manager');
    const list = await c.ok('GET', '/api/tasks?limit=500');
    assert.ok(list.tasks.length >= 7 && list.tasks.every((t) => t.org_unit_id === r.unitId), '예시 업무만');
    assert.ok(list.tasks.some((t) => t.assignee_id === me.user.id), '심사 계정에게 배정된 예시');
    const other = (await ctx.owner.ok('POST', '/api/tasks', { title: '회사 비밀 업무', orgUnitId: ctx.hq })).id;
    assert.equal((await c.get(`/api/tasks/${other}`)).status, 404);
    assert.ok(!(await c.ok('GET', '/api/org')).users.some((u) => u.role === 'owner'));
    for (const path of ['/api/admin/users', '/api/admin/ops', '/api/revenue', '/api/reports']) assert.ok([403, 404].includes((await c.get(path)).status), path);
    const t = list.tasks.find((x) => x.assignee_id === me.user.id && x.status !== 'done');
    await c.ok('PATCH', `/api/tasks/${t.id}`, { status: 'done', version: t.version });
    const add = await c.ok('POST', '/api/tasks', { title: '심사 중 추가', orgUnitId: r.unitId });
    assert.ok(add.id);
    assert.ok(!(await ctx.owner.ok('GET', '/api/tasks?limit=500')).tasks.some((x) => x.org_unit_id === r.unitId), '대표 화면에 체험 데이터 없음');
    const again = await ctx.owner.ok('POST', '/api/admin/review-account', { email: 'review@workin.test' });
    assert.equal(again.alreadyActive, true); assert.equal(again.invitePath, null);
    const after = await c.ok('GET', '/api/tasks?limit=500');
    assert.ok(!after.tasks.some((x) => x.title === '심사 중 추가'), '예시 초기화');
    assert.ok((await c.ok('GET', '/api/notifications')).items.length >= 1, '예시 알림');
  });
});

describe('WORKIN_V4 본사 사람끼리 일정 보기 · 비공개', () => {
  test('본사 소속·대표는 서로의 개인 일정을 보고, 비공개는 "바쁨"(내용·메모 없음), 현장 직원에게는 안 보임', async () => {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'hqcal@dagym.test', name: '김소담', role: 'staff', orgUnitIds: [ctx.hq] });
    const c = new Client('hqcal');
    await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'hqcal-pass-1234' });
    const me = (await c.ok('GET', '/api/auth/me')).user;
    const d = addDays(today, 2);
    const ownerCal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    const open = (await ctx.owner.ok('POST', '/api/events', { calendarId: ownerCal, title: '대표 거래처 미팅', location: '본사 3층', start: `${d}T10:00:00+09:00`, end: `${d}T11:00:00+09:00` })).id;
    const priv = (await ctx.owner.ok('POST', '/api/events', { calendarId: ownerCal, title: '대표 병원 예약', location: '비밀 장소', start: `${d}T15:00:00+09:00`, end: `${d}T16:00:00+09:00`, isPrivate: true })).id;
    const q = `/api/events?from=${d}T00:00:00%2B09:00&to=${addDays(d, 1)}T00:00:00%2B09:00`;
    const seen = (await c.ok('GET', q)).events;
    const o = seen.find((e) => e.id === open);
    assert.ok(o, '본사 직원이 대표 개인 일정을 봄');
    assert.equal(o.ownerId, ctx.ownerId); assert.equal(o.ownerName, '김대표'); assert.equal(o.title, '대표 거래처 미팅');
    const p = seen.find((e) => e.id === priv);
    assert.equal(p.title, '바쁨'); assert.equal(p.location, ''); assert.equal(p.masked, true);
    const det = await c.ok('GET', `/api/events/${priv}`);
    assert.equal(det.event.title, '바쁨'); assert.equal(det.event.location, ''); assert.equal(det.perms.edit, false);
    assert.equal((await c.get(`/api/events/${priv}/notes`)).status, 404, '비공개 일정 메모는 없는 것처럼');
    assert.equal((await c.req('PATCH', `/api/events/${open}`, { title: '바꿈' })).status, 403, '남의 일정은 보기만');
    // 주인은 그대로 보임
    assert.equal((await ctx.owner.ok('GET', q)).events.find((e) => e.id === priv).title, '대표 병원 예약');
    // 현장 직원에게는 대표 개인 일정 안 보임
    assert.ok(!(await ctx.staffA.client.ok('GET', q)).events.some((e) => e.id === open || e.id === priv));
    assert.equal((await ctx.staffA.client.get(`/api/events/${open}`)).status, 404);
    // 대표도 본사 직원 일정을 봄
    const myCal = (await c.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    const mine = (await c.ok('POST', '/api/events', { calendarId: myCal, title: '김소담 외근', start: `${d}T13:00:00+09:00`, end: `${d}T14:00:00+09:00` })).id;
    assert.ok((await ctx.owner.ok('GET', q)).events.some((e) => e.id === mine && e.ownerId === me.id));
  });
});

describe('WORKIN_V5 일정 ↔ 업무 연동 ("업무에도 추가") · 반복', () => {
  test('일정 만들 때 업무에도 추가 → 같은 날짜 업무, 일정 이동 → 마감 이동, 마감 변경 → 일정 이동, 연결 삭제', async () => {
    const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    const d = addDays(today, 4);
    const r = await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: 'V5 거래처 방문', start: `${d}T14:00:00+09:00`, end: `${d}T15:30:00+09:00`, alsoTask: true });
    assert.ok(r.taskId, '연결 업무 생성');
    let t = (await ctx.owner.ok('GET', `/api/tasks/${r.taskId}`)).task;
    assert.equal(t.title, 'V5 거래처 방문'); assert.equal(t.due_date, d); assert.equal(t.due_time, '14:00');
    assert.equal(t.assignee_id, ctx.ownerId); assert.equal(t.requested_by, ctx.ownerId);
    const det = await ctx.owner.ok('GET', `/api/events/${r.id}`);
    assert.equal(det.syncTask.id, r.taskId);
    const q = `/api/events?from=${d}T00:00:00%2B09:00&to=${addDays(d, 1)}T00:00:00%2B09:00`;
    assert.equal((await ctx.owner.ok('GET', q)).events.find((e) => e.id === r.id).linkedTask.id, r.taskId, '캘린더 블록에 연결 표시');
    // 일정 이동 → 업무 마감 이동
    const d2 = addDays(d, 2);
    await ctx.owner.ok('PATCH', `/api/events/${r.id}`, { start: `${d2}T09:00:00+09:00`, end: `${d2}T10:30:00+09:00` });
    t = (await ctx.owner.ok('GET', `/api/tasks/${r.taskId}`)).task;
    assert.equal(t.due_date, d2); assert.equal(t.due_time, '09:00');
    // 업무 마감 변경 → 일정 이동(길이 유지)
    const d3 = addDays(d, 5);
    await ctx.owner.ok('PATCH', `/api/tasks/${r.taskId}`, { dueDate: d3, dueTime: '16:00' });
    const ev = (await ctx.owner.ok('GET', `/api/events/${r.id}`)).event;
    assert.equal(new Date(ev.start_at).toISOString(), new Date(`${d3}T16:00:00+09:00`).toISOString());
    assert.equal(new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime(), 90 * 60000, '길이 유지');
    const le = (await ctx.owner.ok('GET', `/api/tasks/${r.taskId}/events`)).events ?? (await ctx.owner.ok('GET', `/api/tasks/${r.taskId}/events`));
    assert.ok(JSON.stringify(le).includes(r.id), '업무 상세에 연결된 일정');
    // 일정 삭제 + 연결 업무도 삭제
    const del = await ctx.owner.ok('DELETE', `/api/events/${r.id}?scope=all&alsoTask=1`);
    assert.equal(del.tasksDeleted, 1);
    assert.equal((await ctx.owner.get(`/api/tasks/${r.taskId}`)).status, 404);
    // 반대 방향: 업무 삭제 + 연결 일정도 삭제, 그냥 삭제면 일정은 남음
    const r2 = await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: 'V5 둘째', start: `${d}T10:00:00+09:00`, end: `${d}T11:00:00+09:00`, alsoTask: true });
    const del2 = await ctx.owner.ok('DELETE', `/api/tasks/${r2.taskId}?alsoEvent=1`);
    assert.equal(del2.eventsDeleted, 1);
    assert.equal((await ctx.owner.get(`/api/events/${r2.id}`)).status, 404);
    const r3 = await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: 'V5 셋째', start: `${d}T11:00:00+09:00`, end: `${d}T12:00:00+09:00` });
    const linked = await ctx.owner.ok('PATCH', `/api/events/${r3.id}`, { alsoTask: true });
    assert.ok(linked.taskId, '기존 일정에도 업무에도 추가');
    await ctx.owner.ok('DELETE', `/api/tasks/${linked.taskId}`);
    await ctx.owner.ok('GET', `/api/events/${r3.id}`);
  });
  test('반복 일정 + 업무에도 추가 = 같은 규칙의 반복 업무 하나, 완료하면 다음 회차', async () => {
    const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    const d = addDays(today, 1);
    const r = await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: 'V5 주간 회의', start: `${d}T09:00:00+09:00`, end: `${d}T10:00:00+09:00`, rrule: 'FREQ=WEEKLY;COUNT=4', alsoTask: true });
    const t = (await ctx.owner.ok('GET', `/api/tasks/${r.taskId}`)).task;
    assert.match(t.recurrence_rule, /FREQ=WEEKLY/); assert.equal(t.due_date, d);
    assert.equal((await sql`select count(*)::int n from tasks where title = 'V5 주간 회의' and deleted_at is null`)[0].n, 1, '회차마다 만들지 않음');
    await ctx.owner.ok('PATCH', `/api/tasks/${r.taskId}`, { status: 'done', version: t.version });
    const next = await sql`select to_char(due_date,'YYYY-MM-DD') d from tasks where recurrence_source_id = ${r.taskId} and deleted_at is null`;
    assert.equal(next[0]?.d, addDays(d, 7), '다음 회차 업무');
  });
  test('권한: 볼 수 없는 사람(현장 직원)은 대표 개인 일정에 업무 연결 불가(404)', async () => {
    const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    const d = addDays(today, 3);
    const r = await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: 'V5 권한', start: `${d}T10:00:00+09:00`, end: `${d}T11:00:00+09:00` });
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/events/${r.id}`, { alsoTask: true })).status, 404);
  });
});
