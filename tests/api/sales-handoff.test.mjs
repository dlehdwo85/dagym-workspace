// 대표 10/21 12:00 영업 재편 1): [영업 진행으로 넘기기] — 담당자 선택 → 리드(담당 = 첫 담당자) · 원 행 '영업 중' · 담당자마다 업무(검토·첫 연락)
// 196차 결정 15-35: 입찰 공고는 리드 없이 입찰 업무 1건(공동 담당·기한 = 참가신청/입찰 마감 전날) — 정기 점검·결과·정리는 sales-bid-split.test.mjs
// · 공고 일정(현장설명회·참가신청 마감·입찰 마감·개찰) → 회사 공용 캘린더(참석 = 담당자, 알림) · 배정 알림 · 같은 건 다시 넘기면 409 · 영업 밖 직원 404 · 전환 전 409
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootstrap, resetDb, startServer, testDb, seoulToday, addDays } from '../helpers.mjs';
import { fakeKapt } from '../fakeKapt.mjs';

let srv, ctx, sql, kaptSrv;
// #507 후속: 가짜 K-apt(로컬 10/23 실측 순서) — 광명푸르지오(같은 공고 두 줄)·한화포레나(첨부 칸 빈 줄)·목록 거절 공고
const KAPT_PORT = 3241;
const kapt = fakeKapt({ fail: new Set(['20261022999999999']), files: {
  '20261021092205298': [{ seq: 4329886, fileName: '커뮤니티 시설 위탁 운영업체 선정 입찰 공고.hwp' }],
  '20261022180315277': [{ seq: 5100001, fileName: '주민운동시설 위탁관리 입찰공고.hwp' }, { seq: 5100002, fileName: '과업내용서', body: Buffer.from('%PDF-1.4\n%x\n') }] } });
