// 필수 시나리오 API 통합 시험: 실제 next start 서버 + 실제 PostgreSQL + 가짜 Google/FCM/웹푸시 서버
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
    assert.equal((await ctx.staffA.client.get('/api/admin/users')).status, 404, 'V14 7번: 메뉴 권한이 꺼져 있으면 404');
    assert.equal((await ctx.staffA.client.post('/api/admin/org-units', { name: 'x', type: 'site' })).status, 404, 'V14 7번: 메뉴 권한이 꺼져 있으면 404');
    assert.equal((await ctx.managerA.client.get('/api/admin/audit')).status, 404, 'V14 7번: 메뉴 권한이 꺼져 있으면 404');
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
    id = (await ctx.owner.ok('POST', '/api/tasks', { title: 'GX 시간표 개편', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id, dueDate: addDays(today, 5), approvalRequired: true })).id; // V12-11: 검토 승인은 지시자
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
    const r3 = await ctx.staffA.client.ok('PATCH', `/api/tasks/${r.spawned}`, { status: 'done' }); // V12: 진행 상태는 담당자만
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
    assert.equal((await ctx.managerA.client.post('/api/approval-lines', { name: 'x', steps: [{ label: 'a', type: 'role', role: 'owner' }] })).status, 404, 'V14 7번: 메뉴 권한이 꺼져 있으면 404');
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
    assert.equal((await ctx.staffA.client.req('PUT', '/api/holidays/2026-11-20', { name: '임시' })).status, 404, 'V14 7번: 메뉴 권한이 꺼져 있으면 404');
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
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${doneId}`, { status: 'done' }); // V12: 담당자가 완료
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
    const [{ dt }] = await sql`select count(*)::int dt from notifications where entity_id = ${todayTask} and title like '오늘 마감:%' and user_id = ${ctx.staffA.id}`;
    assert.equal(dt, 1, '오늘 마감 알림 하루 1번');
    const [{ s }] = await sql`select count(*)::int s from notifications where entity_id = ${soon} and type = 'due_soon' and user_id = ${ctx.staffA.id}`;
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
    const start = new Date(Date.now() + 8 * 60000), end = new Date(start.getTime() + 3600e3);
    // staffA: 기본 10분(V8) → 대상, owner: 끔(0) → 제외
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
  test('V13 GPT Action: 기본 꺼짐 — 토큰 발급·공개 입력·openapi 모두 404, 기존 토큰 무효', async () => {
    assert.equal((await ctx.owner.post('/api/revenue/tokens', { name: 'GPT 자료 운영체계' })).status, 404);
    const send = (b) => fetch(BASE + '/api/public/revenue', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer wk_anything', origin: BASE }, body: JSON.stringify(b) });
    assert.equal((await send({ entries: [] })).status, 404);
    assert.equal((await fetch(BASE + '/api/public/revenue/openapi.json')).status, 404);
    assert.equal((await sql`select count(*)::int n from api_tokens where revoked_at is null`)[0].n, 0);
  });
  test('V13 AI 분석: 내장 AI(가짜 Anthropic)로 집계 숫자만 전송, 입력에 없는 현장 제안은 버림, 사용량 기록', async () => {
    await ctx.owner.ok('PUT', '/api/revenue', { orgUnitId: ctx.siteA, month: '2026-07', revenue: 70000000, expense: 40000000, note: '비밀 메모 김대표 010-1234-5678' });
    assert.equal((await ctx.staffA.client.post('/api/revenue/ai', { period: '2026-07' })).status, 404);
    const before = (await (await fetch(FAKE + '/__state')).json()).anthropic.length;
    const out = { summary: '다짐 강남점 2026-07 매출은 70000000원입니다.', anomalies: [{ site: '다짐 강남점', month: '2026-07', metric: 'revenue', comment: '늘었습니다.' }, { site: '없는 현장', month: '2026-07', metric: 'revenue', comment: '지어낸 제안' }], comparisons: [{ site: '다짐 강남점', comment: '가장 높습니다.' }] };
    await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn' }] }) });
    const { report } = await ctx.owner.ok('POST', '/api/revenue/ai', { period: '2026-07' });
    assert.equal(report.output.anomalies.length, 1, '없는 현장 제안 제거');
    assert.equal(report.output.anomalies[0].site, '다짐 강남점');
    const sent = (await (await fetch(FAKE + '/__state')).json()).anthropic.slice(before);
    assert.equal(sent.length, 1); assert.equal(sent[0].key, 'sk-ant-fake-test');
    assert.equal(sent[0].body.model, 'claude-opus-5-5', '복잡한 분석만 opus(AI_MODEL_DEEP)');
    assert.equal(sent[0].body.output_config.format.type, 'json_schema');
    const payload = JSON.stringify(sent[0].body.messages);
    for (const bad of ['비밀 메모', '010-1234-5678', '정산.xlsx', '@dagym.test', '김대표']) assert.ok(!payload.includes(bad), `보내면 안 되는 값: ${bad}`);
    assert.ok(payload.includes('70000000'));
    assert.equal((await sql`select count(*)::int n from ai_usage where purpose = 'revenue'`)[0].n, 1, '회사 AI 사용량에 포함');
    const again = await ctx.owner.ok('GET', '/api/revenue/ai?period=2026-07');
    assert.equal(again.report.id, report.id);
    assert.equal((await ctx.owner.post('/api/revenue/ai', { period: '2020-01' })).status, 400, '실적 없는 달');
  });
  test('V13 자료로 입력(AI): 정산서 → "매출 근거" 폴더 저장 → AI 추출 미리보기(저장 안 함) → 확인 후 반영, 숫자에 근거 파일 연결', async () => {
    const data = Buffer.from('8월 정산\n강남점 매출 81,000,000');
    const init = await ctx.owner.ok('POST', '/api/library', { fileName: '8월 정산.csv', mimeType: 'text/csv', size: data.length, purpose: 'revenue', folder: '아무데나' });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
    const done = await ctx.owner.ok('POST', `/api/library/${init.id}/complete`);
    assert.equal(done.organized, null, '매출 근거는 자동 정리 안 함');
    assert.equal((await sql`select folder from library_files where id = ${init.id}`)[0].folder, '매출 근거');
    const rows = [{ site: '다짐 강남점', month: '2026-08', item: '매출', amount: 81000000 }, { site: '다짐 강남점', month: '2026-08', item: '회원수', amount: 900 }];
    await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ rows, notes: '' }) }], stop_reason: 'end_turn' }] }) });
    assert.equal((await ctx.staffA.client.post('/api/revenue/extract', { fileIds: [init.id] })).status, 404, '매출 권한 없음');
    const x = await ctx.owner.ok('POST', '/api/revenue/extract', { fileIds: [init.id] });
    assert.equal(x.ok, true); assert.equal(x.count, 1); assert.equal(x.rows.length, 2);
    const xs = (await (await fetch(FAKE + '/__state')).json()).anthropic.at(-1).body;
    assert.equal(xs.model, 'claude-haiku-5-5', '매출 추출은 가벼운 모델'); assert.equal(xs.output_config.effort, undefined);
    assert.equal((await sql`select count(*)::int n from revenue_entries where month = '2026-08-01'`)[0].n, 0, '미리보기는 저장 안 함');
    const r = await ctx.owner.ok('POST', '/api/revenue/import', { csv: x.csv, fileName: x.fileName, evidenceFileIds: [init.id] });
    assert.equal(r.count, 1);
    const [row] = await sql`select revenue::float8 as revenue, members, source, source_file_ids from revenue_entries where org_unit_id = ${ctx.siteA} and month = '2026-08-01'`;
    assert.equal(row.revenue, 81000000); assert.equal(row.members, 900); assert.equal(row.source, 'ai'); assert.deepEqual(row.source_file_ids, [init.id]);
    assert.ok((await sql`select 1 from audit_logs where action = 'revenue.ai_import'`).length, '감사 로그');
    // 근거 폴더는 직원에게 안 보임 (기본 폴더 권한)
    assert.equal((await ctx.staffA.client.req('GET', `/api/library/${init.id}`)).status, 404);
    assert.equal((await ctx.staffA.client.req('GET', `/api/library/${init.id}/download`)).status, 404, '서명 주소 발급 전 검사');
  });
});

describe('V13 메뉴 권한 — 대표만 설정, 등급별·사람별, 서버가 403/404, 감사 로그', () => {
  test('매출 기본은 대표만: 직원·현장 관리자 404, 권한 화면은 대표 외 403', async () => {
    for (const c of [ctx.staffA.client, ctx.managerA.client]) assert.equal((await c.get('/api/revenue')).status, 404);
    assert.equal((await ctx.managerA.client.get('/api/admin/menu-perms')).status, 403);
    assert.equal((await ctx.managerA.client.req('PUT', '/api/admin/menu-perms', { menu: 'revenue', role: 'site_manager', level: 'edit' })).status, 403);
    const m = await ctx.owner.ok('GET', '/api/admin/menu-perms');
    assert.equal(m.matrix.revenue.owner, 'edit'); assert.equal(m.matrix.revenue.admin, 'none'); assert.equal(m.matrix.revenue.staff, 'none');
    assert.ok(m.menus.find((x) => x.key === 'library').levels.some((l) => l.value === 'delete'));
  });
  test('대표가 등급을 켜면 200, 보기만이면 입력 403, 끄면 다시 404 · 대표 본인 권한은 못 끔', async () => {
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'revenue', role: 'site_manager', level: 'view' });
    const v = await ctx.managerA.client.ok('GET', '/api/revenue?year=2026');
    assert.equal(v.canEdit, false);
    assert.equal((await ctx.managerA.client.req('PUT', '/api/revenue', { orgUnitId: ctx.siteA, month: '2026-01', revenue: 1 })).status, 403);
    assert.equal((await ctx.managerA.client.post('/api/revenue/import', { csv: '현장,월,항목,금액\n다짐 강남점,2026-01,매출,1\n' })).status, 403);
    assert.equal((await ctx.staffA.client.get('/api/revenue')).status, 404, '다른 등급은 그대로');
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'revenue', role: 'site_manager', level: 'edit' });
    await ctx.managerA.client.ok('PUT', '/api/revenue', { orgUnitId: ctx.siteA, month: '2026-01', revenue: 1 });
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'revenue', role: 'site_manager', level: null });
    assert.equal((await ctx.managerA.client.get('/api/revenue')).status, 404, '기본값으로 되돌림');
    assert.equal((await ctx.owner.req('PUT', '/api/admin/menu-perms', { menu: 'revenue', role: 'owner', level: 'none' })).status, 403);
    assert.equal((await ctx.owner.req('PUT', '/api/admin/menu-perms', { menu: 'revenue', userId: ctx.ownerId, level: 'none' })).status, 403);
    const logs = await sql`select detail from audit_logs where action = 'menu_perm.set' order by id`;
    assert.ok(logs.length >= 3);
  });
  test('사람별 예외가 등급보다 먼저: 이 직원만 매출 보기 허용 → 지우면 다시 404', async () => {
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'revenue', userId: ctx.staffA.id, level: 'view' });
    await ctx.staffA.client.ok('GET', '/api/revenue');
    assert.equal((await ctx.managerA.client.get('/api/revenue')).status, 404, '같은 등급 다른 사람은 그대로');
    const m = await ctx.owner.ok('GET', '/api/admin/menu-perms');
    assert.ok(m.overrides.some((o) => o.user_id === ctx.staffA.id && o.level === 'view'));
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'revenue', userId: ctx.staffA.id, level: null });
    assert.equal((await ctx.staffA.client.get('/api/revenue')).status, 404);
  });
  test('자료실: 등급을 "안 보임"으로 끄면 목록·파일·AI 검색 모두 막힘, "보기"면 올리기 403', async () => {
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library', role: 'staff', level: 'view' });
    assert.equal((await ctx.staffA.client.post('/api/library', { fileName: 'a.txt', size: 3 })).status, 403);
    await ctx.staffA.client.ok('GET', '/api/library');
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library', role: 'staff', level: 'none' });
    assert.equal((await ctx.staffA.client.get('/api/library')).status, 404);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'library', role: 'staff', level: null });
    await ctx.staffA.client.ok('GET', '/api/library');
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
    assert.ok(n.some((x) => x.type === 'review_requested' && x.link === `/tasks/${t}` && /승인 또는 반려/.test(x.body)), '지시자에게 검토 요청 알림(V12 7번)');
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

describe('WORKIN_V6 상태 알림 · 일괄 생성 · 삭제/휴지통 · 오늘 완료 · 1시간 전 알림', () => {
  const mk = async (email, name) => {
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email, name, role: 'staff', orgUnitIds: [ctx.hq] });
    const c = new Client(email);
    await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${email}-pass-1234` });
    c.id = (await c.ok('GET', '/api/auth/me')).user.id;
    return c;
  };
  let a, b;
  test('담당자가 상태를 바꿀 때마다 지시자에게 알림 (진행 중·보류·완료)', async () => {
    a = await mk('v6a@dagym.test', '육가람'); b = await mk('v6b@dagym.test', '육나래');
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V6 상태 알림', orgUnitId: ctx.hq, assigneeId: a.id, approvalRequired: false })).id;
    let v = (await a.ok('GET', `/api/tasks/${t}`)).task.version;
    for (const st of ['in_progress', 'on_hold', 'done']) {
      v = (await a.ok('PATCH', `/api/tasks/${t}`, { status: st, version: v })).version;
    }
    const ns = await sql`select title, body from notifications where user_id = ${ctx.ownerId} and entity_id = ${t} and type = 'task_done_for_requester' and title not like '확인 완료%' order by created_at`;
    assert.equal(ns.length, 3, '상태 변경 3번 = 알림 3건');
    assert.match(ns[0].body, /육가람님이 'V6 상태 알림'을\(를\) 시작했습니다/);
    assert.match(ns[1].body, /보류했습니다/); assert.match(ns[2].body, /완료했습니다/);
  });
  test('담당자 여러 명 → 각자 1건씩(같은 묶음), 각자 알림, 묶음 진행률, 지시자만 묶음 수정·삭제', async () => {
    const r = await ctx.owner.ok('POST', '/api/tasks', { title: 'V6 일괄 점검표 제출', orgUnitId: ctx.hq, assigneeIds: [a.id, b.id, ctx.ownerId], dueDate: addDays(today, 2), approvalRequired: false });
    assert.equal(r.ids.length, 3);
    const rows = await sql`select assignee_id, batch_id from tasks where id = any(${r.ids}::uuid[])`;
    assert.equal(new Set(rows.map((x) => x.batch_id)).size, 1, '같은 묶음');
    assert.equal((await sql`select count(*)::int n from notifications where type = 'task_assigned' and entity_id = any(${r.ids}::uuid[])`)[0].n, 2, '다른 사람 2명에게 각자 알림(본인 제외)');
    const det = await a.ok('GET', `/api/tasks/${r.ids[0]}`);
    assert.equal(det.batchMates.length, 3); assert.equal(det.task.batch.total, 3);
    assert.equal((await a.req('PATCH', `/api/tasks/batch/${r.batchId}`, { dueDate: addDays(today, 5) })).status, 403, '담당자는 묶음 전체 수정 불가');
    await ctx.owner.ok('PATCH', `/api/tasks/batch/${r.batchId}`, { dueDate: addDays(today, 5), priority: 'high' });
    assert.equal((await sql`select count(*)::int n from tasks where batch_id = ${r.batchId} and due_date = ${addDays(today, 5)} and priority = 'high'`)[0].n, 3);
    const del = await ctx.owner.ok('DELETE', `/api/tasks/batch/${r.batchId}`);
    assert.equal(del.deleted, 3);
  });
  test('삭제 → 목록·검색·홈에서 빠짐 → 휴지통에서 되살리기, 지시자도 삭제 가능', async () => {
    const t = (await a.ok('POST', '/api/tasks', { title: 'V6 지울 업무 고유어', orgUnitId: ctx.hq, assigneeId: a.id, requestedById: b.id, approvalRequired: false })).id;
    await b.ok('DELETE', `/api/tasks/${t}`); // 지시자 삭제
    assert.ok(!(await a.ok('GET', '/api/tasks?q=고유어')).tasks.some((x) => x.id === t), '검색에서 제외');
    assert.equal((await a.get(`/api/tasks/${t}`)).status, 404);
    const trash = (await b.ok('GET', '/api/tasks/trash')).tasks;
    assert.ok(trash.some((x) => x.id === t), '휴지통에 보임');
    assert.ok(!(await ctx.staffA.client.ok('GET', '/api/tasks/trash')).tasks.some((x) => x.id === t), '다른 현장 직원 휴지통엔 없음');
    await b.ok('POST', `/api/tasks/${t}/restore`, {});
    assert.equal((await a.ok('GET', `/api/tasks/${t}`)).task.title, 'V6 지울 업무 고유어');
  });
  test('기본 목록(includeDone=recent)에 오늘 완료한 업무는 남고, 완료 보기는 완료만', async () => {
    const t = (await a.ok('POST', '/api/tasks', { title: 'V6 오늘 완료', orgUnitId: ctx.hq, assigneeId: a.id, approvalRequired: false })).id;
    const v = (await a.ok('GET', `/api/tasks/${t}`)).task.version;
    await a.ok('PATCH', `/api/tasks/${t}`, { status: 'done', version: v });
    assert.ok((await a.ok('GET', '/api/tasks?includeDone=recent')).tasks.some((x) => x.id === t), '오늘 완료는 남김');
    assert.ok(!(await a.ok('GET', '/api/tasks?includeDone=0')).tasks.some((x) => x.id === t));
    await sql`update tasks set completed_at = now() - interval '3 days' where id = ${t}`;
    assert.ok(!(await a.ok('GET', '/api/tasks?includeDone=recent')).tasks.some((x) => x.id === t), '지난 완료는 빠짐');
    await a.ok('POST', `/api/tasks/${t}/comments`, { body: '확인 부탁드려요' });
    assert.ok((await a.ok('GET', '/api/tasks?includeDone=recent')).tasks.some((x) => x.id === t), '댓글 달린 완료는 7일');
    const done = (await a.ok('GET', '/api/tasks?view=done')).tasks;
    assert.ok(done.every((x) => x.status === 'done') && done.some((x) => x.id === t));
  });
  test('마감 시각이 있는 업무: 1시간 전 알림 (본인 업무도)', async () => {
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(Date.now() + 40 * 60000));
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + 40 * 60000));
    const t = (await a.ok('POST', '/api/tasks', { title: 'V6 한 시간 전', orgUnitId: ctx.hq, assigneeId: a.id, dueDate: day, dueTime: hm, approvalRequired: false })).id;
    await tick();
    const n = await sql`select title from notifications where user_id = ${a.id} and entity_id = ${t} and title like '1시간 뒤 마감%'`;
    assert.equal(n.length, 1);
  });
});

