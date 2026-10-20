// 로컬 10/20(대표) '알람처럼 울리기': 설정 기본값(일정 끔·업무 끔·중요 켬) 저장 · 로컬 예약 알림(/api/reminders/upcoming) 에 alarm·snoozeMinutes·actions(dismiss/snooze/open)·kind·entityId ·
// 정기 실행이 만드는 마감 알림 meta.alarm(중요 업무 기본 켬, 보통 업무는 끔, 업무별 alarm 우선) · 알림 액션 [해제]/[10분 뒤](활동 기록·재푸시) · 기기 결과 기록 API(남의 업무 404)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const kst = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d);
const g = (parts, t) => parts.find((x) => x.type === t).value;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.staffA.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-token-alarm-staffA', platform: 'android' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('알람처럼 울리기', () => {
  test('설정 기본값: 일정 끔·업무 끔·중요 켬 → 저장·되읽기', async () => {
    const p = await ctx.staffA.client.ok('GET', '/api/notifications/prefs');
    assert.deepEqual([p.settings.alarmEvents, p.settings.alarmTasks, p.settings.alarmImportant], [false, false, true]);
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, alarmEvents: true } });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/notifications/prefs')).settings.alarmEvents, true);
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, alarmEvents: false } });
  });
  test('로컬 예약 알림: 중요 업무·alarm 켠 일정은 alarm:true + 10분·dismiss/snooze/open, 보통 업무·기본 일정은 없음, 업무별 alarm:false 는 중요해도 끔', async () => {
    const d2 = addDays(today, 2);
    const high = (await ctx.owner.ok('POST', '/api/tasks', { title: '알람 중요 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: d2, dueTime: '15:00', priority: 'high' })).id;
    const normal = (await ctx.owner.ok('POST', '/api/tasks', { title: '알람 보통 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: d2, dueTime: '16:00' })).id;
    const off = (await ctx.owner.ok('POST', '/api/tasks', { title: '알람 끈 중요 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: d2, dueTime: '17:00', priority: 'urgent', alarm: false })).id;
    const cal = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
    const s = new Date(Date.now() + 2 * 864e5), e = new Date(s.getTime() + 3600e3);
    const evOn = (await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '알람 일정', start: s.toISOString(), end: e.toISOString(), alarm: true })).id;
    const evDef = (await ctx.staffA.client.ok('POST', '/api/events', { calendarId: cal, title: '기본 일정', start: s.toISOString(), end: e.toISOString() })).id;
    const { reminders } = await ctx.staffA.client.ok('GET', '/api/reminders/upcoming?days=5');
    const of = (id) => reminders.filter((r) => r.entityId === id);
    assert.ok(of(high).length && of(high).every((r) => r.alarm === true && r.snoozeMinutes === 10 && r.kind === 'task'), '중요 업무 = 알람 기본 켬');
    assert.deepEqual(of(high)[0].actions.map((a) => a.id), ['dismiss', 'snooze', 'open']);
    assert.ok(of(normal).length && of(normal).every((r) => !r.alarm), '보통 업무는 알람 아님');
    assert.ok(of(off).length && of(off).every((r) => !r.alarm), '업무별 끔이 우선');
    assert.ok(of(evOn).length && of(evOn).every((r) => r.alarm === true && r.kind === 'event'), '일정별 켬');
    assert.ok(of(evDef).length && of(evDef).every((r) => !r.alarm), '일정 기본은 끔');
    // 업무 상세에 alarm 칸 · PATCH 로 바꿈
    assert.equal((await ctx.staffA.client.ok('GET', `/api/tasks/${normal}`)).task.alarm, null);
    const v = (await ctx.staffA.client.ok('GET', `/api/tasks/${normal}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${normal}`, { alarm: true, version: v });
    assert.ok((await ctx.staffA.client.ok('GET', '/api/reminders/upcoming?days=5')).reminders.filter((r) => r.entityId === normal).every((r) => r.alarm === true), '업무별 켬');
    assert.equal((await ctx.staffA.client.ok('GET', `/api/events/${evOn}`)).event.alarm, true);
  });
  test('정기 실행 마감 알림: 중요 업무는 meta.alarm + 푸시, 알림 액션 [해제]/[10분 뒤] → 활동 기록·10분 뒤 재푸시, 웹 띠(unread=1 alarms)', async () => {
    const soon = new Date(Date.now() + 50 * 60_000), k = kst(soon);
    const dueDate = `${g(k, 'year')}-${g(k, 'month')}-${g(k, 'day')}`, dueTime = `${g(k, 'hour') === '24' ? '00' : g(k, 'hour')}:${g(k, 'minute')}`;
    const high = (await ctx.owner.ok('POST', '/api/tasks', { title: '알람 마감 예고', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate, dueTime, priority: 'high' })).id;
    const normal = (await ctx.owner.ok('POST', '/api/tasks', { title: '보통 마감 예고(알람 없음)', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate, dueTime })).id;
    await tick();
    const rows = await sql`select n.id, n.entity_id, n.meta, (select count(*)::int from notification_deliveries d where d.notification_id = n.id) pushes from notifications n where n.user_id = ${ctx.staffA.id} and n.type = 'due_soon' and n.entity_id = any(${[high, normal]}::uuid[])`;
    const rh = rows.find((r) => r.entity_id === high), rn = rows.find((r) => r.entity_id === normal);
    assert.ok(rh && rh.meta.alarm === true && rh.pushes >= 1, '중요 업무 마감 알림 = 알람 + 푸시');
    assert.ok(rn && !rn.meta.alarm, '보통 업무는 알람 아님');
    const list = await ctx.staffA.client.ok('GET', '/api/notifications?unread=1');
    const n = list.items.find((x) => x.id === rh.id);
    assert.deepEqual(n.actions.map((a) => a.id), ['dismiss', 'snooze']);
    assert.ok(list.alarms.some((a) => a.id === rh.id), '웹 띠용 alarms');
    // 10분 뒤 → 재푸시 예약 + 활동 기록, 그대로 알람 상태
    const sn = await ctx.staffA.client.ok('POST', `/api/notifications/${rh.id}/action`, { action: 'snooze' });
    assert.match(sn.label, /10분 뒤/);
    const [d] = await sql`select max(next_attempt_at) at from notification_deliveries where notification_id = ${rh.id}`;
    assert.ok(new Date(d.at).getTime() > Date.now() + 8 * 60_000, '10분 뒤 재푸시');
    assert.equal((await sql`select count(*)::int n from activities where entity_type = 'task' and entity_id = ${high} and action = 'alarm_snoozed'`)[0].n, 1);
    // 해제 → 처리됨·활동 기록·띠에서 사라짐
    const dm = await ctx.staffA.client.ok('POST', `/api/notifications/${rh.id}/action`, { action: 'dismiss' });
    assert.equal(dm.label, '알람 해제');
    assert.equal((await sql`select count(*)::int n from activities where entity_id = ${high} and action = 'alarm_dismissed'`)[0].n, 1);
    assert.ok(!(await ctx.staffA.client.ok('GET', '/api/notifications?unread=1')).alarms.some((a) => a.id === rh.id), '해제하면 띠에서 빠짐');
    const act = await ctx.staffA.client.ok('GET', '/api/notifications/activity');
    assert.ok(act.items.some((a) => a.kind === 'alarm_dismissed' && a.task_id === high), "'활동' 탭에 알람 해제");
  });
  test('기기 로컬 알람 결과 기록: POST /api/reminders/alarm (dismiss/snooze, 남의 업무 404, snooze 는 minutes 필수)', async () => {
    const mine = (await ctx.owner.ok('POST', '/api/tasks', { title: '기기 알람 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: addDays(today, 1), dueTime: '10:00' })).id;
    const other = (await ctx.owner.ok('POST', '/api/tasks', { title: '남의 업무', assigneeId: ctx.staffB.id, orgUnitId: ctx.siteB, approvalRequired: false, dueDate: addDays(today, 1) })).id;
    await ctx.staffA.client.ok('POST', '/api/reminders/alarm', { kind: 'task', id: mine, action: 'snooze', minutes: 10, key: `task:${mine}` });
    await ctx.staffA.client.ok('POST', '/api/reminders/alarm', { kind: 'task', id: mine, action: 'dismiss' });
    assert.equal((await ctx.staffA.client.req('POST', '/api/reminders/alarm', { kind: 'task', id: other, action: 'dismiss' })).status, 404);
    assert.equal((await ctx.staffA.client.req('POST', '/api/reminders/alarm', { kind: 'task', id: mine, action: 'snooze' })).status, 400);
    const acts = await sql`select action, changes from activities where entity_id = ${mine} and action like 'alarm_%' order by id`;
    assert.deepEqual(acts.map((a) => [a.action, a.changes.from, a.changes.minutes]), [['alarm_snoozed', 'device', 10], ['alarm_dismissed', 'device', null]]);
  });
});
