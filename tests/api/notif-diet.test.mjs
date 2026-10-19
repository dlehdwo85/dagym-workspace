// 로컬 10/20 알림 다이어트 + 알림에서 바로 처리:
// 기본값(종류별 푸시: 내가 보낸 결과·자동 정리 결과는 끔, 요청·일정·지시 완료는 켬 / 조용한 시간 기본 22~07·끄기) · push:false 는 설정과 무관하게 목록만 · 마감 예고 개별 푸시는 높음·긴급만 ·
// 댓글 묶음 "새 댓글 n개" · 액션 API(배정 확인·오늘 할 일·검토 승인/수정 요청·연장 승인·답글, 처리되면 "…함 ✓"·재푸시 없음, 남의 알림 404, 권한 없는 처리 403) · GET 알림에 actions
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  for (const [k, u] of Object.entries({ owner: { client: ctx.owner }, staffA: ctx.staffA, managerA: ctx.managerA })) await u.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: `fcm-token-${k}`, platform: 'android' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const deliveries = (userId, type) => sql`select d.next_attempt_at, d.status from notification_deliveries d join notifications n on n.id = d.notification_id where n.user_id = ${userId} and n.type = ${type}`;

describe('알림 다이어트', () => {
  test('종류별 푸시 기본값: 보낸 결과·자료실 정리·반복 생성은 끔, 배정·검토·멘션·일정·지시 완료는 켬 · 조용한 시간 기본 22~07(시험 서버는 QUIET_DEFAULT=off 라 null)·끄기 저장', async () => {
    const p = await ctx.staffA.client.ok('GET', '/api/notifications/prefs');
    const push = Object.fromEntries(p.types.map((t) => [t.type, t.push]));
    assert.deepEqual([push.mail_sent, push.library_organized, push.recurring_created, push.month_close], [false, false, false, false]);
    assert.deepEqual([push.task_assigned, push.review_requested, push.mention, push.event_reminder, push.task_done_for_requester, push.comment, push.chat, push.mail_status], [true, true, true, true, true, true, true, true]);
    assert.equal(p.types.find((t) => t.type === 'mail_sent').pushDefault, false);
    assert.deepEqual([p.settings.quietOff, p.settings.quietDefault], [false, null], '시험 서버는 기본 조용한 시간 끔(운영은 22:00~07:00)');
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, quietOff: true } });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/notifications/prefs')).settings.quietOff, true);
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, quietOff: false } });
  });
  test('조용한 시간: 지금이 그 안이면 푸시가 끝나는 시각으로 미뤄짐 · 끄면 바로', async () => {
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
    const hh = (x) => `${String((x + 24) % 24).padStart(2, '0')}:00`;
    const p = await ctx.staffA.client.ok('GET', '/api/notifications/prefs');
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, quietStart: hh(h - 1), quietEnd: hh(h + 2), quietOff: false } });
    const t1 = (await ctx.owner.ok('POST', '/api/tasks', { title: '조용한 시간 배정', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const [d1] = await sql`select d.next_attempt_at from notification_deliveries d join notifications n on n.id = d.notification_id where n.entity_id = ${t1} and n.user_id = ${ctx.staffA.id}`;
    assert.ok(new Date(d1.next_attempt_at).getTime() > Date.now() + 30 * 60_000, '끝나는 시각(1시간 이상 뒤)으로 미뤄짐');
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, quietStart: hh(h - 1), quietEnd: hh(h + 2), quietOff: true } });
    const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '조용한 시간 끔 배정', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const [d2] = await sql`select d.next_attempt_at from notification_deliveries d join notifications n on n.id = d.notification_id where n.entity_id = ${t2} and n.user_id = ${ctx.staffA.id}`;
    assert.ok(new Date(d2.next_attempt_at).getTime() <= Date.now() + 60_000, '끄면 바로');
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, quietStart: null, quietEnd: null, quietOff: true } });
  });
  test('마감 예고: 보통 업무는 목록만(푸시 없음), 높음 업무는 푸시 · 오늘 마감·기한 지남은 목록만 · 아침 브리핑에 마감 업무 이름', async () => {
    const soon = new Date(Date.now() + 50 * 60_000); // 50분 뒤 마감 → 기본 60분 전 알림 대상
    const kst = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(soon);
    const g = (t) => kst.find((x) => x.type === t).value;
    const dueDate = `${g('year')}-${g('month')}-${g('day')}`, dueTime = `${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
    const normal = (await ctx.owner.ok('POST', '/api/tasks', { title: '보통 마감 예고', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate, dueTime })).id;
    const high = (await ctx.owner.ok('POST', '/api/tasks', { title: '높음 마감 예고', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate, dueTime, priority: 'high' })).id;
    await tick();
    const rows = await sql`select n.entity_id, n.title, (select count(*)::int from notification_deliveries d where d.notification_id = n.id) as pushes from notifications n where n.user_id = ${ctx.staffA.id} and n.type = 'due_soon' and n.entity_id = any(${[normal, high]}::uuid[])`;
    const rn = rows.find((r) => r.entity_id === normal), rh = rows.find((r) => r.entity_id === high);
    assert.ok(rn && rh, '둘 다 목록에는 있음'); assert.equal(rn.pushes, 0, '보통은 푸시 없음'); assert.ok(rh.pushes >= 1, '높음은 푸시');
    const td = (await ctx.owner.ok('POST', '/api/tasks', { title: '오늘 마감 목록만', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: today })).id;
    const late = (await ctx.owner.ok('POST', '/api/tasks', { title: '기한 지남 목록만', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: addDays(today, -1) })).id;
    await tick();
    for (const [id, label] of [[td, '오늘 마감'], [late, '기한 지남']]) {
      const [r] = await sql`select n.id, (select count(*)::int from notification_deliveries d where d.notification_id = n.id) as pushes from notifications n where n.user_id = ${ctx.staffA.id} and n.entity_id = ${id} and n.title like ${label + '%'}`;
      assert.ok(r, `${label} 알림 있음`); assert.equal(r.pushes, 0, `${label}은 푸시 없음(브리핑에 모아서)`);
    }
    const p = await ctx.staffA.client.ok('GET', '/api/notifications/prefs');
    await ctx.staffA.client.ok('PUT', '/api/notifications/prefs', { settings: { ...p.settings, briefingTime: '00:00', briefingWeekend: true, briefingEnabled: true } });
    await tick();
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false }).format(new Date())) % 24;
    if (hour < 22) {
      const [b] = await sql`select body from notifications where user_id = ${ctx.staffA.id} and type = 'briefing'`;
      assert.match(b.body, /마감: .*기한 지남 목록만\(지남\)/, '브리핑에 마감 업무 이름');
    }
  });
  test('댓글 묶음: 안 읽은 댓글 알림이 있으면 "새 댓글 n개"로 갱신(count) · 알림에 답글·확인 버튼', async () => {
    const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '댓글 묶음', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: '하나' });
    await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: '둘' });
    await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: '셋' });
    const ns = (await ctx.staffA.client.ok('GET', '/api/notifications')).items.filter((n) => n.type === 'comment' && n.entity_id === id);
    assert.equal(ns.length, 1); assert.equal(ns[0].count, 3); assert.match(ns[0].title, /^새 댓글 3개: 댓글 묶음/);
    assert.deepEqual(ns[0].actions.map((a) => a.id), ['reply', 'ack']);
  });
});

describe('알림에서 바로 처리', () => {
  test('배정 알림 [확인] → assignee_ack_at · [오늘 할 일에 넣기] → 시작일 오늘 · 처리되면 "…함" 표시·버튼 없음·읽음 · 남의 알림 404 · 권한 없으면 403 · 처리된 알림은 대기 푸시 건너뜀', async () => {
    const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '바로 처리 배정', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const n = (await ctx.staffA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'task_assigned' && x.entity_id === id);
    assert.deepEqual(n.actions.map((a) => [a.id, a.label]), [['ack', '확인'], ['today', '오늘 할 일에 넣기']]);
    assert.equal((await ctx.staffB.client.req('POST', `/api/notifications/${n.id}/action`, { action: 'ack' })).status, 404, '남의 알림');
    assert.equal((await ctx.staffA.client.req('POST', `/api/notifications/${n.id}/action`, { action: 'approve' })).status, 400, '이 알림에 없는 버튼');
    const r = await ctx.staffA.client.ok('POST', `/api/notifications/${n.id}/action`, { action: 'today' });
    assert.equal(r.label, '오늘 할 일에 넣음');
    assert.equal((await sql`select to_char(start_date, 'YYYY-MM-DD') s from tasks where id = ${id}`)[0].s, today);
    const after_ = (await ctx.staffA.client.ok('GET', '/api/notifications')).items.find((x) => x.id === n.id);
    assert.deepEqual([after_.action_done, after_.actions, !!after_.read_at], ['오늘 할 일에 넣음', [], true]);
    assert.equal((await ctx.staffA.client.ok('POST', `/api/notifications/${n.id}/action`, { action: 'ack' })).already, true, '이미 처리된 알림은 그대로');
    // 권한 없음: 배정 알림을 받은 뒤 담당이 바뀌면 [오늘 할 일] 은 403
    const id2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '담당 바뀐 배정', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const n2 = (await ctx.staffA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'task_assigned' && x.entity_id === id2);
    await ctx.owner.ok('PATCH', `/api/tasks/${id2}`, { assigneeId: ctx.managerA.id });
    assert.equal((await ctx.staffA.client.req('POST', `/api/notifications/${n2.id}/action`, { action: 'today' })).status, 403);
    // 처리된 알림의 대기 푸시는 보내지 않음
    const id3 = (await ctx.owner.ok('POST', '/api/tasks', { title: '푸시 전 처리', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const n3 = (await ctx.staffA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'task_assigned' && x.entity_id === id3);
    await sql`update notification_deliveries set status = 'pending', next_attempt_at = now() where notification_id = ${n3.id}`;
    await ctx.staffA.client.ok('POST', `/api/notifications/${n3.id}/action`, { action: 'ack' });
    await tick();
    assert.deepEqual([...new Set((await sql`select status from notification_deliveries where notification_id = ${n3.id}`).map((d) => d.status))], ['skipped']);
  });
  test('검토 요청 알림 [승인] → 완료 · [수정 요청](글 필수) → 진행 중+보완 요청 알림 · 결재 아닌 사람은 403', async () => {
    const id = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '검토 바로 승인', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: true })).id;
    const v = (await ctx.staffA.client.ok('GET', `/api/tasks/${id}`)).task.version;
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review', version: v });
    const n = (await ctx.managerA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'review_requested' && x.entity_id === id);
    assert.deepEqual(n.actions.map((a) => a.id), ['approve', 'changes']);
    assert.equal((await ctx.managerA.client.req('POST', `/api/notifications/${n.id}/action`, { action: 'changes' })).status, 400, '수정 요청 글 필수');
    await ctx.managerA.client.ok('POST', `/api/notifications/${n.id}/action`, { action: 'changes', text: '사진 추가' });
    assert.equal((await sql`select status from tasks where id = ${id}`)[0].status, 'in_progress');
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and type = 'review_result' and entity_id = ${id} and body like '%사진 추가%'`).length, '담당자에게 보완 요청');
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${id}`, { status: 'review' });
    const n2 = (await ctx.managerA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'review_requested' && x.entity_id === id && !x.action_done);
    const r = await ctx.managerA.client.ok('POST', `/api/notifications/${n2.id}/action`, { action: 'approve' });
    assert.equal(r.label, '승인함');
    assert.equal((await sql`select status from tasks where id = ${id}`)[0].status, 'done');
  });
  test('마감 연장 요청 알림 [승인] → 마감 바뀜·"연장 승인함" · 멘션 알림 [답글] → 같은 스레드 댓글', async () => {
    const id = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '연장 바로 승인', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: today })).id;
    await ctx.staffA.client.ok('POST', `/api/tasks/${id}/extend`, { toDate: addDays(today, 3), reason: '자재 지연' });
    const n = (await ctx.managerA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'review_requested' && x.entity_id === id && x.meta?.kind === 'extension');
    assert.deepEqual(n.actions.map((a) => a.label), ['승인', '거절']);
    const r = await ctx.managerA.client.ok('POST', `/api/notifications/${n.id}/action`, { action: 'approve_ext' });
    assert.equal(r.label, '연장 승인함');
    assert.equal((await sql`select to_char(due_date, 'YYYY-MM-DD') d from tasks where id = ${id}`)[0].d, addDays(today, 3));
    assert.deepEqual((await ctx.managerA.client.ok('GET', '/api/notifications')).items.find((x) => x.id === n.id).actions, [], '처리된 알림은 버튼 없음');
    const c = await ctx.managerA.client.ok('POST', `/api/tasks/${id}/comments`, { body: `@[이직원](${ctx.staffA.id}) 일정 확인` });
    const m = (await ctx.staffA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'mention' && x.entity_id === id);
    assert.deepEqual(m.actions.map((a) => a.id), ['reply', 'ack']);
    await ctx.staffA.client.ok('POST', `/api/notifications/${m.id}/action`, { action: 'reply', text: '네 확인했습니다' });
    const [reply] = await sql`select parent_id, body from comments where task_id = ${id} and author_id = ${ctx.staffA.id}`;
    assert.deepEqual([reply.parent_id, reply.body], [c.id, '네 확인했습니다'], '멘션 댓글에 답글');
  });
});