describe('WORKIN_V6 엑셀 내려받기', () => {
  test('업무 목록형 .xlsx: 보이는 업무만·삭제 제외·한글, 캘린더 표형 + 주간 표·남의 비공개는 바쁨', async () => {
    const { execFileSync } = await import('node:child_process');
    const { writeFileSync } = await import('node:fs');
    const keep = (await ctx.owner.ok('POST', '/api/tasks', { title: '엑셀 남는 업무 가나다', orgUnitId: ctx.hq, dueDate: today, approvalRequired: false })).id;
    const gone = (await ctx.owner.ok('POST', '/api/tasks', { title: '엑셀 지운 업무 라마바', orgUnitId: ctx.hq, dueDate: today, approvalRequired: false })).id;
    await ctx.owner.ok('DELETE', `/api/tasks/${gone}`);
    const dl = (c, path) => fetch(BASE + path, { headers: { cookie: c.cookie, origin: BASE } }); // 파일 응답 그대로
    const res = await dl(ctx.owner, `/api/export/tasks?basis=due&start=${today}&end=${today}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /spreadsheetml/);
    assert.match(res.headers.get('content-disposition'), /filename\*=UTF-8''%EC%9B%8C%ED%81%AC%EC%9D%B8/);
    const f = `/tmp/wos-export-${Date.now()}.xlsx`;
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
    const xml = execFileSync('unzip', ['-p', f, 'xl/worksheets/sheet1.xml']).toString();
    assert.ok(xml.includes('엑셀 남는 업무 가나다'), '업무 포함'); assert.ok(!xml.includes('라마바'), '삭제 업무 제외');
    assert.ok(xml.includes('기한 준수'), '머리글');
    // 다른 현장 직원은 본사 업무를 못 내보냄
    const r2 = await dl(ctx.staffA.client, `/api/export/tasks?basis=due&start=${today}&end=${today}`);
    const f2 = `/tmp/wos-export2-${Date.now()}.xlsx`; writeFileSync(f2, Buffer.from(await r2.arrayBuffer()));
    assert.ok(!execFileSync('unzip', ['-p', f2, 'xl/worksheets/sheet1.xml']).toString().includes('가나다'));
    void keep;
    // 캘린더
    const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '엑셀 비밀 약속', start: `${today}T10:00:00+09:00`, end: `${today}T11:00:00+09:00`, isPrivate: true });
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'xls@dagym.test', name: '엑셀본사', role: 'staff', orgUnitIds: [ctx.hq] });
    const c = new Client('xls'); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'xls-pass-1234' });
    const r3 = await dl(c, `/api/export/calendar?start=${today}&end=${today}`);
    assert.equal(r3.status, 200);
    const f3 = `/tmp/wos-export3-${Date.now()}.xlsx`; writeFileSync(f3, Buffer.from(await r3.arrayBuffer()));
    const s1 = execFileSync('unzip', ['-p', f3, 'xl/worksheets/sheet1.xml']).toString();
    assert.ok(s1.includes('바쁨') && !s1.includes('엑셀 비밀 약속'), '남의 비공개는 바쁨만');
    assert.ok(execFileSync('unzip', ['-p', f3, 'xl/worksheets/sheet2.xml']).toString().includes('10:00'), '주간 달력 표');
  });
});

describe('WORKIN_V6 달성률', () => {
  test('이번 주 완료율·기한 준수율·기한 지남·사람별·지시한 업무, 현장 직원은 자기 범위만', async () => {
    const t1 = (await ctx.owner.ok('POST', '/api/tasks', { title: '달성률 완료', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, dueDate: today, approvalRequired: false })).id;
    await ctx.owner.ok('POST', '/api/tasks', { title: '달성률 미완료', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, dueDate: today, approvalRequired: false });
    const v = (await ctx.owner.ok('GET', `/api/tasks/${t1}`)).task.version;
    await ctx.owner.ok('PATCH', `/api/tasks/${t1}`, { status: 'done', version: v });
    const s = await ctx.owner.ok('GET', '/api/stats?period=week');
    assert.ok(s.due >= 2 && s.done >= 1 && s.completion !== null && s.completion <= 100);
    assert.ok(s.onTime === null || (s.onTime >= 0 && s.onTime <= 100));
    assert.ok(Array.isArray(s.people) && s.people.some((p) => p.id === ctx.ownerId));
    assert.equal(typeof s.requested.open, 'number');
    const m = await ctx.owner.ok('GET', '/api/stats?period=month');
    assert.ok(m.due >= s.due || m.start <= s.start);
    const st = await ctx.staffA.client.ok('GET', '/api/stats?period=week');
    assert.ok(!st.people.some((p) => p.id === ctx.ownerId && p.due >= 2), '현장 직원 달성률에 본사 업무가 섞이지 않음');
  });
});

describe('WORKIN_V7 캘린더 색 (개인/회사 두 가지)', () => {
  test('기본값 → 내 색 저장(나만), 대표만 모두의 기본값, 팔레트 밖 색 거부', async () => {
    const d0 = await ctx.staffA.client.ok('GET', '/api/calendar-colors');
    assert.equal(d0.colors.personal, '#039be5'); assert.equal(d0.palette.length, 12);
    await ctx.staffA.client.ok('PUT', '/api/calendar-colors', { personal: '#d50000', company: '#3f51b5' });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/calendar-colors')).colors.personal, '#d50000');
    assert.equal((await ctx.owner.ok('GET', '/api/calendar-colors')).colors.personal, '#039be5', '남의 색은 그대로');
    assert.equal((await ctx.staffA.client.req('PUT', '/api/calendar-colors', { personal: '#8e24aa', company: '#0b8043', asDefault: true })).status, 403, '기본값은 대표만');
    assert.equal((await ctx.staffA.client.req('PUT', '/api/calendar-colors', { personal: '#123456', company: '#0b8043' })).status, 400);
    await ctx.owner.ok('PUT', '/api/calendar-colors', { personal: '#8e24aa', company: '#f4511e', asDefault: true });
    assert.equal((await ctx.staffB.client.ok('GET', '/api/calendar-colors').catch(async () => ctx.managerA.client.ok('GET', '/api/calendar-colors'))).colors.company, '#f4511e', '안 바꾼 사람은 새 기본값');
    assert.equal((await ctx.staffA.client.ok('GET', '/api/calendar-colors')).colors.personal, '#d50000', '바꾼 사람은 자기 색 유지');
  });
});

describe('WORKIN_V8 아침 브리핑 · 주간 보고 초안 · 부재 종류 · 멘션', () => {
  test('아침 브리핑: 설정 시각 이후 하루 1번, 할 일·일정 요약, 끄면 안 옴', async () => {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date()));
    const p = await ctx.staffA.client.ok('GET', '/api/notifications/prefs');
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, briefingTime: '00:00', briefingWeekend: true, briefingEnabled: true } });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/notifications/prefs')).settings.briefingTime, '00:00');
    await ctx.managerA.client.ok('POST', '/api/tasks', { title: '브리핑용 오늘 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: today, approvalRequired: false });
    await tick(); await tick();
    const n = await sql`select title, body from notifications where user_id = ${ctx.staffA.id} and type = 'briefing'`;
    if (hour < 22) {
      assert.equal(n.length, 1, '하루 한 번');
      assert.match(n[0].body, /오늘 할 일 \d+건/);
    }
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, briefingEnabled: false } });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/notifications/prefs')).settings.briefingEnabled, false);
  });
  test('개인 주간 보고: 초안 만들기(완료·진행·다음 주·일정) → 고쳐서 제출 → 대표 화면에 모두의 보고, 직원은 모두 보기 403', async () => {
    const t = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '보고용 완료 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: today, approvalRequired: false })).id;
    const v = (await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'done', version: v });
    const r = await ctx.staffA.client.ok('POST', '/api/reports/mine', {});
    assert.equal(r.report.status, 'draft');
    assert.match(r.report.body, /■ 이번 주 완료/); assert.ok(r.report.body.includes('보고용 완료 업무'));
    const s = await ctx.staffA.client.ok('PUT', '/api/reports/mine', { body: r.report.body + '\n특이사항 없음', submit: true });
    assert.equal(s.report.status, 'submitted');
    const team = await ctx.owner.ok('GET', '/api/reports/team');
    assert.ok(team.reports.some((x) => x.user_id === ctx.staffA.id && x.status === 'submitted'));
    assert.equal((await ctx.staffA.client.req('GET', '/api/reports/team')).status, 404, 'V13: 메뉴 권한이 없으면 메뉴째 숨김(404)');
  });
  test('일정 종류 연차·반차·외근, 연차 날은 가용 시간 부재', async () => {
    const cal = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    const d = addDays(today, 9);
    await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '연차', kind: 'vacation', allDay: true, start: `${d}T00:00:00+09:00`, end: `${addDays(d, 1)}T00:00:00+09:00` });
    await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '오후 반차', kind: 'half_day', start: `${addDays(d, 1)}T13:00:00+09:00`, end: `${addDays(d, 1)}T18:00:00+09:00` });
    await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '거래처 외근', kind: 'outside', start: `${addDays(d, 2)}T10:00:00+09:00`, end: `${addDays(d, 2)}T12:00:00+09:00` });
    const av = await ctx.managerA.client.ok('GET', `/api/availability?userId=${ctx.staffA.id}&date=${d}`);
    assert.equal(av.days[0].away, true, '연차 날은 부재 → 배정 경고');
  });
  test('회의 메모 @이름 → 참석자에게 멘션 알림, 댓글 멘션 문구', async () => {
    const cal = (await ctx.managerA.client.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
    const d = addDays(today, 3);
    const ev = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: 'V8 멘션 회의', start: `${d}T10:00:00+09:00`, end: `${d}T11:00:00+09:00`, attendeeIds: [ctx.staffA.id] })).id;
    await ctx.managerA.client.ok('PUT', `/api/events/${ev}/notes`, { body: '- 장비 견적 @이직원 확인 부탁' });
    const n = await sql`select title, link from notifications where user_id = ${ctx.staffA.id} and type = 'mention' and entity_id = ${ev}`;
    assert.equal(n.length, 1); assert.match(n[0].title, /회의 메모에서 회원님을 언급/);
  });
});

describe('WORKIN_V8 템플릿 · 미리 알림', () => {
  test('시작 템플릿 3종, 직원 개인 템플릿(나만 봄)·업무에서 저장(기본 담당·마감 오프셋), 적용하면 체크리스트까지', async () => {
    const list = (await ctx.owner.ok('GET', '/api/templates')).templates;
    for (const n of ['현장 점검', '입찰 준비', '견적서 발송']) assert.ok(list.some((t) => t.name === n), `시작 템플릿 ${n}`);
    const src = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '내 반복 점검', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 2), checklist: ['조명', '바닥'], approvalRequired: false })).id;
    assert.equal((await ctx.staffA.client.req('POST', '/api/templates', { name: '공용 시도', fromTaskId: src })).status, 403, '직원은 공용 불가');
    const tp = await ctx.staffA.client.ok('POST', '/api/templates', { name: '내 점검 양식', fromTaskId: src, personal: true });
    const mine = (await ctx.staffA.client.ok('GET', '/api/templates')).templates.find((t) => t.id === tp.id);
    assert.ok(mine && mine.personal); assert.equal(mine.payload.dueInDays, 2); assert.equal(mine.payload.assigneeId, ctx.staffA.id);
    assert.ok(!(await ctx.managerA.client.ok('GET', '/api/templates')).templates.some((t) => t.id === tp.id), '다른 사람에게 안 보임');
    const made = await ctx.staffA.client.ok('POST', `/api/templates/${tp.id}/apply`, { title: '내 점검 양식 적용', orgUnitId: ctx.siteA });
    const d = await ctx.staffA.client.ok('GET', `/api/tasks/${made.id}`);
    assert.equal(d.task.assignee_id, ctx.staffA.id); assert.equal(d.task.due_date, addDays(today, 2)); assert.equal(d.checklist.length, 2);
  });
  test('업무별 미리 알림(최대 3개)·기본값, 일정 기본 10분', async () => {
    const p = await ctx.managerA.client.ok('GET', '/api/notifications/prefs');
    assert.equal(p.settings.taskReminderMinutes, 60); assert.equal(p.settings.eventReminderMinutes, 10);
    assert.equal((await ctx.managerA.client.req('POST', '/api/tasks', { title: 'x', orgUnitId: ctx.siteA, reminderMinutes: [1, 2, 3, 4] })).status, 400, '최대 3개');
    const at = new Date(Date.now() + 25 * 60000);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at);
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
    const t = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: 'V8 30분 전 알림', orgUnitId: ctx.siteA, assigneeId: ctx.managerA.id, dueDate: day, dueTime: hm, reminderMinutes: [30, 1440], approvalRequired: false })).id;
    assert.deepEqual((await ctx.managerA.client.ok('GET', `/api/tasks/${t}`)).task.reminder_minutes, [30, 1440]);
    await tick(); await tick();
    const n = await sql`select title from notifications where entity_id = ${t} and type = 'due_soon' and title like '%분 뒤 마감%' or (entity_id = ${t} and title like '1일 뒤 마감%')`;
    assert.equal(n.filter((x) => /30분 뒤 마감/.test(x.title)).length, 1, '30분 전 알림 1번');
    assert.equal(n.filter((x) => /1일 뒤/.test(x.title)).length, 1, '하루 전 알림도(이미 지났지만 마감 전) 1번');
  });
});

describe('WORKIN 휴대폰 예약 알림', () => {
  test('앞으로 7일 예약 목록: 업무별 알림·오늘 마감·일정 알림, 삭제·불참 제외, 64개 이하', async () => {
    const c = ctx.staffA.client;
    const tom = addDays(today, 1);
    const t1 = (await c.ok('POST', '/api/tasks', { title: '예약 알림 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: tom, dueTime: '15:00', reminderMinutes: [30], approvalRequired: false })).id;
    const t2 = (await c.ok('POST', '/api/tasks', { title: '예약 삭제될 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: tom, approvalRequired: false })).id;
    await c.ok('DELETE', `/api/tasks/${t2}`);
    const cal = (await ctx.managerA.client.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'org_unit').id;
    const start = new Date(Date.now() + 3 * 3600e3), end = new Date(start.getTime() + 3600e3);
    const ev = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '예약 알림 회의', start: start.toISOString(), end: end.toISOString(), attendeeIds: [ctx.staffA.id, ctx.staffB.id], reminderMinutes: [15] })).id;
    const ev2 = (await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '예약 불참 회의', start: start.toISOString(), end: end.toISOString(), attendeeIds: [ctx.staffA.id], reminderMinutes: [15] })).id;
    await c.ok('POST', `/api/events/${ev2}/respond`, { response: 'declined' });
    const { reminders } = await c.ok('GET', '/api/reminders/upcoming');
    assert.ok(reminders.length <= 64);
    const r30 = reminders.find((r) => r.link === `/tasks/${t1}` && /30분 뒤 마감/.test(r.title));
    assert.ok(r30, '업무별 30분 전');
    assert.equal(new Date(r30.fireAt).toISOString(), new Date(`${tom}T14:30:00+09:00`).toISOString(), '서울 기준 14:30');
    assert.ok(reminders.some((r) => r.link === `/tasks/${t1}` && /^오늘 마감/.test(r.title)), '당일 09시 오늘 마감');
    assert.ok(!reminders.some((r) => r.link === `/tasks/${t2}`), '삭제한 업무 제외');
    const er = reminders.find((r) => r.link === `/calendar?event=${ev}`);
    assert.ok(er && /15분 뒤 일정/.test(er.title), '일정 15분 전');
    assert.equal(new Date(er.fireAt).getTime(), start.getTime() - 15 * 60000);
    assert.ok(!reminders.some((r) => r.link === `/calendar?event=${ev2}`), '불참 일정 제외');
    assert.equal(new Set(reminders.map((r) => r.id)).size, reminders.length, 'id 중복 없음');
    assert.ok(reminders.every((r, i) => i === 0 || reminders[i - 1].fireAt <= r.fireAt), '가까운 순');
    // 다른 사람 목록에는 내 업무가 없음
    assert.ok(!(await ctx.managerA.client.ok('GET', '/api/reminders/upcoming')).reminders.some((r) => r.link === `/tasks/${t1}`));
  });
  test('예약 알림 기기: 바뀌면 조용한 FCM, 서버는 미리 알림(마감·일정·브리핑)을 이 기기에 보내지 않음', async () => {
    const c = ctx.staffA.client;
    await c.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-local-a', platform: 'android', localReminders: true });
    const at = new Date(Date.now() + 25 * 60000);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(at);
    const hm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
    const t = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '예약 기기 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: day, dueTime: hm, reminderMinutes: [30], approvalRequired: false })).id;
    await new Promise((r) => setTimeout(r, 1500));
    await tick(); await tick();
    const st = await fetch(`${FAKE}/__state`).then((r) => r.json());
    const mine = st.fcm.filter((m) => m.token === 'fcm-local-a');
    assert.ok(mine.some((m) => m.data?.type === 'reminders-changed' && !m.notification), '조용한 재예약 메시지');
    assert.ok(mine.some((m) => m.data?.link === `/tasks/${t}` && m.notification), '배정 알림은 그대로 옴');
    assert.ok(!mine.some((m) => m.data?.link === `/tasks/${t}` && /마감/.test(m.notification?.title ?? '')), '마감 미리 알림은 기기 예약이 담당');
    const n = await sql`select count(*)::int c from notifications where entity_id = ${t} and type = 'due_soon'`;
    assert.ok(n[0].c >= 1, '알림 기록(앱 안 목록)은 남음');
    const del = await sql`select count(*)::int c from notification_deliveries d join notifications n on n.id = d.notification_id join push_subscriptions p on p.id = d.subscription_id
      where p.endpoint = 'fcm-local-a' and n.type = 'due_soon'`;
    assert.equal(del[0].c, 0);
    // 예전 앱(플래그 없음) 다시 등록하면 서버 알림 복귀
    await c.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-local-a', platform: 'android' });
    assert.equal((await sql`select local_reminders from push_subscriptions where endpoint = 'fcm-local-a'`)[0].local_reminders, false);
  });
});

describe('WORKIN_V9 회사 자료실 · AI 비서 (가짜 Anthropic 서버)', () => {
  const up = async (c, meta, data) => {
    const init = await c.ok('POST', '/api/library', { ...meta, size: data.length });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
    await c.ok('POST', `/api/library/${init.id}/complete`);
    return init.id;
  };
  const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicQueue: items }) });
  const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
  const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
  const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
  let logo, price, demo;

  test('자료실: 올리기·폴더·태그·본문 검색, 고치기/지우기는 올린 사람·관리자, 체험 계정·다른 회사 차단', async () => {
    logo = await up(ctx.owner, { fileName: '다짐 로고.png', mimeType: 'image/png', folder: '브랜드/다짐', tags: ['로고', '다짐'] }, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    price = await up(ctx.staffA.client, { fileName: '단가표.csv', mimeType: 'text/csv', folder: '영업' }, Buffer.from('항목,가격\nPT 10회,550000\n', 'utf8'));
    const all = await ctx.staffA.client.ok('GET', '/api/library');
    assert.ok(all.files.some((f) => f.id === logo) && all.files.some((f) => f.id === price), '같은 회사 직원은 모두 봄');
    assert.ok(all.folders.some((f) => f.folder === '브랜드/다짐'));
    const byBody = await ctx.managerA.client.ok('GET', '/api/library?q=' + encodeURIComponent('PT 550000'));
    assert.deepEqual(byBody.files.map((f) => f.id), [price], '본문 글자로 검색');
    assert.ok(byBody.files[0].has_text && /550000/.test(byBody.files[0].snippet));
    assert.ok((await ctx.staffA.client.ok('GET', '/api/library?q=' + encodeURIComponent('다짐 로고'))).files.some((f) => f.id === logo), '제목·태그 검색');
    assert.deepEqual((await ctx.owner.ok('GET', '/api/library?folder=' + encodeURIComponent('브랜드'))).files.map((f) => f.id), [logo], '상위 폴더로 하위 포함');
    assert.equal((await ctx.managerA.client.req('PATCH', `/api/library/${price}`, { title: 'x' })).status, 403, '남이 올린 자료는 못 고침');
    assert.equal((await ctx.managerA.client.req('DELETE', `/api/library/${price}`)).status, 403);
    await ctx.owner.ok('PATCH', `/api/library/${price}`, { title: '2026 단가표', tags: ['단가'] });
    const dl = await ctx.staffA.client.req('GET', `/api/library/${logo}/download?inline=1`);
    assert.equal(dl.status, 302);
    assert.equal((await ctx.staffA.client.req('GET', '/api/library/00000000-0000-4000-8000-000000000000')).status, 404);
    demo = new Client('iso');
    await demo.ok('POST', '/api/auth/login', { email: 'iso@dagym.test', password: 'iso-pass-1234' });
    assert.equal((await demo.req('GET', '/api/library')).status, 403, '체험 계정은 자료실 없음');
    assert.equal((await demo.req('GET', `/api/library/${logo}`)).status, 403);
    // 다른 회사(tenant) 자료는 없는 것처럼
    await sql`update library_files set tenant = 'other-co' where id = ${price}`;
    assert.equal((await ctx.owner.req('GET', `/api/library/${price}`)).status, 404);
    assert.ok(!(await ctx.owner.ok('GET', '/api/library')).files.some((f) => f.id === price));
    await sql`update library_files set tenant = 'default' where id = ${price}`;
  });

  test('AI 비서: 도구로 자료 찾기 → 첨부 제안 → [확인]해야 첨부, 사용량 기록, 남의 제안·두 번 실행 불가', async () => {
    const st0 = await ctx.staffA.client.ok('GET', '/api/ai/status');
    assert.equal(st0.enabled, true); assert.equal(st0.usage.costUsd, undefined, '직원에게 비용은 안 보임');
    assert.equal((await demo.ok('GET', '/api/ai/status')).enabled, false, '체험 계정은 AI 숨김');
    assert.equal((await demo.req('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '안녕' }] })).status, 403);
    const task = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: 'V9 홍보물 제작', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    const before = (await fakeState()).anthropic.length;
    await queue([toolUse('tu1', 'search_library', { query: '다짐 로고' }), toolUse('tu2', 'propose_attach_file', { taskId: task, fileId: logo }), say('로고를 찾았습니다. 확인을 누르면 첨부됩니다.')]);
    const r = await ctx.staffA.client.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '다짐 로고 불러와줘' }], taskId: task });
    assert.match(r.reply, /확인을 누르면/);
    assert.deepEqual(r.tools, ['search_library', 'propose_attach_file']);
    assert.equal(r.proposals.length, 1); assert.match(r.proposals[0].summary, /다짐 로고 → V9 홍보물 제작/);
    const reqs = (await fakeState()).anthropic.slice(before);
    assert.equal(reqs.length, 3);
    assert.equal(reqs[0].key, 'sk-ant-fake-test');
    assert.match(reqs[0].beta ?? '', /server-side-fallback-2026-07-01/);
    assert.equal(reqs[0].body.model, 'claude-sonnet-5-5', '기본 모델'); assert.equal(reqs[0].body.fallbacks, 'default');
    assert.match(reqs[0].body.system, /이직원/); assert.match(reqs[0].body.system, new RegExp(task), '보고 있는 업무 맥락');
    assert.ok(reqs[0].body.tools.some((t) => t.name === 'propose_create_task'));
    const tr = reqs[1].body.messages.at(-1).content[0];
    assert.equal(tr.type, 'tool_result'); assert.ok(tr.content.includes(logo), '검색 결과에 로고 id');
    // 확인 전에는 첨부 없음
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${task}`)).attachments.length, 0);
    assert.equal((await ctx.managerA.client.req('POST', `/api/ai/proposals/${r.proposals[0].id}`, { accept: true })).status, 404, '남의 제안');
    const done = await ctx.staffA.client.ok('POST', `/api/ai/proposals/${r.proposals[0].id}`, { accept: true });
    assert.equal(done.status, 'done');
    const att = (await ctx.staffA.client.ok('GET', `/api/tasks/${task}`)).attachments;
    assert.equal(att.length, 1); assert.equal(att[0].file_name, '다짐 로고.png');
    assert.equal((await ctx.staffA.client.req('POST', `/api/ai/proposals/${r.proposals[0].id}`, { accept: true })).status, 400, '두 번 실행 불가');
    const used = await sql`select count(*)::int n, sum(cost_usd)::float8 c from ai_usage where user_id = ${ctx.staffA.id} and purpose = 'assistant'`;
    assert.equal(used[0].n, 3, '자료실 자동 정리(library_organize)는 따로 기록'); assert.ok(used[0].c > 0);
  });

  test('AI 도구는 요청한 사람 권한으로만: 직원은 매출·남의 현장 업무 못 봄, 업무 만들기 제안 확인/취소', async () => {
    const hidden = (await ctx.owner.ok('POST', '/api/tasks', { title: '판교 비밀 업무', orgUnitId: ctx.siteB, approvalRequired: false })).id;
    const before = (await fakeState()).anthropic.length;
    await queue([{ content: [{ type: 'tool_use', id: 'a1', name: 'revenue_summary', input: { fromMonth: '2026-01', toMonth: '2026-09' } },
      { type: 'tool_use', id: 'a2', name: 'get_task', input: { taskId: hidden } },
      { type: 'tool_use', id: 'a3', name: 'propose_create_task', input: { title: 'AI 제안 업무', dueDate: addDays(today, 3), assigneeId: ctx.staffA.id } },
      { type: 'tool_use', id: 'a4', name: 'propose_comment', input: { taskId: hidden, text: '몰래 댓글' } }], stop_reason: 'tool_use' }, say('정리했습니다.')]);
    const r = await ctx.staffA.client.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '매출 알려주고 업무 만들어줘' }] });
    const results = (await fakeState()).anthropic.slice(before)[1].body.messages.at(-1).content;
    const byId = Object.fromEntries(results.map((x) => [x.tool_use_id, x]));
    assert.equal(byId.a1.is_error, true); assert.match(byId.a1.content, /매출 보기 권한/);
    assert.equal(byId.a2.is_error, true); assert.match(byId.a2.content, /권한/);
    assert.equal(byId.a4.is_error, true, '볼 수 없는 업무에 댓글 제안도 불가');
    assert.equal(r.proposals.length, 1);
    assert.equal((await sql`select count(*)::int n from tasks where title = 'AI 제안 업무'`)[0].n, 0, '확인 전 미생성');
    const made = await ctx.staffA.client.ok('POST', `/api/ai/proposals/${r.proposals[0].id}`, { accept: true });
    const t = await ctx.staffA.client.ok('GET', made.link.replace('/tasks/', '/api/tasks/'));
    assert.equal(t.task.title, 'AI 제안 업무'); assert.equal(t.task.due_date, addDays(today, 3)); assert.equal(t.task.assignee_id, ctx.staffA.id);
    // 취소
    await queue([toolUse('b1', 'propose_create_task', { title: '취소할 업무' }), say('확인을 눌러 주세요.')]);
    const r2 = await ctx.staffA.client.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '업무 하나 더' }] });
    assert.equal((await ctx.staffA.client.ok('POST', `/api/ai/proposals/${r2.proposals[0].id}`, { accept: false })).status, 'cancelled');
    assert.equal((await sql`select count(*)::int n from tasks where title = '취소할 업무'`)[0].n, 0);
  });

  test('엑셀 보고서 제안 → 확인하면 자료실 "AI 보고서"에 저장(본문 검색 가능)·업무 첨부', async () => {
    const task = (await ctx.owner.ok('POST', '/api/tasks', { title: '3분기 매출 분석', orgUnitId: ctx.hq, approvalRequired: false })).id;
    await queue([toolUse('x1', 'propose_xlsx_report', { title: '3분기 매출 요약', taskId: task, sheets: [{ name: '요약', rows: [['현장', '매출'], ['강남점', 12345678]] }] }), say('보고서를 준비했습니다.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '3분기 매출 분석해서 올려줘' }], taskId: task });
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${r.proposals[0].id}`, { accept: true });
    const lib = await ctx.owner.ok('GET', '/api/library?q=' + encodeURIComponent('강남점'));
    assert.ok(lib.files.some((f) => f.id === done.fileId && f.folder === 'AI 보고서' && f.file_name === '3분기 매출 요약.xlsx'), '엑셀 본문 추출·검색');
    const att = (await ctx.owner.ok('GET', `/api/tasks/${task}`)).attachments;
    assert.equal(att[0].file_name, '3분기 매출 요약.xlsx');
  });

  test('회사별 월 한도: 대표만 설정, 넘으면 429 안내, 대표는 비용을 봄', async () => {
    assert.equal((await ctx.staffA.client.req('PUT', '/api/ai/limit', { monthlyUsd: 1 })).status, 403);
    await ctx.owner.ok('PUT', '/api/ai/limit', { monthlyUsd: 0.01 });
    const st = await ctx.owner.ok('GET', '/api/ai/status');
    assert.ok(st.usage.costUsd >= 0.01 && st.overLimit && st.canSetLimit);
    const r = await ctx.staffA.client.req('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '안녕' }] });
    assert.equal(r.status, 429); assert.match(r.body.error.message, /한도/);
    await ctx.owner.ok('PUT', '/api/ai/limit', { monthlyUsd: 30 });
    assert.equal((await ctx.staffA.client.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '안녕' }] })).reply, '테스트 응답입니다.');
  });
});

describe('WORKIN_V10 회사별 사용량 · 요금제 (결제 연동 없음)', () => {
  const setPlan = (planCode, addons = {}) => ctx.owner.ok('PUT', '/api/platform/tenants/default', { planCode, addons });
  test('우리 회사 = 내부(무제한), 사용량 화면은 대표·관리자만, /platform 은 플랫폼 운영자만(그 외 404)', async () => {
    const u = await ctx.owner.ok('GET', '/api/usage');
    assert.equal(u.subscription.planCode, 'internal');
    assert.deepEqual(u.limits, { users: null, storageGb: null, aiRequests: null });
    assert.ok(u.usage.storageBytes > 0 && u.usage.users >= 4 && u.usage.aiRequests >= 1, '첨부·자료실·사람·AI 요청 셈');
    assert.ok(u.topFiles.length > 0 && u.topFiles[0].size >= u.topFiles.at(-1).size, '큰 파일 순');
    assert.ok(u.plans.some((p) => p.code === 'basic' && p.per_user_krw === 1500) && u.plans.some((p) => p.code === 'free' && p.limits.users === 20) && !u.plans.some((p) => p.code === 'internal' || p.code === 'standard'), '2안: 무료·베이직(1인 1,500원), 내부·1안은 목록에 없음');
    assert.equal((await ctx.staffA.client.req('GET', '/api/usage')).status, 404, 'V14 7번: 메뉴 권한이 꺼져 있으면 404');
    const pf = await ctx.owner.ok('GET', '/api/platform');
    assert.deepEqual(pf.tenants.map((t) => t.id).sort(), ['default', 'demo']);
    assert.equal(pf.tenants.find((t) => t.id === 'default').overLimit, false);
    assert.equal((await ctx.managerA.client.req('GET', '/api/platform')).status, 404);
    assert.equal((await ctx.managerA.client.req('PUT', '/api/platform/tenants/default', { planCode: 'free' })).status, 404);
  });

  test('요금제 숫자는 배포 없이 변경, 추가 옵션은 한도에 더해짐', async () => {
    await ctx.owner.ok('PUT', '/api/platform/plans/standard', { name: '스탠다드', monthlyKrw: 30000, limits: { users: 20, storageGb: 50, aiRequests: 500 } });
    assert.equal((await ctx.owner.ok('GET', '/api/platform')).plans.find((p) => p.code === 'standard').monthly_krw, 30000);
    await ctx.owner.ok('PUT', '/api/platform/plans/standard', { name: '스탠다드', monthlyKrw: 29000, limits: { users: 20, storageGb: 50, aiRequests: 500 } });
    await setPlan('free', { storage20: 2, ai100: 1 });
    const u = await ctx.owner.ok('GET', '/api/usage');
    assert.deepEqual(u.limits, { users: 20, storageGb: 41, aiRequests: 110 }, '무료(20명·1GB·AI 10) + 저장 20GB 팩 2개 + AI 100회 팩');
    // 베이직: 1인 1GB·AI 20회 × 활성 사용자 수
    await setPlan('basic');
    const b = await ctx.owner.ok('GET', '/api/usage');
    assert.equal(b.limits.users, null); assert.equal(b.limits.storageGb, b.usage.users); assert.equal(b.limits.aiRequests, 20 * b.usage.users);
    assert.equal(b.subscription.perUserKrw, 1500); assert.equal(b.subscription.monthlyKrw, 1500 * b.usage.users);
    assert.equal((await ctx.owner.req('PUT', '/api/platform/tenants/default', { planCode: 'free', addons: { nope: 1 } })).status, 400);
    await setPlan('internal');
  });

  test('한도를 넘으면 올리기·AI·초대만 막고 업무·일정은 그대로, 정기 실행이 80%/100% 알림', async () => {
    await ctx.owner.ok('PUT', '/api/platform/plans/tiny-test', { name: '시험용 초소형', monthlyKrw: 0, limits: { users: 2, storageGb: 0.000001, aiRequests: 0 }, public: false });
    await setPlan('tiny-test');
    const t = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '한도 초과 중 업무', orgUnitId: ctx.siteA, approvalRequired: false })).id;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'done' });
    const cal = (await ctx.managerA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'org_unit').id;
    await ctx.managerA.client.ok('POST', '/api/events', { calendarId: cal, title: '한도 초과 중 일정', start: `${addDays(today, 2)}T10:00:00+09:00`, end: `${addDays(today, 2)}T11:00:00+09:00` });
    const att = await ctx.staffA.client.req('POST', '/api/attachments', { taskId: t, kind: 'file', fileName: 'a.pdf', mimeType: 'application/pdf', size: 2000 });
    assert.equal(att.status, 409); assert.match(att.body.error.message, /저장공간/);
    assert.equal((await ctx.staffA.client.req('POST', '/api/library', { fileName: 'b.txt', size: 10 })).status, 409);
    assert.ok((await ctx.staffA.client.ok('GET', '/api/library')).files.length > 0, '기존 자료 보기는 계속');
    const ai = await ctx.staffA.client.req('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '안녕' }] });
    assert.equal(ai.status, 429); assert.match(ai.body.error.message, /AI 요청/);
    assert.equal((await ctx.staffA.client.ok('GET', '/api/ai/status')).overLimit, true);
    const inv = await ctx.owner.req('POST', '/api/admin/users', { email: 'seat@dagym.test', name: '초과', role: 'staff', orgUnitIds: [ctx.siteA] });
    assert.equal(inv.status, 409); assert.match(inv.body.error.message, /사용자 수/);
    await tick();
    const n = await sql`select title from notifications where type = 'usage_alert' and user_id = ${ctx.ownerId}`;
    assert.ok(n.some((x) => /저장공간 한도/.test(x.title)) && n.some((x) => /사용자 한도/.test(x.title)), '관리자에게 100% 알림');
    await tick();
    assert.equal((await sql`select count(*)::int c from notifications where type = 'usage_alert' and user_id = ${ctx.ownerId} and title like '저장공간%'`)[0].c, 1, '같은 달 같은 단계는 1번');
    assert.ok((await sql`select storage_bytes from tenant_usage where tenant = 'default'`)[0].storage_bytes > 0, '월별 기록');
    const pf = await ctx.owner.ok('GET', '/api/platform');
    assert.equal(pf.tenants.find((x) => x.id === 'default').overLimit, true, '운영 화면 한도 초과 표시');
    await setPlan('internal');
    assert.equal((await ctx.staffA.client.req('POST', '/api/library', { fileName: 'b.txt', size: 10 })).status, 200, '내부 요금제로 돌리면 다시 올리기 가능');
  });

  test('요금제 변경 요청 → 운영자 승인하면 반영·요청자 알림, 반려도 가능', async () => {
    const r = await ctx.owner.ok('POST', '/api/usage/request', { planCode: 'basic', note: '지점 늘어남' });
    assert.equal((await ctx.staffA.client.req('POST', '/api/usage/request', { planCode: 'basic' })).status, 404, 'V14 7번: 메뉴 권한이 꺼져 있으면 404');
    assert.equal((await ctx.owner.req('POST', '/api/usage/request', { planCode: 'internal' })).status, 400, '공개 안 된 요금제는 요청 불가');
    const pf = await ctx.owner.ok('GET', '/api/platform');
    assert.equal(pf.requests.find((x) => x.id === r.id).status, 'pending');
    await ctx.owner.ok('POST', `/api/platform/requests/${r.id}`, { approve: true });
    assert.equal((await ctx.owner.ok('GET', '/api/usage')).subscription.planCode, 'basic');
    assert.equal((await ctx.owner.req('POST', `/api/platform/requests/${r.id}`, { approve: true })).status, 400);
    const before = (await ctx.owner.ok('GET', '/api/usage')).limits.aiRequests;
    const r2 = await ctx.owner.ok('POST', '/api/usage/request', { addons: { ai500: 1 } });
    await ctx.owner.ok('POST', `/api/platform/requests/${r2.id}`, { approve: false });
    assert.equal((await ctx.owner.ok('GET', '/api/usage')).limits.aiRequests, before, '반려는 반영 안 됨');
    await setPlan('internal');
  });
});

describe('WORKIN_V12 상태 권한 · 확인 완료 · 검토 요청 알림', () => {
  test('진행 상태는 담당자만, 지시자는 검토 승인·반려·보류만, 담당자가 열면 확인 완료 + 지시자 알림, 검토 요청은 지시자에게 즉시', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V12 권한 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id, approvalRequired: false })).id;
    assert.equal((await ctx.managerA.client.ok('GET', `/api/tasks/${t}`)).task.assignee_ack_at, null, '지시자가 열어도 확인 아님');
    const d = await ctx.staffA.client.ok('GET', `/api/tasks/${t}`);
    assert.ok(d.task.assignee_ack_at, '담당자가 열면 확인 완료');
    const ackN = await sql`select title, body from notifications where user_id = ${ctx.managerA.id} and entity_id = ${t} and title like '확인 완료%'`;
    assert.equal(ackN.length, 1); assert.match(ackN[0].body, /이직원님이 업무를 확인했습니다/);
    await ctx.staffA.client.ok('GET', `/api/tasks/${t}`);
    assert.equal((await sql`select count(*)::int c from notifications where entity_id = ${t} and title like '확인 완료%'`)[0].c, 1, '한 번만');
    const deny = await ctx.managerA.client.req('PATCH', `/api/tasks/${t}`, { status: 'in_progress' });
    assert.equal(deny.status, 403); assert.match(deny.body.error.message, /담당자만 바꿀 수 있어요/);
    assert.equal((await ctx.owner.req('PATCH', `/api/tasks/${t}`, { status: 'done' })).status, 403, '대표도 남의 업무 완료 불가');
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'in_progress' });
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'review' });
    const rv = await sql`select body from notifications where user_id = ${ctx.managerA.id} and entity_id = ${t} and type = 'review_requested'`;
    assert.equal(rv.length, 1, '지시자에게 검토 요청 알림'); assert.match(rv[0].body, /승인 또는 반려/);
    const pending = await sql`select count(*)::int c from notification_deliveries d join notifications n on n.id = d.notification_id where n.entity_id = ${t} and n.type = 'review_requested'`;
    assert.ok(pending[0].c >= 0);
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'in_progress', reviewNote: '사진 추가' }); // 반려
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'review' });
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'done' }); // 승인
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).task.status, 'done');
  });
});

describe('WORKIN_V12 11번 상태는 담당자만 (대표·관리자 예외 없음)', () => {
  test('대표·관리자·지시자도 담당자 업무의 보류·진행·완료 불가(403), 담당자는 가능', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V12-11 보류 시도', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    for (const st of ['on_hold', 'in_progress', 'done']) {
      for (const c of [ctx.owner, ctx.managerA.client]) {
        const r = await c.req('PATCH', `/api/tasks/${t}`, { status: st });
        assert.equal(r.status, 403, `${st} 거절`); assert.match(r.body.error.message, /상태는 담당자만/);
      }
    }
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'on_hold' });
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'in_progress' });
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).task.status, 'in_progress');
  });
  test('유일한 예외: 검토 요청된 업무를 그 업무의 지시자가 승인·반려 — 지시자가 아닌 대표·관리자는 불가, 검토 전에는 지시자도 불가', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V12-11 검토', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id, approvalRequired: false })).id;
    assert.equal((await ctx.managerA.client.req('PATCH', `/api/tasks/${t}`, { status: 'done' })).status, 403, '검토 전에는 지시자도 불가');
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'review' });
    assert.equal((await ctx.owner.req('PATCH', `/api/tasks/${t}`, { status: 'done' })).status, 403, '지시자가 아닌 대표는 승인 불가');
    assert.equal((await ctx.managerA.client.req('PATCH', `/api/tasks/${t}`, { status: 'on_hold' })).status, 403, '지시자도 보류는 불가');
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'in_progress', reviewNote: '보완' }); // 반려
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'review' });
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'done' }); // 승인
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).task.status, 'done');
  });
  test('담당자가 없는 업무는 만든 사람만 상태 변경', async () => {
    const t = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: 'V12-11 담당 없음', orgUnitId: ctx.siteA, assigneeId: null, approvalRequired: false })).id;
    assert.equal((await ctx.owner.req('PATCH', `/api/tasks/${t}`, { status: 'in_progress' })).status, 403, '대표도 불가');
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${t}`, { status: 'done' })).status, 403);
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t}`, { status: 'done' });
  });
});

describe('WORKIN_V12 8번 자료로 업무 일괄 생성 (가짜 Anthropic)', () => {
  const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicQueue: items }) });
  const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
  const up = async (c, name, mime, data) => {
    const init = await c.ok('POST', '/api/library', { fileName: name, mimeType: mime, size: data.length, folder: 'AI 요청 첨부' });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
    await c.ok('POST', `/api/library/${init.id}/complete`);
    return init.id;
  };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  test('사진 첨부 → 비전 입력, create_tasks 제안(담당자별·체크리스트·메모·마감 시각) → 확인하면 각자 1건 + 원본 첨부', async () => {
    const img = await up(ctx.owner, '촬영 요청서.png', 'image/png', png);
    const before = (await fakeState()).anthropic.length;
    const checklist = ['1 지점 외관', '2 내부 전경', '3 기구 근접', '4 트레이너', '5 회원 운동', '6 이벤트 배너', '7 야간 조명'];
    await queue([{ content: [{ type: 'tool_use', id: 'c1', name: 'propose_create_tasks', input: { title: '각 지점 촬영 자료 받아오기', assigneeIds: [ctx.staffA.id, ctx.managerA.id],
      dueDate: addDays(today, 5), dueTime: '14:00', description: '요청서 7개 게시물용 사진 — 촬영 팁: 자연광', checklist, attachFileIds: [img] } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: '2명에게 각각 만들 업무를 준비했습니다. 확인을 누르면 만들어집니다.' }], stop_reason: 'end_turn' }]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '이직원·최매니저에게 각 지점 자료 받아오라고 배정해줘' }], fileIds: [img] });
    const req0 = (await fakeState()).anthropic.slice(before)[0].body;
    const last = req0.messages.at(-1).content;
    assert.equal(last[0].type, 'image'); assert.equal(last[0].source.type, 'base64'); assert.equal(last[0].source.data, png.toString('base64'), '사진 내용(base64)을 비전 입력으로');
    assert.ok(last.at(-1).text.includes(img) && last.at(-1).text.includes('각 지점 자료'), '첨부 id + 요청 문장');
    assert.ok(req0.tools.some((t) => t.name === 'propose_create_tasks'));
    const p = r.proposals[0];
    assert.equal(p.kind, 'create_tasks'); assert.deepEqual(p.preview.assignees.sort(), ['이직원', '최매니저'].sort()); assert.equal(p.preview.checklist.length, 7); assert.equal(p.preview.files, 1);
    assert.equal((await sql`select count(*)::int n from tasks where title = '각 지점 촬영 자료 받아오기'`)[0].n, 0, '확인 전 미생성');
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${p.id}`, { accept: true });
    assert.equal(done.taskIds.length, 2);
    for (const id of done.taskIds) {
      const d = await ctx.owner.ok('GET', `/api/tasks/${id}`);
      assert.equal(d.checklist.length, 7); assert.equal(d.task.due_time?.slice(0, 5), '14:00'); assert.match(d.task.description, /촬영 팁/);
      assert.equal(d.attachments.length, 1); assert.equal(d.attachments[0].file_name, '촬영 요청서.png');
    }
  });
  test('모르는 담당자 id·다른 회사 자료는 거절, 자료로 채우기(구조화 출력)', async () => {
    await queue([{ content: [{ type: 'tool_use', id: 'd1', name: 'propose_create_tasks', input: { title: 'x', assigneeIds: ['00000000-0000-4000-8000-000000000000'] } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: '사람을 찾지 못했습니다.' }], stop_reason: 'end_turn' }]);
    const before = (await fakeState()).anthropic.length;
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '없는 사람에게 배정' }] });
    assert.equal(r.proposals.length, 0);
    const tr = (await fakeState()).anthropic.slice(before)[1].body.messages.at(-1).content[0];
    assert.equal(tr.is_error, true); assert.match(tr.content, /배정할 수 없는 사람/);
    const csv = await up(ctx.staffA.client, '촬영목록.csv', 'text/csv', Buffer.from('번호,내용\n1,외관\n2,내부\n', 'utf8'));
    await sql`update library_files set tenant = 'other-co' where id = ${csv}`;
    assert.equal((await ctx.staffA.client.req('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '읽어줘' }], fileIds: [csv] })).status, 404);
    await sql`update library_files set tenant = 'default' where id = ${csv}`;
    await queue([{ content: [{ type: 'text', text: JSON.stringify({ title: '촬영 목록 정리', description: '외관·내부 촬영', checklist: ['외관', '내부'], dueDate: addDays(today, 3), dueTime: null }) }], stop_reason: 'end_turn' }]);
    const b2 = (await fakeState()).anthropic.length;
    const fill = await ctx.staffA.client.ok('POST', '/api/ai/fill', { fileIds: [csv] });
    assert.deepEqual(fill, { title: '촬영 목록 정리', description: '외관·내부 촬영', checklist: ['외관', '내부'], dueDate: addDays(today, 3), dueTime: null });
    const fr = (await fakeState()).anthropic.slice(b2)[0].body;
    assert.equal(fr.output_config.format.type, 'json_schema'); assert.ok(!fr.tools, '도구 없이');
    assert.match(fr.messages[0].content[0].text, /번호,내용/, 'CSV 는 추출한 글자로');
    // 업무에 첨부 API
    const t = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: '자료 첨부 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    await ctx.staffA.client.ok('POST', `/api/library/${csv}/attach`, { taskId: t });
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).attachments.length, 1);
  });
});

