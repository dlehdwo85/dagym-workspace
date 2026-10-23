// 대표 10/21 22:00 ⑦(#420) 알람 'N분 전' 설정 + ⑧(#421) 영업 2차 추적(리드 업무 완료 → 다음 연락일 → 다음 조치 업무)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  // 리드 쓰기는 영업관리 전환 뒤(sales_cutover.writes_open)만 — 시험은 바로 연다
  await sql`insert into sales_cutover (tenant, frozen_at, src_counts, ok, writes_open, updated_by) values ('default', now(), '{}'::jsonb, true, true, ${ctx.ownerId}) on conflict (tenant) do update set writes_open = true, ok = true`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('#420 알람 N분 전', () => {
  test('설정 저장(1~1440) · 로컬 예약 알림은 N분 전 시점만 alarm, 날짜만 있는 업무는 18시 기준', async () => {
    const p = await ctx.staffA.client.ok('GET', '/api/notifications/prefs');
    assert.equal(p.settings.alarmMinutes, 10, '기본 10분');
    assert.equal((await ctx.staffA.client.req('PUT', '/api/notifications/prefs', { settings: { ...p.settings, alarmMinutes: 0 } })).status, 400);
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, alarmMinutes: 15, alarmTasks: true } });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/notifications/prefs')).settings.alarmMinutes, 15);
    const d2 = addDays(today, 2);
    const timed = (await ctx.owner.ok('POST', '/api/tasks', { title: '15분 전 알람', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: d2, dueTime: '14:00' })).id;
    const dateOnly = (await ctx.owner.ok('POST', '/api/tasks', { title: '날짜만 알람', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: d2 })).id;
    const { reminders } = await ctx.staffA.client.ok('GET', '/api/reminders/upcoming?days=5');
    const of = (id) => reminders.filter((r) => r.entityId === id);
    const a15 = of(timed).find((r) => r.key.endsWith(':15'));
    assert.ok(a15 && a15.alarm === true && a15.fireAt.endsWith('T04:45:00.000Z'), '14:00 마감 → 13:45(KST) 알람'); // 13:45 KST = 04:45Z
    assert.ok(of(timed).filter((r) => r.key.endsWith(':60')).every((r) => !r.alarm), '1시간 전은 보통 알림');
    const d15 = of(dateOnly).find((r) => r.key.endsWith('::15'));
    assert.ok(d15 && d15.alarm === true && d15.fireAt.endsWith('T08:45:00.000Z'), '날짜만 → 18:00 기준 17:45(KST) 알람');
    // 배정 알림 같은 낮은 중요도는 알람 아님: 예약 목록에 kind 가 task/event 가 아닌 항목(브리핑)·알람 없는 항목만
    assert.ok(reminders.filter((r) => r.alarm).every((r) => r.kind === 'task' || r.kind === 'event'));
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, alarmMinutes: 10, alarmTasks: false } });
  });
});