const today = seoulToday();
const put = (tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
before(async () => {
  kaptSrv = http.createServer(async (req, res) => { let body = ''; for await (const c of req) body += c; if (!kapt.handle(req, res, body)) { res.writeHead(404); res.end(); } });
  await new Promise((r) => kaptSrv.listen(KAPT_PORT, '127.0.0.1', r));
  await resetDb(); srv = await startServer({ SALES_COLLECT_TEST_BASE: `http://127.0.0.1:${KAPT_PORT}` }); sql = testDb(); ctx = await bootstrap();
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
after(async () => { srv?.proc.kill(); kaptSrv?.close(); await sql?.end(); });

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
  test('공고(결정 15-35): 리드 없이 입찰 업무 1건(주 담당 + 공동 담당, 246차 #772 마감 = 입찰 마감일 당일·마감 시각) + 입찰 진행 + 일정 2건(#771 현장설명회·입찰 마감) + 알림 · 다시 넘기면 409', async () => {
    const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N1', assigneeIds: [ctx.staffA.id, ctx.ownerId], note: '현장설명회 꼭 참석' });
    assert.deepEqual([r.status, r.leadId, r.due, r.dueTime, r.taskIds.length], ['입찰 진행', null, addDays(today, 8), '10:00', 1]);
    assert.match(r.dueText, /^\d+\/\d+\(.\) 10:00$/);
    assert.deepEqual(r.eventErrors, []); assert.equal(r.eventIds.length, 2, '현장설명회·입찰 마감만(참가신청·개찰은 업무 체크리스트에)');
    assert.deepEqual(r.dates.map((d) => d.label), ['현장설명회', '참가신청 마감', '입찰 마감', '개찰']);
    assert.equal((await sql`select count(*)::int c from sales_leads where src->>'id' = 'N1'`)[0].c, 0, '리드 없음');
    const [w] = await sql`select status, lead_id, data from sales_work_records where tenant = 'default' and src_tbl = 'opportunity_work' and ref_id = 'N1'`;
    assert.deepEqual([w.status, w.lead_id, w.data.notice_id, w.data.bid_task_id], ['입찰 진행', null, 'N1', r.taskIds[0]]);
    const [t] = await sql`select title, assignee_id, due_date::text as due, to_char(due_time, 'HH24:MI') as tm, space, sales_ref, lead_id, requested_by, description from tasks where id = ${r.taskIds[0]}`;
    assert.deepEqual([t.title, t.assignee_id, t.due, t.tm, t.space, t.lead_id, t.sales_ref.kind, t.requested_by], ['[입찰] 분당 스포츠센터 체육시설 위탁운영 용역', ctx.staffA.id, addDays(today, 8), '10:00', 'sales', null, 'bid', ctx.ownerId]);
    assert.ok(t.description.includes('현장설명회 꼭 참석'));
    assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${r.taskIds[0]}`).map((x) => x.user_id), [ctx.ownerId], '두 번째 담당자는 공동 담당');
    const evs = await sql`select e.title, e.all_day, c.type, (select count(*)::int from event_attendees a where a.event_id = e.id) as att from events e join calendars c on c.id = e.calendar_id where e.id = any(${r.eventIds}::uuid[]) order by e.start_at`;
    assert.deepEqual(evs.map((e) => [e.title.split(' · ')[0], e.type, e.att]), [['[입찰] 현장설명회', 'company', 2], ['[입찰] 입찰 마감', 'company', 2]]);
    const [n] = await sql`select type, title, link from notifications where user_id = ${ctx.staffA.id} and title like '입찰 업무:%' order by created_at desc limit 1`;
    assert.ok(n, '배정 알림'); assert.equal(n.link, `/tasks/${r.taskIds[0]}`);
    assert.equal((await sql`select count(*)::int as c from notifications where user_id = ${ctx.ownerId} and title like '입찰 업무:%'`)[0].c, 0, '넘긴 본인에게는 알림 없음');
    // 화면: 진행 중 탭 카드에 입찰 업무(workBid) · 다시 넘기면 409
    const b = await ctx.owner.ok('GET', '/api/sales/src?view=bids&tab=working');
    const n1 = b.items.find((x) => x.id === 'N1'); assert.ok(n1); assert.deepEqual([n1.workLeadId, n1.work, n1.workBid?.taskId], [null, '입찰 진행', r.taskIds[0]]);
    const again = await ctx.owner.req('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N1', assigneeIds: [ctx.staffA.id] });
    assert.equal(again.status, 409); assert.equal(again.body.error.code, 'already');
  });
  test('지난 공고: 일정 없음, 업무 마감 = 3일 뒤 · 영업 직원도 넘길 수 있음', async () => {
    const r = await ctx.staffA.client.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N2', assigneeIds: [ctx.staffA.id] });
    assert.equal(r.eventIds.length, 0); assert.deepEqual(r.dates, []); assert.equal(r.due, addDays(today, 3)); assert.equal(r.taskIds.length, 1);
    const [t] = await sql`select assignee_id, requested_by from tasks where id = ${r.taskIds[0]}`; assert.deepEqual([t.assignee_id, t.requested_by], [ctx.staffA.id, ctx.staffA.id]);
  });
  test('대표 #794: 담당 2명으로 넘기면 업무 1건(첫 사람 주 담당·나머지 공동 담당, 묶음 아님) — 댓글·첨부가 한 업무에 모임', async () => {
    await put('building_sales_pipeline', { id: 'B794', name: '공동 담당 단지', households: 900, region: '경기', status: '영업 전', first_seen_at: today });
    const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'building', id: 'B794', assigneeIds: [ctx.staffA.id, ctx.ownerId] });
    assert.equal(r.taskIds.length, 1, '업무 1건');
    const [t] = await sql`select assignee_id, batch_id, lead_id from tasks where id = ${r.taskIds[0]}`;
    assert.deepEqual([t.assignee_id, t.batch_id, t.lead_id], [ctx.staffA.id, null, r.leadId]);
    assert.deepEqual((await sql`select user_id from task_assignees where task_id = ${r.taskIds[0]}`).map((x) => x.user_id), [ctx.ownerId], '두 번째 = 공동 담당');
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffA.id} and type = 'task_assigned' and entity_id = ${r.taskIds[0]}`).length, '주 담당 배정 알림');
  });
  test('영업 DB(신규단지·시설·협력사): 리드 + 원 행 영업 중 + 허브 화면 leadId', async () => {
    for (const [kind, id, tab, nameExp] of [['building', 'B1', 'buildings', '판교 새단지'], ['facility', 'F1', 'facilities', '수원 아파트 커뮤니티'], ['vendor', 'V1', 'vendors', '좋은관리(주)']]) {
      const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind, id, assigneeIds: [ctx.staffA.id] });
      const [lead] = await sql`select name, owner_id from sales_leads where id = ${r.leadId}`; assert.deepEqual([lead.name, lead.owner_id], [nameExp, ctx.staffA.id], kind);
      const h = await ctx.owner.ok('GET', `/api/sales/src?view=hub&tab=${tab}`);
      const it = h.items.find((x) => x.id === id); assert.ok(it, `${kind} 허브에 보임`);
      assert.equal(it.work?.leadId ?? it.leadId, r.leadId, `${kind} 허브 행에 리드 연결`);
      assert.equal(kind === 'building' ? it.work?.status : kind === 'facility' ? it.contact : it.status, '영업 중', `${kind} 영업 중`);
      assert.equal(it.work?.handoff ?? it.handoff, true, `${kind} 카드 [되돌리기] 표시(#610)`);
    }
    const [f] = await sql`select status, data from sales_work_records where tenant = 'default' and src_tbl = 'operating_facility_prospects__progress' and ref_id = 'F1'`;
    assert.deepEqual([f.status, f.data.contact_status], ['영업 중', '영업 중']);
  });
});

