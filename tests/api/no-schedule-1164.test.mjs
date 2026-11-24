// #1164(대표 11/24 "영업시트에서 넘어온 업무 중 현설이 없거나 미팅이 없으면 스케줄을 잡으라는 표시"): needs_schedule · '일정 없음' 거르기
// 영업 출처(sales_ref) 열린 업무 + 연결 일정 없음 → 'any' · 공고에 현장설명회 '없음' → 'meeting' · 입찰 마감(날짜 맞춤) 일정만 있으면 여전히 표시
// 미팅을 잡거나 현장설명회 일정이 연결되면 사라짐 · 완료·보류·마감 지남·영업 출처 아님 = 표시 없음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const day = (n) => { const d = new Date(`${seoulToday()}T12:00:00+09:00`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('영업 출처 업무 일정 없음 표시 · 거르기 · 미팅을 잡으면 사라짐', async () => {
  const mk = async (title, ref, extra = {}) => {
    const t = await ctx.owner.ok('POST', '/api/tasks', { title, assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: day(5), ...extra });
    if (ref) await sql`update tasks set sales_ref = ${sql.json(ref)} where id = ${t.id}`;
    return t.id;
  };
  const ns = async (id) => (await ctx.owner.ok('GET', `/api/tasks/${id}`)).task.needs_schedule;
  const bid = await mk('입찰 업무', { kind: 'bid', id: 'N-1', name: '가나아파트 헬스장' });
  const none = await mk('현설 없음 공고', { kind: 'bid', id: 'N-2', name: '다라아파트', bidInfo: { briefingNone: true } });
  const plain = await mk('일반 업무', null);
  const lead = await mk('리드 후속', { kind: 'lead', id: 'L-1', name: '리드' });
  assert.equal(await ns(bid), 'any'); assert.equal(await ns(none), 'meeting'); assert.equal(await ns(plain), null); assert.equal(await ns(lead), 'any');

  // 입찰 마감(날짜 맞춤 sync) 일정만 연결 → 그대로 표시 · 현장설명회(sync 아님) 연결 → 사라짐
  const [cal] = await sql`select id from calendars where type = 'company' and tenant = 'default' order by created_at limit 1`;
  const ev = async (title) => (await sql`insert into events (calendar_id, title, start_at, end_at, created_by) values (${cal.id}, ${title}, now() + interval '3 days', now() + interval '3 days 1 hour', ${ctx.ownerId}) returning id`)[0].id;
  await sql`insert into event_tasks (event_id, task_id, role, sync) values (${await ev('[입찰] 입찰 마감')}, ${bid}, 'link', true)`;
  assert.equal(await ns(bid), 'any', '입찰 마감 일정은 현설·미팅이 아님');
  const list = await ctx.owner.ok('GET', '/api/tasks?view=all&noSchedule=1');
  const ids = list.tasks.map((t) => t.id);
  assert.ok(ids.includes(bid) && ids.includes(none) && ids.includes(lead) && !ids.includes(plain), '거르기');
  await sql`insert into event_tasks (event_id, task_id, role, sync) values (${await ev('[입찰] 현장설명회')}, ${bid}, 'link', false)`;
  assert.equal(await ns(bid), null, '현장설명회 일정이 연결되면 사라짐');

  // [일정 잡기] = 기존 미팅 잡기 → 사라짐
  await ctx.owner.ok('POST', `/api/tasks/${none}/meeting`, { location: '다라아파트 관리사무소', start: `${day(2)}T10:00:00+09:00`, end: `${day(2)}T11:00:00+09:00`, title: '현설 없음 공고' });
  assert.equal(await ns(none), null);

  // 완료·보류·마감 지남은 표시 없음
  await ctx.owner.ok('PATCH', `/api/tasks/${lead}`, { status: 'on_hold' });
  assert.equal(await ns(lead), null, '보류');
  const past = await mk('마감 지난 공고', { kind: 'bid', id: 'N-3', name: '지난' });
  await sql`update tasks set due_date = ${day(-1)} where id = ${past}`;
  assert.equal(await ns(past), null, '마감 지남');
  const done = await mk('끝난 공고', { kind: 'bid', id: 'N-4', name: '끝' });
  await ctx.owner.ok('PATCH', `/api/tasks/${done}`, { status: 'done' });
  assert.equal(await ns(done), null, '완료');
});