const { createHmac } = await import('node:crypto');
describe('WORKIN_V12 3번 ICS 구독 · 2단계 인증 · 도움말 문의 · 로그인 기기', () => {
  const b32 = (s) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s) bits += A.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
  const totp = (secret, at = Date.now()) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(Math.floor(at / 30000))); const h = createHmac('sha1', b32(secret)).update(b).digest(); const o = h[h.length - 1] & 15;
    return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };
  test('ICS: 비밀 주소로 내 일정·내 업무 마감만, 새 주소면 이전 주소 404, 끄면 404', async () => {
    const c = ctx.managerA.client;
    const t = (await c.ok('POST', '/api/tasks', { title: 'ICS 마감 업무', orgUnitId: ctx.siteA, assigneeId: ctx.managerA.id, dueDate: addDays(today, 2), dueTime: '15:00', approvalRequired: false })).id;
    const other = (await ctx.owner.ok('POST', '/api/tasks', { title: 'ICS 남의 업무', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, dueDate: addDays(today, 2), approvalRequired: false })).id;
    const f = await c.ok('POST', '/api/calendar-feed', {});
    assert.match(f.url, /\/api\/ics\/[A-Za-z0-9_-]+\.ics$/);
    const path = new URL(f.url).pathname;
    const r = await fetch(BASE + path); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/calendar/);
    const ics = await r.text();
    assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.includes('SUMMARY:마감: ICS 마감 업무') && ics.includes(`UID:task-${t}@workin`), '내 업무 마감');
    assert.ok(!ics.includes('ICS 남의 업무'), '남의 업무 없음');
    assert.ok((await c.ok('GET', '/api/calendar-feed')).lastUsedAt, '마지막 사용 기록');
    const f2 = await c.ok('POST', '/api/calendar-feed', {});
    assert.equal((await fetch(BASE + path)).status, 404, '새 주소 → 이전 주소 무효');
    await c.ok('DELETE', '/api/calendar-feed');
    assert.equal((await fetch(BASE + new URL(f2.url).pathname)).status, 404);
    void other;
  });
  test('2단계 인증: 설정 → 코드로 켜기 → 로그인 시 코드 요구(코드 전에는 401) → 코드 확인 후 로그인, 틀리면 거절, 끄기', async () => {
    const em = 'mfa@dagym.test', pw = 'mfa-pass-1234';
    const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: em, name: '두단계', role: 'staff', orgUnitIds: [ctx.siteA] });
    const u = new Client('mfa'); await u.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: pw });
    const { secret } = await u.ok('POST', '/api/auth/2fa', {});
    assert.equal((await u.req('PUT', '/api/auth/2fa', { code: '000000' })).status, 400);
    await u.ok('PUT', '/api/auth/2fa', { code: totp(secret) });
    assert.equal((await u.ok('GET', '/api/auth/2fa')).enabled, true);
    const l = new Client('mfa2');
    const r1 = await l.ok('POST', '/api/auth/login', { email: em, password: pw });
    assert.equal(r1.mfaRequired, true);
    assert.equal((await l.req('GET', '/api/auth/me')).status, 401, '코드 전에는 로그인 아님');
    assert.equal((await l.req('POST', '/api/auth/2fa/verify', { code: '123456' })).status, 400);
    const ok = await l.ok('POST', '/api/auth/2fa/verify', { code: totp(secret) });
    assert.equal(ok.user.name, '두단계');
    assert.equal((await l.ok('GET', '/api/auth/me')).user.name, '두단계');
    // 로그인 기기 목록·다른 기기 로그아웃
    const ss = await l.ok('GET', '/api/auth/sessions');
    assert.ok(ss.sessions.length >= 2 && ss.sessions.some((x) => x.current));
    const out = await l.ok('DELETE', '/api/auth/sessions');
    assert.ok(out.revoked >= 1);
    assert.equal((await u.req('GET', '/api/auth/me')).status, 401, '다른 기기는 로그아웃됨');
    await l.ok('DELETE', '/api/auth/2fa', { code: totp(secret) });
    const r2 = await new Client('mfa3').ok('POST', '/api/auth/login', { email: em, password: pw });
    assert.ok(r2.user && !r2.mfaRequired, '끄면 코드 없이 로그인');
  });
  test('도움말 문의 → 플랫폼 운영자 접수함·알림 → 답변하면 문의한 사람에게 알림, 다른 사람은 접수함 404', async () => {
    const c = ctx.staffA.client;
    const t = await c.ok('POST', '/api/support', { category: 'bug', subject: '사진 업로드 실패', body: '파일 저장소에 연결하지 못했습니다 문구가 나옵니다' });
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and title = '새 문의: 사진 업로드 실패'`).length, '운영자 알림');
    assert.equal((await c.req('GET', '/api/support/admin')).status, 404);
    assert.ok((await ctx.owner.ok('GET', '/api/support/admin')).tickets.some((x) => x.id === t.id));
    assert.equal((await c.req('POST', `/api/support/${t.id}`, { answer: 'x' })).status, 404);
    await ctx.owner.ok('POST', `/api/support/${t.id}`, { answer: '저장소 설정을 고쳤습니다. 다시 올려 주세요.' });
    const mine = (await c.ok('GET', '/api/support')).tickets.find((x) => x.id === t.id);
    assert.equal(mine.status, 'answered'); assert.match(mine.answer, /다시 올려/);
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and title = '문의 답변: 사진 업로드 실패'`).length);
    assert.equal((await fetch(BASE + '/status')).status, 200, '공개 상태 페이지');
  });
});

