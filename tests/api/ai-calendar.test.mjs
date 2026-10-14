// V14 22번: AI 비서 일정 도구 — 빈 시간 찾기·일정 만들기·변경·취소 (제안 카드 → 확인 후 실행), 충돌·연차 경고 (가짜 Anthropic 서버)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays, FAKE, BASE, ensureTls } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, fake, ctx, sql, day, day2;
const queue = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
const fakeState = () => fetch(`${FAKE}/__state`).then((r) => r.json());
const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const iso = (d, t) => `${d}T${t}:00+09:00`;

async function chat(c, text, steps) {
  const before = (await fakeState()).anthropic.length;
  await queue(steps);
  const r = await c.ok('POST', '/api/ai/chat', { messages: [{ role: 'user', text }] });
  const reqs = (await fakeState()).anthropic.slice(before).filter((x) => Array.isArray(x.body.messages?.at(-1)?.content) && x.body.messages.at(-1).content.some((b) => b.type === 'tool_result'));
  const results = reqs.flatMap((x) => x.body.messages.at(-1).content.filter((b) => b.type === 'tool_result'));
  return { r, results: Object.fromEntries(results.map((x) => [x.tool_use_id, x])) };
}

before(async () => {
  await resetDb();
  await ensureTls();
  fake = await startFakeGoogle();
  srv = await startServer();
  sql = testDb();
  ctx = await bootstrap();
  const hol = new Set((await sql`select to_char(date,'YYYY-MM-DD') d from holidays`).map((h) => h.d));
  const work = (d) => { const w = new Date(d + 'T00:00:00Z').getUTCDay(); return w >= 1 && w <= 5 && !hol.has(d); };
  day = addDays(seoulToday(), 2); while (!work(day)) day = addDays(day, 1);
  day2 = addDays(day, 1); while (!work(day2)) day2 = addDays(day2, 1);
  // 이직원: day 10~12 회의(다른 일정), day2 연차
  const cals = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars;
  const mine = cals.find((c) => c.type === 'personal' && c.owner_user_id === ctx.staffA.id) ?? cals.find((c) => c.type === 'personal');
  await ctx.staffA.client.ok('POST', '/api/events', { calendarId: mine.id, title: '거래처 미팅', start: iso(day, '10:00'), end: iso(day, '12:00') });
  await ctx.staffA.client.ok('POST', '/api/events', { calendarId: mine.id, title: '연차', kind: 'vacation', allDay: true, start: iso(day2, '00:00'), end: iso(addDays(day2, 1), '00:00') });
});
after(async () => { srv?.proc.kill(); fake?.server.close(); await sql?.end(); });

