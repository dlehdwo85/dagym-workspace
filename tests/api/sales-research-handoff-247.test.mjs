// 247차 #777·#778(대표 10/28 21:35): 후속조사 자동 묶음 기본 꺼짐 · 사람이 [후속조사 넘기기](카드·여러 개) → 업무 하나(담당 기본 = 담당자 지정 '영업 원천 · 시설', 바꿀 수 있음, 영업 밖 사람 안 됨)
// · 이미 후속조사 중이면 건너뜀 · 카드 '후속조사 중' · 완료 창 연락 결과(통화·직함·반응·미팅 약속 → 일정 · 다음 연락일 → 업무, 같은 값 다시 저장해도 한 번) · 통화 안 됨만이면 확인 못함
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'operating_facility_prospects', ${row.id}, ${sql.json({ facility_type: '아파트', region: '경기', first_seen_at: today, ...row })})`;
const hub = async () => Object.fromEntries((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=facilities')).items.map((x) => [x.id, x]));

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); // SALES_RESEARCH_WEEKLY 없음 = 기본(꺼짐)
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await put({ id: 'H1', name: '광교 넘김단지', household_count: 1500, office_phone: '031-247-0001' });
  await put({ id: 'H2', name: '동탄 넘김단지', household_count: 1200 });
  await put({ id: 'H3', name: '수원 그대로단지', household_count: 900 });
  await sql`insert into assignee_rules (tenant, kind, ref, primary_user_id) values ('default', 'sales_source', 'facility', ${ctx.staffA.id})`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('자동 묶음 기본 꺼짐 — 정기 실행이 후속조사 업무를 만들지 않음 · 머리 줄 auto=false', async () => {
  const d = await tick();
  assert.equal(d.salesResearch?.skipped, 'off', JSON.stringify(d.salesResearch));
  assert.equal((await sql`select count(*)::int n from sales_research where tenant = 'default'`)[0].n, 0);
  assert.equal((await ctx.owner.ok('GET', '/api/sales/research')).auto, false);
});

test('[후속조사 넘기기] 두 곳 → 업무 하나(담당 기본 = 담당자 지정 규칙) · 카드 후속조사 중 · 같은 곳 다시 넘기면 건너뜀 · 영업 밖 사람·없는 시설', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/research/handoff', { ids: ['H1', 'H2'] });
  assert.deepEqual([r.items, r.skipped.length, r.assigneeId], [2, 0, ctx.staffA.id]);
  const [t] = await sql`select title, description, assignee_id, due_date::text as due, space, sales_ref, requested_by from tasks where id = ${r.taskId}`;
  assert.deepEqual([t.title, t.assignee_id, t.due, t.space, t.sales_ref.kind, t.requested_by], ['[후속조사] 시설 2곳 — 연락(전화)', ctx.staffA.id, addDays(today, 7), 'sales', 'research', ctx.ownerId]);
  assert.match(t.description, /1\. 광교 넘김단지 \(경기 · 1,500세대\) · 관리사무소 031-247-0001/);
  assert.match(t.description, /계약 만료일은 알려 주면 적고, 몰라도 됩니다\. 개인 휴대폰 번호는 적지 않습니다/);
  const [n] = await sql`select title, link from notifications where user_id = ${ctx.staffA.id} and link = ${`/tasks/${r.taskId}`}`;
  assert.equal(n?.title, '후속조사: 시설 2곳 — 연락(전화)');
  const h = await hub();
  assert.deepEqual([h.H1.research?.status, h.H1.research?.taskId, h.H2.research?.status, h.H3.research ?? null], ['open', r.taskId, 'open', null]);
  const again = await ctx.owner.ok('POST', '/api/sales/research/handoff', { ids: ['H1', 'H3'], assigneeId: ctx.ownerId });
  assert.deepEqual([again.items, again.skipped.map((x) => x.id), again.assigneeId], [1, ['H1'], ctx.ownerId], '이미 후속조사 중이면 건너뜀 · 담당 바꾸기');
  assert.match(again.skipped[0].why, /^이미 후속조사 중\(담당 .+\)$/);
  assert.equal((await sql`select title from tasks where id = ${again.taskId}`)[0].title, '[후속조사] 수원 그대로단지 — 연락(전화)');
  assert.equal((await ctx.owner.req('POST', '/api/sales/research/handoff', { ids: ['H2'], assigneeId: ctx.staffB.id })).status, 400, '영업 밖 사람은 담당 안 됨');
  assert.equal((await ctx.owner.req('POST', '/api/sales/research/handoff', { ids: ['없는시설'] })).status, 404);
  assert.equal((await ctx.staffB.client.req('POST', '/api/sales/research/handoff', { ids: ['H2'] })).status, 404, '영업 밖 직원');
});

test('완료 창 연락 결과: 통화함·직함·반응·미팅 약속 → 일정 · 다음 연락일 → 업무(다시 저장해도 한 번) · 통화 안 됨만이면 확인 못함', async () => {
  const items = (await ctx.staffA.client.ok('GET', `/api/sales/research?task=${(await sql`select task_id from sales_research where src_id = 'H1'`)[0].task_id}`)).items;
  const id1 = items.find((x) => x.srcId === 'H1').id, id2 = items.find((x) => x.srcId === 'H2').id;
  const body = { call: '통화함', contactTitle: '관리소장', reaction: '관심 있음', meetingAt: `${addDays(today, 5)}T14:00`, nextDate: addDays(today, 10), note: '다음 주 방문' };
  const a = await ctx.staffA.client.ok('PATCH', `/api/sales/research/${id1}`, body);
  assert.equal(a.status, 'done');
  const [ev] = await sql`select title, to_char(start_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') s from events where id = ${a.result.meetingEventId}`;
  assert.deepEqual([ev.title, ev.s], ['[영업] 미팅 · 광교 넘김단지', `${addDays(today, 5)} 14:00`]);
  const [nt] = await sql`select title, due_date::text d, assignee_id, space from tasks where id = ${a.result.nextTaskId}`;
  assert.deepEqual([nt.title, nt.d, nt.assignee_id, nt.space], ['[영업] 광교 넘김단지 — 다음 연락', addDays(today, 10), ctx.staffA.id, 'sales']);
  const b = await ctx.staffA.client.ok('PATCH', `/api/sales/research/${id1}`, body);
  assert.deepEqual([b.result.meetingEventId, b.result.nextTaskId], [a.result.meetingEventId, a.result.nextTaskId], '같은 값으로 다시 저장해도 다시 만들지 않음');
  assert.equal((await sql`select count(*)::int n from events where title = '[영업] 미팅 · 광교 넘김단지' and deleted_at is null`)[0].n, 1);
  assert.equal((await ctx.staffA.client.ok('PATCH', `/api/sales/research/${id2}`, { call: '안 받음' })).status, 'none', '통화가 안 됐고 다른 값이 없으면 확인 못함');
  const h = await hub();
  assert.deepEqual([h.H1.research?.reaction, h.H1.research?.meetingAt, h.H1.research?.contactTitle], ['관심 있음', `${addDays(today, 5)}T14:00`, '관리소장']);
  assert.equal((await ctx.staffA.client.req('PATCH', `/api/sales/research/${id1}`, { meetingAt: '내일 두시' })).status, 400);
});
