// 대표 10/21 12:00 영업 재편 1): [영업 진행으로 넘기기] — 담당자 선택 → 리드(담당 = 첫 담당자) · 원 행 '영업 중' · 담당자마다 업무(검토·첫 연락, 마감 = 참가신청/입찰 마감 전날)
// · 공고 일정(현장설명회·참가신청 마감·입찰 마감·개찰) → 회사 공용 캘린더(참석 = 담당자, 알림) · 배정 알림 · 같은 건 다시 넘기면 409 · 영업 밖 직원 404 · 전환 전 409
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  await put('procurement_notices', { id: 'N1', title: '체육시설 위탁운영 용역', complex_name: '분당 스포츠센터', issuer: '성남시청', region: '경기', related: true, first_seen_at: today,
    site_briefing_at: `${addDays(today, 2)}T14:00`, participation_deadline_at: `${addDays(today, 6)}T18:00`, deadline_at: `${addDays(today, 8)}T10:00`, opening_at: `${addDays(today, 8)}T11:00` });
  await put('procurement_notices', { id: 'N2', title: '지난 공고', issuer: '구청', deadline_at: `${addDays(today, -3)}T10:00`, first_seen_at: addDays(today, -10) });
  await put('building_sales_pipeline', { id: 'B1', name: '판교 새단지', households: 1200, region: '경기', status: '영업 전', first_seen_at: today });
  await put('operating_facility_prospects', { id: 'F1', name: '수원 아파트 커뮤니티', households: 1500, facility_type: '아파트', region: '경기', office_phone: '031-200-0000', first_seen_at: today });
  await put('vendor_registrations', { id: 'V1', company: '좋은관리(주)', category: '종합관리', first_seen_at: today });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })})`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffA.id, spaces: ['sales'] });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('영업 진행으로 넘기기', () => {
  test('담당자 후보 = 영업 공간 구성원 + 관리자 · 영업 밖 직원 404 · 전환 전 409', async () => {
    const p = await ctx.owner.ok('GET', '/api/sales/work/handoff');
    assert.equal(p.me, ctx.ownerId);
    const ids = p.people.map((x) => x.id);
    assert.ok(ids.includes(ctx.ownerId) && ids.includes(ctx.staffA.id), '대표·영업 직원 포함'); assert.ok(!ids.includes(ctx.staffB.id), '영업 밖 직원은 후보 아님');
    assert.equal((await ctx.staffB.client.req('GET', '/api/sales/work/handoff')).status, 404, '영업 공간 밖 직원은 404(숨김)');
    assert.equal((await ctx.owner.req('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N1', assigneeIds: [ctx.staffA.id] })).status, 409, '전환 전');
    await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
    assert.equal((await ctx.owner.req('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'NOPE', assigneeIds: [ctx.staffA.id] })).status, 404);
    assert.equal((await ctx.owner.req('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N1', assigneeIds: [] })).status, 400, '담당자 1명 이상');
    assert.equal((await ctx.owner.req('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N1', assigneeIds: [ctx.staffB.id] })).status, 400, '영업 밖 직원 배정 불가');
  });
  test('공고: 리드 + 영업 중 + 담당자 업무(마감 = 참가신청 마감 전날) + 일정 4건(회사 캘린더) + 알림 · 다시 넘기면 409', async () => {
    const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N1', assigneeIds: [ctx.staffA.id, ctx.ownerId], note: '현장설명회 꼭 참석' });
    assert.equal(r.status, '영업 중'); assert.equal(r.due, addDays(today, 5), '참가신청 마감 전날');
    assert.equal(r.taskIds.length, 2, '담당자마다 업무'); assert.deepEqual(r.eventErrors, []); assert.equal(r.eventIds.length, 4, '현장설명회·참가신청·입찰 마감·개찰');
    assert.deepEqual(r.dates.map((d) => d.label), ['현장설명회', '참가신청 마감', '입찰 마감', '개찰']);
    const [lead] = await sql`select name, status, owner_id, src, next_contact_date::text as nd, memo from sales_leads where id = ${r.leadId}`;
    assert.deepEqual([lead.name, lead.status, lead.owner_id, lead.src.from, lead.src.id, lead.src.handoff, lead.nd], ['분당 스포츠센터 체육시설 위탁운영 용역', '신규리드', ctx.staffA.id, 'bid', 'N1', true, addDays(today, 5)]);
    assert.ok(lead.memo.includes('현장설명회 꼭 참석'));
    const [w] = await sql`select status, lead_id, data from sales_work_records where tenant = 'default' and src_tbl = 'opportunity_work' and ref_id = 'N1'`;
    assert.deepEqual([w.status, w.lead_id, w.data.notice_id], ['영업 중', r.leadId, 'N1']);
    const tasks = await sql`select title, assignee_id, due_date::text as due, space, sales_ref, lead_id, requested_by from tasks where id = any(${r.taskIds}::uuid[]) order by created_at`;
    assert.deepEqual(tasks.map((t) => [t.title, t.due, t.space, t.lead_id, t.sales_ref.kind, t.requested_by]).sort(), Array(2).fill(['[영업] 분당 스포츠센터 체육시설 위탁운영 용역 — 검토·첫 연락', addDays(today, 5), 'sales', r.leadId, 'bid', ctx.ownerId]));
    assert.deepEqual(tasks.map((t) => t.assignee_id).sort(), [ctx.staffA.id, ctx.ownerId].sort());
    const evs = await sql`select e.title, e.all_day, c.type, (select count(*)::int from event_attendees a where a.event_id = e.id) as att from events e join calendars c on c.id = e.calendar_id where e.id = any(${r.eventIds}::uuid[]) order by e.start_at`;
    assert.deepEqual(evs.map((e) => [e.title.split(' · ')[0], e.type, e.att]), [['[영업] 현장설명회', 'company', 2], ['[영업] 참가신청 마감', 'company', 2], ['[영업] 입찰 마감', 'company', 2], ['[영업] 개찰', 'company', 2]]);
    const [n] = await sql`select type, title, link from notifications where user_id = ${ctx.staffA.id} and type = 'assigned' and title like '영업 배정%' order by created_at desc limit 1`;
    assert.ok(n, '배정 알림'); assert.equal(n.link, `/s/sales/leads?id=${r.leadId}`);
    assert.equal((await sql`select count(*)::int as c from notifications where user_id = ${ctx.ownerId} and title like '영업 배정%'`)[0].c, 0, '넘긴 본인에게는 알림 없음');
    // 화면: 진행 중 탭 행에 리드 연결(workLeadId) · 다시 넘기면 409
    const b = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working');
    const n1 = b.items.find((x) => x.id === 'N1'); assert.ok(n1); assert.equal(n1.workLeadId, r.leadId); assert.equal(n1.work, '영업 중');
    const again = await ctx.owner.req('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N1', assigneeIds: [ctx.staffA.id] });
    assert.equal(again.status, 409); assert.equal(again.body.error.code, 'already');
  });
  test('지난 공고: 일정 없음, 업무 마감 = 3일 뒤 · 영업 직원도 넘길 수 있음', async () => {
    const r = await ctx.staffA.client.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N2', assigneeIds: [ctx.staffA.id] });
    assert.equal(r.eventIds.length, 0); assert.deepEqual(r.dates, []); assert.equal(r.due, addDays(today, 3)); assert.equal(r.taskIds.length, 1);
    const [t] = await sql`select assignee_id, requested_by from tasks where id = ${r.taskIds[0]}`; assert.deepEqual([t.assignee_id, t.requested_by], [ctx.staffA.id, ctx.staffA.id]);
  });
  test('영업 DB(신규단지·시설·협력사): 리드 + 원 행 영업 중 + 허브 화면 leadId', async () => {
    for (const [kind, id, tab, nameExp] of [['building', 'B1', 'buildings', '판교 새단지'], ['facility', 'F1', 'facilities', '수원 아파트 커뮤니티'], ['vendor', 'V1', 'vendors', '좋은관리(주)']]) {
      const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind, id, assigneeIds: [ctx.staffA.id] });
      const [lead] = await sql`select name, owner_id from sales_leads where id = ${r.leadId}`; assert.deepEqual([lead.name, lead.owner_id], [nameExp, ctx.staffA.id], kind);
      const h = await ctx.owner.ok('GET', `/api/sales/src?view=hub&tab=${tab}`);
      const it = h.items.find((x) => x.id === id); assert.ok(it, `${kind} 허브에 보임`);
      assert.equal(it.work?.leadId ?? it.leadId, r.leadId, `${kind} 허브 행에 리드 연결`);
      assert.equal(kind === 'building' ? it.work?.status : kind === 'facility' ? it.contact : it.status, '영업 중', `${kind} 영업 중`);
    }
    const [f] = await sql`select status, data from sales_work_records where tenant = 'default' and src_tbl = 'operating_facility_prospects__progress' and ref_id = 'F1'`;
    assert.deepEqual([f.status, f.data.contact_status], ['영업 중', '영업 중']);
  });
});

// 대표 10/21 12:00 영업 재편 2): [배정 이전으로 되돌리기] — 업무·일정 취소(활동 기록), 원 행 넘기기 전 상태로(lead_id 해제), 리드 '되돌림'·상태 기록·알림, 다시 넘기기 가능 · 권한(담당자·넘긴 사람·관리자)
describe('배정 이전으로 되돌리기', () => {
  test('담당자가 되돌림 → 업무·일정 취소, 원 행 복구, 리드 되돌림, 알림 · 관계없는 직원 403 · 다시 넘기기 가능', async () => {
    const today0 = seoulToday();
    await put('procurement_notices', { id: 'N3', title: '되돌리기 공고', issuer: '구청', related: true, first_seen_at: today0, deadline_at: `${addDays(today0, 5)}T10:00`, site_briefing_at: `${addDays(today0, 2)}T14:00` });
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: 'N3', status: '검토중', memo: '넘기기 전 메모' });
    const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N3', assigneeIds: [ctx.staffA.id] });
    assert.equal(r.taskIds.length, 1); assert.equal(r.eventIds.length, 2);
    const [src] = await sql`select src from sales_leads where id = ${r.leadId}`; assert.deepEqual([src.src.taskIds, src.src.eventIds], [r.taskIds, r.eventIds], '리드에 업무·일정 id 보관');
    await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['sales'] });
    assert.equal((await ctx.staffB.client.req('POST', '/api/sales/work/handoff/revert', { leadId: r.leadId })).status, 403, '관계없는 영업 직원');
    const v = await ctx.staffA.client.ok('POST', '/api/sales/work/handoff/revert', { leadId: r.leadId, reason: '담당 변경' });
    assert.deepEqual([v.status, v.tasks, v.events, v.rows], ['되돌림', 1, 2, 1]);
    assert.equal((await sql`select count(*)::int c from tasks where id = any(${r.taskIds}::uuid[]) and deleted_at is not null`)[0].c, 1, '업무 취소(소프트 삭제)');
    assert.equal((await sql`select count(*)::int c from activities where entity_type = 'task' and entity_id = any(${r.taskIds}::uuid[]) and action = 'canceled'`)[0].c, 1, '활동 기록');
    assert.equal((await sql`select count(*)::int c from events where id = any(${r.eventIds}::uuid[]) and deleted_at is not null`)[0].c, 2, '일정 취소');
    const [w] = await sql`select status, lead_id, data from sales_work_records where tenant = 'default' and src_tbl = 'opportunity_work' and ref_id = 'N3'`;
    assert.deepEqual([w.status, w.lead_id, w.data.memo, w.data.lead_id ?? null], ['검토중', null, '넘기기 전 메모', null], '원 행 넘기기 전 상태로');
    const [l] = await sql`select status, src from sales_leads where id = ${r.leadId}`; assert.equal(l.status, '되돌림'); assert.equal(l.src.reverted.reason, '담당 변경');
    assert.equal((await sql`select count(*)::int c from sales_status_log where lead_id = ${r.leadId} and to_status = '되돌림'`)[0].c, 1);
    assert.equal((await sql`select count(*)::int c from notifications where user_id = ${ctx.ownerId} and title like '영업 배정 취소%'`)[0].c, 0, '되돌린 본인(담당)에게는 없음·넘긴 사람은 담당 아님');
    const b = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working'); const n3 = b.items.find((x) => x.id === 'N3'); assert.equal(n3.workLeadId, null); assert.equal(n3.work, '검토중');
    assert.equal((await ctx.staffA.client.req('POST', '/api/sales/work/handoff/revert', { leadId: r.leadId })).status, 409, '두 번 되돌리기');
    const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${r.leadId}`); assert.equal(d.lead.status, '되돌림'); assert.equal(d.raw.handoff, true, 'raw 에 src 펼쳐짐'); assert.equal(d.raw.reverted.reason, '담당 변경');
    const r2 = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N3', assigneeIds: [ctx.ownerId] }); assert.notEqual(r2.leadId, r.leadId, '다시 넘기면 새 리드');
  });
});