// 대표 10/21 12:00 영업 재편 2): [배정 이전으로 되돌리기] — 업무·일정 취소(활동 기록), 원 행 넘기기 전 상태로(lead_id 해제), 리드 '되돌림'·상태 기록·알림, 다시 넘기기 가능 · 권한(담당자·넘긴 사람·관리자)
describe('배정 이전으로 되돌리기', () => {
  test('담당자가 되돌림 → 업무 취소, 원 행 복구, 리드 되돌림, 알림 · 관계없는 직원 403 · 다시 넘기기 가능(현장 영업 원천 — 입찰은 sales-bid-split)', async () => {
    await put('building_sales_pipeline', { id: 'B3', name: '되돌리기 단지', households: 800, region: '경기', status: '영업 전', first_seen_at: today });
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'building', id: 'B3', status: '검토중', memo: '넘기기 전 메모' });
    const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'building', id: 'B3', assigneeIds: [ctx.staffA.id] });
    assert.equal(r.taskIds.length, 1); assert.equal(r.eventIds.length, 0, '현장 영업 원천에는 공고 일정 없음');
    const [src] = await sql`select src from sales_leads where id = ${r.leadId}`; assert.deepEqual([src.src.taskIds, src.src.eventIds], [r.taskIds, []], '리드에 업무 id 보관');
    assert.equal((await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).items.find((x) => x.id === 'B3').work?.handoff, true, '#610 카드 [되돌리기] 표시');
    await ctx.owner.ok('PUT', '/api/admin/spaces/members', { userId: ctx.staffB.id, spaces: ['sales'] });
    assert.equal((await ctx.staffB.client.req('POST', '/api/sales/work/handoff/revert', { leadId: r.leadId })).status, 403, '관계없는 영업 직원');
    const v = await ctx.staffA.client.ok('POST', '/api/sales/work/handoff/revert', { leadId: r.leadId, reason: '담당 변경' });
    assert.deepEqual([v.status, v.tasks, v.events, v.rows], ['되돌림', 1, 0, 1]);
    assert.equal((await sql`select count(*)::int c from tasks where id = any(${r.taskIds}::uuid[]) and deleted_at is not null`)[0].c, 1, '업무 취소(소프트 삭제)');
    assert.equal((await sql`select count(*)::int c from activities where entity_type = 'task' and entity_id = any(${r.taskIds}::uuid[]) and action = 'canceled'`)[0].c, 1, '활동 기록');
    const [w] = await sql`select status, lead_id, data from sales_work_records where tenant = 'default' and src_tbl = 'opportunity_work' and ref_id = 'B3'`;
    assert.deepEqual([w.status, w.lead_id, w.data.memo, w.data.lead_id ?? null], ['검토중', null, '넘기기 전 메모', null], '원 행 넘기기 전 상태로');
    const [l] = await sql`select status, src from sales_leads where id = ${r.leadId}`; assert.equal(l.status, '되돌림'); assert.equal(l.src.reverted.reason, '담당 변경');
    assert.equal((await sql`select count(*)::int c from sales_status_log where lead_id = ${r.leadId} and to_status = '되돌림'`)[0].c, 1);
    assert.equal((await sql`select count(*)::int c from notifications where user_id = ${ctx.ownerId} and title like '영업 배정 취소%'`)[0].c, 0, '되돌린 본인(담당)에게는 없음·넘긴 사람은 담당 아님');
    const h = (await ctx.owner.ok('GET', '/api/sales/src?view=hub&tab=buildings')).items.find((x) => x.id === 'B3'); assert.deepEqual([h.work?.leadId ?? null, h.work?.status, !!h.work?.handoff], [null, '검토중', false]);
    const lv = (await ctx.owner.ok('GET', '/api/sales/src?view=leads')).leads.find((x) => x.id === r.leadId);
    assert.deepEqual([lv.status, lv.archive?.prev, lv.archive?.by], ['되돌림', '신규리드', '이직원'], '#614 되돌린 리드는 보관함(이전 단계·누가)');
    assert.equal((await ctx.staffA.client.req('POST', '/api/sales/work/handoff/revert', { leadId: r.leadId })).status, 409, '두 번 되돌리기');
    const d = await ctx.owner.ok('GET', `/api/sales/src?view=lead&id=${r.leadId}`); assert.equal(d.lead.status, '되돌림'); assert.equal(d.raw.handoff, true, 'raw 에 src 펼쳐짐'); assert.equal(d.raw.reverted.reason, '담당 변경');
    const r2 = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'building', id: 'B3', assigneeIds: [ctx.ownerId] }); assert.notEqual(r2.leadId, r.leadId, '다시 넘기면 새 리드');
  });
});