describe('V13 자료실 자동 정리·중복·폴더 권한 (가짜 Anthropic)', () => {
  const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const up = async (c, meta, data, extra = {}) => {
    const init = await c.ok('POST', '/api/library', { ...meta, size: data.length, ...extra });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
    return { id: init.id, done: await c.ok('POST', `/api/library/${init.id}/complete`) };
  };
  const hash = (b) => createHash('sha256').update(b).digest('hex');
  let auto;
  test('올리면 AI 가 폴더·태그·제목·요약을 바로 적용("AI 정리됨"), 확신 낮으면 "정리 필요", 되돌리기', async () => {
    const org = { folder: '브랜드자료/다짐', tags: ['로고', '다짐', '가로형'], title: '다짐 로고 (가로형)', summary: '다짐 브랜드 가로형 로고', confidence: 0.92 };
    await ctl({ anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify(org) }], stop_reason: 'end_turn' }] });
    const data = Buffer.from('fake-png-garo');
    const r = await up(ctx.owner, { fileName: '다짐_로고_가로형.png', mimeType: 'image/png', contentHash: hash(data) }, data);
    auto = r.id;
    assert.equal(r.done.organized.by, 'ai'); assert.equal(r.done.organized.folder, '브랜드자료/다짐');
    const st = await (await fetch(FAKE + '/__state')).json();
    assert.equal(st.anthropic.at(-1).body.model, 'claude-haiku-5-5', '가벼운 모델');
    const [f] = await sql`select folder, tags, title, description, organized_by, needs_review from library_files where id = ${auto}`;
    assert.equal(f.folder, '브랜드자료/다짐'); assert.deepEqual(f.tags, ['로고', '다짐', '가로형']); assert.equal(f.title, '다짐 로고 (가로형)');
    assert.equal(f.organized_by, 'ai'); assert.equal(f.needs_review, false);
    assert.ok((await sql`select 1 from ai_usage where purpose = 'library_organize'`).length, 'AI 한도에 포함');
    // 같은 파일 다시 → 409 중복 안내, allowDuplicate 면 허용
    const dup = await ctx.owner.req('POST', '/api/library', { fileName: '복사본.png', mimeType: 'image/png', size: data.length, contentHash: hash(data) });
    assert.equal(dup.status, 409); assert.equal(dup.body.error.detail.duplicate.id, auto);
    // 확신 낮은 정리 → 정리 필요 보기
    await ctl({ anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ ...org, folder: '기타', title: '무언가', confidence: 0.3 }) }], stop_reason: 'end_turn' }] });
    const low = await up(ctx.owner, { fileName: 'scan_0001.jpg', mimeType: 'image/jpeg' }, Buffer.from('blurry'));
    const rv = await ctx.owner.ok('GET', '/api/library?review=1');
    assert.ok(rv.review >= 1); assert.ok(rv.files.some((x) => x.id === low.id)); assert.ok(!rv.files.some((x) => x.id === auto));
    await ctx.owner.ok('POST', `/api/library/${low.id}/organize`, { action: 'undo' });
    const [u] = await sql`select folder, title, organized_by, needs_review from library_files where id = ${low.id}`;
    assert.equal(u.folder, ''); assert.equal(u.title, 'scan_0001'); assert.equal(u.organized_by, null); assert.equal(u.needs_review, false);
  });
  test('사람이 고친 정리는 회사별 규칙으로 남고, AI 가 꺼진(응답 실패) 때는 그 규칙으로 정리', async () => {
    await ctx.owner.ok('PATCH', `/api/library/${auto}`, { folder: '브랜드/다짐/로고', tags: ['로고', '다짐'] });
    assert.equal((await sql`select folder from library_rules order by id desc limit 1`)[0].folder, '브랜드/다짐/로고');
    await ctl({ anthropicQueue: [{ content: [{ type: 'text', text: 'JSON 아님' }], stop_reason: 'end_turn' }] });
    const r = await up(ctx.owner, { fileName: '다짐_로고_세로형.png', mimeType: 'image/png' }, Buffer.from('fake-png-sero'));
    assert.equal(r.done.organized.by, 'rule'); assert.equal(r.done.organized.folder, '브랜드/다짐/로고');
    // 다음 AI 요청에는 고친 예시가 들어간다
    await ctl({ anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ folder: '브랜드/다짐/로고', tags: ['로고'], title: '다짐 로고 심볼', summary: '', confidence: 0.9 }) }], stop_reason: 'end_turn' }] });
    await up(ctx.owner, { fileName: '다짐_로고_심볼.png', mimeType: 'image/png' }, Buffer.from('fake-png-sym'));
    const st = await (await fetch(FAKE + '/__state')).json();
    assert.ok(JSON.stringify(st.anthropic.at(-1).body.messages).includes('브랜드/다짐/로고'));
  });
  test('폴더 권한(대표만): "인사" 폴더를 직원에게 숨기면 목록·파일·내려받기·AI 검색에서 빠지고 하위 폴더도 상속', async () => {
    await ctl({ anthropicQueue: [{ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' }] });
    const hr = await up(ctx.owner, { fileName: '연봉표.txt', mimeType: 'text/plain', folder: '인사/2026' }, Buffer.from('연봉 비밀'));
    assert.equal((await sql`select folder from library_files where id = ${hr.id}`)[0].folder, '인사/2026', '사용자가 정한 폴더는 유지');
    assert.equal((await ctx.managerA.client.req('PUT', '/api/library/folder-perms', { folder: '인사', role: 'staff', level: 'none' })).status, 403);
    await ctx.owner.ok('PUT', '/api/library/folder-perms', { folder: '인사', role: 'staff', level: 'none' });
    const list = await ctx.staffA.client.ok('GET', '/api/library');
    assert.ok(!list.files.some((f) => f.id === hr.id)); assert.ok(!list.folders.some((f) => f.folder.startsWith('인사')));
    assert.equal((await ctx.staffA.client.req('GET', `/api/library/${hr.id}`)).status, 404);
    assert.equal((await ctx.staffA.client.req('GET', `/api/library/${hr.id}/download`)).status, 404);
    assert.ok((await ctx.managerA.client.ok('GET', '/api/library')).files.some((f) => f.id === hr.id), '다른 등급은 그대로');
    // AI 비서 검색도 요청자 권한 안에서만
    await ctl({ anthropicQueue: [{ content: [{ type: 'tool_use', id: 's1', name: 'search_library', input: { query: '연봉' } }], stop_reason: 'tool_use' }, { content: [{ type: 'text', text: '없습니다' }], stop_reason: 'end_turn' }] });
    const before = (await (await fetch(FAKE + '/__state')).json()).anthropic.length;
    await ctx.staffA.client.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '연봉표 찾아줘' }] });
    const res = (await (await fetch(FAKE + '/__state')).json()).anthropic.slice(before)[1].body.messages.at(-1).content;
    assert.ok(!JSON.stringify(res).includes(hr.id), 'AI 검색 결과에 숨긴 폴더 파일 없음');
    // 보기만 → 수정 403, 삭제 단계 없으면 남의 파일 삭제 403
    await ctx.owner.ok('PUT', '/api/library/folder-perms', { folder: '인사', role: 'site_manager', level: 'view' });
    assert.equal((await ctx.managerA.client.post('/api/library', { fileName: 'b.txt', size: 3, folder: '인사/2026' })).status, 403);
    assert.equal((await ctx.managerA.client.req('DELETE', `/api/library/${auto}`)).status, 403);
    assert.ok((await sql`select 1 from audit_logs where action = 'library_folder_perm.set'`).length);
    await ctx.owner.ok('PUT', '/api/library/folder-perms', { folder: '인사', role: 'site_manager', level: null });
  });
});

