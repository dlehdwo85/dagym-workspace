// 대기열 소형 3건 (2026-10-22 클라우드): #76 부재중 설정(기간·자동 응답·대리인·알림 보류·복귀 요약) · #111 일정 화상 회의 링크 · #279 탈퇴 30일 뒤 실제 삭제
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, tick, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const P = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await ctx.staffA.client.ok('POST', '/api/push/subscribe', { kind: 'fcm', endpoint: 'fcm-token-staffA', platform: 'android' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('#76 부재중 설정', () => {
  test('설정 저장: 기간·문구·대리인 → active · 근무 상태에 "부재 ~M/D · 대리 ○○" · 담당자 규칙 부재로 집계', async () => {
    const r0 = await ctx.staffA.client.ok('GET', '/api/account/away');
    assert.deepEqual([r0.away, r0.active], [null, false]);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/account/away', { from: today, to: addDays(today, 2), deputyId: ctx.staffA.id })).status, 400, '대리인 본인 불가');
    assert.equal((await ctx.staffA.client.req('PUT', '/api/account/away', { from: addDays(today, 2), to: today })).status, 400, '끝 < 시작');
    const r = await ctx.staffA.client.ok('PUT', '/api/account/away', { from: today, to: addDays(today, 2), note: '휴가 중입니다', deputyId: ctx.staffB.id });
    assert.equal(r.active, true); assert.equal(r.away.deputyName, '박직원'); assert.equal(r.away.hold, true);
    const p = await ctx.owner.ok('GET', '/api/people/presence');
    assert.equal(p.people[ctx.staffA.id]?.s, 'leave');
    assert.match(p.people[ctx.staffA.id].label, /^부재 ~\d+\/\d+ · 대리 박직원$/);
    assert.equal(p.people[ctx.staffB.id], undefined, '대리인은 근무 중');
  });
  test('알림 보류: 부재 중 배정 알림은 목록에만(meta.held) · 푸시 없음', async () => {
    P.task = (await ctx.owner.ok('POST', '/api/tasks', { title: '부재 중 배정', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const n = (await ctx.staffA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'task_assigned' && x.entity_id === P.task);
    assert.ok(n, '목록에는 쌓임'); assert.equal(n.meta?.held, true);
    const [{ c }] = await sql`select count(*)::int c from notification_deliveries where notification_id = ${n.id}`;
    assert.equal(c, 0, '푸시 전달 없음');
    // 보류 끄면 바로 푸시
    await ctx.staffA.client.ok('PUT', '/api/account/away', { from: today, to: addDays(today, 2), note: '휴가 중입니다', deputyId: ctx.staffB.id, hold: false });
    const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: '보류 끈 뒤 배정', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
    const n2 = (await ctx.staffA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'task_assigned' && x.entity_id === t2);
    assert.notEqual(n2.meta?.held, true);
    const [{ c: c2 }] = await sql`select count(*)::int c from notification_deliveries where notification_id = ${n2.id}`;
    assert.equal(c2, 1);
    await ctx.staffA.client.ok('PUT', '/api/account/away', { from: today, to: addDays(today, 2), note: '휴가 중입니다', deputyId: ctx.staffB.id, hold: true });
  });
  test('1:1 대화 자동 응답: 방마다 하루 1번 "[부재중] …" 시스템 메시지', async () => {
    P.dm = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
    await ctx.owner.ok('POST', `/api/chat/rooms/${P.dm}/messages`, { body: '이직원님 계신가요?' });
    let d = await ctx.owner.ok('GET', `/api/chat/rooms/${P.dm}`);
    const auto = d.messages.filter((m) => m.kind === 'system' && m.body.startsWith('[부재중]'));
    assert.equal(auto.length, 1);
    assert.match(auto[0].body, /^\[부재중\] 이직원님은 \d+\/\d+까지 부재중입니다\. "휴가 중입니다" 급한 일은 박직원님께 연락해 주세요\.$/);
    await ctx.owner.ok('POST', `/api/chat/rooms/${P.dm}/messages`, { body: '두 번째' });
    d = await ctx.owner.ok('GET', `/api/chat/rooms/${P.dm}`);
    assert.equal(d.messages.filter((m) => m.kind === 'system' && m.body.startsWith('[부재중]')).length, 1, '같은 방 24시간 안엔 한 번만');
    // 부재자가 보내는 쪽에는 안내 없음(상대 = 김대표는 부재 아님)
    await ctx.staffA.client.ok('POST', `/api/chat/rooms/${P.dm}/messages`, { body: '급한 건 박직원에게요' });
    d = await ctx.owner.ok('GET', `/api/chat/rooms/${P.dm}`);
    assert.equal(d.messages.filter((m) => m.kind === 'system' && m.body.startsWith('[부재중]')).length, 1);
  });
  test('복귀 요약: 부재가 끝나면 tick 이 "부재 중 알림 n건" 1건(푸시) · 두 번 안 보냄 · 해제하면 설정 비움', async () => {
    await sql`update user_settings set away_from = ${addDays(today, -3)}, away_to = ${addDays(today, -1)}, away_summary_at = null where user_id = ${ctx.staffA.id}`;
    const [{ held }] = await sql`select count(*)::int held from notifications where user_id = ${ctx.staffA.id} and meta->>'held' = 'true' and read_at is null`;
    assert.equal(held, 3, '보류된 알림 = 배정 1 + 대표 1:1 메시지 2 (보류 끈 뒤 배정은 제외)');
    let n = null;
    for (let i = 0; i < 12 && !n; i++) {
      await tick();
      n = (await ctx.staffA.client.ok('GET', '/api/notifications')).items.find((x) => x.type === 'briefing' && /^부재 중 알림 \d+건$/.test(x.title));
      if (!n) await new Promise((r) => setTimeout(r, 1000));
    }
    assert.ok(n, '복귀 요약 알림');
    assert.equal(n.title, `부재 중 알림 ${held}건`, '보류된(held) 안 읽은 알림만 셈');
    assert.equal(n.link, '/notifications?unread=1');
    const [{ c }] = await sql`select count(*)::int c from notification_deliveries where notification_id = ${n.id}`;
    assert.equal(c, 1, '요약은 푸시');
    await tick();
    assert.equal((await ctx.staffA.client.ok('GET', '/api/notifications')).items.filter((x) => x.type === 'briefing' && /^부재 중 알림/.test(x.title)).length, 1);
    assert.equal((await ctx.owner.ok('GET', '/api/people/presence')).people[ctx.staffA.id], undefined, '기간 지나면 근무 중');
    const r = await ctx.staffA.client.ok('DELETE', '/api/account/away');
    assert.deepEqual([r.away, r.active], [null, false]);
  });
});

describe('#111 일정 화상 회의 링크', () => {
  test('만들기·목록·수정 · http(s) 아니면 400', async () => {
    const cals = (await ctx.owner.ok('GET', '/api/calendars')).calendars;
    const mine = cals.find((c) => c.type === 'personal' && c.owner_user_id === ctx.ownerId) ?? cals.find((c) => c.type === 'personal');
    const day = addDays(today, 3);
    const body = { calendarId: mine.id, title: '화상 회의', start: `${day}T10:00:00+09:00`, end: `${day}T11:00:00+09:00` };
    assert.equal((await ctx.owner.post('/api/events', { ...body, meetingUrl: 'zoom.us/j/123' })).status, 400);
    const id = (await ctx.owner.ok('POST', '/api/events', { ...body, meetingUrl: 'https://meet.google.com/abc-defg-hij' })).id;
    const list = () => ctx.owner.ok('GET', `/api/events?from=${encodeURIComponent(`${day}T00:00:00+09:00`)}&to=${encodeURIComponent(`${addDays(day, 1)}T00:00:00+09:00`)}`);
    assert.equal((await list()).events.find((e) => e.id === id)?.meetingUrl, 'https://meet.google.com/abc-defg-hij');
    await ctx.owner.ok('PATCH', `/api/events/${id}`, { meetingUrl: 'https://zoom.us/j/123' });
    assert.equal((await list()).events.find((e) => e.id === id)?.meetingUrl, 'https://zoom.us/j/123');
  });
});

describe('#279 탈퇴 30일 뒤 실제 삭제', () => {
  test('tick: 익명화 뒤 30일 지난 계정만 전화·회사 메일·설정·알림·세션·푸시 정리 + purged_at + 감사', async () => {
    const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
    const mk = async (days) => {
      const [u] = await sql`insert into users (email, name, role, status, tenant, phone, work_email, deleted_at) values (${`deleted+${crypto.randomUUID()}@deleted.invalid`}, '탈퇴한 사용자', 'staff', 'left', ${tenant}, '010-1234-5678', 'x@company.test', now() - make_interval(days => ${days})) returning id`;
      await sql`insert into user_settings (user_id, away_note) values (${u.id}, '남은 설정')`;
      await sql`insert into notifications (user_id, type, title, dedupe_key) values (${u.id}, 'task_assigned', '남은 알림', ${`purge:${u.id}`})`;
      return u.id;
    };
    const old = await mk(31), fresh = await mk(10);
    for (let i = 0; i < 12; i++) {
      const r = await tick();
      if (!r.skipped) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const [a] = await sql`select purged_at, phone, work_email, (select count(*)::int from notifications where user_id = ${old}) n, (select count(*)::int from user_settings where user_id = ${old}) s from users where id = ${old}`;
    assert.ok(a.purged_at); assert.deepEqual([a.phone, a.work_email, a.n, a.s], [null, null, 0, 0]);
    const [b] = await sql`select purged_at, phone, (select count(*)::int from notifications where user_id = ${fresh}) n from users where id = ${fresh}`;
    assert.deepEqual([b.purged_at, b.phone, b.n], [null, '010-1234-5678', 1], '30일 안 된 계정은 그대로');
    const [log] = await sql`select 1 from audit_logs where action = 'account.purged' and target_id = ${old}`;
    assert.ok(log, '감사 기록');
  });
});