describe('V14 22번 AI 일정 도구', () => {
  test('find_free_time: 참석자 회의·연차를 피한 근무 시간만', async () => {
    const { results } = await chat(ctx.owner, '이직원이랑 1시간 비는 시간 찾아줘', [
      toolUse('f1', 'find_free_time', { attendeeIds: [ctx.staffA.id], from: day, to: day2, durationMinutes: 60 }), say('빈 시간입니다.')]);
    const out = JSON.parse(results.f1.content);
    assert.ok(!results.f1.is_error, results.f1.content);
    assert.ok(out.slots.length > 0);
    assert.ok(out.slots.every((s) => s.date === day), '연차인 day2 는 제외');
    assert.ok(!out.slots.some((s) => s.start < '12:00' && s.end > '10:00'), '10~12 회의와 겹치지 않음');
    assert.ok(out.slots.every((s) => s.start >= '09:00' && s.end <= '18:00' && !(s.start < '13:00' && s.end > '12:00')), '근무 시간·점심 제외');
  });

  test('propose_create_event: 카드(시간·참석자·충돌·연차 경고) → 확인 전 미생성 → 확인하면 생성·초대 알림', async () => {
    const { r, results } = await chat(ctx.owner, '모레 11시 본사 회의 이직원 참석 1시간', [
      toolUse('c1', 'propose_create_event', { title: '본사 회의', date: day, startTime: '11:00', durationMinutes: 60, attendeeIds: [ctx.staffA.id], location: '본사 3층', reminderMinutes: [10] }), say('확인을 누르면 반영됩니다.')]);
    assert.ok(!results.c1.is_error, results.c1.content);
    assert.equal(r.proposals.length, 1);
    const p = r.proposals[0];
    assert.match(p.summary, /본사 회의/);
    assert.match(p.preview.when, /11:00~12:00/);
    assert.deepEqual(p.preview.attendees.map((a) => a.split(' · ')[0]), ['이직원']);
    assert.ok(p.preview.warnings.some((w) => /겹치는 일정/.test(w) && /이직원/.test(w)), JSON.stringify(p.preview.warnings));
    assert.equal((await sql`select count(*)::int n from events where title = '본사 회의'`)[0].n, 0, '확인 전 미생성');
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${p.id}`, { accept: true });
    const [ev] = await sql`select e.*, c.type from events e join calendars c on c.id = e.calendar_id where e.id = ${done.eventId}`;
    assert.equal(ev.location, '본사 3층'); assert.equal(ev.type, 'personal'); assert.deepEqual(ev.reminder_minutes, [10]);
    assert.equal(new Date(ev.start_at).toISOString(), new Date(iso(day, '11:00')).toISOString());
    const n = await sql`select title from notifications where user_id = ${ctx.staffA.id} and entity_id = ${ev.id}`;
    assert.match(n[0]?.title ?? '', /일정 초대: 본사 회의/);
    // 연차 경고
    const v = await chat(ctx.owner, '그 다음 날 종일 워크숍', [toolUse('c2', 'propose_create_event', { title: '워크숍', date: day2, allDay: true, attendeeIds: [ctx.staffA.id] }), say('ok')]);
    assert.ok(v.r.proposals[0].preview.warnings.some((w) => /이직원: 연차·출장/.test(w)), JSON.stringify(v.r.proposals[0].preview.warnings));
  });

  test('반복·회사 캘린더·권한: 직원은 회사 캘린더 불가(오류), 볼 수 없는 사람 id 거절', async () => {
    const x = await chat(ctx.staffA.client, '회사 일정', [toolUse('d1', 'propose_create_event', { title: '전사 공지', date: day, startTime: '15:00', calendar: 'company' }),
      toolUse('d2', 'propose_create_event', { title: '모르는 사람', date: day, startTime: '15:00', attendeeIds: ['00000000-0000-4000-8000-0000000000aa'] }), say('ok')]);
    assert.equal(x.results.d1.is_error, true); assert.match(x.results.d1.content, /권한/);
    assert.equal(x.results.d2.is_error, true);
    const w = await chat(ctx.owner, '매주 회의', [toolUse('d3', 'propose_create_event', { title: '주간 회의', date: day, startTime: '09:00', durationMinutes: 30, repeat: 'weekly', calendar: 'company' }), say('ok')]);
    const done = await ctx.owner.ok('POST', `/api/ai/proposals/${w.r.proposals[0].id}`, { accept: true });
    const [ev] = await sql`select e.rrule, c.type from events e join calendars c on c.id = e.calendar_id where e.id = ${done.eventId}`;
    assert.equal(ev.type, 'company'); assert.match(ev.rrule, /FREQ=WEEKLY/);
  });

  test('propose_update_event: 시간 변경·취소 → 확인 후 실행·참석자 알림, 남의 일정은 거절', async () => {
    const [ev] = await sql`select id from events where title = '본사 회의'`;
    const m = await chat(ctx.owner, '본사 회의 2시로', [toolUse('u1', 'propose_update_event', { eventId: ev.id, action: 'move', startTime: '14:00' }), say('ok')]);
    assert.ok(!m.results.u1.is_error, m.results.u1.content);
    assert.match(m.r.proposals[0].preview.when, /14:00~15:00/);
    assert.ok(!m.r.proposals[0].preview.warnings.some((w) => /겹치는 일정/.test(w)), '자기 자신과는 충돌 아님');
    await ctx.owner.ok('POST', `/api/ai/proposals/${m.r.proposals[0].id}`, { accept: true });
    const [moved] = await sql`select start_at, end_at from events where id = ${ev.id}`;
    assert.equal(new Date(moved.start_at).toISOString(), new Date(iso(day, '14:00')).toISOString());
    assert.equal(new Date(moved.end_at).toISOString(), new Date(iso(day, '15:00')).toISOString());
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and title like '일정 변경%'`).length);
    // 직원은 대표가 만든 일정을 바꿀 수 없다(참석자여도)
    const s = await chat(ctx.staffA.client, '취소해', [toolUse('u2', 'propose_update_event', { eventId: ev.id, action: 'cancel' }), say('ok')]);
    assert.equal(s.results.u2.is_error, true);
    const c = await chat(ctx.owner, '본사 회의 취소', [toolUse('u3', 'propose_update_event', { eventId: ev.id, action: 'cancel' }), say('ok')]);
    assert.match(c.r.proposals[0].summary, /일정 취소/);
    assert.equal((await sql`select deleted_at from events where id = ${ev.id}`)[0].deleted_at, null, '확인 전 유지');
    await ctx.owner.ok('POST', `/api/ai/proposals/${c.r.proposals[0].id}`, { accept: true });
    assert.notEqual((await sql`select deleted_at from events where id = ${ev.id}`)[0].deleted_at, null);
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and title like '일정 취소%'`).length);
  });
});

describe('V14 24번 직책 약칭', () => {
  test('사용자 관리에서 약칭 입력 → 아바타 표시용 목록(약칭, 없으면 직책), 직원은 입력 불가, 로그인 필요', async () => {
    await ctx.owner.ok('PATCH', `/api/admin/users/${ctx.ownerId}`, { titleShort: 'CEO' });
    await ctx.owner.ok('PATCH', `/api/admin/users/${ctx.managerA.id}`, { title: '현장 매니저' });
    const b = await ctx.staffA.client.ok('GET', '/api/people/badges');
    assert.equal(b.people[ctx.ownerId], 'CEO');
    assert.equal(b.people[ctx.managerA.id], '현장 매니저', '약칭이 없으면 직책');
    assert.equal(b.people[ctx.staffA.id], undefined);
    const list = await ctx.owner.ok('GET', '/api/admin/users');
    assert.equal(list.users.find((x) => x.id === ctx.ownerId).title_short, 'CEO');
    assert.ok([403, 404].includes((await ctx.staffA.client.req('PATCH', `/api/admin/users/${ctx.staffA.id}`, { titleShort: 'X' })).status));
    assert.equal((await fetch(`${BASE}/api/people/badges`)).status, 401);
    await ctx.owner.ok('PATCH', `/api/admin/users/${ctx.ownerId}`, { titleShort: '' });
    assert.equal((await ctx.owner.ok('GET', '/api/people/badges')).people[ctx.ownerId], undefined, '비우면 직책(없으면 표시 없음)');
  });
});

describe('V14 25·26번 메신저 답장·반응·고정, AI 대화 화면 맥락', () => {
  test('답장 인용·반응 켜고 끄기·대화방 고정, 다른 방 메시지에 답장 불가', async () => {
    const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
    const first = await ctx.owner.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '원래 메시지' });
    const rep = await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '답장입니다', replyTo: first.id });
    const d = await ctx.owner.ok('GET', `/api/chat/rooms/${room}`);
    const m = d.messages.find((x) => x.id === rep.id);
    assert.equal(m.reply_to, first.id); assert.equal(m.reply.body, '원래 메시지'); assert.equal(m.reply.author, '김대표');
    const other = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.managerA.id })).id;
    assert.equal((await ctx.owner.req('POST', `/api/chat/rooms/${other}/messages`, { body: 'x', replyTo: first.id })).status, 400);
    assert.equal((await ctx.staffA.client.ok('POST', `/api/chat/messages/${first.id}/react`, { emoji: '👍' })).on, true);
    await ctx.owner.ok('POST', `/api/chat/messages/${first.id}/react`, { emoji: '👍' });
    let r = (await ctx.owner.ok('GET', `/api/chat/rooms/${room}`)).messages.find((x) => x.id === first.id).reactions;
    assert.deepEqual(r.map((x) => [x.emoji, x.n, x.mine]), [['👍', 2, true]]);
    assert.equal((await ctx.owner.ok('POST', `/api/chat/messages/${first.id}/react`, { emoji: '👍' })).on, false);
    r = (await ctx.owner.ok('GET', `/api/chat/rooms/${room}`)).messages.find((x) => x.id === first.id).reactions;
    assert.deepEqual(r.map((x) => [x.emoji, x.n, x.mine]), [['👍', 1, false]]);
    assert.equal((await ctx.owner.req('POST', `/api/chat/messages/${first.id}/react`, { emoji: '💩' })).status, 400);
    assert.equal((await ctx.managerA.client.req('POST', `/api/chat/messages/${first.id}/react`, { emoji: '👍' })).status, 404, '남의 방 메시지');
    await ctx.owner.ok('PATCH', `/api/chat/rooms/${other}`, { pinned: true });
    const list = (await ctx.owner.ok('GET', '/api/chat/rooms')).rooms;
    assert.equal(list[0].id, other); assert.equal(list[0].pinned, true);
  });

  test('AI 대화는 시작한 화면(맥락)을 기억해 패널 목록에서 먼저 보인다', async () => {
    await queue([say('네.')]);
    const r = await ctx.owner.ok('POST', '/api/ai/chat', { text: '이 날 일정 알려줘', context: { page: 'calendar', id: day } });
    const t = (await ctx.owner.ok('GET', '/api/ai/threads')).threads.find((x) => x.id === r.threadId);
    assert.equal(t.context_page, 'calendar'); assert.equal(t.context_id, day);
  });
});
