// 277차 #815 지원사업 업무 회수: [관심]·[신청 준비]·[업무로] 뒤 회수 → 업무는 휴지통 · 진행 기록은 처음 상태(목록·상세에서 사라짐) · 기록 '회수' · 담당 알림
// · 다른 사람이 업무에 댓글·첨부·체크를 남겼으면 needsConfirm 먼저 · 권한(넘긴 사람·담당·관리자) · 다시 [관심] 누르면 같은 행을 살림(결과 칸은 비움)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';
import { startFakeGoogle } from '../fake-google.mjs';

let srv, ctx, sql, fg;
const d = (n) => addDays(seoulToday(), n);
const ins = (o) => sql`insert into support_programs ${sql({ source: 'bizinfo', regions: ['경기'], nationwide: false, hashtags: [], attachments: sql.json([]), apply_end: d(20), target: '중소기업', agency: '경기도', ...o })} returning id`.then((r) => r[0].id);
const workOf = async (p) => (await sql`select id, status, owner_id, task_id, withdrawn_at, withdrawn_by, applied_at, result_memo from support_work where program_id = ${p}`)[0];
const taskOf = async (id) => (await sql`select id, deleted_at, assignee_id from tasks where id = ${id}`)[0];

before(async () => {
  await resetDb(); fg = await startFakeGoogle(); srv = await startServer({ SUPPORT_WEEKLY: 'off' }); sql = testDb(); ctx = await bootstrap();
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  for (const k of ['staffA', 'staffB']) await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx[k].id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/sales/support/profile', { regionSido: '경기', regionSigungu: '용인시', founded: d(-1735), size: '소기업', employees: 8, industries: ['소프트웨어'], keywords: [], certs: [], brands: ['다짐'], interests: ['마케팅'], excludes: [], memo: '', autoAi: false });
});
after(async () => { srv?.proc.kill(); fg?.server.close(); await sql?.end(); });

test('[관심] 직후 되돌리기 = 회수: 업무 휴지통 · 진행 기록 처음 상태 · 기록 회수 · 다시 [관심]이면 같은 행 살림', async () => {
  const p = await ins({ source_id: 'W1', title: '[경기] 마케팅 지원 사업' });
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'interest' });
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { appliedAt: d(-1), resultMemo: '서류 통과' });
  const w0 = await workOf(p); assert.ok(w0.task_id);
  const r = await ctx.owner.ok('POST', `/api/sales/support/${p}/withdraw`, { confirm: true });
  assert.equal(r.withdrawn, true); assert.equal(r.taskId, w0.task_id);
  assert.equal(r.view.item.work, null, '상세: 진행 없음'); assert.equal(r.view.task ?? null, null);
  const w1 = await workOf(p);
  assert.ok(w1.withdrawn_at); assert.equal(w1.withdrawn_by, ctx.ownerId); assert.equal(w1.task_id, null); assert.equal(w1.applied_at, null); assert.equal(w1.result_memo, null);
  assert.ok((await taskOf(w0.task_id)).deleted_at, '업무는 휴지통');
  const [lg] = await sql`select from_status, to_status, note from support_work_log where work_id = ${w0.id} order by id desc limit 1`;
  assert.deepEqual([lg.from_status, lg.to_status], ['interest', 'withdrawn']); assert.match(lg.note, /업무 회수/);
  const L = (await ctx.owner.ok('GET', '/api/sales/support?tab=all&limit=200&sort=new&dd=all&kind=all')).items.find((x) => x.id === p);
  assert.equal(L.work, null, '목록: 진행 없음(처음 상태)');
  assert.equal((await ctx.owner.req('POST', `/api/sales/support/${p}/withdraw`, {})).status, 400, '두 번 회수는 안 됨');
  // 다시 [관심] → 같은 행(기록 이어짐) · 새 업무 · 결과 칸 비어 있음
  const back = await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'interest' });
  const w2 = await workOf(p);
  assert.equal(w2.id, w0.id); assert.equal(w2.withdrawn_at, null); assert.ok(w2.task_id && w2.task_id !== w0.task_id); assert.equal(back.item.work.status, 'interest'); assert.equal(back.item.work.appliedAt, null);
  assert.equal(Number((await sql`select count(*)::int n from audit_logs where action = 'support.withdraw'`)[0].n), 1);
});

