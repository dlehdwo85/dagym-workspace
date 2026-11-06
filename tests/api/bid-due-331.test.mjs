// 331차(대표 11/02 15:5x "한화포레나 평택화양·광명 푸르지오 센트베르 입찰 일정 마감일이 오늘인데 어제로 설정되어 있음 … 업무 마감일은 입찰 마감일과 동일하게 … 전수조사해서 수정"):
// 공고에서 온 업무는 어느 경로든 마감 = 공고 입찰 마감 일시 — 정기 실행(bidDueAlign)이 열린 공고 업무(sales_ref.kind = bid · 공고에서 넘어온 리드의 업무)를 공고 마감에 맞춤(첫 실행 = 전수 보정, 공고 정정도 따라감)
// · 상태 버튼 자동 업무는 다음 연락일보다 공고 마감 우선 · 합치기(327차)는 공고 업무면 공고 마감, 아니면 가장 늦은 마감 · 함께 담당도 마감 연장 요청(로컬 ②)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${String(row.id)}, ${sql.json(row)})`;
const patch = (id, p) => sql`update sales_src_rows set row = row || ${sql.json(p)} where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const due = async (id) => { const [r] = await sql`select due_date::text as d, to_char(due_time, 'HH24:MI') as t from tasks where id = ${id}`; return [r.d, r.t]; };
const mk = (title, extra = {}) => ctx.owner.ok('POST', '/api/tasks', { title, assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, space: 'sales', ...extra });

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await put({ id: 'D1', title: '커뮤니티시설 위탁운영 용역', complex_name: '광명 시험단지', issuer: '광명시', related: true, first_seen_at: today, deadline_at: `${addDays(today, 5)}T14:00`, opening_at: `${addDays(today, 5)}T15:00` });
  await put({ id: 'D2', title: '체육시설 운영 용역', complex_name: '평택 시험단지', issuer: '평택시', related: true, first_seen_at: today, deadline_at: `${addDays(today, 9)}T10:00` });
  await put({ id: 'D3', title: '지난 공고', complex_name: '지난 단지', issuer: '시청', related: true, first_seen_at: addDays(today, -20), deadline_at: `${addDays(today, -3)}T10:00`, opening_at: `${addDays(today, -2)}T10:00` });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('정기 실행 bidDueAlign: 예전 D-1 로 남은 공고 업무(넘기기 경로 그대로 흉내) → 공고 마감 일시 · 공고에서 넘어온 리드의 업무도 · 사람이 옮긴 것도 공고 마감으로 · 기록(활동·app_settings) · 다시 돌리면 0건 · 공고 정정 → 따라감 · 일정 다 지난 공고는 그대로', async () => {
  const legacy = await mk('[입찰] 광명 시험단지 커뮤니티시설 위탁운영 용역');
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: 'D1', name: '광명 시험단지', handoff: true })}, due_date = ${addDays(today, 4)}, due_time = '14:00' where id = ${legacy.id}`;
  const [lead] = await sql`insert into sales_leads (tenant, name, status, src) values ('default', '평택 시험단지(공고 리드)', '연락중', ${sql.json({ from: 'bid', id: 'D2', handoff: true })}) returning id`;
  const leadTask = await mk('[입찰] 평택 시험단지 — 다음 연락');
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'lead', id: lead.id, name: '평택 시험단지' })}, lead_id = ${lead.id}, due_date = ${addDays(today, 2)} where id = ${leadTask.id}`;
  const moved = await mk('[입찰] 광명 시험단지 — 사람이 옮긴 마감');
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: 'D1' })}, due_date = ${addDays(today, 12)} where id = ${moved.id}`;
  const past = await mk('[입찰] 지난 단지 — 결과 정리');
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: 'D3' })}, due_date = ${addDays(today, 1)} where id = ${past.id}`;
  const done = await mk('[입찰] 광명 시험단지 — 끝난 업무');
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: 'D1' })}, due_date = ${addDays(today, 4)}, status = 'done', completed_at = now() where id = ${done.id}`;
  const plain = await mk('일반 업무(공고 아님)', { dueDate: addDays(today, 4) });

  const t1 = await tick();
  assert.equal(t1.bidDueAlign.moved, 3, JSON.stringify(t1.bidDueAlign));
  assert.deepEqual(await due(legacy.id), [addDays(today, 5), '14:00'], 'D-1 → 공고 마감 당일·시각');
  assert.deepEqual(await due(leadTask.id), [addDays(today, 9), '10:00'], '공고에서 넘어온 리드의 업무도 그 공고 마감');
  assert.deepEqual(await due(moved.id), [addDays(today, 5), '14:00'], '사람이 뒤로 옮긴 것도 공고 마감(대표: 동일하게)');
  assert.deepEqual(await due(past.id), [addDays(today, 1), null], '일정이 다 지난 공고는 그대로');
  assert.deepEqual(await due(done.id), [addDays(today, 4), null], '끝난 업무는 안 건드림');
  assert.deepEqual(await due(plain.id), [addDays(today, 4), null], '공고 아닌 업무는 그대로');
  const acts = await sql`select changes from activities where entity_type = 'task' and entity_id = ${legacy.id} and action = 'updated' and changes->>'reason' = 'bid_deadline_align'`;
  assert.equal(acts.length, 1); assert.deepEqual(acts[0].changes.dueDate, { from: addDays(today, 4), to: addDays(today, 5) });
  const [rec] = await sql`select value from app_settings where key = 'bid_due_align_331'`;
  assert.equal(rec.value.moved, 3); assert.ok(rec.value.changed.some((c) => c.id === legacy.id && c.from === addDays(today, 4) && c.to === addDays(today, 5)), '첫 실행 전수 보정 기록');

  assert.equal((await tick()).bidDueAlign.moved, 0, '맞춘 뒤엔 0건');
  await patch('D1', { deadline_at: `${addDays(today, 7)}T11:00` });
  assert.equal((await tick()).bidDueAlign.moved, 2, '공고 정정 → D1 업무 2건 따라감');
  assert.deepEqual(await due(legacy.id), [addDays(today, 7), '11:00']);
  assert.deepEqual(await due(moved.id), [addDays(today, 7), '11:00']);
  const [rec2] = await sql`select value from app_settings where key = 'bid_due_align_331'`; assert.equal(rec2.value.moved, 3, '기록은 첫 실행 것 그대로');
});

