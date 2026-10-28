// 241차(로컬 10/28 19:20 '10/29 면접 일정 1건이 17:45~19:15 사이 사라짐 — 누가·언제 지웠는지 · 휴지통(되살리기)'):
// 지운 일정 목록(지운 사람·때·캘린더) · 고칠 수 있는 사람만(남은 목록에 없고 되살리기 404) · 남의 비공개는 '바쁨' · 되살리면 다시 보이고 활동 기록 ·
// 반복 일정은 통째로 지웠다 되살리면 바꾼 회차는 돌아오고, 앞서 '이번 일정만' 지운 회차는 그대로 빠짐
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const at = (d, h, m = 0) => { const x = new Date(Date.now() + d * 864e5); x.setUTCHours(h, m, 0, 0); return x.toISOString(); };
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('지운 일정: 지운 사람·때·캘린더 · 남은 못 봄(404) · 되살리기 · 활동 기록', async () => {
  const A = ctx.staffA.client, B = ctx.staffB.client;
  const ev = await A.ok('POST', '/api/events', { title: '241 면접(팀장)', start: at(1, 6), end: at(1, 6, 30) });
  await A.ok('DELETE', `/api/events/${ev.id}?scope=all`);
  assert.equal((await A.req('GET', `/api/events/${ev.id}`)).status, 404);
  const it = (await A.ok('GET', '/api/events/deleted')).items.find((x) => x.id === ev.id);
  assert.ok(it, '지운 일정 목록에 있음');
  assert.deepEqual([it.title, it.calendar, it.deletedBy, it.repeat, it.allDay], ['241 면접(팀장)', '내 일정', '이직원', false, false]);
  assert.ok(Date.now() - Date.parse(it.deletedAt) < 60e3, '지운 때');
  // 남(다른 지점 직원)은 목록에 없고 되살리기도 없는 것처럼
  assert.ok(!(await B.ok('GET', '/api/events/deleted')).items.some((x) => x.id === ev.id));
  assert.equal((await B.req('POST', `/api/events/${ev.id}/restore`)).status, 404);
  assert.equal((await B.req('POST', '/api/events/not-a-uuid/restore')).status, 404);
  // 되살리기 → 다시 보이고 목록에서 빠짐 · 두 번은 404
  const r = await A.ok('POST', `/api/events/${ev.id}/restore`);
  assert.equal(r.id, ev.id);
  assert.equal((await A.ok('GET', `/api/events/${ev.id}`)).event.title, '241 면접(팀장)');
  assert.ok(!(await A.ok('GET', '/api/events/deleted')).items.some((x) => x.id === ev.id));
  assert.equal((await A.req('POST', `/api/events/${ev.id}/restore`)).status, 404);
  const acts = (await sql`select action from activities where entity_type = 'event' and entity_id = ${ev.id} order by id`).map((a) => a.action).filter((a) => a === 'deleted' || a === 'restored');
  assert.deepEqual(acts, ['deleted', 'restored']);
});

test('같은 지점 캘린더: 다른 사람이 지운 것도 보이고(지운 사람 이름) · 남의 비공개는 바쁨', async () => {
  const A = ctx.staffA.client, M = ctx.managerA.client;
  const cal = (await A.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'org_unit' && c.perms?.edit);
  assert.ok(cal, '지점 캘린더(고치기 가능)');
  const ev = await A.ok('POST', '/api/events', { title: '241 지점 회의', calendarId: cal.id, start: at(2, 2), end: at(2, 3) });
  await M.ok('DELETE', `/api/events/${ev.id}?scope=all`);
  const it = (await A.ok('GET', '/api/events/deleted')).items.find((x) => x.id === ev.id);
  assert.deepEqual([it?.title, it?.deletedBy, it?.calendar], ['241 지점 회의', '최매니저', cal.name]);
  const pv = await A.ok('POST', '/api/events', { title: '241 개인 사정', calendarId: cal.id, isPrivate: true, start: at(2, 4), end: at(2, 5) });
  await A.ok('DELETE', `/api/events/${pv.id}?scope=all`);
  assert.equal((await M.ok('GET', '/api/events/deleted')).items.find((x) => x.id === pv.id)?.title, '바쁨', '남의 비공개 일정은 제목 숨김');
  assert.equal((await A.ok('GET', '/api/events/deleted')).items.find((x) => x.id === pv.id)?.title, '241 개인 사정');
  // 다른 지점 직원은 둘 다 못 봄
  const bs = (await ctx.staffB.client.ok('GET', '/api/events/deleted')).items.map((x) => x.id);
  assert.ok(!bs.includes(ev.id) && !bs.includes(pv.id));
});

