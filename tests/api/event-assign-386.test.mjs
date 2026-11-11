// 386차(대표 11/09 "서로 업무배정뿐 아니라 스케줄도 배정해줄 수 있도록" + 사례: 본부장이 AI 비서로 대표 일정을 만들자 본부장 캘린더에도 생김):
// 일정 배정 = 받는 사람 개인 캘린더에 생기고, 배정한 사람은 참석자로 안 들어감(만든 사람이라 보기·고치기는 됨) · 받는 사람 '일정 배정' 알림 ·
// 기존 일정을 다른 사람 일정으로 넘기기 · 바꾸기·지우기 때 일정 주인에게 알림 · AI 비서 ownerId(나도 함께면 includeMe) — 구조 시험(가짜 Anthropic)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays, FAKE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql, day;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const iso = (d, t) => `${d}T${t}:00+09:00`;
const calOf = async (id) => (await sql`select c.type, c.owner_user_id from events e join calendars c on c.id = e.calendar_id where e.id = ${id}`)[0];
const attendeesOf = async (id) => (await sql`select user_id, response from event_attendees where event_id = ${id}`).map((r) => ({ id: r.user_id, response: r.response }));
const notes = async (userId, id) => (await sql`select title, body from notifications where user_id = ${userId} and entity_id = ${id} order by created_at`).map((n) => `${n.title} | ${n.body}`);

