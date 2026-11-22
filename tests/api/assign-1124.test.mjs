// #1124(대표 11/22 '영업관리나 마케팅관리에서 업무로 넘길 때 담당자 지정 — 입찰처럼'): 담당 후보(공간 권한 함께) · 영업 일괄 넘기기 · 마케팅 홈 제안 · 전화 문의 → 고른 사람이 주 담당, 나머지 공동
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql, tenant;
const today = seoulToday();
const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
const co = async (taskId) => (await sql`select user_id from task_assignees where task_id = ${taskId}`).map((r) => r.user_id);
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  await put('building_sales_pipeline', { id: 'B1', name: '판교 새단지', household_count: 1200, region: '경기', first_seen_at: today });
  await put('building_sales_pipeline', { id: 'B2', name: '광교 새단지', household_count: 800, region: '경기', first_seen_at: today });
  await put('procurement_notices', { id: 'N1', title: '성남시 체육시설 위탁운영', issuer: '성남시청', region: '경기', related: true, first_seen_at: today, deadline_at: `${addDays(today, 5)}T10:00:00+09:00`, status: '공고중' });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales', 'marketing'] });
});
after(async () => { if (process.env.DUMP_SERVER_LOG) console.log(srv.log().split('\n').filter((l) => /error|Error|at /.test(l)).slice(-40).join('\n')); srv?.proc.kill(); await sql?.end(); });

describe('#1124 담당 고르기', () => {
  test('담당 후보: 회사 사람 전체 + 공간 권한(inSpace) · 나 먼저 · 원천 담당 규칙이 기본 · 공간 밖 사람 404', async () => {
    const m = await ctx.owner.ok('GET', '/api/spaces/people?space=marketing');
    assert.equal(m.me, ctx.ownerId); assert.equal(m.people[0].id, ctx.ownerId, '나 먼저');
    const by = Object.fromEntries(m.people.map((p) => [p.id, p.inSpace]));
    assert.deepEqual([by[ctx.ownerId], by[ctx.staffA.id], by[ctx.staffB.id]], [true, true, false], '권한 없는 사람도 목록에(회색)');
    assert.equal(m.suggested, null);
    assert.equal((await ctx.owner.req('GET', '/api/spaces/people?space=nope')).status, 400);
    assert.equal((await ctx.staffB.client.req('GET', '/api/spaces/people?space=sales')).status, 404, '공간 밖 사람은 후보도 못 봄');
    await ctx.owner.ok('PUT', '/api/admin/assignees', { kind: 'sales_source', ref: 'building', primaryUserId: ctx.staffA.id });
    assert.equal((await ctx.owner.ok('GET', '/api/spaces/people?space=sales&kind=building')).suggested, ctx.staffA.id, '원천 담당 규칙이 기본 선택');
    assert.equal((await ctx.owner.ok('GET', '/api/spaces/people?space=sales&kind=bid')).suggested, null, '규칙 없는 원천은 기본 없음(화면은 나)');
  });

  test('영업 일괄 넘기기: 고른 담당(처음 = 주 담당·나머지 공동) · 다음 연락일 · 입찰은 입찰 업무 · 공간 밖 담당은 실패로', async () => {
    const r = await ctx.owner.ok('POST', '/api/sales/work/bulk', { kind: 'building', ids: ['B1', 'B2'], status: '연락중', nextDate: addDays(today, 2), assigneeIds: [ctx.staffA.id, ctx.ownerId], note: '이번 주 안에' });
    assert.deepEqual([r.tasks, r.results.every((x) => x.ok)], [2, true]);
    const leads = await sql`select name, owner_id, next_contact_date::text as next, memo from sales_leads where tenant = ${tenant} and src->>'from' = 'building' order by name`;
    assert.deepEqual(leads.map((l) => [l.name, l.owner_id, l.next]), [['광교 새단지', ctx.staffA.id, addDays(today, 2)], ['판교 새단지', ctx.staffA.id, addDays(today, 2)]]);
    assert.ok(leads[0].memo.includes('이번 주 안에'));
    const [t] = await sql`select id, assignee_id, space, title, due_date::text as due from tasks where sales_ref->>'kind' = 'building' and sales_ref->>'id' = 'B1' and deleted_at is null`;
    assert.deepEqual([t.assignee_id, t.space, await co(t.id), t.due], [ctx.staffA.id, 'sales', [ctx.ownerId], addDays(today, 2)], '주 담당 A · 공동 대표 · 마감 = 고른 다음 연락일');
    const b = await ctx.owner.ok('POST', '/api/sales/work/bulk', { kind: 'bid', ids: ['N1'], status: '연락중', assigneeIds: [ctx.staffA.id] });
    assert.deepEqual([b.tasks, b.results[0].ok], [1, true]);
    const [bt] = await sql`select assignee_id, title from tasks where sales_ref->>'kind' = 'bid' and sales_ref->>'id' = 'N1' and deleted_at is null`;
    assert.ok(bt.title.startsWith('[입찰]'), bt.title); assert.equal(bt.assignee_id, ctx.staffA.id);
    await put('building_sales_pipeline', { id: 'B3', name: '동탄 새단지', region: '경기', first_seen_at: today });
    const bad = await ctx.owner.ok('POST', '/api/sales/work/bulk', { kind: 'building', ids: ['B3'], status: '연락중', assigneeIds: [ctx.staffB.id] });
    assert.equal(bad.results[0].ok, false); assert.match(bad.results[0].error, /영업 공간/);
    const old = await ctx.owner.ok('POST', '/api/sales/work/bulk', { kind: 'building', ids: ['B3'], status: '연락중' });
    assert.equal(old.results[0].ok, true, '담당을 안 고르면 예전처럼(상태만 바꾸고 업무)');
  });

  test('마케팅 홈 제안 → 업무: 고른 담당 · 전화 문의 → 영업 리드로: 고른 담당', async () => {
    await sql`insert into mkt_calls (tenant, phone, created_by) values (${tenant}, '010-1124-0000', ${ctx.ownerId})`;
    const h = await ctx.owner.ok('POST', '/api/marketing/home', { action: 'task', keys: ['calls'], assigneeIds: [ctx.staffA.id, ctx.ownerId] });
    assert.equal(h.count, 1);
    const [t] = await sql`select id, assignee_id, space from tasks where id = ${h.ids[0]}`;
    assert.deepEqual([t.assignee_id, t.space, await co(t.id)], [ctx.staffA.id, 'marketing', [ctx.ownerId]]);
    const [c] = await sql`select id from mkt_calls where phone = '010-1124-0000'`;
    const r = await ctx.owner.ok('POST', `/api/marketing/calls/${c.id}/convert`, { assigneeIds: [ctx.staffA.id] });
    const [ct] = await sql`select assignee_id, title from tasks where id = ${r.taskId}`;
    assert.equal(ct.assignee_id, ctx.staffA.id); assert.ok(ct.title.startsWith('[전화 문의]'));
  });
});