describe('#421 영업 2차 추적', () => {
  test('진행 중 리드 → 자동 업무 완료 → 다음 연락일 +7일(없거나 지났을 때) · 다음 조치 업무 새로 생성 · 감사 기록', async () => {
    const lead = await ctx.owner.ok('POST', '/api/sales/leads', { name: '강남 피트니스 센터', status: '1차연락완료', nextContactDate: today, ownerId: ctx.staffA.id });
    const [t1] = await sql`select id, title, status, due_date::text d from tasks where lead_id = ${lead.id} and deleted_at is null and status <> 'done' order by created_at desc limit 1`;
    assert.ok(t1, '리드 만들면 → 다음 조치 업무'); assert.equal(t1.d, today);
    const v = (await ctx.staffA.client.ok('GET', `/api/tasks/${t1.id}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t1.id}`, { status: 'done', version: v });
    const [l] = await sql`select next_contact_date::text n from sales_leads where id = ${lead.id}`;
    assert.equal(l.n, addDays(today, 7), '다음 연락 = 오늘 + 7일');
    const [t2] = await sql`select id, title, due_date::text d, assignee_id from tasks where lead_id = ${lead.id} and deleted_at is null and status <> 'done' order by created_at desc limit 1`;
    assert.ok(t2 && t2.id !== t1.id, '다음 조치 업무가 새로 생김'); assert.equal(t2.d, addDays(today, 7)); assert.match(t2.title, /다음 연락/); assert.equal(t2.assignee_id, ctx.staffA.id);
    assert.ok((await sql`select 1 from audit_logs where action = 'sales.followup'`).length, '감사 기록');
    // 다음 연락일이 아직 앞이면 날짜는 그대로, 업무만 다시
    const far = addDays(today, 20);
    await ctx.owner.ok('PATCH', `/api/sales/leads/${lead.id}`, { nextContactDate: far });
    const [t3] = await sql`select id from tasks where lead_id = ${lead.id} and deleted_at is null and status <> 'done' order by created_at desc limit 1`;
    const v3 = (await ctx.staffA.client.ok('GET', `/api/tasks/${t3.id}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${t3.id}`, { status: 'done', version: v3 });
    assert.equal((await sql`select next_contact_date::text n from sales_leads where id = ${lead.id}`)[0].n, far);
    const [t4] = await sql`select id, due_date::text d from tasks where lead_id = ${lead.id} and deleted_at is null and status <> 'done' order by created_at desc limit 1`;
    assert.ok(t4 && t4.id !== t3.id && t4.d === far);
    // 보류 리드는 이어지지 않음
    await ctx.owner.ok('PATCH', `/api/sales/leads/${lead.id}`, { status: '보류', reason: '예산 검토' });
    const open = await sql`select id from tasks where lead_id = ${lead.id} and deleted_at is null and status not in ('done', 'on_hold')`;
    assert.equal(open.length, 0, '보류 → 열린 업무 없음');
  });
  test('#508 후속(로컬 10/23 운영): 완료 되돌리기 → 그 완료로 생긴 후속 업무가 손대지 않았으면 같이 휴지통(리드 다음 연락일도 원래대로) · 손댔으면 그대로+알림 · 다시 완료해도 열린 후속 1개 · 반복 다음 회차도 같은 규칙', async () => {
    const lead = await ctx.owner.ok('POST', '/api/sales/leads', { name: '역삼 커뮤니티 되돌리기', status: '1차연락완료', nextContactDate: today, ownerId: ctx.staffA.id });
    const openOf = async () => (await sql`select id from tasks where lead_id = ${lead.id} and deleted_at is null and status <> 'done' order by created_at`).map((r) => r.id);
    const set = async (id, status) => ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status, version: (await ctx.staffA.client.ok('GET', `/api/tasks/${id}`)).task.version });
    const nextOf = async () => (await sql`select next_contact_date::text n from sales_leads where id = ${lead.id}`)[0].n;
    const [t1] = await openOf(); assert.ok(t1);
    await set(t1, 'done');
    const [t2] = await openOf(); assert.ok(t2 && t2 !== t1, '완료 → 다음 연락 업무'); assert.equal(await nextOf(), addDays(today, 7));
    // 손대지 않은 후속 업무 → 되돌리기와 함께 휴지통 · 리드 다음 연락일 원래대로 · 기록
    const back = await set(t1, 'todo');
    assert.deepEqual([back.autoRemoved?.map((x) => x.id), back.autoKept], [[t2], []]);
    assert.deepEqual(await openOf(), [t1], '열린 업무는 되돌린 업무 하나(같은 리드 업무 두 개 아님)');
    assert.ok((await sql`select deleted_at from tasks where id = ${t2}`)[0].deleted_at, '휴지통(30일 되살리기)');
    assert.equal(await nextOf(), today, '리드 다음 연락일도 완료 전으로');
    assert.equal((await sql`select count(*)::int n from activities where (entity_id = ${t1} and action = 'auto_removed') or (entity_id = ${t2} and action = 'deleted' and changes->>'auto' = '완료 되돌리기')`)[0].n, 2, '두 업무에 기록');
    // 다시 완료 → 후속 업무 하나(새로)
    await set(t1, 'done');
    const again = await openOf(); assert.equal(again.length, 1); const t3 = again[0]; assert.ok(t3 !== t2);
    // 손댄 후속 업무(댓글) → 되돌려도 그대로 + 화면에 알릴 목록 · 다시 완료해도 새로 만들지 않음
    await ctx.staffA.client.ok('POST', `/api/tasks/${t3}/comments`, { body: '고객과 통화 예정' });
    const back2 = await set(t1, 'todo');
    assert.deepEqual([back2.autoRemoved ?? [], back2.autoKept?.map((x) => x.id)], [[], [t3]]);
    assert.deepEqual((await openOf()).sort(), [t1, t3].sort(), '손댄 후속 업무는 그대로');
    assert.equal(await nextOf(), addDays(today, 7), '손댄 후속이 있으면 다음 연락일도 그대로');
    await set(t1, 'done');
    assert.deepEqual(await openOf(), [t3], '다시 완료해도 열린 후속 업무가 있으면 새로 만들지 않음');
    // 반복 업무: 완료 → 다음 회차 → 되돌리기 → 다음 회차 휴지통 + 반복을 다시 이어받음 → 다시 완료하면 다음 회차 다시(하나)
    const rid = (await ctx.owner.ok('POST', '/api/tasks', { title: '되돌리기 반복 점검', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, 1), recurrenceRule: 'FREQ=WEEKLY', approvalRequired: false })).id;
    const d1 = await set(rid, 'done'); assert.ok(d1.spawned);
    const rb = await set(rid, 'in_progress');
    assert.deepEqual(rb.autoRemoved?.map((x) => x.id), [d1.spawned]);
    assert.deepEqual([(await sql`select recurrence_stopped from tasks where id = ${rid}`)[0].recurrence_stopped, !!(await sql`select deleted_at from tasks where id = ${d1.spawned}`)[0].deleted_at], [false, true]);
    const d2 = await set(rid, 'done'); assert.ok(d2.spawned && d2.spawned !== d1.spawned, '다시 완료 → 다음 회차 다시');
    assert.equal((await sql`select count(*)::int n from tasks where recurrence_source_id = ${rid} and deleted_at is null`)[0].n, 1, '열린 다음 회차는 하나');
    // 자동 업무가 없는 완료를 되돌리면 정리 없음(응답에 칸 없음)
    const plain = (await ctx.owner.ok('POST', '/api/tasks', { title: '되돌리기 보통 업무', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
    await set(plain, 'done'); const pb = await set(plain, 'todo');
    assert.deepEqual([pb.autoRemoved, pb.autoKept], [undefined, undefined]);
  });
});
