// 196차 결정 15-35(대표 10/26 17:00): 입찰은 업무로, 현장 영업은 영업 진행(리드)으로.
// [입찰 업무로 넘기기] = 리드 없이 입찰 업무 1건(공동 담당·기한 = 공고 일정·체크리스트·일정) · 정기 점검(정정 → 기한·일정 · 취소 → 업무 취소 · 개찰 결과 → 낙찰/미낙찰 판정)
// · [낙찰]·[미낙찰]·[유찰] 바로잡기 · 낙찰 → 계약 기록·계약 업무 → 종료 120일 전 재계약 준비 업무 · 되돌리기 · 예전 입찰발 리드 정리 · 업무 없던 리드의 다음 연락 업무
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${String(row.id)}, ${sql.json(row)})`;
const patch = (id, p) => sql`update sales_src_rows set row = row || ${sql.json(p)} where scope = 'global' and tbl = 'procurement_notices' and src_id = ${id}`;
const tick = async () => { const r = await fetch(`${BASE}/api/cron/tick?reason=test`, { method: 'POST', headers: { authorization: 'Bearer cron-test-secret' } }); assert.equal(r.status, 200); return (await r.json()).detail ?? {}; };
const work = async (id) => (await sql`select status, lead_id, data from sales_work_records where tenant = 'default' and src_tbl = 'opportunity_work' and ref_id = ${id} order by updated_at desc limit 1`)[0];
const kday = (col) => sql`to_char(${sql(col)} at time zone 'Asia/Seoul', 'YYYY-MM-DD')`;
const handoff = (client, id, assigneeIds, note) => client.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id, assigneeIds, ...(note ? { note } : {}) });

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['sales'] });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await sql`insert into company_profiles (tenant, key, name, biz_no, is_default) values ('default', 'dagymtest', '다짐테스트(주)', '123-45-67890', true)`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('입찰 업무로 넘기기', () => {
  test('리드 없이 입찰 업무 1건(주 담당 + 공동 담당) · 기한 = 참가신청 마감 전날 · 체크리스트 · 일정 4건 · 상태 버튼 자동 업무는 이어받음 · 리드 전환·상태 버튼 막힘 · 홈 일정', async () => {
    await put({ id: 'B1', title: '체육시설 위탁운영 용역', complex_name: '분당 스포츠센터', issuer: '성남시청', related: true, first_seen_at: today,
      site_briefing_at: `${addDays(today, 2)}T14:00`, participation_deadline_at: `${addDays(today, 6)}T18:00`, deadline_at: `${addDays(today, 8)}T10:00`, opening_at: `${addDays(today, 8)}T11:00` });
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'B1', status: '검토중', memo: '검토 시작' });
    const [auto] = await sql`select id, title from tasks where sales_ref->>'kind' = 'bid' and sales_ref->>'id' = 'B1' and deleted_at is null`;
    assert.ok(auto?.title.startsWith('[입찰] '), `상태 버튼 자동 업무도 [입찰]: ${auto?.title}`);
    const r = await handoff(ctx.owner, 'B1', [ctx.staffA.id, ctx.ownerId], '현장설명회 꼭 참석');
    assert.deepEqual([r.status, r.leadId, r.taskIds.length, r.due, r.eventIds.length, r.merged], ['입찰 진행', null, 1, addDays(today, 5), 4, 1]);
    assert.deepEqual(r.dates.map((d) => d.label), ['현장설명회', '참가신청 마감', '입찰 마감', '개찰']);
    assert.equal((await sql`select count(*)::int c from sales_leads where src->>'id' = 'B1'`)[0].c, 0, '리드를 만들지 않음');
    const [t] = await sql`select id, title, assignee_id, due_date::text as due, space, sales_ref, lead_id, requested_by, description from tasks where id = ${r.taskId}`;
    assert.deepEqual([t.title, t.assignee_id, t.due, t.space, t.sales_ref.kind, t.sales_ref.bid, t.lead_id, t.requested_by], ['[입찰] 분당 스포츠센터 체육시설 위탁운영 용역', ctx.staffA.id, addDays(today, 5), 'sales', 'bid', true, null, ctx.ownerId]);
    assert.match(t.description, /메모: 현장설명회 꼭 참석/); assert.match(t.description, /공고가 취소되면 이 업무도 함께 취소/);
    assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${t.id}`).map((x) => x.user_id), [ctx.ownerId], '공동 담당');
    const items = (await sql`select text from task_checklist_items where task_id = ${t.id} order by sort`).map((x) => x.text);
    assert.equal(items.length, 5); assert.equal(items[0], '공고문·참가 자격 검토');
    assert.deepEqual(items.slice(1).map((x) => x.split(' · ')[0]), ['현장설명회 참석', '참가신청', '입찰서 제출', '개찰 결과 확인']);
    const [old] = await sql`select deleted_at from tasks where id = ${auto.id}`; assert.ok(old.deleted_at, '상태 버튼으로 생긴 자동 업무는 이어받아 정리');
    assert.equal((await sql`select count(*)::int c from activities where entity_id = ${auto.id} and action = 'merged_into'`)[0].c, 1);
    const evs = await sql`select e.title, c.type, (select count(*)::int from event_attendees a where a.event_id = e.id) as att from events e join calendars c on c.id = e.calendar_id where e.id = any(${r.eventIds}::uuid[]) order by e.start_at`;
    assert.deepEqual(evs.map((e) => [e.title.split(' · ')[0], e.type, e.att]), [['[입찰] 현장설명회', 'company', 2], ['[입찰] 참가신청 마감', 'company', 2], ['[입찰] 입찰 마감', 'company', 2], ['[입찰] 개찰', 'company', 2]]);
    const w = await work('B1');
    assert.deepEqual([w.status, w.lead_id, w.data.bid_task_id, w.data.bid_due_auto, w.data.handoff_prev_status, w.data.memo], ['입찰 진행', null, t.id, addDays(today, 5), '검토중', '검토 시작']);
    assert.deepEqual(w.data.assignees, [ctx.staffA.id, ctx.ownerId]);
    const [n] = await sql`select type, link from notifications where user_id = ${ctx.staffA.id} and title like '입찰 업무:%'`;
    assert.deepEqual([n?.type, n?.link], ['task_assigned', `/tasks/${t.id}`]);
    assert.equal((await sql`select count(*)::int c from notifications where user_id = ${ctx.ownerId} and title like '입찰 업무:%'`)[0].c, 0, '넘긴 본인 제외');
    const card = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working')).items.find((x) => x.id === 'B1');
    assert.deepEqual([card.work, card.workLeadId, card.workBid?.taskId, card.workBid?.due, card.workBid?.result ?? null, card.workBid?.assignees], ['입찰 진행', null, t.id, addDays(today, 5), null, 2]);
    const again = await ctx.owner.req('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'B1', assigneeIds: [ctx.staffA.id] });
    assert.equal(again.status, 409); assert.equal(again.body.error.code, 'already');
    assert.equal((await ctx.owner.req('POST', '/api/sales/work', { kind: 'bid', id: 'B1', status: '보류' })).status, 400, '넘긴 공고는 업무에서');
    const cv = await ctx.owner.req('POST', '/api/sales/work/convert', { kind: 'bid', id: 'B1', force: true });
    assert.equal(cv.status, 400); assert.match(cv.body.error.message, /입찰 업무로 넘기기/);
    const ag = await ctx.owner.ok('GET', `/api/sales/src?view=agenda&from=${today}&to=${addDays(today, 14)}`);
    // 대표 10/27 ④('입찰 마감이 업무·일정·영업에 여러 번 뜸 — 하나만'): 입찰 업무로 넘긴 공고는 회사 캘린더 '입찰 마감' 일정이 있으므로 영업 주요 일정에는 다시 안 넣음
    assert.ok(!ag.items.some((x) => x.kind === 'bid' && x.title.startsWith('입찰 마감 · 분당 스포츠센터')), '넘긴 공고는 주요 일정에서 빠짐(일정이 대신)');
    assert.ok((await sql`select 1 from events where title like '[입찰] 입찰 마감 · %분당 스포츠센터%' and deleted_at is null`).length, '입찰 마감은 회사 캘린더 일정으로 한 번');
  });
  test('정기 점검 — 공고 정정(날짜) → 일정·기한 따라감 · 사람이 바꾼 기한은 그대로', async () => {
    const w0 = await work('B1'); const taskId = w0.data.bid_task_id; const applyEv = w0.data.bid_events.apply;
    await patch('B1', { participation_deadline_at: `${addDays(today, 9)}T18:00`, deadline_at: `${addDays(today, 11)}T10:00` });
    const d1 = await tick(); assert.ok(d1.bidTasks?.checked >= 1, JSON.stringify(d1.bidTasks));
    assert.equal((await sql`select due_date::text d from tasks where id = ${taskId}`)[0].d, addDays(today, 8), '참가신청 마감 전날로');
    assert.equal((await sql`select ${kday('start_at')} d from events where id = ${applyEv}`)[0].d, addDays(today, 9), '일정도 옮김');
    const [act] = await sql`select changes from activities where entity_id = ${taskId} and action = 'updated' and changes->>'reason' = 'bid_schedule' order by id desc limit 1`;
    assert.deepEqual([act.changes.dueDate.from, act.changes.dueDate.to], [addDays(today, 5), addDays(today, 8)]);
    await ctx.staffA.client.ok('PATCH', `/api/tasks/${taskId}`, { dueDate: addDays(today, 3) }); // 사람이 바꾼 기한
    await patch('B1', { participation_deadline_at: `${addDays(today, 10)}T18:00` });
    await tick();
    assert.equal((await sql`select due_date::text d from tasks where id = ${taskId}`)[0].d, addDays(today, 3), '사람이 바꾼 기한은 그대로');
    assert.equal((await sql`select ${kday('start_at')} d from events where id = ${applyEv}`)[0].d, addDays(today, 10));
    assert.equal((await work('B1')).data.bid_due_auto, addDays(today, 9));
  });
  test('정기 점검 — 나라장터 같은 번호 취소 공고 → 업무·일정 취소 · 공고 취소 · 알림', async () => {
    await put({ id: 'B2', source_type: 'g2b_bid', source_external_id: 'R26BK0001-000', title: '주민운동시설 위탁 운영', issuer: '구청', related: true, first_seen_at: today, posted_date: addDays(today, -1),
      deadline_at: `${addDays(today, 5)}T10:00`, site_briefing_at: `${addDays(today, 2)}T10:00` });
    const r = await handoff(ctx.owner, 'B2', [ctx.staffA.id]);
    assert.equal(r.eventIds.length, 2);
    await tick();
    assert.equal((await work('B2')).status, '입찰 진행', '취소 전에는 그대로');
    await put({ id: 'B2c', source_type: 'g2b_bid', source_external_id: 'R26BK0001-001', title: '[취소] 주민운동시설 위탁 운영', issuer: '구청', notice_kind: 'cancel', current_status: '취소', related: true, posted_date: today, first_seen_at: today });
    const d = await tick(); assert.ok(d.bidTasks?.canceled >= 1, JSON.stringify(d.bidTasks));
    assert.ok((await sql`select deleted_at from tasks where id = ${r.taskId}`)[0].deleted_at, '업무 취소');
    assert.equal((await sql`select count(*)::int c from activities where entity_id = ${r.taskId} and action = 'canceled' and changes->>'reason' = 'notice_canceled'`)[0].c, 1);
    assert.equal((await sql`select count(*)::int c from events where id = any(${r.eventIds}::uuid[]) and deleted_at is not null`)[0].c, 2, '일정 취소');
    const w = await work('B2'); assert.deepEqual([w.status, w.data.bid_result], ['공고 취소', 'canceled']);
    const [n] = await sql`select type from notifications where user_id = ${ctx.staffA.id} and title like '공고 취소:%'`; assert.equal(n?.type, 'bid_update');
    const card = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working')).items.find((x) => x.id === 'B2');
    assert.equal(card?.workBid?.result, 'canceled');
    // 제목에 '취소'가 든 일반 공고(수집 때 공고 종류를 '취소'로 추정) — 원천 상태가 취소가 아니면 그대로 진행
    await put({ id: 'B7', title: '자동차 등록 취소 업무 대행 용역', issuer: '구청', notice_kind: 'cancel', current_status: '공고중', related: true, first_seen_at: today, deadline_at: `${addDays(today, 5)}T10:00` });
    const r7 = await handoff(ctx.owner, 'B7', [ctx.staffA.id]);
    await tick();
    assert.equal((await work('B7')).status, '입찰 진행', '제목만으로는 취소로 보지 않음');
    assert.equal((await sql`select deleted_at from tasks where id = ${r7.taskId}`)[0].deleted_at, null);
  });
});

