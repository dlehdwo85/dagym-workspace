// 대표 10/20 14:15 영업 진행 → 업무 자동 리스트업 + S2-5 홈 오늘 할 일 7묶음 + S2-6 요약 타일·진행 현황표·계약만료·재입찰 + ④ 일괄 [영업 진행으로]
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
const P = {};
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await put('global', 'procurement_notices', { id: 'N1', title: '성남시 체육시설 위탁운영', complex_name: '분당 스포츠센터', issuer: '성남시청', region: '경기', related: true, first_seen_at: today, deadline_at: `${addDays(today, 5)}T10:00:00+09:00`, status: '공고중' });
  await put('global', 'procurement_notices', { id: 'N2', title: '내일 마감 공고', issuer: '수원시', region: '경기', related: true, first_seen_at: today, deadline_at: `${addDays(today, 1)}T17:00:00+09:00`, status: '공고중' });
  await put('global', 'procurement_notices', { id: 'N3', title: '계약 종료 예정 시설 운영', issuer: '용인시', region: '경기', related: true, first_seen_at: addDays(today, -30), status: '낙찰', winner_name: '타사(주)', contract_end_date: addDays(today, 60) });
  await put('global', 'building_sales_pipeline', { id: 'B1', name: '판교 새단지', household_count: 1200, region: '경기', status: '영업 전', first_seen_at: today });
  await put('global', 'building_sales_pipeline', { id: 'B2', name: '광교 새단지', household_count: 800, region: '경기', first_seen_at: today });
  await put('global', 'operating_facility_prospects', { id: 'F1', name: '수원 아파트 커뮤니티', household_count: 1500, facility_type: '아파트', region: '경기', office_phone: '031-2', first_seen_at: today });
  await put('global', 'vendor_registrations', { id: 'V1', company: '좋은관리(주)', category: '종합관리', first_seen_at: today });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });
const openTask = (kind, id) => sql`select id, title, status, due_date::text as due, assignee_id, requested_by, space, sales_ref, lead_id from tasks where sales_ref->>'kind' = ${kind} and sales_ref->>'id' = ${id} and deleted_at is null order by created_at desc limit 1`;