before(async () => {
  await resetDb(); await ensureTls(); fake = await startFakeGoogle(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  day = addDays(seoulToday(), 3);
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('386차 일정 배정', () => {
  let evId;
  test('직원이 대표에게 일정 배정 → 대표 캘린더에만 · 배정한 사람은 참석자 아님 · 대표 알림 · 배정한 사람도 보기·고치기', async () => {
    const r = await ctx.staffA.client.ok('POST', '/api/events', { ownerId: ctx.ownerId, title: '시험386 현장 미팅', start: iso(day, '13:00'), end: iso(day, '14:00'), location: '시험 단지' });
    evId = r.id;
    assert.deepEqual(await calOf(evId), { type: 'personal', owner_user_id: ctx.ownerId }, '받는 사람 개인 캘린더');
    assert.deepEqual(await attendeesOf(evId), [], '배정한 사람(이직원)은 참석자로 들어가지 않음');
    const n = await notes(ctx.ownerId, evId);
    assert.equal(n.length, 1); assert.match(n[0], /^일정 배정: 시험386 현장 미팅 \| 이직원님이 일정을 배정했습니다 · /);
    // 배정한 사람: 목록에 보이고(주인 = 대표, 배정 = 나), 상세·고치기 가능
    const from = iso(day, '00:00'), to = iso(addDays(day, 1), '00:00');
    const mine = (await ctx.staffA.client.ok('GET', `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).events.find((e) => e.id === evId);
    assert.ok(mine, '배정한 일정이 목록에 보임');
    assert.deepEqual([mine.ownerId, mine.ownerName, mine.assignedBy?.id], [ctx.ownerId, '김대표', ctx.staffA.id]);
    const d = await ctx.staffA.client.ok('GET', `/api/events/${evId}`);
    assert.deepEqual([d.owner?.id, d.assignedBy?.id, d.perms.edit], [ctx.ownerId, ctx.staffA.id, true]);
    // 받은 사람(대표): 내 일정 + '이직원님이 배정'
    const own = (await ctx.owner.ok('GET', `/api/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).events.find((e) => e.id === evId);
    assert.deepEqual([own.ownerId, own.assignedBy?.name], [ctx.ownerId, '이직원']);
    // 배정한 사람이 시간을 바꾸면 주인(참석자 아님)에게도 변경 알림
    const cur = (await ctx.staffA.client.ok('GET', `/api/events/${evId}`)).event.version;
    await ctx.staffA.client.ok('PATCH', `/api/events/${evId}`, { ownerId: ctx.ownerId, calendarId: (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id, start: iso(day, '15:00'), end: iso(day, '16:00'), version: cur, scope: 'all' });
    assert.deepEqual(await calOf(evId), { type: 'personal', owner_user_id: ctx.ownerId }, '누구 일정(ownerId)이 오면 함께 온 캘린더 값으로 다시 옮기지 않음');
    assert.ok((await notes(ctx.ownerId, evId)).some((x) => /^일정 변경: 시험386 현장 미팅 \| 이직원님이 일정을 변경했습니다/.test(x)));
  });

  test('나도 함께(참석자에 나) · 같은 회사 재직자만 · 남에게 배정할 때 충돌은 받는 사람 기준(내 일정은 빼고)', async () => {
    const r = await ctx.staffA.client.ok('POST', '/api/events', { ownerId: ctx.staffB.id, title: '시험386 동행', start: iso(day, '10:00'), end: iso(day, '11:00'), attendeeIds: [ctx.staffA.id, ctx.staffB.id] });
    assert.deepEqual(await calOf(r.id), { type: 'personal', owner_user_id: ctx.staffB.id });
    assert.deepEqual(await attendeesOf(r.id), [{ id: ctx.staffA.id, response: 'accepted' }], '주인(박직원)은 참석자 줄에서 빠지고 나는 참석');
    const bad = await ctx.staffA.client.req('POST', '/api/events', { ownerId: '00000000-0000-4000-8000-000000000386', title: '없는 사람', start: iso(day, '10:00'), end: iso(day, '11:00') });
    assert.equal(bad.status, 400); assert.match(bad.body.error?.message ?? '', /같은 회사 재직자/);
    // 이직원 본인 일정 9:30~10:30 이 있어도 박직원에게 배정하는 10~11시 충돌 안내에는 안 나옴(withoutMe)
    await ctx.staffA.client.ok('POST', '/api/events', { title: '시험386 내 일정', start: iso(day, '09:30'), end: iso(day, '10:30') });
    const q = (w) => `/api/events/conflicts?start=${encodeURIComponent(iso(day, '10:00'))}&end=${encodeURIComponent(iso(day, '11:00'))}&userIds=${ctx.staffB.id}&exclude=${r.id}${w}`;
    assert.ok((await ctx.staffA.client.ok('GET', q(''))).conflicts.some((c) => c.title === '시험386 내 일정'), '기본은 나도 포함');
    assert.ok(!(await ctx.staffA.client.ok('GET', q('&withoutMe=1'))).conflicts.some((c) => c.title === '시험386 내 일정'));
  });

  test('기존 일정을 다른 사람 일정으로 넘기기(본부장 사례: 내 캘린더 + 대표 참석자 → 대표 일정) · 지우면 주인에게 취소 알림', async () => {
    const mine = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal');
    const r = await ctx.owner.ok('POST', '/api/events', { calendarId: mine.id, title: '시험386 넘길 일정', start: iso(day, '16:00'), end: iso(day, '17:00'), attendeeIds: [ctx.staffB.id] });
    const v = (await ctx.owner.ok('GET', `/api/events/${r.id}`)).event.version;
    await ctx.owner.ok('PATCH', `/api/events/${r.id}`, { ownerId: ctx.staffB.id, version: v, scope: 'all' });
    assert.deepEqual(await calOf(r.id), { type: 'personal', owner_user_id: ctx.staffB.id });
    assert.deepEqual(await attendeesOf(r.id), [], '새 주인은 참석자 줄에서 빠짐(이제 주인)');
    assert.ok((await notes(ctx.staffB.id, r.id)).some((x) => /^일정 배정: 시험386 넘길 일정 \| 김대표님이 일정을 배정했습니다/.test(x)));
    const d = await ctx.owner.ok('GET', `/api/events/${r.id}`);
    assert.deepEqual([d.owner?.id, d.assignedBy?.id, d.perms.edit], [ctx.staffB.id, ctx.ownerId, true], '넘긴 사람(만든 사람)도 계속 고칠 수 있음');
    await ctx.owner.ok('DELETE', `/api/events/${r.id}?scope=all`);
    assert.ok((await notes(ctx.staffB.id, r.id)).some((x) => /^일정 취소: 시험386 넘길 일정 \| 김대표님이 일정을 취소했습니다/.test(x)));
  });

  test('AI 비서: "대표님 일정 잡아줘" → ownerId 로 대표 캘린더에(요청한 사람은 안 들어감) · 나도 같이면 includeMe', async () => {
    await queue([toolUse('a1', 'propose_create_event', { title: '시험386 롯데캐슬 미팅', date: day, startTime: '13:00', durationMinutes: 60, ownerId: ctx.ownerId }), say('김대표님 일정으로 배정했습니다.')]);
    const r = await ctx.staffA.client.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '대표님 목요일 1시 롯데캐슬 미팅 일정 잡아줘' }] });
    const p = r.proposals[0];
    assert.match(p.summary, /^일정 1 만들기: 시험386 롯데캐슬 미팅 — .* · 김대표님 일정으로 배정$/);
    assert.deepEqual([p.preview.calendar, p.preview.owner, p.preview.attendees], ['김대표 캘린더(배정)', '김대표', []]);
    const done = await ctx.staffA.client.ok('POST', `/api/ai/proposals/${p.id}`, { accept: true });
    assert.deepEqual(await calOf(done.eventId), { type: 'personal', owner_user_id: ctx.ownerId });
    assert.deepEqual(await attendeesOf(done.eventId), [], '요청한 사람(이직원)은 일정에 안 들어감');
    assert.ok((await notes(ctx.ownerId, done.eventId)).some((x) => /^일정 배정: 시험386 롯데캐슬 미팅/.test(x)));
    // 나도 같이
    await queue([toolUse('a2', 'propose_create_event', { title: '시험386 함께 방문', date: day, startTime: '17:00', ownerId: ctx.ownerId, includeMe: true }), say('ok')]);
    const r2 = await ctx.staffA.client.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text: '대표님 일정 잡고 나도 같이 가' }] });
    assert.deepEqual(r2.proposals[0].preview.attendees, ['나']);
    const done2 = await ctx.staffA.client.ok('POST', `/api/ai/proposals/${r2.proposals[0].id}`, { accept: true });
    assert.deepEqual(await calOf(done2.eventId), { type: 'personal', owner_user_id: ctx.ownerId });
    assert.deepEqual(await attendeesOf(done2.eventId), [{ id: ctx.staffA.id, response: 'accepted' }]);
  });
});