test('[업무로](다른 담당) 뒤 회수: 담당이 댓글을 남겼으면 needsConfirm → 확인 뒤 회수 · 담당 알림 · 업무 상세 경로(담당이 직접 회수)', async () => {
  const p = await ins({ source_id: 'W2', title: '[경기] 청년 고용 지원' });
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'preparing', ownerId: ctx.staffA.id });
  const w = await workOf(p); assert.equal((await taskOf(w.task_id)).assignee_id, ctx.staffA.id);
  await ctx.staffA.client.ok('POST', `/api/tasks/${w.task_id}/comments`, { body: '서류 준비 시작했습니다' });
  const ask = await ctx.owner.ok('POST', `/api/sales/support/${p}/withdraw`, {});
  assert.equal(ask.needsConfirm, true); assert.match(ask.message, /댓글 1개/); assert.equal((await workOf(p)).withdrawn_at, null, '묻기만 하고 그대로');
  assert.equal((await taskOf(w.task_id)).deleted_at, null);
  const r = await ctx.owner.ok('POST', `/api/sales/support/${p}/withdraw`, { confirm: true });
  assert.equal(r.withdrawn, true); assert.ok((await taskOf(w.task_id)).deleted_at);
  const [n] = await sql`select title, link from notifications where user_id = ${ctx.staffA.id} and title like '지원사업 업무 회수:%'`;
  assert.ok(n, '담당 알림'); assert.equal(n.link, `/s/sales/support?id=${p}`);
  assert.equal(Number((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and title like '지원사업 업무 회수:%'`)[0].n), 0, '회수한 본인은 알림 없음');
  // 담당이 업무 상세 [지원사업으로 회수] — 자기 업무라 다른 사람 흔적 없음 → 바로 회수
  const p2 = await ins({ source_id: 'W3', title: '[경기] 수출 바우처' });
  await ctx.owner.ok('POST', `/api/sales/support/${p2}/work`, { status: 'preparing', ownerId: ctx.staffA.id });
  const t2 = (await workOf(p2)).task_id;
  const task = await ctx.staffA.client.ok('GET', `/api/tasks/${t2}`);
  assert.equal(task.task.sales_ref.kind, 'support'); assert.equal(task.task.sales_ref.id, p2);
  const r2 = await ctx.staffA.client.ok('POST', `/api/sales/support/${task.task.sales_ref.id}/withdraw`, {});
  assert.equal(r2.withdrawn, true); assert.ok((await taskOf(t2)).deleted_at);
  assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and title like ${'지원사업 업무 회수:%수출%'}`).length === 0, '담당 본인이 회수하면 담당 알림 없음');
});

test('권한: 넘긴 사람·담당·관리자만 — 관계없는 영업 공간 직원은 403 · 영업 공간 밖 사람은 막힘', async () => {
  const p = await ins({ source_id: 'W4', title: '[경기] 스마트공장 지원' });
  await ctx.owner.ok('POST', `/api/sales/support/${p}/work`, { status: 'preparing', ownerId: ctx.staffA.id });
  const no = await ctx.staffB.client.req('POST', `/api/sales/support/${p}/withdraw`, { confirm: true });
  assert.equal(no.status, 403); assert.match(JSON.stringify(no.body), /넘긴 사람·담당·관리자만/);
  assert.notEqual((await ctx.managerA.client.req('POST', `/api/sales/support/${p}/withdraw`, { confirm: true })).status, 200, '영업 공간 밖');
  assert.equal((await workOf(p)).withdrawn_at, null);
  // 직원이 넘긴 것은 넘긴 직원이 회수 가능
  const p2 = await ins({ source_id: 'W5', title: '[경기] 디자인 바우처' });
  await ctx.staffB.client.ok('POST', `/api/sales/support/${p2}/work`, { status: 'interest' });
  assert.equal((await ctx.staffB.client.ok('POST', `/api/sales/support/${p2}/withdraw`, { confirm: true })).withdrawn, true);
});