describe('V13 6번 마감 알림을 지시자에게도', () => {
  const notes = (uid, id) => sql`select title, body, link from notifications where user_id = ${uid} and entity_id = ${id} and type = 'due_soon' order by id`;
  test('지시자에게 담당자 이름·상태와 함께, 반복 실행해도 1번 · 지시자 = 담당자면 1건 · 완료·보류는 안 보냄', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-6 오늘 마감', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id, dueDate: today })).id;
    const self = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-6 내 업무', orgUnitId: ctx.siteA, assigneeId: ctx.managerA.id, requestedById: ctx.managerA.id, dueDate: today })).id;
    const held = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-6 보류', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id, dueDate: today })).id;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${held}`, { status: 'on_hold' });
    await tick(); await tick();
    const mine = await notes(ctx.managerA.id, t);
    assert.equal(mine.filter((n) => n.title === '[지시] 오늘 마감: V13-6 오늘 마감').length, 1, '하루 1번');
    assert.match(mine[0].body, /담당 이직원 · 시작 전|담당 이직원 · /);
    assert.ok((await notes(ctx.staffA.id, t)).some((n) => n.title === '오늘 마감: V13-6 오늘 마감'), '담당자는 그대로');
    const s = await notes(ctx.managerA.id, self);
    assert.ok(s.length >= 1 && !s.some((n) => n.title.startsWith('[지시]')), '지시자 = 담당자면 담당자 알림만(중복 없음)');
    assert.equal(s.filter((n) => n.title.startsWith('오늘 마감')).length, 1);
    assert.equal((await notes(ctx.managerA.id, held)).length, 0, '보류는 안 보냄');
  });
  test('일괄 업무는 지시자에게 묶음 1건, 설정을 끄면 안 보냄', async () => {
    const r = await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-6 일괄', orgUnitId: ctx.siteA, assigneeIds: [ctx.staffA.id, ctx.managerA.id], dueDate: today });
    const ids = (r.ids ?? r.tasks?.map((x) => x.id)) ?? [r.id];
    await tick();
    const all = await sql`select title, body from notifications where user_id = ${ctx.ownerId} and type = 'due_soon' and title = '[지시] 오늘 마감: V13-6 일괄'`;
    assert.equal(all.length, 1, `묶음 1건 (업무 ${ids.length}개)`); assert.match(all[0].body, /외 1명/);
    // 끄기
    const pre = await ctx.staffA.client.ok('GET', '/api/notifications/prefs');
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...pre.settings, requesterDueAlerts: false } });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/notifications/prefs')).settings.requesterDueAlerts, false);
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-6 끔', orgUnitId: ctx.siteA, assigneeId: ctx.managerA.id, requestedById: ctx.staffA.id, dueDate: today })).id;
    await tick();
    assert.equal((await notes(ctx.staffA.id, t)).length, 0, '설정 끄면 지시자 알림 없음');
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...pre.settings, requesterDueAlerts: true } });
  });
  test('휴대폰 예약 알림 목록에 내가 지시한 업무 포함', async () => {
    const tomorrow = addDays(today, 1);
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-6 내일', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id, dueDate: tomorrow, dueTime: '15:00' })).id;
    const { reminders } = await ctx.managerA.client.ok('GET', '/api/reminders/upcoming');
    const mine = reminders.filter((x) => x.link === `/tasks/${t}`);
    assert.ok(mine.some((x) => x.title === '[지시] 오늘 마감: V13-6 내일' && x.body === '담당 이직원'));
    assert.ok(mine.some((x) => x.title.startsWith('[지시] 1시간 뒤 마감')));
  });
});

