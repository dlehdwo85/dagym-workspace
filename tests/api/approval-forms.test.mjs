// V30 ④ 결재 양식: 기본 양식(휴가·지출결의·품의) → 요청 = 결재 업무(검토 요청·결재선 1단계 알림) → 승인/반려(기존 결재 API) → 휴가 승인이면 연차 일정 자동 등록·근무 상태 휴가,
// 결재선 없으면 400 안내, 필수 칸 검사, 양식 편집은 관리자만(직원 403), 지출결의 승인 건 엑셀, 목록 범위(요청자·결재자·관리자)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE, addDays, seoulToday } from '../helpers.mjs';

let srv, ctx, sql, lineId;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const today = seoulToday();

describe('V30 ④ 결재 양식', () => {
  test('기본 양식 3종 · 결재선 없으면 400 안내 · 직원은 양식 편집 403/404', async () => {
    const f = await ctx.staffA.client.ok('GET', '/api/approvals/forms');
    assert.deepEqual(f.forms.map((x) => [x.kind, x.isDefault]), [['leave', true], ['expense', true], ['general', true]]); assert.equal(f.canEdit, false);
    assert.ok(f.forms[0].fields.some((x) => x.key === 'period' && x.type === 'daterange'));
    const r = await ctx.staffA.client.req('POST', '/api/approvals/requests', { kind: 'leave', data: { leave_type: '연차', period: { from: addDays(today, 3), to: addDays(today, 4) } } });
    assert.equal(r.status, 400); assert.match(r.body.error.message, /결재선이 없습니다/);
    assert.ok([403, 404].includes((await ctx.staffA.client.req('POST', '/api/approvals/forms', { kind: 'leave', name: 'x', fields: [{ key: 'a', label: 'a', type: 'text' }] })).status));
    lineId = (await ctx.owner.ok('POST', '/api/approval-lines', { name: '본사 결재', steps: [{ label: '대표', type: 'role', role: 'owner' }] })).id;
  });
  let leaveReq, leaveTask;
  test('휴가 요청 → 결재 업무(검토 상태·결재선·대표에게 결재 알림) → 대표 승인 → 승인 상태 + 연차 일정 자동 등록 + 근무 상태 휴가', async () => {
    const bad = await ctx.staffA.client.req('POST', '/api/approvals/requests', { kind: 'leave', data: { leave_type: '연차' } });
    assert.equal(bad.status, 400); assert.match(bad.body.error.message, /"기간"/, '필수 칸');
    const from = addDays(today, 3), to = addDays(today, 4);
    const r = await ctx.staffA.client.ok('POST', '/api/approvals/requests', { kind: 'leave', data: { leave_type: '연차', period: { from, to }, reason: '가족 행사' } });
    leaveReq = r.id; leaveTask = r.taskId;
    assert.match(r.title, /^\[휴가\] 이직원 연차 \d\d-\d\d~\d\d-\d\d$/); assert.equal(r.needsFile, false);
    const [t] = await sql`select status, task_type, approval_line_id, assignee_id, due_date::text, description from tasks where id = ${leaveTask}`;
    assert.deepEqual([t.status, t.task_type, t.approval_line_id, t.assignee_id, t.due_date], ['review', 'approval', lineId, ctx.staffA.id, from]);
    assert.match(t.description, /종류: 연차/); assert.match(t.description, /사유: 가족 행사/);
    assert.equal((await sql`select count(*)::int n from task_approvals where task_id = ${leaveTask} and status = 'pending'`)[0].n, 1);
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.ownerId} and type = 'review_requested' and link = ${`/tasks/${leaveTask}`}`).length, '대표에게 결재 요청 알림');
    const mine = await ctx.staffA.client.ok('GET', '/api/approvals/requests');
    assert.deepEqual([mine.requests.length, mine.requests[0].status, mine.requests[0].steps[0].label], [1, 'pending', '대표']);
    assert.equal((await ctx.staffB.client.ok('GET', '/api/approvals/requests')).requests.length, 0, '남의 요청은 안 보임');
    // 대표 승인(기존 결재 API)
    await ctx.owner.ok('POST', `/api/tasks/${leaveTask}/approval`, { decision: 'approve' });
    const [q] = await sql`select status, event_id from approval_requests where id = ${leaveReq}`;
    assert.equal(q.status, 'approved'); assert.ok(q.event_id, '연차 일정 만들어짐');
    const [ev] = await sql`select e.title, e.kind, e.all_day, e.created_by, c.type, c.owner_user_id from events e join calendars c on c.id = e.calendar_id where e.id = ${q.event_id}`;
    assert.deepEqual([ev.title, ev.kind, ev.all_day, ev.created_by, ev.type, ev.owner_user_id], ['연차 (이직원)', 'vacation', true, ctx.staffA.id, 'personal', ctx.staffA.id]);
    assert.equal((await sql`select status from tasks where id = ${leaveTask}`)[0].status, 'done');
    const sheet = await ctx.owner.ok('GET', `/api/attendance/sheet?day=${from}`);
    assert.deepEqual([sheet.rows.find((r) => r.id === ctx.staffA.id).away, sheet.rows.find((r) => r.id === ctx.staffA.id).missing], ['연차', false], '근태 표에 연차로(미기록 아님)');
  });
  test('반차 승인 → 반차(half_day) 일정 · 반려 → 반려 상태·일정 없음 · 지출결의 금액·엑셀(관리자만)', async () => {
    const d = addDays(today, 6);
    const half = await ctx.staffA.client.ok('POST', '/api/approvals/requests', { kind: 'leave', data: { leave_type: '반차(오후)', period: { from: d, to: d } } });
    await ctx.owner.ok('POST', `/api/tasks/${half.taskId}/approval`, { decision: 'approve' });
    const [hq] = await sql`select e.kind, e.all_day, to_char(e.start_at at time zone 'Asia/Seoul', 'HH24:MI') as s, to_char(e.end_at at time zone 'Asia/Seoul', 'HH24:MI') as e from approval_requests r join events e on e.id = r.event_id where r.id = ${half.id}`;
    assert.deepEqual([hq.kind, hq.all_day, hq.s, hq.e], ['half_day', false, '13:00', '18:00']);
    const rej = await ctx.staffB.client.ok('POST', '/api/approvals/requests', { kind: 'leave', data: { leave_type: '병가', period: { from: d, to: d } } });
    await ctx.owner.ok('POST', `/api/tasks/${rej.taskId}/approval`, { decision: 'reject', comment: '인원 부족' });
    const [rr] = await sql`select status, event_id from approval_requests where id = ${rej.id}`;
    assert.deepEqual([rr.status, rr.event_id], ['rejected', null]);
    const exp = await ctx.staffA.client.ok('POST', '/api/approvals/requests', { kind: 'expense', data: { used_on: today, item: '현장 소모품', amount: '45,000', method: '법인카드' } });
    assert.equal(exp.needsFile, true, '영수증 사진은 결재 업무에 첨부');
    assert.equal((await sql`select amount from approval_requests where id = ${exp.id}`)[0].amount, '45000');
    await ctx.owner.ok('POST', `/api/tasks/${exp.taskId}/approval`, { decision: 'approve' });
    const x = await fetch(`${BASE}/api/approvals/requests/export?kind=expense&month=${today.slice(0, 7)}`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(x.status, 200); assert.equal(Buffer.from(await x.arrayBuffer()).subarray(0, 2).toString(), 'PK');
    assert.equal((await fetch(`${BASE}/api/approvals/requests/export?kind=expense`, { headers: { cookie: ctx.staffA.client.cookie, origin: BASE } })).status, 403);
    const all = await ctx.owner.ok('GET', '/api/approvals/requests');
    assert.equal(all.requests.length, 4, '관리자는 전체'); assert.equal(all.isAdmin, true);
    assert.deepEqual(all.requests.filter((r) => r.kind === 'leave').map((r) => r.status).sort(), ['approved', 'approved', 'rejected']);
  });
  test('양식 편집(관리자): 칸 추가·기본 결재선 → 요청 때 새 칸 필수 검사·양식 결재선 사용', async () => {
    const line2 = (await ctx.owner.ok('POST', '/api/approval-lines', { name: '매니저 선결재', steps: [{ label: '매니저', type: 'user', userId: ctx.managerA.id }, { label: '대표', type: 'role', role: 'owner' }] })).id;
    const f = await ctx.owner.ok('POST', '/api/approvals/forms', { kind: 'general', name: '품의서(우리 회사)', lineId: line2, fields: [{ key: 'subject', label: '제목', type: 'text', required: true }, { key: 'body', label: '내용', type: 'textarea', required: true }, { key: 'vendor', label: '거래처', type: 'select', required: true, options: ['A사', 'B사'] }] });
    const forms = await ctx.staffA.client.ok('GET', '/api/approvals/forms');
    const g = forms.forms.find((x) => x.kind === 'general');
    assert.deepEqual([g.id, g.isDefault, g.name, g.lineName, g.fields.length], [f.id, false, '품의서(우리 회사)', '매니저 선결재', 3]);
    const bad = await ctx.staffA.client.req('POST', '/api/approvals/requests', { kind: 'general', data: { subject: '비품 구매', body: '의자 2개', vendor: 'C사' } });
    assert.equal(bad.status, 400); assert.match(bad.body.error.message, /"거래처"/);
    const ok = await ctx.staffA.client.ok('POST', '/api/approvals/requests', { kind: 'general', data: { subject: '비품 구매', body: '의자 2개', vendor: 'A사' } });
    assert.equal((await sql`select approval_line_id from tasks where id = ${ok.taskId}`)[0].approval_line_id, line2, '양식 기본 결재선');
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.managerA.id} and link = ${`/tasks/${ok.taskId}`}`).length, '1단계 매니저에게 알림');
    assert.equal((await ctx.managerA.client.ok('GET', '/api/approvals/requests')).requests.some((r) => r.id === ok.id), true, '결재자에게도 목록에');
    assert.equal((await ctx.owner.req('POST', '/api/approvals/forms', { kind: 'leave', name: 'x', fields: [{ key: 'a', label: 'a', type: 'text' }, { key: 'a', label: 'b', type: 'text' }] })).status, 400, '키 중복');
  });
});