describe('영업 진행 → 업무 자동 리스트업', () => {
  test('입찰 연락중(다음 연락일) → "[입찰] …" 업무(결정 15-35 — 담당·요청자 = 바꾼 사람, 마감 = 다음 연락일, space sales, 원천 배지) · 검토중은 업무 없음 → 다음 연락일 바꾸면 마감 따라감', async () => {
    const r0 = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '미검토' });
    assert.equal(r0.task.action, 'none'); assert.equal((await openTask('bid', 'N1')).length, 0, '미검토는 업무 없음');
    const r = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '연락중', nextDate: addDays(today, 3) });
    assert.equal(r.task.action, 'created');
    const [t] = await openTask('bid', 'N1');
    assert.ok(t.title.startsWith('[입찰] 분당 스포츠센터 성남시 체육시설 위탁운영 — 입찰 준비'), t.title);
    assert.deepEqual([t.status, t.due, t.assignee_id, t.requested_by, t.space, t.sales_ref.kind, t.sales_ref.id], ['todo', addDays(today, 3), ctx.ownerId, ctx.ownerId, 'sales', 'bid', 'N1']);
    const r2 = await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', nextDate: addDays(today, 6) });
    assert.equal(r2.task.action, 'updated'); assert.equal((await openTask('bid', 'N1'))[0].due, addDays(today, 6), '마감 따라감');
    assert.equal((await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '연락중' })).task.action, 'none', '같은 상태 다시 저장해도 업무 하나');
    const list = await ctx.owner.ok('GET', '/api/tasks?space=sales&limit=50');
    const mine = (list.tasks ?? list).find((x) => x.id === t.id);
    assert.ok(mine && mine.sales_ref?.kind === 'bid', '업무 목록 공간 필터·원천');
  });
  test('보류 → 업무 보류, 다시 연락중 → 되살림, 미참여 → 완료 / 다음 연락일 없는 입찰은 마감 = 입찰 마감 D-1', async () => {
    assert.equal((await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '보류' })).task.action, 'held');
    assert.equal((await openTask('bid', 'N1'))[0].status, 'on_hold');
    assert.equal((await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '연락중' })).task.action, 'updated');
    assert.equal((await openTask('bid', 'N1'))[0].status, 'todo');
    assert.equal((await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N1', status: '미참여' })).task.action, 'done');
    const [t] = await sql`select status, completed_at from tasks where sales_ref->>'id' = 'N1' order by created_at desc limit 1`;
    assert.equal(t.status, 'done'); assert.ok(t.completed_at);
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N2', status: '연락중' });
    assert.equal((await openTask('bid', 'N2'))[0].due, today, '내일 마감 → D-1 = 오늘');
  });
  test('시설 연락중·협력사 신청 준비 → 업무, 영업완료·등록 완료 → 완료 / 전환하면 원천 업무 완료 + 리드 "첫 연락" 업무(lead_id)', async () => {
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'facility', id: 'F1', status: '연락중', nextDate: today });
    assert.ok((await openTask('facility', 'F1'))[0].title.includes('수원 아파트 커뮤니티'));
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'vendor', id: 'V1', status: '신청 준비' });
    assert.ok((await openTask('vendor', 'V1'))[0].title.includes('등록 신청'));
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'vendor', id: 'V1', status: '등록 완료' });
    assert.equal((await openTask('vendor', 'V1'))[0].status, 'done');
    const c = await ctx.owner.ok('POST', '/api/sales/work/convert', { kind: 'facility', id: 'F1', force: true });
    P.lead = c.leadId;
    assert.equal((await openTask('facility', 'F1'))[0].status, 'done', '전환된 원천 업무 완료');
    const [lt] = await openTask('lead', P.lead);
    assert.ok(lt && lt.title.includes('첫 연락') && lt.lead_id === P.lead, '리드 첫 연락 업무');
  });
  test('새 리드 → 첫 연락 업무(마감 = 다음 연락일), 리드 실패 → 업무 완료, 보류 → 보류', async () => {
    const l = await ctx.owner.ok('POST', '/api/sales/leads', { name: '새 거래처', nextContactDate: addDays(today, 2) });
    const [t] = await openTask('lead', l.id);
    assert.deepEqual([t.due, t.lead_id, t.status], [addDays(today, 2), l.id, 'todo']);
    await ctx.owner.ok('PATCH', `/api/sales/leads/${l.id}`, { status: '보류', reason: '예산 없음' });
    assert.equal((await openTask('lead', l.id))[0].status, 'on_hold');
    await ctx.owner.ok('PATCH', `/api/sales/leads/${l.id}`, { status: '실패', reason: '타사 선정' });
    assert.equal((await openTask('lead', l.id))[0].status, 'done');
  });
  test('④ 일괄: 신규단지 2건 → [영업 진행으로] → 업무 2건, 관리자 아닌 영업 공간 밖 사람 404', async () => {
    const r = await ctx.owner.ok('POST', '/api/sales/work/bulk', { kind: 'building', ids: ['B1', 'B2'], status: '연락중', nextDate: addDays(today, 1) });
    assert.equal(r.tasks, 2); assert.ok(r.results.every((x) => x.ok));
    assert.equal((await openTask('building', 'B2'))[0].due, addDays(today, 1));
    assert.equal((await ctx.owner.ok('POST', '/api/sales/work/bulk', { kind: 'building', ids: ['NOPE'], status: '연락중' })).results[0].ok, false, '없는 건은 results 에 실패로');
  });
  test('S2-5 홈 오늘 할 일 7묶음 + S2-6 타일 6·진행 현황표', async () => {
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N2', nextDate: addDays(today, -1) }); // 후속 기한 지남
    await sql`update tasks set due_date = ${addDays(today, -2)} where sales_ref->>'id' = 'B1'`; // 지난 영업 업무
    const s = await ctx.owner.ok('GET', '/api/sales/src?view=summary');
    assert.ok(s.todo.followUp.some((x) => x.id === 'N2' && x.kind === 'bid'), '입찰 후속');
    assert.ok(s.todo.facilities.length >= 0 && s.todo.vendors.length >= 0);
    assert.ok(s.todo.pastTasks.some((x) => x.sales_ref?.id === 'B1'), '지난 영업 업무');
    assert.ok(s.todo.nowSales.some((x) => x.id === 'N2'), '지금 영업 상위(연락중·마감 임박)');
    assert.ok(s.todo.closingSoon.some((x) => x.id === 'N2' && x.status === '내일 마감' && x.memo === '17:00'), '내일 마감');
    assert.deepEqual([s.tiles.buildings, s.tiles.facilities, s.tiles.vendors, s.tiles.contracts], [2, 1, 1, 1]);
    assert.ok(s.tiles.nowSales >= 1 && s.tiles.bidsOpen >= 1);
    const prog = Object.fromEntries(s.progress);
    assert.equal(prog['신규단지']['연락중'], 2); assert.equal(prog['협력사']['등록 완료'], 1);
  });
  test('S2-6 계약만료·재입찰: 종료일 역산(−12/−9/−6/−3개월)·단계·요약', async () => {
    const c = await ctx.owner.ok('GET', '/api/sales/src?view=contracts');
    assert.equal(c.items.length, 1);
    const x = c.items[0];
    assert.deepEqual([x.id, x.winner, x.end, x.stage, x.daysLeft], ['N3', '타사(주)', addDays(today, 60), '재입찰', 60]);
    assert.ok(x.propose < x.rebid && x.start < x.propose);
    assert.deepEqual([c.summary.d90, c.summary.d180, c.summary.d365, c.summary.past], [1, 1, 1, 0]);
    assert.ok(c.stages.some(([s, n]) => s === '재입찰' && n === 1));
  });
});
