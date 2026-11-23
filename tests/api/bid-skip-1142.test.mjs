// #1142·#1143(대표 11/24 위임): 입찰 안 함·공고 취소 정리 — 결정은 영업에서, 업무 쪽은 공통 [삭제]만
// ① 영업 [미참여](사유) → 열린 입찰 업무 휴지통 · 자동 일정(입찰 마감·현장설명회) 삭제 · 공고는 '미참여' 탭(사유) · [되돌리기] → 업무·일정 되살림, '입찰 진행'
// ② 업무 화면 공통 [삭제](사유) → 공고 '미참여(업무에서 삭제)' · 연결 자동 일정은 삭제 창 기본 체크 · 휴지통에서 되살리면 공고 이전 상태
// ③ 넘기지 않은 공고 상태를 '미참여'로 → 이 공고로 만든 자동 업무 휴지통(완료 아님)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${String(row.id)}, ${sql.json(row)})`;
const rec = async (id) => (await sql`select status, data from sales_work_records where tenant = 'default' and ref_id = ${id} order by updated_at desc limit 1`)[0];
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  for (const [id, n] of [['S1', '미참여 단지'], ['S2', '삭제 단지'], ['S3', '넘기지 않은 단지']]) await put({ id, title: '체육시설 위탁', complex_name: n, issuer: '시청', related: true, first_seen_at: today, site_briefing_at: `${addDays(today, 2)}T14:00`, deadline_at: `${addDays(today, 8)}T10:00` });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('① [미참여](사유) → 업무 휴지통·일정 삭제·미참여 탭 · [되돌리기] → 되살림', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'S1', assigneeIds: [ctx.ownerId] });
  const s = await ctx.owner.ok('POST', '/api/sales/work/bid-skip', { id: 'S1', reason: '일정이 맞지 않음' });
  assert.deepEqual([s.status, s.tasks, s.events], ['미참여', 1, 2]);
  assert.ok((await sql`select deleted_at from tasks where id = ${r.taskIds[0]}`)[0].deleted_at, '업무는 휴지통');
  assert.equal((await sql`select count(*)::int n from events where id = any(${r.eventIds}::uuid[]) and deleted_at is null`)[0].n, 0, '자동 일정 삭제');
  const w = await rec('S1'); assert.deepEqual([w.status, w.data.skip_reason, w.data.bid_result], ['미참여', '일정이 맞지 않음', 'skipped']);
  const L = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=noentry');
  const card = (L.items ?? []).find((x) => String(x.id) === 'S1');
  assert.ok(card, '미참여 탭에 있음'); assert.equal(card.noEntry?.reason, '일정이 맞지 않음');
  assert.ok(!((await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working')).items ?? []).some((x) => String(x.id) === 'S1'), '다른 탭에서는 빠짐');
  assert.equal((await ctx.owner.req('POST', '/api/sales/work/bid-skip', { id: 'S1' })).status, 400, '두 번은 안 됨');
  const u = await ctx.owner.ok('POST', '/api/sales/work/bid-skip', { id: 'S1', undo: true });
  assert.deepEqual([u.status, u.tasks, u.events], ['입찰 진행', 1, 2]);
  assert.equal((await sql`select deleted_at from tasks where id = ${r.taskIds[0]}`)[0].deleted_at, null);
  assert.equal((await sql`select count(*)::int n from events where id = any(${r.eventIds}::uuid[]) and deleted_at is null`)[0].n, 2);
});

test('② 업무 화면 공통 [삭제](사유) → 공고 미참여(업무에서 삭제) · 휴지통에서 되살리면 이전 상태', async () => {
  const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'S2', assigneeIds: [ctx.ownerId] });
  const plan = await ctx.owner.ok('GET', `/api/tasks/${r.taskIds[0]}/delete-plan`);
  assert.equal(plan.events.filter((e) => e.checked).length, 2, '자동 일정은 기본 체크(같이 지움)');
  const del = await ctx.owner.ok('DELETE', `/api/tasks/${r.taskIds[0]}?events=default&reason=${encodeURIComponent('중복 공고')}`);
  assert.equal(del.notice?.status, '미참여'); assert.equal(del.eventsDeleted, 2);
  const w = await rec('S2'); assert.equal(w.status, '미참여'); assert.equal(w.data.skip_reason, '업무에서 삭제 — 중복 공고');
  const [act] = await sql`select changes from activities where entity_id = ${r.taskIds[0]} and action = 'deleted' order by id desc limit 1`;
  assert.equal(act.changes?.reason, '중복 공고');
  const back = await ctx.owner.ok('POST', `/api/tasks/${r.taskIds[0]}/restore`, {});
  assert.equal(back.noticesBack, 1); assert.equal(back.eventsRestored, 2);
  assert.equal((await rec('S2')).status, '입찰 진행');
});

test('③ 넘기지 않은 공고를 미참여로 → 자동 업무는 휴지통(완료 아님)', async () => {
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'S3', status: '연락중' });
  const [t] = await sql`select id from tasks where sales_ref->>'kind' = 'bid' and sales_ref->>'id' = 'S3' and deleted_at is null`;
  assert.ok(t);
  const r = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'S3', status: '미참여', reason: '수익성 낮음' });
  assert.equal(r.task.action, 'trashed');
  const [x] = await sql`select status, deleted_at from tasks where id = ${t.id}`;
  assert.ok(x.deleted_at && x.status !== 'done', '휴지통(완료 아님)');
  assert.equal((await rec('S3')).data.bid_skip?.reason, '수익성 낮음');
});
