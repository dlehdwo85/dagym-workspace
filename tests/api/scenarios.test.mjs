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