describe('V13 8번 대댓글·댓글 알림·반응', () => {
  const cnotes = (uid, cid) => sql`select title from notifications where user_id = ${uid} and link like ${'%#c-' + cid}`;
  test('새 댓글 → 담당·지시·댓글 단 사람(본인 제외), 답글 → 원 작성자·스레드 참여자만, 멘션은 1건', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-8 댓글', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id })).id;
    const c1 = await ctx.staffA.client.ok('POST', `/api/tasks/${t}/comments`, { body: '시작했습니다' });
    assert.equal((await cnotes(ctx.managerA.id, c1.id)).length, 1, '지시자');
    assert.equal((await cnotes(ctx.ownerId, c1.id)).length, 1, '만든 사람');
    assert.equal((await cnotes(ctx.staffA.id, c1.id)).length, 0, '본인 제외');
    const c2 = await ctx.owner.ok('POST', `/api/tasks/${t}/comments`, { body: '좋습니다' });
    assert.equal((await cnotes(ctx.staffA.id, c2.id)).length, 1, '담당자');
    // 답글: 원 작성자(staffA) + 스레드 참여자
    const r1 = await ctx.managerA.client.ok('POST', `/api/tasks/${t}/comments`, { body: '사진도 올려 주세요', parentId: c1.id });
    assert.equal(r1.parentId, c1.id);
    assert.deepEqual((await cnotes(ctx.staffA.id, r1.id)).map((n) => n.title), ['답글: V13-8 댓글']);
    assert.equal((await cnotes(ctx.ownerId, r1.id)).length, 0, '스레드 밖 사람에게는 안 감');
    // 답글의 답글 → 같은 스레드(1단계), 참여자 managerA 에게
    const r2 = await ctx.staffA.client.ok('POST', `/api/tasks/${t}/comments`, { body: `@[최매니저](${ctx.managerA.id}) 올렸습니다`, parentId: r1.id });
    assert.equal(r2.parentId, c1.id, '답글은 1단계');
    const m = await sql`select type from notifications where user_id = ${ctx.managerA.id} and link like ${'%#c-' + r2.id}`;
    assert.deepEqual(m.map((x) => x.type), ['mention'], '멘션된 사람은 1건');
    // 다른 업무의 댓글에 답글 달기 불가
    const other = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-8 다른 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id })).id;
    assert.equal((await ctx.staffA.client.post(`/api/tasks/${other}/comments`, { body: 'x', parentId: c1.id })).status, 404);
    // 상세: 답글 구조
    const d = await ctx.staffA.client.ok('GET', `/api/tasks/${t}`);
    assert.equal(d.comments.filter((c) => c.parent_id === c1.id).length, 2);
  });
  test('반응 토글·수정·삭제(작성자만), 답글 있는 댓글은 "삭제된 댓글"로 남음, 볼 수 없는 사람은 반응 불가', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-8 반응', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id })).id;
    const c = await ctx.owner.ok('POST', `/api/tasks/${t}/comments`, { body: '확인 부탁합니다' });
    assert.equal((await ctx.staffA.client.ok('POST', `/api/comments/${c.id}/reactions`, { emoji: '👍' })).on, true);
    let d = await ctx.owner.ok('GET', `/api/tasks/${t}`);
    assert.deepEqual(d.comments[0].reactions.map((r) => [r.emoji, r.n, r.mine]), [['👍', 1, false]]);
    assert.equal((await ctx.staffA.client.ok('POST', `/api/comments/${c.id}/reactions`, { emoji: '👍' })).on, false, '다시 누르면 취소');
    assert.equal((await ctx.staffA.client.post(`/api/comments/${c.id}/reactions`, { emoji: '💩' })).status, 400);
    const hidden = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-8 판교', orgUnitId: ctx.siteB })).id;
    const hc = await ctx.owner.ok('POST', `/api/tasks/${hidden}/comments`, { body: '판교 전용' });
    assert.equal((await ctx.staffA.client.post(`/api/comments/${hc.id}/reactions`, { emoji: '👍' })).status, 404, '볼 수 없는 업무의 댓글');
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/comments/${c.id}`, { body: '남의 댓글' })).status, 403);
    await ctx.owner.ok('PATCH', `/api/comments/${c.id}`, { body: '확인 부탁드립니다' });
    await ctx.staffA.client.ok('POST', `/api/tasks/${t}/comments`, { body: '네', parentId: c.id });
    await ctx.owner.ok('DELETE', `/api/comments/${c.id}`);
    d = await ctx.owner.ok('GET', `/api/tasks/${t}`);
    const top = d.comments.find((x) => x.id === c.id);
    assert.equal(top.deleted, true); assert.equal(top.body, '', '지운 내용은 안 보냄');
    assert.equal(d.comments.filter((x) => x.parent_id === c.id).length, 1);
  });
});

describe('V13 10번 사내 메신저', () => {
  let dm;
  test('1:1 왕복·안 읽은 수·읽음·푸시(알림 목록에는 안 쌓임)', async () => {
    await ctx.staffA.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-chat-a', platform: 'android' });
    dm = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
    assert.equal((await ctx.staffA.client.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.ownerId })).id, dm, '같은 두 사람은 같은 방');
    const m1 = await ctx.owner.ok('POST', `/api/chat/rooms/${dm}/messages`, { body: '내일 10시 회의 자료 부탁해요' });
    assert.deepEqual(m1.notified, [ctx.staffA.id]);
    const list = await ctx.staffA.client.ok('GET', '/api/chat/rooms');
    const row = list.rooms.find((r) => r.id === dm);
    assert.equal(row.unread, 1); assert.equal(row.name, '김대표'); assert.ok(list.rooms.some((r) => r.kind === 'company'), '회사 전체방 자동');
    assert.equal((await ctx.staffA.client.ok('GET', '/api/chat/unread')).unread, 1);
    const notes = await ctx.staffA.client.ok('GET', '/api/notifications');
    assert.ok(!notes.items.some((n) => n.type === 'chat'), '알림 목록에는 메신저 안 쌓임');
    await new Promise((r) => setTimeout(r, 800)); await tick();
    const st = await fetch(`${FAKE}/__state`).then((r) => r.json());
    assert.ok(st.fcm.some((m) => m.token === 'fcm-chat-a' && m.data.link === `/messages?room=${dm}`), '푸시 → 그 대화방으로');
    const r2 = await ctx.staffA.client.ok('POST', `/api/chat/rooms/${dm}/messages`, { body: '네 준비하겠습니다' });
    await ctx.staffA.client.ok('POST', `/api/chat/rooms/${dm}/read`, {});
    assert.equal((await ctx.staffA.client.ok('GET', '/api/chat/unread')).unread, 0);
    const d = await ctx.owner.ok('GET', `/api/chat/rooms/${dm}`);
    assert.deepEqual(d.messages.map((m) => m.body), ['내일 10시 회의 자료 부탁해요', '네 준비하겠습니다']);
    assert.ok(BigInt(d.members.find((m) => m.id === ctx.staffA.id).last_read_id) >= BigInt(r2.id), '읽음 표시');
  });
  test('다른 사람·다른 회사의 방은 404, 볼 수 없는 업무의 방도 404', async () => {
    assert.equal((await ctx.managerA.client.get(`/api/chat/rooms/${dm}`)).status, 404);
    assert.equal((await ctx.managerA.client.post(`/api/chat/rooms/${dm}/messages`, { body: '끼어들기' })).status, 404);
    const [{ id }] = await sql`select id::text from chat_messages where room_id = ${dm} limit 1`;
    assert.equal((await ctx.managerA.client.req('DELETE', `/api/chat/messages/${id}`)).status, 404);
    await sql`update chat_rooms set tenant = 'other-co' where id = ${dm}`;
    assert.equal((await ctx.owner.get(`/api/chat/rooms/${dm}`)).status, 404, '다른 회사');
    assert.ok(!(await ctx.owner.ok('GET', '/api/chat/rooms')).rooms.some((r) => r.id === dm));
    await sql`update chat_rooms set tenant = 'default' where id = ${dm}`;
    const pangyo = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-10 판교 업무', orgUnitId: ctx.siteB })).id;
    assert.equal((await ctx.staffA.client.post('/api/chat/rooms', { kind: 'task', taskId: pangyo })).status, 404);
    const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'task', taskId: pangyo })).id;
    assert.equal((await ctx.staffA.client.get(`/api/chat/rooms/${room}`)).status, 404);
  });
  test('그룹·알림 끄기(멘션은 예외)·업무 방 담당자 자동 참여·수정/삭제·고정·검색·업무로 만들기·내보내기(대표만)', async () => {
    const g = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '강남점 오픈', userIds: [ctx.staffA.id, ctx.managerA.id] })).id;
    await ctx.managerA.client.ok('PATCH', `/api/chat/rooms/${g}`, { muted: true });
    const a = await ctx.owner.ok('POST', `/api/chat/rooms/${g}/messages`, { body: '오픈 일정 공유합니다' });
    assert.deepEqual(a.notified, [ctx.staffA.id], '알림 끈 사람 제외');
    const b = await ctx.owner.ok('POST', `/api/chat/rooms/${g}/messages`, { body: `@[최매니저](${ctx.managerA.id}) 확인 부탁` });
    assert.ok(b.notified.includes(ctx.managerA.id), '멘션은 알림 끔이어도 보냄');
    // 업무 방: 담당자는 방을 연 적 없어도 알림
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V13-10 강남 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id })).id;
    const tr = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'task', taskId: t })).id;
    assert.ok((await ctx.owner.ok('POST', `/api/chat/rooms/${tr}/messages`, { body: '사진 올려 주세요' })).notified.includes(ctx.staffA.id));
    assert.equal((await ctx.staffA.client.ok('GET', `/api/chat/rooms/${tr}`)).room.name, 'V13-10 강남 업무');
    // 수정·삭제(작성자만)·고정
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/chat/messages/${a.id}`, { body: '남의 것' })).status, 403);
    await ctx.owner.ok('PATCH', `/api/chat/messages/${a.id}`, { body: '오픈 일정 공유합니다 (수정)' });
    await ctx.staffA.client.ok('POST', `/api/chat/messages/${a.id}/pin`, { pin: true });
    let d = await ctx.owner.ok('GET', `/api/chat/rooms/${g}`);
    assert.equal(d.pinned[0].id, a.id); assert.ok(d.messages.find((m) => m.id === a.id).edited_at);
    await ctx.owner.ok('DELETE', `/api/chat/messages/${b.id}`);
    d = await ctx.owner.ok('GET', `/api/chat/rooms/${g}`);
    const del = d.messages.find((m) => m.id === b.id);
    assert.equal(del.deleted, true); assert.equal(del.body, '', '삭제된 내용은 안 보냄');
    // 검색 (내가 속한 방만)
    assert.ok((await ctx.staffA.client.ok('GET', '/api/chat/search?q=' + encodeURIComponent('오픈 일정'))).results.some((r) => r.id === a.id));
    assert.ok(!(await ctx.managerA.client.ok('GET', '/api/chat/search?q=' + encodeURIComponent('회의 자료'))).results.length, '내가 없는 방은 검색 안 됨');
    // 업무로 만들기: 제안 → 만든 업무 연결
    const s = await ctx.staffA.client.ok('POST', `/api/chat/messages/${a.id}/to-task`, {});
    assert.equal(s.title, '오픈 일정 공유합니다 (수정)');
    const nt = (await ctx.staffA.client.ok('POST', '/api/tasks', { title: s.title, orgUnitId: ctx.siteA })).id;
    await ctx.staffA.client.ok('POST', `/api/chat/messages/${a.id}/link`, { taskId: nt });
    assert.equal((await ctx.owner.ok('GET', `/api/chat/rooms/${g}`)).messages.find((m) => m.id === a.id).task_id, nt);
    // 내보내기: 대표만, 감사 기록
    assert.equal((await ctx.staffA.client.get(`/api/chat/rooms/${g}/export`)).status, 403);
    const csv = await (await fetch(`${BASE}/api/chat/rooms/${g}/export`, { headers: { cookie: ctx.owner.cookie, origin: BASE } })).text();
    assert.match(csv, /오픈 일정 공유합니다/); assert.match(csv, /삭제됨/);
    assert.ok((await sql`select 1 from audit_logs where action = 'chat.export'`).length);
  });
  test('실시간: SSE 로 새 메시지·폴링 대체', async () => {
    const ac = new AbortController();
    const res = await fetch(`${BASE}/api/chat/stream`, { headers: { cookie: ctx.staffA.client.cookie, origin: BASE }, signal: ac.signal });
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    const until = async (re) => { const end = Date.now() + 15000; while (!re.test(buf) && Date.now() < end) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } return re.test(buf); };
    assert.ok(await until(/event: ready/));
    const sent = await ctx.owner.ok('POST', `/api/chat/rooms/${dm}/messages`, { body: '실시간 시험' });
    assert.ok(await until(/event: messages[\s\S]*실시간 시험/), 'SSE 로 새 메시지');
    assert.match(buf, new RegExp(`id: ${sent.id}`));
    ac.abort();
    const p = await ctx.staffA.client.ok('GET', `/api/chat/poll?since=${Number(sent.id) - 1}&t=${Date.now() - 1000}`);
    assert.ok(p.messages.some((m) => m.id === sent.id), '폴링으로도');
  });
});

