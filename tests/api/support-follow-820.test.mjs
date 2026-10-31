// 281차 #820(대표 10/31 "진행중인 지원사업도 업무로 넘길 수 있도록 담당자 설정해서"): 신청 완료 → [업무로] = 고른 담당에게 '결과 확인' 업무(체크리스트) ·
// 선정으로 바꾸면 결과 확인 업무는 끝나고, [업무로] = '협약·정산' 업무 · 같은 단계에서 두 번 눌러도 1건 · 기록 저장은 이어 만든 업무를 안 끝냄 ·
// 담당을 바꾸면 열린 업무도 넘김 · 탈락·포기는 업무로 안 됨 · 목록·상세 taskOpen · 회수(#815)는 이어 만든 업무도 휴지통
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fg;
const d = (n) => addDays(seoulToday(), n);
const ins = (o) => sql`insert into support_programs ${sql({ source: 'bizinfo', regions: ['경기'], nationwide: false, hashtags: [], attachments: sql.json([]), apply_end: d(20), target: '중소기업', agency: '경기도', ...o })} returning id`.then((r) => r[0].id);
const workOf = async (p) => (await sql`select id, status, owner_id, task_id from support_work where program_id = ${p}`)[0];
const taskOf = async (id) => (await sql`select id, title, status, assignee_id, deleted_at, sales_ref, description from tasks where id = ${id}`)[0];
const items = async (id) => (await sql`select text from task_checklist_items where task_id = ${id} order by sort`).map((x) => x.text);

before(async () => {
  await resetDb(); fg = await startFakeGoogle(); srv = await startServer({ SUPPORT_WEEKLY: 'off' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  for (const k of ['staffA', 'staffB']) await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx[k].id, spaces: ['sales'] });
});
after(async () => { srv?.proc.kill(); fg?.server.close(); await sql?.end(); });

test('신청 완료 → [업무로] 결과 확인 · 선정 → 결과 확인 끝 · [업무로] 협약·정산 · 한 번만 · 담당 바꾸면 넘김', async () => {
  const p = await ins({ source_id: 'F1', title: '[경기] 스마트 공장 지원 사업' });
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'preparing', ownerId: ctx.staffA.id });
  const prep = (await workOf(p)).task_id;
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'applied' });
  assert.equal((await taskOf(prep)).status, 'done', '신청 준비 업무는 신청 완료로 끝');
  let v = await ctx.owner.ok('GET', `/api/sales/support/${p}`);
  assert.equal(v.item.work.taskOpen, null, '열린 업무 없음 → [업무로] 보임');
  // [업무로] — 담당 박직원으로 바꾸며
  v = await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { task: true, ownerId: ctx.staffB.id });
  const w1 = await workOf(p); assert.notEqual(w1.task_id, prep);
  const t1 = await taskOf(w1.task_id);
  assert.match(t1.title, /— 결과 확인$/); assert.equal(t1.assignee_id, ctx.staffB.id); assert.equal(t1.status, 'todo');
  assert.deepEqual([t1.sales_ref.kind, t1.sales_ref.stage], ['support', 'result']);
  assert.match(t1.description, /신청일: \d{4}-\d{2}-\d{2}/);
  assert.equal((await items(t1.id)).length, 3);
  assert.equal(v.item.work.taskOpen, 'result'); assert.equal(v.task.id, t1.id);
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.staffB.id} and entity_id = ${t1.id}`)[0].n >= 1, true, '담당 알림');
  // 두 번 눌러도 1건 · 기록 저장은 안 끝냄
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { task: true });
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { resultMemo: '서류 심사 중' });
  assert.equal((await workOf(p)).task_id, t1.id); assert.equal((await taskOf(t1.id)).status, 'todo');
  assert.equal((await sql`select count(*)::int n from tasks where sales_ref->>'id' = ${p} and deleted_at is null`)[0].n, 2);
  // 담당 바꾸면 열린 업무도 넘김
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { ownerId: ctx.staffA.id });
  assert.equal((await taskOf(t1.id)).assignee_id, ctx.staffA.id);
  // 선정 → 결과 확인 업무 끝 · 목록에서 [업무로] 다시 보임 · 협약·정산
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'selected', amountAwarded: '2,000만원' });
  assert.equal((await taskOf(t1.id)).status, 'done');
  const L = (await ctx.owner.ok('GET', '/api/sales/support?tab=results&limit=200&dd=all&kind=all')).items.find((x) => x.id === p);
  assert.equal(L.work.status, 'selected'); assert.equal(L.work.taskOpen, null);
  await ctx.staffA.client.ok('POST', `/api/sales/support/${p}/work`, { task: true });
  const t2 = await taskOf((await workOf(p)).task_id);
  assert.match(t2.title, /— 협약·정산$/); assert.equal(t2.sales_ref.stage, 'contract'); assert.equal(t2.assignee_id, ctx.staffA.id);
  assert.match(t2.description, /선정 금액: 2,000만원/);
  assert.ok((await items(t2.id)).includes('정산 서류 제출·자부담 확인'));
  const lg = await sql`select to_status, note from support_work_log where work_id = ${w1.id} and note like '업무로%' order by id`;
  assert.deepEqual(lg.map((x) => x.note), ['업무로: 결과 확인', '업무로: 협약·정산']);
  // 회수(#815) — 이어 만든 업무도 휴지통
  await ctx.owner.ok('POST', `/api/sales/support/${p}/withdraw`, { confirm: true });
  assert.ok((await taskOf(t2.id)).deleted_at);
});

test('탈락·포기는 업무로 안 됨 · 관심·준비는 기존 업무 그대로', async () => {
  const p = await ins({ source_id: 'F2', title: '[경기] 수출 바우처' });
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'applied' });
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'rejected' });
  assert.equal((await ctx.owner.req('POST', `/api/sales/support/${p}/work`, { task: true })).status, 400);
  const q = await ins({ source_id: 'F3', title: '[경기] 디자인 지원' });
  await ctx.owner.ok('POST', `/api/sales/support/${q}/work`, { status: 'interest' });
  const a = (await workOf(q)).task_id;
  await ctx.owner.ok('POST', `/api/sales/support/${q}/work`, { task: true });
  assert.equal((await workOf(q)).task_id, a, '관심 단계는 기존 업무 그대로');
});