test('상태 버튼 자동 업무(syncSalesTask): 다음 연락일을 적어도 마감 = 공고 입찰 마감 일시 · 다음 연락일 바꿔도 그대로 · 일정 다 지난 공고는 다음 연락일', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'D2', status: '연락중', nextDate: addDays(today, 1) });
  assert.equal(r.task.action, 'created');
  assert.deepEqual(await due(r.task.taskId), [addDays(today, 9), '10:00'], '다음 연락일(+1)이 아니라 공고 마감(+9 10:00)');
  const r2 = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'D2', nextDate: addDays(today, 3) });
  assert.equal(r2.task.action, 'none'); assert.deepEqual(await due(r.task.taskId), [addDays(today, 9), '10:00']);
  const r3 = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'D3', status: '연락중', nextDate: addDays(today, 2) });
  assert.deepEqual(await due(r3.task.taskId), [addDays(today, 2), null], '마감·개찰이 다 지난 공고는 다음 연락일');
});

test('합치기(327차 dupes): 공고 업무끼리 합치면 마감 = 공고 마감(가장 이른 것 아님) · 일반 업무끼리는 가장 늦은 마감', async () => {
  const a = await mk('[입찰] 광명 시험단지 서류 준비', { dueDate: addDays(today, 3) });
  const b = await ctx.owner.ok('POST', '/api/tasks', { title: '[입찰] 광명 시험단지 서류 준비', assigneeId: ctx.managerA.id, orgUnitId: ctx.siteA, approvalRequired: false, space: 'sales', dueDate: addDays(today, 6) });
  await sql`update tasks set sales_ref = ${sql.json({ kind: 'bid', id: 'D1' })} where id in (${a.id}, ${b.id})`;
  const m = await ctx.owner.ok('POST', '/api/tasks/dupes', { sets: [[a.id, b.id]] });
  assert.equal(m.merged.length, 1, JSON.stringify(m));
  assert.deepEqual(await due(m.merged[0].keep), [addDays(today, 7), '11:00'], '합친 업무 마감 = 공고 마감(정정 뒤 +7 11:00)');
  const c = await mk('월간 보고서 취합', { dueDate: addDays(today, 2) });
  const d = await ctx.owner.ok('POST', '/api/tasks', { title: '월간 보고서 취합', assigneeId: ctx.managerA.id, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: addDays(today, 8) });
  const m2 = await ctx.owner.ok('POST', '/api/tasks/dupes', { sets: [[c.id, d.id]] });
  assert.equal(m2.merged.length, 1, JSON.stringify(m2));
  assert.deepEqual(await due(m2.merged[0].keep), [addDays(today, 8), null], '일반 업무는 가장 늦은 마감');
  const [act] = await sql`select changes from activities where entity_id = ${m2.merged[0].keep} and action = 'merged'`;
  assert.equal(act.changes.dueRule, 'latest');
});

test('함께 담당도 마감 연장 가능(로컬 ②) → 378차: 함께 담당·주 담당·요청자 모두 승인 없이 바로(사유 남김)', async () => {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '연장 요청 시험', assigneeId: ctx.staffA.id, coAssigneeIds: [ctx.managerA.id], orgUnitId: ctx.siteA, approvalRequired: false, dueDate: addDays(today, 2) });
  const co = await ctx.managerA.client.ok('POST', `/api/tasks/${t.id}/extend`, { toDate: addDays(today, 4), reason: '현장설명회 뒤 서류 보완' });
  assert.deepEqual([co.applied, co.as], [true, '담당자'], '함께 담당 → 바로 연장');
  assert.deepEqual(await due(t.id), [addDays(today, 4), null]);
  assert.equal((await sql`select count(*)::int c from notifications where user_id = ${ctx.ownerId} and entity_id = ${t.id} and title like '마감 연장:%' and body like '%(사유: 현장설명회 뒤 서류 보완)'`)[0].c, 1, '요청자에게 사유와 함께 알림');
  const me = await ctx.staffA.client.ok('POST', `/api/tasks/${t.id}/extend`, { toDate: addDays(today, 5), reason: '자료 늦음' });
  assert.equal(me.applied, true, '주 담당도 바로');
  assert.equal((await sql`select count(*)::int c from task_due_extensions where task_id = ${t.id} and status = 'pending'`)[0].c, 0, '대기 요청 없음');
  const boss = await ctx.owner.ok('POST', `/api/tasks/${t.id}/extend`, { toDate: addDays(today, 6), reason: '요청자 바로 연장' });
  assert.equal(boss.applied, true); assert.deepEqual(await due(t.id), [addDays(today, 6), null]);
});