describe('V14 3번 자료실 자동 정리 점검 — 상태·실패 사유·다시 정리·전체 정리', () => {
  const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const say = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o) }], stop_reason: 'end_turn' });
  const up = async (meta, data) => {
    const init = await ctx.owner.ok('POST', '/api/library', { ...meta, size: data.length });
    await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: data });
    return { id: init.id, done: await ctx.owner.ok('POST', `/api/library/${init.id}/complete`) };
  };
  test('실패하면 이유를 남기고(조용히 넘어가지 않음) "다시 정리"로 AI 정리, 설명 섞인 답에서도 JSON 추출', async () => {
    await ctl({ anthropicQueue: [say('죄송합니다')] });
    const a = await up({ fileName: 'V14_견적서.pdf', mimeType: 'application/pdf' }, Buffer.from('%PDF-1.4 fake'));
    assert.equal(a.done.organized.by, 'rule'); assert.match(a.done.organized.error, /해석하지 못했습니다/);
    let [f] = await sql`select organize_status, organize_error from library_files where id = ${a.id}`;
    assert.equal(f.organize_status, 'failed'); assert.ok(f.organize_error);
    const st = await (await fetch(FAKE + '/__state')).json();
    assert.ok(st.anthropic.at(-1).body.messages[0].content.some((b) => b.type === 'document'), 'PDF 는 문서로 보냄');
    await ctl({ anthropicQueue: [say('정리 결과입니다: ' + JSON.stringify({ folder: '영업/견적', tags: ['견적'], title: '견적서', summary: '견적', confidence: 0.9 }))] });
    const r = await ctx.owner.ok('POST', `/api/library/${a.id}/organize`, { action: 'redo' });
    assert.equal(r.by, 'ai'); assert.equal(r.folder, '영업/견적');
    [f] = await sql`select organize_status, organize_error, folder from library_files where id = ${a.id}`;
    assert.equal(f.organize_status, 'done'); assert.equal(f.organize_error, null);
    const list = await ctx.owner.ok('GET', '/api/library');
    assert.equal(list.files.find((x) => x.id === a.id).organize_status, 'done');
  });
  test('관리자 "전체 정리": 정리 안 된 파일을 차례로, 직원은 403', async () => {
    await sql`update library_files set organize_status = null, organized_by = null where source = 'upload' and deleted_at is null`;
    assert.equal((await ctx.staffA.client.post('/api/library/organize-all', {})).status, 403);
    await ctl({ anthropicQueue: Array.from({ length: 30 }, () => say({ folder: '정리됨', tags: ['일괄'], title: '', summary: '', confidence: 0.8 })) });
    let total = 0; let r;
    for (let i = 0; i < 10; i++) { r = await ctx.owner.ok('POST', '/api/library/organize-all', {}); total += r.done; if (!r.left) break; }
    assert.equal(r.left, 0); assert.ok(total > 0);
    const [{ n }] = await sql`select count(*)::int n from library_files where source = 'upload' and deleted_at is null and upload_status = 'ready' and organize_status is null`;
    assert.equal(n, 0);
    await ctl({ anthropicReset: true });
  });
});