describe('개찰 결과 · 계약 · 재계약 준비', () => {
  test('자동 판정: 우리 회사 이름(법인 표시 무시)·사업자번호 → 낙찰(계약 기록·계약 업무) · 다른 회사 → 미낙찰 · 입찰 업무 마침 · 알림', async () => {
    const past = { related: true, first_seen_at: addDays(today, -3), deadline_at: `${addDays(today, -1)}T10:00`, opening_at: `${addDays(today, -1)}T11:00` };
    await put({ id: 'B3', source_type: 'g2b_bid', source_external_id: 'R26BK0003-000', title: '헬스장 위탁운영', issuer: '시청', ...past });
    await put({ id: 'B4', source_type: 'g2b_bid', source_external_id: 'R26BK0004-000', title: '수영장 위탁운영', issuer: '군청', ...past });
    await put({ id: 'B5', source_type: 'g2b_bid', source_external_id: 'R26BK0005-000', title: '체력단련실 운영', issuer: '공단', ...past });
    const r3 = await handoff(ctx.owner, 'B3', [ctx.staffA.id]); const r4 = await handoff(ctx.owner, 'B4', [ctx.staffA.id]); const r5 = await handoff(ctx.owner, 'B5', [ctx.staffA.id]);
    assert.equal(r3.due, addDays(today, 3), '일정이 다 지난 공고 = 3일 뒤');
    await patch('B3', { winner_name: '주식회사 다짐테스트', winner_amount: '120000000', award_date: addDays(today, -1), current_status: '낙찰' });
    await patch('B4', { winner_name: '남의회사(주)', winner_biz_no: '999-99-99999', winner_amount: '90000000', award_date: addDays(today, -1), current_status: '낙찰' });
    await patch('B5', { winner_name: '다짐 테스트 컴퍼니', winner_biz_no: '1234567890', award_date: addDays(today, -1), current_status: '낙찰' });
    const d = await tick(); assert.ok(d.bidTasks?.results >= 3, JSON.stringify(d.bidTasks));
    const w3 = await work('B3'); assert.deepEqual([w3.status, w3.data.bid_result, w3.data.bid_result_auto, w3.data.bid_winner], ['낙찰', 'won', true, '주식회사 다짐테스트']);
    const [c3] = await sql`select lead_id, data from sales_lead_records where kind = 'contracts' and data->'source'->>'id' = 'B3'`;
    assert.deepEqual([c3.lead_id, c3.data.title, c3.data.amount, c3.data.status, c3.data.end_date], [null, '헬스장 위탁운영', 120000000, '계약', null]);
    const [ct] = await sql`select title, assignee_id, due_date::text as due, sales_ref, status from tasks where id = ${w3.data.bid_contract_task_id}`;
    assert.deepEqual([ct.title, ct.assignee_id, ct.due, ct.sales_ref.kind, ct.status], ['[계약] 헬스장 위탁운영 — 계약 체결·계약 기간 입력', ctx.staffA.id, addDays(today, 7), 'contract', 'todo']);
    const [bt] = await sql`select status from tasks where id = ${r3.taskId}`; assert.equal(bt.status, 'done', '입찰 업무 마침');
    assert.equal((await sql`select count(*)::int c from activities where entity_id = ${r3.taskId} and action = 'updated' and changes->>'reason' = 'bid_result'`)[0].c, 1);
    assert.equal((await sql`select count(*)::int c from notifications where user_id = ${ctx.staffA.id} and type = 'bid_update' and title = '낙찰: 헬스장 위탁운영'`)[0].c, 1);
    const w4 = await work('B4'); assert.deepEqual([w4.status, w4.data.bid_result, w4.data.bid_contract_id], ['미낙찰', 'lost', null]);
    assert.equal((await sql`select status from tasks where id = ${r4.taskId}`)[0].status, 'done');
    const [n4] = await sql`select body from notifications where user_id = ${ctx.staffA.id} and title = '개찰 결과: 수영장 위탁운영'`; assert.match(n4.body, /낙찰 남의회사\(주\)\(90,000,000원\)/);
    assert.equal((await work('B5')).data.bid_result, 'won', '사업자번호가 같으면 이름이 달라도 우리 회사');
    const deals = await ctx.owner.ok('GET', '/api/sales/src?view=deals'); assert.ok(deals.contracts.some((c) => c.title === '헬스장 위탁운영'), '제안·계약 화면에 계약');
    const card = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=all&q=헬스장')).items.find((x) => x.id === 'B3');
    assert.deepEqual([card?.workBid?.result, card?.workBid?.auto, !!card?.workBid?.contractTaskId], ['won', true, true]);
    assert.equal((await r5).taskIds.length, 1);
  });
  test('[낙찰]로 바로잡기(계약 기간) → 종료 120일 전 재계약 준비 업무 · 다시 [미낙찰] → 자동 계약 기록·업무 정리 · 권한 · 되돌리기는 결과 전만', async () => {
    assert.equal((await ctx.staffB.client.req('POST', '/api/sales/work/bid-result', { id: 'B4', result: 'won' })).status, 403, '관계없는 영업 직원');
    assert.equal((await ctx.staffA.client.req('POST', '/api/sales/work/bid-result', { id: 'B4', result: 'won', contractStart: addDays(today, 10), contractEnd: today })).status, 400, '종료가 시작보다 앞');
    const r = await ctx.staffA.client.ok('POST', '/api/sales/work/bid-result', { id: 'B4', result: 'won', contractStart: today, contractEnd: addDays(today, 100) });
    assert.equal(r.status, '낙찰'); assert.ok(r.contractId && r.contractTaskId);
    const [c] = await sql`select data from sales_lead_records where id = ${r.contractId}`; assert.deepEqual([c.data.start_date, c.data.end_date, c.data.amount], [today, addDays(today, 100), 90000000]);
    const w = await work('B4'); assert.deepEqual([w.data.bid_result_auto, w.data.bid_result_by], [false, ctx.staffA.id]);
    const d = await tick(); assert.ok(d.contractCare?.made >= 1, JSON.stringify(d.contractCare));
    const [care] = await sql`select id, title, assignee_id, due_date::text as due, sales_ref from tasks where sales_ref->>'kind' = 'contract' and sales_ref->>'id' = ${r.contractId} and title like '[재계약]%'`;
    assert.deepEqual([care.title, care.assignee_id, care.due], ['[재계약] 수영장 위탁운영 — 재계약 준비', ctx.staffA.id, addDays(today, 10)], '기한 = 종료 90일 전');
    assert.equal((await sql`select data->>'care_task_id' as x from sales_lead_records where id = ${r.contractId}`)[0].x, care.id);
    await tick(); assert.equal((await sql`select count(*)::int c from tasks where sales_ref->>'id' = ${r.contractId} and title like '[재계약]%'`)[0].c, 1, '한 계약에 한 번');
    assert.equal((await sql`select count(*)::int c from notifications where user_id = ${ctx.staffA.id} and title = '재계약 준비: 수영장 위탁운영'`)[0].c, 1);
    // 낙찰 → 미낙찰로 바로잡음: 자동 계약 기록 삭제, 계약 업무·재계약 업무 정리
    const back = await ctx.owner.ok('POST', '/api/sales/work/bid-result', { id: 'B4', result: 'lost' });
    assert.equal(back.status, '미낙찰');
    assert.equal((await sql`select count(*)::int c from sales_lead_records where id = ${r.contractId}`)[0].c, 0);
    assert.ok((await sql`select deleted_at from tasks where id = ${r.contractTaskId}`)[0].deleted_at, '계약 업무 정리');
    assert.ok((await sql`select deleted_at from tasks where id = ${care.id}`)[0].deleted_at, '재계약 준비 업무 정리');
    assert.equal((await ctx.owner.req('POST', '/api/sales/work/handoff/revert', { kind: 'bid', id: 'B4' })).status, 409, '결과가 나온 공고는 되돌리기 없음');
  });
  test('되돌리기(결과 전): 업무·일정 취소, 진행 기록은 넘기기 전 상태로 · 관계없는 직원 403 · 다시 넘기기 가능', async () => {
    await put({ id: 'B6', title: '되돌리기 공고', issuer: '구청', related: true, first_seen_at: today, deadline_at: `${addDays(today, 5)}T10:00` });
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'B6', status: '검토중', memo: '넘기기 전 메모' });
    const r = await handoff(ctx.owner, 'B6', [ctx.staffA.id]);
    assert.equal((await ctx.staffB.client.req('POST', '/api/sales/work/handoff/revert', { kind: 'bid', id: 'B6' })).status, 403);
    const v = await ctx.staffA.client.ok('POST', '/api/sales/work/handoff/revert', { kind: 'bid', id: 'B6', reason: '담당 변경' });
    assert.deepEqual([v.status, v.tasks, v.events], ['검토중', 1, 1]);
    assert.ok((await sql`select deleted_at from tasks where id = ${r.taskId}`)[0].deleted_at);
    const w = await work('B6'); assert.deepEqual([w.status, w.data.bid_task_id ?? null, w.data.memo, w.data.reverted_reason], ['검토중', null, '넘기기 전 메모', '담당 변경']);
    assert.equal((await sql`select count(*)::int c from notifications where user_id = ${ctx.ownerId} and title like '입찰 업무 취소:%'`)[0].c, 0, '넘긴 사람(담당 아님)에게는 없음');
    const r2 = await handoff(ctx.owner, 'B6', [ctx.ownerId]); assert.notEqual(r2.taskId, r.taskId);
  });
});