describe('#507 공고 첨부 자동(대표 10/23 15:50)', () => {
  test('넘기기 → 응답 뒤 공고 첨부를 받아 자료실 영업/공고에 한 번 저장 · 담당자 업무마다 연결(공고 첨부(자동)) · 30MB 넘는 파일은 설명에 실패 한 줄 · [공고 파일 붙이기] 다시 눌러도 중복 없음', async () => {
    let hits = 0;
    const fake = http.createServer((req, res) => {
      hits++;
      if (req.url.startsWith('/spec.hwp')) { res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '11' }); res.end('HWP-CONTENT'); return; }
      if (req.url.startsWith('/big.pdf')) { res.writeHead(200, { 'content-length': String(31 * 1024 * 1024) }); res.end(); return; }
      if (req.url.startsWith('/login.hwp')) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!DOCTYPE html><html><body>로그인이 필요합니다</body></html>'); return; }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => fake.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${fake.address().port}`;
    try {
      await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
      await put('procurement_notices', { id: 'N9', title: '커뮤니티센터 피트니스 위탁운영 업체 선정', complex_name: '광교 센트럴', issuer: '입주자대표회의', related: true, first_seen_at: today, deadline_at: `${addDays(today, 9)}T17:00`,
        attachment_urls: [{ url: `${base}/spec.hwp`, name: '입찰공고문.hwp' }, `${base}/big.pdf`, `/api/bids/file?u=${encodeURIComponent(`${base}/spec.hwp`)}&n=dup.hwp`, { url: `${base}/login.hwp`, name: '과업지시서.hwp' }] });
      const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N9', assigneeIds: [ctx.staffA.id, ctx.ownerId] });
      assert.equal(r.files, 3, '받을 첨부 3건(중계 주소는 원래 주소로 바꿔 같은 파일 1건으로)');
      assert.equal(r.taskIds.length, 1, '입찰 업무 1건(두 사람은 공동 담당)');
      // 응답 뒤(after)에 붙음 — 기다림
      let rows = [];
      for (let i = 0; i < 50 && rows.length < 1; i++) { await new Promise((ok) => setTimeout(ok, 200)); rows = await sql`select task_id, file_name, source, storage_key from attachments where task_id = any(${r.taskIds}::uuid[]) and deleted_at is null`; }
      assert.equal(rows.length, 1, '입찰 업무 1건에 1건');
      assert.ok(rows.every((a) => a.source === 'sales_auto' && a.file_name === '입찰공고문.hwp'), JSON.stringify(rows));
      assert.equal(new Set(rows.map((a) => a.storage_key)).size, 1, '같은 저장 파일(한 번만 저장)');
      const libs = await sql`select folder, space, source, file_name from library_files where ext_ref like 'salesfile:%' and deleted_at is null`;
      assert.deepEqual(libs.map((l) => [l.folder, l.space, l.source, l.file_name]), [['영업/공고/광교 센트럴 커뮤니티센터 피트니스 위탁운영 업체 선정', 'sales', 'sales_auto', '입찰공고문.hwp']]);
      let desc = '';
      for (let i = 0; i < 30 && !/자동 첨부 실패/.test(desc); i++) { await new Promise((ok) => setTimeout(ok, 200)); desc = (await sql`select description from tasks where id = ${r.taskIds[0]}`)[0].description; }
      assert.match(desc, /공고 첨부 3건 중 2건 자동 첨부 실패\(big\.pdf: 30MB 넘음 · 과업지시서\.hwp: 파일 대신 웹페이지\(로그인·세션 필요\)\) — 공고문 내려받기: \/s\/sales\/hub\?tab=bids&bt=working&bq=N9/, desc);
      const act = await sql`select changes from activities where entity_type = 'task' and entity_id = ${r.taskIds[0]} and action = 'file_attached'`;
      assert.equal(act[0].changes.from, 'sales_auto');
      // 업무 상세 [공고 파일 붙이기]: 이미 붙은 파일은 건너뜀, 실패 줄은 한 줄만(새로 씀) · 볼 수 없는 사람은 404
      const before = hits;
      const again = await ctx.owner.ok('POST', `/api/tasks/${r.taskIds[0]}/source-files`, {});
      assert.deepEqual([again.total, again.ok, again.failed.length], [3, 1, 2]);
      assert.equal(hits - before, 2, '자료실에 있는 파일은 다시 받지 않음(실패한 2건만 다시 시도)');
      assert.equal((await sql`select count(*)::int n from attachments where task_id = ${r.taskIds[0]} and deleted_at is null`)[0].n, 1, '중복 첨부 없음');
      const d2 = (await sql`select description from tasks where id = ${r.taskIds[0]}`)[0].description;
      assert.equal((d2.match(/자동 첨부 실패/g) ?? []).length, 1, '실패 줄 한 줄');
      assert.equal((await ctx.staffB.client.req('POST', `/api/tasks/${r.taskIds[0]}/source-files`, {})).status, 404);
      // 첨부 없는 공고(협력사 모집 등)는 건너뜀 · 공고가 아닌 업무는 400
      await put('procurement_notices', { id: 'N10', title: '협력업체 정기등록 안내', issuer: '건설사', related: true, first_seen_at: today });
      const r3 = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'N10', assigneeIds: [ctx.ownerId] });
      assert.equal(r3.files, 0);
      const plain = await ctx.owner.ok('POST', '/api/tasks', { title: '그냥 업무', assigneeId: ctx.ownerId, approvalRequired: false });
      assert.equal((await ctx.owner.req('POST', `/api/tasks/${plain.id}/source-files`, {})).status, 400);
    } finally { fake.close(); }
  });
  test('#507 후속 K-apt(로컬 10/23): 같은 공고 두 줄이면 업무 줄에 첨부가 없어도 다른 줄의 옛 주소 첨부를 세션 순서로 받음 · 첨부 칸이 빈 K-apt 공고는 그 자리에서 첨부 목록을 읽어 받고 줄에도 저장 · 목록을 못 읽으면 이유를 알림', async () => {
    const wait = async (q, ok) => { let v; for (let i = 0; i < 60; i++) { v = await q(); if (ok(v)) return v; await new Promise((r) => setTimeout(r, 200)); } return v; };
    // 광명푸르지오센트베르: 진행 기록·업무가 걸릴 줄(첨부 []) + 같은 공고 다른 줄(원본 영업관리가 저장한 옛 주소 첨부 1건)
    const g = { source_type: 'kapt_bid', source_external_id: '20261021092205298', title: '커뮤니티 시설 위탁 운영업체 선정', complex_name: '광명푸르지오센트베르', related: true, first_seen_at: today };
    await put('procurement_notices', { id: 'KA1', ...g, attachment_urls: [] });
    await put('procurement_notices', { id: 'KA2', ...g, attachment_urls: ['https://www.k-apt.go.kr/bid/bidFileDown.do?bidNum=20261021092205298&fileSeq=4329886'] });
    const r = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'KA1', assigneeIds: [ctx.ownerId] });
    assert.equal(r.files, 0, '이 줄 자체에는 첨부가 없음');
    const a1 = await wait(() => sql`select file_name, mime_type, source from attachments where task_id = ${r.taskIds[0]} and deleted_at is null`, (x) => x.length > 0);
    assert.deepEqual(a1.map((a) => [a.file_name, a.mime_type, a.source]), [['커뮤니티 시설 위탁 운영업체 선정 입찰 공고.hwp', 'application/x-hwp', 'sales_auto']]);
    const [lib] = await sql`select folder from library_files where file_name = '커뮤니티 시설 위탁 운영업체 선정 입찰 공고.hwp' and deleted_at is null`;
    assert.equal(lib.folder, '영업/공고/광명푸르지오센트베르 커뮤니티 시설 위탁 운영업체 선정');
    assert.ok(!kapt.calls.some((c) => c.path === '/kapt/bid/bidFileDown.do'), '옛 주소를 K-apt 에 그대로 부르지 않음(오류 화면)');
    // 한화포레나 평택화양: 첨부 칸 [] · 다른 줄 없음 → 그 자리에서 첨부 목록(세션) → 2건, 이름 없는 건 첫 바이트(%PDF)로 확장자
    await put('procurement_notices', { id: 'KB1', source_type: 'kapt_bid', source_external_id: '20261022180315277', title: '주민운동시설 위탁관리 업체 선정', complex_name: '한화포레나 평택화양', related: true, first_seen_at: today, attachment_urls: [] });
    const r2 = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'KB1', assigneeIds: [ctx.ownerId] });
    const a2 = await wait(() => sql`select file_name from attachments where task_id = ${r2.taskIds[0]} and deleted_at is null order by file_name collate "C"`, (x) => x.length >= 2);
    assert.deepEqual(a2.map((a) => a.file_name), ['과업내용서.pdf', '주민운동시설 위탁관리 입찰공고.hwp']);
    const [kb] = await sql`select row from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = 'KB1'`;
    assert.deepEqual(kb.row.attachment_urls.map((x) => x.name), ['주민운동시설 위탁관리 입찰공고.hwp', '과업내용서'], '목록 화면 공고문 내려받기도 생김(원래 이름)');
    assert.match(kb.row.attachment_urls[0].url, /\/kapt\/cmm\/file\/BID\/fileDownload\.do\?key=5100001&bidNum=20261022180315277$/); assert.ok(kb.row.files_checked_at);
    // [공고 파일 붙이기] 다시: 자료실에 있는 파일은 다시 받지 않고 중복 첨부 없음
    const again = await ctx.owner.ok('POST', `/api/tasks/${r2.taskIds[0]}/source-files`, {});
    assert.deepEqual([again.total, again.ok, again.failed.length], [2, 2, 0]);
    assert.equal((await sql`select count(*)::int n from attachments where task_id = ${r2.taskIds[0]} and deleted_at is null`)[0].n, 2);
    // K-apt 가 첨부 목록을 거절(보안 값) → 버튼이 이유를 알림
    await put('procurement_notices', { id: 'KC1', source_type: 'kapt_bid', source_external_id: '20261022999999999', title: '커뮤니티 운영 위탁', complex_name: '시험 단지', related: true, first_seen_at: today, attachment_urls: [] });
    const r3 = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: 'KC1', assigneeIds: [ctx.ownerId] });
    const fail = await ctx.owner.req('POST', `/api/tasks/${r3.taskIds[0]}/source-files`, {});
    assert.equal(fail.status, 502); assert.match(JSON.stringify(fail.body), /K-apt 첨부 목록을 읽지 못했습니다/);
  });
});