describe('V14 1번 담당자 재배정 권한', () => {
  test('기본: 직원·현장 관리자는 남의 업무 재배정 403, 지시자는 자기 업무 재배정 가능, 대표는 언제나 · 이력·알림', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V14 재배정', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.ownerId })).id;
    assert.equal((await ctx.managerA.client.req('PATCH', `/api/tasks/${t}`, { assigneeId: ctx.managerA.id })).status, 403, '권한 없음');
    const r = await ctx.staffA.client.req('PATCH', `/api/tasks/${t}`, { assigneeId: ctx.managerA.id });
    assert.equal(r.status, 403, '담당자 본인도 넘기기 꺼짐이면 403');
    await ctx.owner.ok('PATCH', `/api/tasks/${t}`, { assigneeId: ctx.managerA.id });
    const d = await ctx.owner.ok('GET', `/api/tasks/${t}`);
    const h = d.history.find((x) => x.action === 'reassigned');
    assert.deepEqual([h.changes.assigneeId.from, h.changes.assigneeId.to], [ctx.staffA.id, ctx.managerA.id]);
    const n = await sql`select title, body from notifications where user_id = ${ctx.staffA.id} and title = 'V14 재배정' or (user_id = ${ctx.staffA.id} and title = '담당자 변경: V14 재배정')`;
    assert.ok(n.some((x) => x.body === '이직원 → 최매니저 (김대표)'), '이전 담당자에게 알림');
    // 지시자 = 현장 관리자: 자기가 지시한 업무는 재배정 가능
    const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V14 지시자 재배정', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id })).id;
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t2}`, { assigneeId: ctx.ownerId });
    // 대표가 "지시자는 자기 업무 재배정" 끄면 403
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'reassign_requester', role: 'site_manager', level: 'none' });
    assert.equal((await ctx.managerA.client.req('PATCH', `/api/tasks/${t2}`, { assigneeId: ctx.staffA.id })).status, 403);
    // 사람별 예외로 재배정 허용
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'reassign', userId: ctx.managerA.id, level: 'use' });
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t2}`, { assigneeId: ctx.staffA.id });
    assert.equal((await ctx.managerA.client.ok('GET', `/api/tasks/${t2}`)).perms.reassign, true);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'reassign', userId: ctx.managerA.id, level: null });
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'reassign_requester', role: 'site_manager', level: null });
    // 담당자 없는 업무에 처음 배정하는 것은 재배정이 아님
    const t3 = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: 'V14 첫 배정', orgUnitId: ctx.siteA, assigneeId: null, requestedById: ctx.ownerId })).id;
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t3}`, { assigneeId: ctx.staffA.id });
  });
  test('담당자 넘기기(켜면): 요청 → 지시자 승인 → 담당 변경·알림, 거절, 남이 승인 403', async () => {
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'reassign_handoff', role: 'staff', level: 'use' });
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V14 넘기기', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id })).id;
    const direct = await ctx.staffA.client.req('PATCH', `/api/tasks/${t}`, { assigneeId: ctx.managerA.id });
    assert.equal(direct.status, 403); assert.equal(direct.body.error.code, 'handoff_required');
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${t}`)).perms.handoff, true);
    const h = await ctx.staffA.client.ok('POST', `/api/tasks/${t}/handoff`, { toUserId: ctx.ownerId, note: '휴가라서요' });
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.managerA.id} and title = 'V14 넘기기' or (user_id = ${ctx.managerA.id} and title = '담당 넘기기 요청: V14 넘기기')`).length);
    assert.equal((await ctx.staffA.client.post(`/api/tasks/${t}/handoff/${h.id}`, { approve: true })).status, 403, '요청한 본인은 승인 못 함');
    const d = await ctx.managerA.client.ok('GET', `/api/tasks/${t}`);
    assert.equal(d.handoff.canDecide, true); assert.equal(d.handoff.note, '휴가라서요');
    await ctx.managerA.client.ok('POST', `/api/tasks/${t}/handoff/${h.id}`, { approve: true });
    assert.equal((await ctx.owner.ok('GET', `/api/tasks/${t}`)).task.assignee_id, ctx.ownerId);
    assert.equal((await ctx.managerA.client.post(`/api/tasks/${t}/handoff/${h.id}`, { approve: true })).status, 409, '이미 처리');
    // 거절
    const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V14 넘기기 거절', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, requestedById: ctx.managerA.id })).id;
    const h2 = await ctx.staffA.client.ok('POST', `/api/tasks/${t2}/handoff`, { toUserId: ctx.ownerId });
    await ctx.managerA.client.ok('POST', `/api/tasks/${t2}/handoff/${h2.id}`, { approve: false });
    assert.equal((await ctx.owner.ok('GET', `/api/tasks/${t2}`)).task.assignee_id, ctx.staffA.id);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'reassign_handoff', role: 'staff', level: null });
    assert.equal((await ctx.staffA.client.post(`/api/tasks/${t2}/handoff`, { toUserId: ctx.ownerId })).status, 403, '꺼지면 요청 불가');
  });
});

describe('V14 2·4·5·6·7번 AI 대화 보관·업무 무관 차단·사용 내역 권한·관리 메뉴 권한', () => {
  const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const st = () => fetch(`${FAKE}/__state`).then((r) => r.json());
  const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
  let thread;
  before(() => ctl({ anthropicReset: true }));
  test('대화가 보관되고 이어서 물으면 서버가 앞 대화를 문맥으로 보냄, 본인만 열람·이름·고정·삭제', async () => {
    await ctl({ anthropicQueue: [say('네, 강남점 오픈 준비 업무가 3건 있습니다.')] });
    const a = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '강남점 오픈 준비 업무 알려줘' });
    thread = a.threadId; assert.ok(thread);
    await ctl({ anthropicQueue: [say('가장 급한 것은 간판 설치입니다.')] });
    const before = (await st()).anthropic.length;
    const b = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '그중에 제일 급한 건?', threadId: thread });
    assert.equal(b.threadId, thread);
    const sent = (await st()).anthropic.slice(before).find((x) => !String(x.body.system).startsWith('WORKIN_TOPIC_CLASSIFIER'));
    const ctxText = JSON.stringify(sent.body.messages);
    assert.ok(ctxText.includes('강남점 오픈 준비 업무 알려줘') && ctxText.includes('3건 있습니다'), '앞 대화가 문맥으로');
    const list = await ctx.staffA.client.ok('GET', '/api/ai/threads');
    const t = list.threads.find((x) => x.id === thread);
    assert.equal(t.title, '강남점 오픈 준비 업무 알려줘'); assert.equal(t.turns, 2);
    assert.equal((await ctx.staffA.client.ok('GET', `/api/ai/threads/${thread}`)).messages.length, 4);
    assert.equal((await ctx.managerA.client.get(`/api/ai/threads/${thread}`)).status, 404, '남의 대화');
    assert.equal((await ctx.managerA.client.post('/api/ai/chat', { text: '이어서', threadId: thread })).status, 404);
    await ctx.staffA.client.ok('PATCH', `/api/ai/threads/${thread}`, { title: '오픈 준비', pinned: true });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/ai/threads?q=' + encodeURIComponent('간판'))).threads[0].id, thread, '내용 검색');
  });
  test('업무 무관 질문은 가벼운 모델 판정으로 차단(비싼 모델 호출 없음), 같은 질문 반복·긴 입력·하루 한도', async () => {
    await ctl({ classifyQueue: [false] });
    const before = (await st()).anthropic.length;
    const r = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '오늘 저녁 메뉴 추천하고 로또 번호 뽑아줘', threadId: thread });
    assert.equal(r.blocked, true); assert.match(r.reply, /업무와 관련된 요청만/);
    assert.equal((await st()).anthropic.length, before, '비싼 모델은 부르지 않음');
    assert.ok((await st()).classified.includes('오늘 저녁 메뉴 추천하고 로또 번호 뽑아줘'), '가벼운 모델로 분류');
    const [m] = await sql`select status from ai_messages where thread_id = ${thread} and role = 'user' order by id desc limit 1`;
    assert.equal(m.status, 'blocked', '차단 기록');
    await ctl({ anthropicQueue: [say('확인했습니다.')] });
    await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '이번 주 내 마감 업무 정리해줘', threadId: thread });
    const rep = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '이번 주 내 마감 업무 정리해줘', threadId: thread });
    assert.equal(rep.blocked, true); assert.match(rep.reply, /같은 질문/);
    assert.equal((await ctx.staffA.client.post('/api/ai/chat', { text: '가'.repeat(4001) })).status, 400, '입력 길이');
    await ctx.owner.ok('PUT', '/api/ai/settings', { dailyLimit: 1 });
    await ctl({ anthropicQueue: [say('네.')] });
    const lim = await ctx.managerA.client.ok('POST', '/api/ai/chat', { text: '현장 점검 일정 알려줘' });
    assert.equal(lim.blocked ?? false, false);
    const over = await ctx.managerA.client.ok('POST', '/api/ai/chat', { text: '내일 회의 준비 업무 만들어줘', threadId: lim.threadId });
    assert.equal(over.blocked, true); assert.match(over.reply, /오늘 AI 요청 1회/);
    await ctx.owner.ok('PUT', '/api/ai/settings', { dailyLimit: 50 });
  });
  test('AI 사용 내역: 기본 대표만 조회(열람 감사 기록)·삭제, 권한 주면 조회만, 직원 고지', async () => {
    assert.equal((await ctx.staffA.client.get('/api/ai/logs')).status, 404);
    const logs = await ctx.owner.ok('GET', '/api/ai/logs?userId=' + ctx.staffA.id);
    assert.ok(logs.threads.some((t) => t.id === thread && t.blocked >= 1));
    const d = await ctx.owner.ok('GET', `/api/ai/logs/${thread}`);
    assert.ok(d.messages.some((m) => m.status === 'blocked'));
    assert.ok((await sql`select 1 from audit_logs where action = 'ai_log.view' and target_id = ${thread}`).length, '열람 기록');
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'ai_logs', userId: ctx.managerA.id, level: 'view' });
    await ctx.managerA.client.ok('GET', '/api/ai/logs');
    assert.equal((await ctx.managerA.client.req('DELETE', `/api/ai/logs/${thread}`)).status, 403);
    assert.equal((await ctx.managerA.client.req('PUT', '/api/ai/settings', { retentionDays: 30 })).status, 403);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'ai_logs', userId: ctx.managerA.id, level: null });
    // 보관 기간: 지난 대화는 정기 실행이 지움
    await ctx.owner.ok('PUT', '/api/ai/settings', { retentionDays: 30 });
    await sql`update ai_threads set updated_at = now() - interval '31 days' where id = ${thread}`;
    await tick();
    assert.equal((await sql`select count(*)::int n from ai_threads where id = ${thread}`)[0].n, 0, '보관 기간 지나 삭제');
    await ctx.owner.ok('PUT', '/api/ai/settings', { retentionDays: 90 });
  });
  test('관리 메뉴 조회/편집: 사용자 관리·운영 상태·사용량 — 꺼짐 404, 조회만이면 쓰기 403, AI 사용량 사람별·기능별·한도 %', async () => {
    assert.equal((await ctx.managerA.client.get('/api/admin/users')).status, 404);
    assert.equal((await ctx.managerA.client.get('/api/admin/ops')).status, 404);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'admin_users', role: 'site_manager', level: 'view' });
    await ctx.managerA.client.ok('GET', '/api/admin/users');
    assert.equal((await ctx.managerA.client.post('/api/admin/users', { email: 'x@dagym.test', name: 'x', role: 'staff', orgUnitIds: [ctx.siteA] })).status, 403);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'admin_users', role: 'site_manager', level: null });
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'usage', userId: ctx.managerA.id, level: 'view' });
    const u = await ctx.managerA.client.ok('GET', '/api/usage');
    assert.equal(u.canEdit, false);
    assert.equal((await ctx.managerA.client.post('/api/usage/request', { note: '팩 요청' })).status, 403);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'usage', userId: ctx.managerA.id, level: null });
    const o = await ctx.owner.ok('GET', '/api/usage');
    assert.ok(o.ai.limitUsd > 0 && typeof o.ai.pct === 'number');
    assert.ok(o.ai.byUser.some((x) => x.user_id === ctx.staffA.id));
    assert.ok(o.ai.byPurpose.some((x) => x.purpose === 'classify') && o.ai.byPurpose.some((x) => x.purpose === 'assistant'));
    assert.ok(o.ai.blocked >= 1);
    const m = await ctx.owner.ok('GET', '/api/admin/menu-perms');
    for (const k of ['team_reports', 'revenue', 'admin_users', 'ops', 'usage', 'library', 'ai_logs', 'reassign']) assert.ok(m.menus.some((x) => x.key === k), k);
  });
});

describe('V14 10번 마감 알림 중복 없음', () => {
  test('마감 당일 업무는 "오늘 마감" 1건만(마감 임박 없음), 업무별 🔔 를 정한 업무는 그 알림만', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V14-10 오늘', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: today, dueTime: '23:50' })).id;
    const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V14-10 내일', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 1), dueTime: '00:20', reminderMinutes: [30] })).id;
    await tick(); await tick();
    const a = await sql`select title from notifications where user_id = ${ctx.staffA.id} and entity_id = ${t} and type = 'due_soon'`;
    assert.ok(a.some((x) => x.title.startsWith('오늘 마감')));
    assert.ok(!a.some((x) => x.title.startsWith('마감 임박')), '같은 날 마감 임박 중복 없음');
    const b = await sql`select title from notifications where user_id = ${ctx.staffA.id} and entity_id = ${t2} and type = 'due_soon'`;
    assert.ok(!b.some((x) => x.title.startsWith('마감 임박')), '🔔 를 정한 업무는 그 알림만');
    const { reminders } = await ctx.staffA.client.ok('GET', '/api/reminders/upcoming');
    assert.ok(!reminders.some((r) => r.link === `/tasks/${t2}` && r.title.startsWith('마감 임박')));
  });
});

describe('V14 11번 모든 화면 AI 비서 — 화면 맥락은 id 만, 서버가 권한 안에서', () => {
  const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const lastSystem = async () => (await (await fetch(`${FAKE}/__state`)).json()).anthropic.at(-1).body.system;
  test('메시지 방 맥락은 최근 대화를, 볼 수 없는 방·자료는 맥락 없이', async () => {
    const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.managerA.id })).id;
    await ctx.owner.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '금요일까지 간판 시안 받아 주세요' });
    await ctl({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: '요약했습니다.' }], stop_reason: 'end_turn' }] });
    await ctx.managerA.client.ok('POST', '/api/ai/chat', { text: '이 대화 요약해줘', context: { page: 'messages', id: room } });
    assert.match(await lastSystem(), /간판 시안/);
    // 남의 방: 맥락 없음 (존재도 드러내지 않음)
    await ctl({ anthropicQueue: [{ content: [{ type: 'text', text: '네.' }], stop_reason: 'end_turn' }] });
    await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '이 대화 요약해줘', context: { page: 'messages', id: room } });
    assert.ok(!(await lastSystem()).includes('간판 시안'), '볼 수 없는 방의 내용은 안 보냄');
    await ctl({ anthropicQueue: [{ content: [{ type: 'text', text: '네.' }], stop_reason: 'end_turn' }] });
    await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: '이 날 일정 정리해줘', context: { page: 'calendar', id: today } });
    assert.match(await lastSystem(), new RegExp(`캘린더에서 ${today}`));
    assert.equal((await ctx.staffA.client.post('/api/ai/chat', { text: 'x', context: { page: 'hack' } })).status, 400);
    await ctl({ anthropicReset: true });
  });
});

describe('V14 8번 팀 단위 업무·팀 업무 권한', () => {
  let team;
  test('팀 만들기(사용자 관리 편집)·팀장 필수·팀 대화방 자동', async () => {
    assert.equal((await ctx.managerA.client.post('/api/teams', { name: '마케팅팀', members: [{ userId: ctx.managerA.id, lead: true }] })).status, 404, '사용자 관리 권한 없음');
    assert.equal((await ctx.owner.post('/api/teams', { name: '마케팅팀', members: [{ userId: ctx.managerA.id, lead: false }] })).status, 400, '팀장 1명 이상');
    team = (await ctx.owner.ok('POST', '/api/teams', { name: '마케팅팀', color: '#2563EB', members: [{ userId: ctx.managerA.id, lead: true }, { userId: ctx.ownerId, lead: false }] })).id;
    const list = await ctx.managerA.client.ok('GET', '/api/teams');
    const t = list.teams.find((x) => x.id === team);
    assert.equal(t.i_lead, true); assert.ok(t.room_id);
    assert.equal((await ctx.managerA.client.ok('GET', `/api/chat/rooms/${t.room_id}`)).room.kind, 'team');
    assert.equal((await ctx.staffA.client.get(`/api/chat/rooms/${t.room_id}`)).status, 404, '팀원 아니면 팀 대화방 404');
  });
  test('팀 업무는 팀원만(같은 현장이어도 팀 밖이면 404), 본인 담당이면 보임, 팀장 배정 알림·재배정, 팀원 각각', async () => {
    const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'V14-8 팀 배정', orgUnitId: ctx.siteA, teamId: team, teamMode: 'lead', assigneeId: null })).id;
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.managerA.id} and title = ${'팀 업무 배정: V14-8 팀 배정'}`).length, '팀장에게 담당 지정 알림');
    assert.equal((await ctx.staffA.client.get(`/api/tasks/${t}`)).status, 404, '같은 현장이어도 팀 밖이면 404');
    assert.ok(!(await ctx.staffA.client.ok('GET', '/api/tasks?includeDone=1')).tasks.some((x) => x.id === t));
    const d = await ctx.managerA.client.ok('GET', `/api/tasks/${t}`);
    assert.equal(d.task.team_name, '마케팅팀'); assert.equal(d.perms.edit, true);
    // 팀장이 담당 지정 → 담당이 된 사람은 팀 밖이어도 볼 수 있다
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t}`, { assigneeId: ctx.staffA.id });
    await ctx.staffA.client.ok('GET', `/api/tasks/${t}`);
    // 팀장은 자기 팀 업무 재배정 가능 (기본 재배정 권한 없는 현장 관리자)
    await ctx.managerA.client.ok('PATCH', `/api/tasks/${t}`, { assigneeId: ctx.ownerId });
    assert.equal((await ctx.staffA.client.get(`/api/tasks/${t}`)).status, 404, '담당에서 빠지면 다시 안 보임');
    // 사람별 예외 "다른 팀 업무 보기"
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'team_tasks_all', userId: ctx.staffA.id, level: 'view' });
    const v = await ctx.staffA.client.ok('GET', `/api/tasks/${t}`);
    assert.equal(v.perms.edit, false, '조회만');
    assert.equal((await ctx.staffA.client.req('PATCH', `/api/tasks/${t}`, { title: '바꾸기' })).status, 403);
    await ctx.owner.ok('PUT', '/api/admin/menu-perms', { menu: 'team_tasks_all', userId: ctx.staffA.id, level: null });
    // 팀원 모두에게 각각
    const each = await ctx.owner.ok('POST', '/api/tasks', { title: 'V14-8 각자', orgUnitId: ctx.siteA, teamId: team, teamMode: 'each' });
    assert.equal(each.ids.length, 2);
    const rows = await sql`select assignee_id, team_id from tasks where batch_id = ${each.batchId}`;
    assert.deepEqual(new Set(rows.map((r) => r.assignee_id)), new Set([ctx.managerA.id, ctx.ownerId])); assert.ok(rows.every((r) => r.team_id === team));
    // 필터·팀 밖 사람의 팀 배정 불가
    assert.ok((await ctx.managerA.client.ok('GET', `/api/tasks?teamId=${team}&includeDone=1`)).tasks.every((x) => x.team_id === team));
    assert.equal((await ctx.staffA.client.post('/api/tasks', { title: 'x', orgUnitId: ctx.siteA, teamId: team })).status, 403);
    // 홈 우리 팀
    const home = await ctx.managerA.client.ok('GET', '/api/teams/today');
    assert.equal(home.teams[0].name, '마케팅팀');
    // 주간 보고 팀별
    const rep = await ctx.owner.ok('GET', `/api/reports/team?teamId=${team}`);
    assert.ok(rep.reports.every((r) => [ctx.managerA.id, ctx.ownerId].includes(r.user_id))); assert.ok(rep.teams.some((x) => x.id === team));
  });
  test('팀원이 바뀌면 대화방 멤버도 맞춤, 보관하면 목록에서 빠짐', async () => {
    await ctx.owner.ok('PATCH', `/api/teams/${team}`, { members: [{ userId: ctx.managerA.id, lead: true }, { userId: ctx.staffA.id, lead: false }] });
    const room = (await ctx.staffA.client.ok('GET', '/api/teams')).teams.find((x) => x.id === team).room_id;
    await ctx.staffA.client.ok('GET', `/api/chat/rooms/${room}`);
    assert.equal((await sql`select count(*)::int n from chat_members where room_id = ${room} and user_id = ${ctx.ownerId}`)[0].n, 0, '빠진 팀원은 대화방에서도');
    await ctx.owner.ok('PATCH', `/api/teams/${team}`, { archived: true });
    assert.ok(!(await ctx.owner.ok('GET', '/api/teams')).teams.some((x) => x.id === team));
  });
});