describe('예전 자료 정리 · 리드 다음 연락 업무', () => {
  test('입찰에서 넘어온 리드 → 미리 보기(옮길 수 있는지·이유) → 고른 것만 입찰 업무로 · 관리자만', async () => {
    await put({ id: 'L1', title: '옛 공고 하나', issuer: '군청', related: true, first_seen_at: today, participation_deadline_at: `${addDays(today, 4)}T18:00`, deadline_at: `${addDays(today, 6)}T10:00` });
    const [cal] = await sql`select id from calendars where type = 'company' and tenant = 'default' limit 1`;
    const ev = await ctx.owner.ok('POST', '/api/events', { calendarId: cal.id, title: '[영업] 참가신청 마감 · 옛 공고 하나', start: `${addDays(today, 4)}T09:00:00.000Z`, end: `${addDays(today, 4)}T10:00:00.000Z`, allDay: false });
    const evId = ev.id ?? ev.event?.id;
    const [l1] = await sql`insert into sales_leads (tenant, name, status, owner_id, src) values ('default', '옛 공고 하나', '신규리드', ${ctx.staffA.id},
      ${sql.json({ from: 'bid', id: 'L1', handoff: true, assignees: [ctx.staffA.id], by: ctx.ownerId, eventIds: [evId] })}) returning id`;
    await sql`update events set lead_id = ${l1.id} where id = ${evId}`;
    const tk = await ctx.owner.ok('POST', '/api/tasks', { title: '[영업] 옛 공고 하나 — 검토·첫 연락', assigneeId: ctx.staffA.id, dueDate: addDays(today, 3), approvalRequired: false });
    await sql`update tasks set space = 'sales', lead_id = ${l1.id}, sales_ref = ${sql.json({ kind: 'bid', id: 'L1', leadId: l1.id, handoff: true })} where id = ${tk.id}`;
    await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, lead_id, data) values ('default', 'opportunity_work', 'w:bid:L1', 'L1', '영업 중', ${l1.id},
      ${sql.json({ status: '영업 중', lead_id: l1.id, notice_id: 'L1', handoff_by: ctx.ownerId, assignees: [ctx.staffA.id], handoff_prev_status: null })})`;
    const [l2] = await sql`insert into sales_leads (tenant, name, status, owner_id, src) values ('default', '옛 공고 둘', '미팅예정', ${ctx.staffA.id}, ${sql.json({ from: 'bid', id: 'L2' })}) returning id`;
    await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, lead_id, data) values ('default', 'opportunity_work', 'w:bid:L2', 'L2', '진행영업 전환', ${l2.id}, ${sql.json({ status: '진행영업 전환', lead_id: l2.id })})`;
    const [l3] = await sql`insert into sales_leads (tenant, name, status, owner_id, src) values ('default', '옛 공고 셋', '신규리드', ${ctx.staffA.id}, ${sql.json({ from: 'bid', id: 'L3' })}) returning id`;
    await sql`insert into sales_work_records (tenant, src_tbl, src_id, ref_id, status, lead_id, data) values ('default', 'opportunity_work', 'w:bid:L3', 'L3', '진행영업 전환', ${l3.id}, ${sql.json({ status: '진행영업 전환', lead_id: l3.id })})`;
    await sql`insert into sales_lead_records (tenant, kind, lead_id, occurred_at, data) values ('default', 'sales_activities', ${l3.id}, now(), ${sql.json({ activity_type: '전화', content: '통화함' })})`;
    assert.equal((await ctx.staffA.client.req('GET', '/api/sales/work/bid-leads')).status, 403, '관리자만');
    const pv = await ctx.owner.ok('GET', '/api/sales/work/bid-leads');
    const by = Object.fromEntries(pv.items.map((x) => [x.name, x]));
    assert.deepEqual([by['옛 공고 하나']?.movable, by['옛 공고 둘']?.movable, by['옛 공고 셋']?.movable], [true, false, false]);
    assert.match(by['옛 공고 둘'].why, /미팅예정/); assert.match(by['옛 공고 셋'].why, /상담·제안·계약 기록 1건/);
    assert.equal(by['옛 공고 하나'].openTasks, 1);
    const mv = await ctx.owner.ok('POST', '/api/sales/work/bid-leads', { leadIds: [l1.id, l2.id] });
    assert.deepEqual([mv.moved.map((x) => x.id), mv.moved[0].taskId, mv.skipped.map((x) => x.id)], [[l1.id], tk.id, [l2.id]]);
    const [lead] = await sql`select status, src from sales_leads where id = ${l1.id}`; assert.deepEqual([lead.status, lead.src.moved_to_bid.taskId], ['되돌림', tk.id]);
    assert.equal((await sql`select reason from sales_status_log where lead_id = ${l1.id} order by id desc limit 1`)[0].reason, '입찰은 업무로 관리 — 입찰 업무로 옮김');
    const [t] = await sql`select lead_id, sales_ref from tasks where id = ${tk.id}`; assert.deepEqual([t.lead_id, t.sales_ref.bid, t.sales_ref.kind], [null, true, 'bid']);
    assert.equal((await sql`select lead_id from events where id = ${evId}`)[0].lead_id, null);
    const w = await work('L1');
    assert.deepEqual([w.status, w.lead_id, w.data.bid_task_id, w.data.bid_events.apply, w.data.moved_from_lead, w.data.bid_due_auto], ['입찰 진행', null, tk.id, evId, l1.id, addDays(today, 3)]);
    assert.equal((await ctx.owner.ok('GET', '/api/sales/work/bid-leads')).items.length, 2, '옮긴 리드는 목록에서 빠짐');
    const card = (await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working')).items.find((x) => x.id === 'L1'); assert.equal(card?.workBid?.taskId, tk.id);
  });
  test('업무가 한 번도 없던 진행 중 리드 — 다음 연락일이 가까우면 정기 실행이 [영업] 다음 연락 업무를 조용히 만듦(한 번만, 지운 업무는 되살리지 않음)', async () => {
    const [a] = await sql`insert into sales_leads (tenant, name, status, owner_id, next_contact_date) values ('default', '옛 거래처', '1차연락완료', ${ctx.staffA.id}, ${addDays(today, 2)}) returning id`;
    const [b] = await sql`insert into sales_leads (tenant, name, status, owner_id, next_contact_date) values ('default', '보류 거래처', '보류', ${ctx.staffA.id}, ${addDays(today, 1)}) returning id`;
    const [c] = await sql`insert into sales_leads (tenant, name, status, owner_id, next_contact_date) values ('default', '먼 거래처', '신규리드', ${ctx.staffA.id}, ${addDays(today, 30)}) returning id`;
    const d = await tick(); assert.ok(d.leadNext?.made >= 1, JSON.stringify(d.leadNext));
    const [t] = await sql`select id, title, assignee_id, due_date::text as due, space, lead_id from tasks where sales_ref->>'kind' = 'lead' and sales_ref->>'id' = ${a.id} and deleted_at is null`;
    assert.deepEqual([t?.title, t?.assignee_id, t?.due, t?.space, t?.lead_id], ['[영업] 옛 거래처 — 다음 연락', ctx.staffA.id, addDays(today, 2), 'sales', a.id]);
    assert.equal((await sql`select count(*)::int c from notifications where user_id = ${ctx.staffA.id} and title like '%옛 거래처%'`)[0].c, 0, '알림 없이');
    for (const id of [b.id, c.id]) assert.equal((await sql`select count(*)::int c from tasks where lead_id = ${id}`)[0].c, 0, '보류·먼 날짜는 만들지 않음');
    const mine = await ctx.staffA.client.ok('GET', '/api/tasks?view=my');
    assert.ok((mine.tasks ?? mine.items ?? []).some((x) => x.id === t.id), '내 업무 목록에 보임');
    await sql`update tasks set deleted_at = now() where id = ${t.id}`;
    await tick();
    assert.equal((await sql`select count(*)::int c from tasks where lead_id = ${a.id} and deleted_at is null`)[0].c, 0, '지운 업무는 되살리지 않음');
  });
});
