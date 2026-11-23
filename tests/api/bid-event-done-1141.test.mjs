// #1141(대표 11/24 '완료한 입찰 업무의 일정이 캘린더에 남음'):
// ① 입찰 넘기기로 만든 일정(현장설명회·입찰 마감)은 입찰 업무에 연결(event_tasks link · hide_when_done) — 날짜는 맞추지 않음(sync 아님)
// ② 연결된 업무가 모두 완료면 일정 목록에 tasksDone = true(캘린더·홈이 숨기고 '완료 보기'에서만 취소선) · 같은 일정에 열린 업무가 하나라도 있으면 false
// ③ 이미 만든 입찰 일정 되살리기: 277 마이그레이션이 sales_work_records.data.bid_events ↔ bid_task_id 로 소급 연결(같은 회사 일정·업무만)
// ④ 그냥 '기존 업무 연결'(hide_when_done 없음)은 지금처럼 숨기지 않음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
const list = async (c = ctx.owner) => (await c.ok('GET', `/api/events?from=${encodeURIComponent(`${addDays(today, -1)}T00:00:00+09:00`)}&to=${encodeURIComponent(`${addDays(today, 12)}T00:00:00+09:00`)}`)).events;

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await put('procurement_notices', { id: 'B1141', title: '체육시설 위탁운영 용역', complex_name: '완료 시험 단지', issuer: '성남시청', region: '경기', related: true, first_seen_at: today,
    site_briefing_at: `${addDays(today, 2)}T14:00`, deadline_at: `${addDays(today, 8)}T10:00` });
  await put('procurement_notices', { id: 'B1141b', title: '청소 용역', complex_name: '예전 넘긴 단지', issuer: '구청', region: '경기', related: true, first_seen_at: today,
    site_briefing_at: `${addDays(today, 3)}T15:00`, deadline_at: `${addDays(today, 9)}T10:00` });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('넘기기 일정은 입찰 업무에 연결 · 업무 완료면 tasksDone · 열린 업무가 하나라도 있으면 보임 · 날짜는 맞추지 않음', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'B1141', assigneeIds: [ctx.staffA.id] });
  assert.equal(r.eventIds.length, 2, '현장설명회·입찰 마감');
  const task = r.taskIds[0];
  const links = await sql`select et.role, et.sync, et.hide_when_done, e.title from event_tasks et join events e on e.id = et.event_id where et.task_id = ${task} order by e.start_at`;
  assert.deepEqual(links.map((x) => [x.title.replace(/ · .*/, ''), x.role, x.sync, x.hide_when_done]), [['[입찰] 현장설명회', 'link', false, true], ['[입찰] 입찰 마감', 'link', true, true]],
    '#1144: 입찰 마감 일정만 날짜 맞춤(sync), 현장설명회는 연결만');

  let evs = (await list()).filter((e) => r.eventIds.includes(e.id));
  assert.equal(evs.length, 2); assert.ok(evs.every((e) => e.tasksDone === false), '업무가 열려 있으면 보임');
  assert.equal(evs.find((e) => /입찰 마감/.test(e.title)).linkedTask?.id, task, '입찰 마감 일정 = 업무와 날짜 맞춤 연결(캘린더에서 업무 줄과 한 줄)');
  assert.equal(evs.find((e) => /현장설명회/.test(e.title)).linkedTask, null);

  // 같은 일정에 다른 업무를 더 연결(열림) → 입찰 업무가 끝나도 보임
  const extra = await ctx.owner.ok('POST', '/api/tasks', { title: '현장설명회 자료 준비', assigneeId: ctx.ownerId, dueDate: addDays(today, 2) });
  const briefing = evs.find((e) => /현장설명회/.test(e.title)).id;
  await sql`insert into event_tasks (event_id, task_id, role, created_by) values (${briefing}, ${extra.id}, 'link', ${ctx.ownerId})`; // [기존 업무 연결]과 같은 줄
  const v = (await sql`select version from tasks where id = ${task}`)[0].version;
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${task}`, { status: 'done', version: v });
  evs = (await list()).filter((e) => r.eventIds.includes(e.id));
  const by = Object.fromEntries(evs.map((e) => [/현장설명회/.test(e.title) ? 'briefing' : 'close', e.tasksDone]));
  assert.deepEqual(by, { briefing: false, close: true }, '입찰 마감 일정은 숨김 대상 · 현장설명회는 열린 업무가 남아 보임');
  // 직원(참석자)도 같은 판정
  const sa = (await list(ctx.staffA.client)).filter((e) => r.eventIds.includes(e.id));
  assert.equal(sa.find((e) => !/현장설명회/.test(e.title)).tasksDone, true);

  await ctx.owner.ok('PATCH', `/api/tasks/${extra.id}`, { status: 'done' });
  evs = (await list()).filter((e) => r.eventIds.includes(e.id));
  assert.ok(evs.every((e) => e.tasksDone === true), '연결 업무가 모두 끝나면 둘 다 숨김 대상');

  // 업무를 다시 열면 다시 보임
  const v2 = (await sql`select version from tasks where id = ${task}`)[0].version;
  await ctx.staffA.client.ok('PATCH', `/api/tasks/${task}`, { status: 'todo', version: v2 });
  evs = (await list()).filter((e) => r.eventIds.includes(e.id));
  assert.ok(evs.every((e) => e.tasksDone === false));
});

test('이미 만든 입찰 일정 되살리기(277 소급) · 그냥 업무 연결은 숨기지 않음', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'B1141b', assigneeIds: [ctx.ownerId] });
  const task = r.taskIds[0];
  // 예전(이번 고침 전)에 넘긴 것처럼 연결을 지움
  await sql`delete from event_tasks where task_id = ${task}`;
  await ctx.owner.ok('PATCH', `/api/tasks/${task}`, { status: 'done' });
  let evs = (await list()).filter((e) => r.eventIds.includes(e.id));
  assert.ok(evs.every((e) => e.tasksDone === false), '연결이 없으면 예전처럼 남아 있음(고치기 전 문제)');

  const file = fs.readFileSync(path.join(process.cwd(), 'db/migrations/277_event_task_hide_done.sql'), 'utf8');
  await sql.unsafe(file);
  await sql.unsafe(file); // 두 번 돌려도 그대로
  const links = await sql`select role, hide_when_done from event_tasks where task_id = ${task}`;
  assert.deepEqual(links.map((x) => [x.role, x.hide_when_done]), [['link', true], ['link', true]]);
  evs = (await list()).filter((e) => r.eventIds.includes(e.id));
  assert.ok(evs.length === 2 && evs.every((e) => e.tasksDone === true), '소급 연결 뒤 숨김 대상');

  // 그냥 '기존 업무 연결'(hide_when_done 없음) — 업무가 끝나도 일정은 그대로
  const cal = (await sql`select id from calendars where type = 'company' and tenant = 'default' order by created_at limit 1`)[0].id;
  const ev = await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '주간 회의', start: `${addDays(today, 4)}T10:00:00+09:00`, end: `${addDays(today, 4)}T11:00:00+09:00` });
  const t2 = await ctx.owner.ok('POST', '/api/tasks', { title: '회의 안건 정리', assigneeId: ctx.ownerId, dueDate: addDays(today, 4) });
  await sql`insert into event_tasks (event_id, task_id, role, created_by) values (${ev.id}, ${t2.id}, 'link', ${ctx.ownerId})`;
  await ctx.owner.ok('PATCH', `/api/tasks/${t2.id}`, { status: 'done' });
  const meet = (await list()).find((e) => e.id === ev.id);
  assert.equal(meet.tasksDone, false, '그냥 연결은 지금처럼');
});

test('#1144 입찰 마감 일정을 옮기면 업무 마감도 · 업무 마감을 바꾸면 일정도 · 정기 작업은 사람이 옮긴 마감을 되돌리지 않고 공고 마감이 바뀔 때만 따라감', async () => {
  await put('procurement_notices', { id: 'B1144', title: '관리 용역', complex_name: '마감 옮김 단지', issuer: '시청', region: '경기', related: true, first_seen_at: today,
    site_briefing_at: `${addDays(today, 2)}T11:00`, deadline_at: `${addDays(today, 7)}T10:00` });
  const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'B1144', assigneeIds: [ctx.ownerId] });
  const task = r.taskIds[0];
  const due = async () => (await sql`select due_date::text d, to_char(due_time, 'HH24:MI') t, sales_ref from tasks where id = ${task}`)[0];
  assert.deepEqual([(await due()).d, (await due()).t], [addDays(today, 7), '10:00']);
  const evOf = async (re) => (await sql`select e.id, e.start_at, e.end_at, e.version from events e where e.id = any(${r.eventIds}::uuid[]) and e.title ~ ${re}`)[0];
  const close = await evOf('입찰 마감'), brief = await evOf('현장설명회');
  const dur = close.end_at - close.start_at;
  const tick = async () => { const x = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(x.status, 200); };

  // 캘린더에서 입찰 마감 일정을 하루 뒤 16:00 으로 옮김 → 업무 마감도
  const ns = new Date(`${addDays(today, 8)}T16:00:00+09:00`);
  await ctx.owner.ok('PATCH', `/api/events/${close.id}`, { start: ns.toISOString(), end: new Date(+ns + dur).toISOString(), version: close.version });
  let t = await due();
  assert.deepEqual([t.d, t.t, t.sales_ref.dueManual], [addDays(today, 8), '16:00', true], '일정을 옮기면 업무 마감이 따라가고 사람이 바꾼 마감으로 표시');
  // 현장설명회를 옮겨도 업무 마감은 그대로
  const nb = new Date(`${addDays(today, 3)}T11:00:00+09:00`);
  await ctx.owner.ok('PATCH', `/api/events/${brief.id}`, { start: nb.toISOString(), end: new Date(+nb + (brief.end_at - brief.start_at)).toISOString(), version: brief.version });
  t = await due(); assert.deepEqual([t.d, t.t], [addDays(today, 8), '16:00'], '현장설명회는 연결만 — 마감은 그대로');

  // 정기 작업(공고 마감 맞춤)이 되돌리지 않음
  await tick(); await tick();
  t = await due(); assert.deepEqual([t.d, t.t], [addDays(today, 8), '16:00'], '공고 마감이 그대로면 사람이 옮긴 마감을 둠');
  assert.equal(t.sales_ref.noticeDue, `${addDays(today, 7)} 10:00`, '마지막으로 본 공고 마감을 적어 둠');

  // 업무 화면에서 마감을 바꾸면 입찰 마감 일정도 옮겨짐
  await ctx.owner.ok('PATCH', `/api/tasks/${task}`, { dueDate: addDays(today, 6), dueTime: '15:00' });
  const moved = await evOf('입찰 마감');
  assert.equal(+moved.start_at, +new Date(`${addDays(today, 6)}T15:00:00+09:00`), '업무 마감 → 일정 시작');
  assert.equal(moved.end_at - moved.start_at, dur, '길이는 그대로');
  assert.equal(+(await evOf('현장설명회')).start_at, +nb, '현장설명회는 그대로');

  // 공고 자체의 마감이 바뀌면(정정) 업무·일정 모두 따라감
  await sql`update sales_src_rows set row = row || ${sql.json({ deadline_at: `${addDays(today, 10)}T14:00` })} where src_id = 'B1144'`;
  await tick(); await tick();
  t = await due();
  assert.deepEqual([t.d, t.t, t.sales_ref.dueManual ?? null, t.sales_ref.noticeDue], [addDays(today, 10), '14:00', null, `${addDays(today, 10)} 14:00`], '공고 정정 → 업무 마감 따라감, 사람 표시는 지움');
  assert.equal(+(await evOf('입찰 마감')).start_at, +new Date(`${addDays(today, 10)}T14:00:00+09:00`), '입찰 마감 일정도 공고 정정을 따라감');
});