test('반복 일정: 통째로 지웠다 되살리면 바꾼 회차는 돌아오고 앞서 지운 회차는 그대로 빠짐', async () => {
  const A = ctx.staffA.client;
  const s0 = at(3, 1), e0 = at(3, 2);
  const m = await A.ok('POST', '/api/events', { title: '241 주간 회의', start: s0, end: e0, rrule: 'FREQ=WEEKLY;COUNT=4' });
  const occ = (k) => new Date(Date.parse(s0) + k * 7 * 864e5).toISOString();
  const ver = async () => (await A.ok('GET', `/api/events/${m.id}`)).event.version;
  await A.ok('PATCH', `/api/events/${m.id}`, { scope: 'this', occurrenceStart: occ(1), title: '241 2회차(바꿈)', version: await ver() });
  const [x2] = await sql`select id from events where recurring_event_id = ${m.id} and original_start = ${occ(1)} and deleted_at is null`;
  await A.ok('DELETE', `/api/events/${x2.id}?scope=this`);
  await A.ok('PATCH', `/api/events/${m.id}`, { scope: 'this', occurrenceStart: occ(2), title: '241 3회차(바꿈)', version: await ver() });
  await A.ok('DELETE', `/api/events/${m.id}?scope=all`);
  const it = (await A.ok('GET', '/api/events/deleted')).items.find((x) => x.id === m.id);
  assert.equal(it?.repeat, true);
  assert.ok(!(await A.ok('GET', '/api/events/deleted')).items.some((x) => x.id === x2.id), '회차 변경 줄은 목록에 따로 안 나옴');
  await A.ok('POST', `/api/events/${m.id}/restore`);
  const from = new Date(Date.parse(s0) - 864e5).toISOString(), to = new Date(Date.parse(s0) + 30 * 864e5).toISOString();
  const evs = (await A.ok('GET', `/api/events?from=${from}&to=${to}`)).events.filter((e) => (e.seriesId ?? e.id) === m.id);
  assert.deepEqual(evs.map((e) => e.title), ['241 주간 회의', '241 3회차(바꿈)', '241 주간 회의']);
  assert.equal((await sql`select deleted_at from events where id = ${x2.id}`)[0].deleted_at !== null, true, '앞서 지운 회차는 지운 채로');
});

test('입찰·영업 연동 취소는 그 표시 · 업무를 지워 함께 숨은 업무 시간 칸은 목록·되살리기에서 빠짐(업무를 되살리면 돌아옴)', async () => {
  const A = ctx.staffA.client;
  const a = await A.ok('POST', '/api/events', { title: '241 입찰 마감', start: at(4, 1), end: at(4, 2) });
  await sql`update events set deleted_at = now() where id = ${a.id}`;
  await sql`insert into activities (entity_type, entity_id, actor_id, action, changes) values ('event', ${a.id}, null, 'canceled', ${sql.json({ reason: 'notice_canceled' })})`;
  const b = await A.ok('POST', '/api/events', { title: '241 업무 시간', start: at(4, 3), end: at(4, 4) });
  await sql`update events set deleted_at = now(), hidden_by_task = ${randomUUID()} where id = ${b.id}`;
  const items = (await A.ok('GET', '/api/events/deleted')).items;
  const ia = items.find((x) => x.id === a.id);
  assert.deepEqual([ia?.auto, ia?.deletedBy], ['입찰·영업 연동으로 함께 취소', null]);
  assert.ok(!items.some((x) => x.id === b.id));
  assert.equal((await A.req('POST', `/api/events/${b.id}/restore`)).status, 404);
});
