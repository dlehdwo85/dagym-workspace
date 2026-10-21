// 로컬 10/20 19:10 (#114) 결재 화면 보강: ① 탭(todo·mine·cc·all) ② 결재선 미리 보기·변경·참조자 ③ 멈춘 단계 ④ 임시 저장·문서번호·반려 사유 ⑤ 양식 6종 ⑦ 결재할 것 수(알림 폴링)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrap, resetDb, startServer, testDb, BASE, addDays, seoulToday } from '../helpers.mjs';

let srv, ctx, sql;
before(async () => { await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });
const today = seoulToday();
const year = today.slice(0, 4);

describe('#114 결재 화면 보강', () => {
  let line2;
  test('⑤ 양식 6종 기본 칸 · ② 결재선 미리 보기(없음 → 만들면 기안→단계별 이름) · 다른 회사 결재선 404', async () => {
    const f = await ctx.staffA.client.ok('GET', '/api/approvals/forms');
    assert.deepEqual(f.forms.map((x) => x.kind), ['leave', 'expense', 'general', 'trip', 'purchase', 'family']);
    assert.ok(f.forms.find((x) => x.kind === 'trip').fields.some((x) => x.key === 'destination' && x.required));
    assert.ok(f.forms.find((x) => x.kind === 'family').fields.some((x) => x.key === 'event_type' && x.type === 'select'));
    const none = await ctx.staffA.client.ok('GET', '/api/approvals/line-preview?kind=trip');
    assert.equal(none.lineId, null); assert.deepEqual(none.steps, []); assert.equal(none.requester, '이직원');
    line2 = (await ctx.owner.ok('POST', '/api/approval-lines', { name: '매니저→대표', steps: [{ label: '검토', type: 'user', userId: ctx.managerA.id }, { label: '승인', type: 'role', role: 'owner' }] })).id;
    const p = await ctx.staffA.client.ok('GET', '/api/approvals/line-preview?kind=trip');
    assert.equal(p.lineId, line2); assert.equal(p.lineName, '매니저→대표'); assert.equal(p.missing, false);
    assert.deepEqual(p.steps.map((s) => [s.label, s.names]), [['검토', ['최매니저']], ['승인', ['김대표']]], '단계별 결재자 이름');
    assert.ok(p.lines.some((l) => l.id === line2), '고를 수 있는 결재선 목록');
    // 다른 회사 결재선 id 를 지정하면 404(숨김)
    const other = (await sql`insert into approval_lines (name, steps, tenant) values ('남의 회사', '[]'::jsonb, 'other-co') returning id`)[0].id;
    assert.equal((await ctx.staffA.client.req('GET', `/api/approvals/line-preview?kind=trip&lineId=${other}`)).status, 404);
    assert.equal((await ctx.staffA.client.req('POST', '/api/approvals/requests', { kind: 'trip', lineId: other, data: { destination: '부산', period: { from: today, to: today }, purpose: 'x' } })).status, 404);
  });
  let draftId, reqId, taskId;
  test('④ 임시 저장(필수 검사 없음) → 내가 올린 것 탭에 draft → 고치기 → 올리기(draftId) = 문서번호·참조자·알림', async () => {
    const d = await ctx.staffA.client.ok('POST', '/api/approvals/drafts', { kind: 'trip', data: { destination: '부산 현장' }, ccUserIds: [ctx.staffB.id] });
    draftId = d.id;
    const mine = await ctx.staffA.client.ok('GET', '/api/approvals/requests?view=mine');
    const row = mine.requests.find((r) => r.id === draftId);
    assert.equal(row.status, 'draft'); assert.equal(row.task_id, null); assert.deepEqual(row.cc_user_ids, [ctx.staffB.id]);
    assert.equal(mine.counts.mine, 1);
    assert.equal((await ctx.staffB.client.ok('GET', '/api/approvals/requests?view=cc')).requests.length, 0, '임시 저장은 참조자에게 안 보임');
    assert.equal((await ctx.owner.ok('GET', '/api/approvals/requests?view=all')).requests.some((r) => r.id === draftId), false, '관리자 전체에도 임시 저장은 없음');
    // 남의 임시 저장은 404
    assert.equal((await ctx.staffB.client.req('PATCH', `/api/approvals/drafts/${draftId}`, { kind: 'trip', data: {} })).status, 404);
    await ctx.staffA.client.ok('PATCH', `/api/approvals/drafts/${draftId}`, { kind: 'trip', data: { destination: '부산 현장', period: { from: addDays(today, 5), to: addDays(today, 6) }, purpose: '현장 점검', amount: '150000' }, ccUserIds: [ctx.staffB.id] });
    const r = await ctx.staffA.client.ok('POST', '/api/approvals/requests', { kind: 'trip', draftId, data: { destination: '부산 현장', period: { from: addDays(today, 5), to: addDays(today, 6) }, purpose: '현장 점검', amount: '150000' }, ccUserIds: [ctx.staffB.id] });
    reqId = r.id; taskId = r.taskId;
    assert.equal(reqId, draftId, '같은 건이 올라감'); assert.equal(r.docNo, `결재-${year}-0001`); assert.match(r.title, /^\[출장\] 이직원 부산 현장 \d\d-\d\d~\d\d-\d\d$/);
    const [row2] = await sql`select status, doc_no, line_id, amount, task_id from approval_requests where id = ${reqId}`;
    assert.deepEqual([row2.status, row2.doc_no, row2.line_id, row2.amount, row2.task_id], ['pending', `결재-${year}-0001`, line2, '150000', taskId]);
    assert.equal((await sql`select approval_line_id from tasks where id = ${taskId}`)[0].approval_line_id, line2);
    assert.ok((await sql`select 1 from notifications where user_id = ${ctx.staffB.id} and type = 'mention' and title like '결재 참조:%'`).length, '참조자 알림(목록만)');
    assert.equal((await ctx.staffB.client.ok('GET', '/api/approvals/requests?view=cc')).requests[0].id, reqId, '참조 탭');
    // 두 번째 문서번호는 0002
    const r2 = await ctx.staffA.client.ok('POST', '/api/approvals/requests', { kind: 'purchase', data: { item: '의자', qty: '2', amount: '90000', reason: '파손' } });
    assert.equal(r2.docNo, `결재-${year}-0002`);
  });
  test('① 내가 결재할 것(역할 단계 포함) · ③ 멈춘 단계·my_turn · ⑦ 알림 폴링 approvalsTodo', async () => {
    const m = await ctx.managerA.client.ok('GET', '/api/approvals/requests?view=todo');
    assert.equal(m.requests.length, 2); assert.ok(m.requests.every((r) => r.my_turn && r.stuck.label === '검토' && r.stuck.step === 1));
    assert.equal(m.counts.todo, 2);
    assert.equal((await ctx.owner.ok('GET', '/api/approvals/requests?view=todo')).requests.length, 0, '대표는 2단계라 아직 차례 아님');
    assert.equal((await ctx.managerA.client.ok('GET', '/api/notifications?unread=1')).approvalsTodo, 2, '휴대폰 상단 결재할 것 n건');
    assert.equal((await ctx.owner.ok('GET', '/api/notifications?unread=1')).approvalsTodo, 0);
    assert.equal((await ctx.staffB.client.ok('GET', '/api/approvals/requests?view=todo')).requests.length, 0, '참조자는 결재할 것 아님');
    // 매니저 승인 → 대표 차례(역할 단계) · 멈춘 단계 = 승인(2)
    await ctx.managerA.client.ok('POST', `/api/tasks/${taskId}/approval`, { decision: 'approve' });
    const o = await ctx.owner.ok('GET', '/api/approvals/requests?view=todo');
    assert.equal(o.requests.length, 1); assert.equal(o.requests[0].id, reqId); assert.equal(o.requests[0].stuck.label, '승인'); assert.equal(o.requests[0].steps[0].status, 'approved');
    assert.equal((await ctx.owner.ok('GET', '/api/notifications?unread=1')).approvalsTodo, 1);
    assert.equal((await ctx.managerA.client.ok('GET', '/api/approvals/requests?view=todo')).counts.todo, 1, '매니저는 남은 1건');
  });
  test('④ 반려 사유가 목록 줄에 · 승인 후 todo 0 · 임시 저장 지우기', async () => {
    await ctx.owner.ok('POST', `/api/tasks/${taskId}/approval`, { decision: 'reject', comment: '경비 산출 근거 보완' });
    const mine = await ctx.staffA.client.ok('GET', '/api/approvals/requests?view=mine');
    const row = mine.requests.find((r) => r.id === reqId);
    assert.equal(row.status, 'rejected'); assert.equal(row.reject_reason, '경비 산출 근거 보완'); assert.equal(row.steps[1].comment, '경비 산출 근거 보완');
    assert.equal((await ctx.owner.ok('GET', '/api/notifications?unread=1')).approvalsTodo, 0);
    const d = await ctx.staffA.client.ok('POST', '/api/approvals/drafts', { kind: 'family', data: { event_type: '출산' } });
    assert.equal((await ctx.staffA.client.ok('GET', '/api/approvals/requests?view=mine')).requests[0].id, d.id, '임시 저장이 맨 위');
    assert.equal((await ctx.staffB.client.req('DELETE', `/api/approvals/drafts/${d.id}`)).status, 404);
    await ctx.staffA.client.ok('DELETE', `/api/approvals/drafts/${d.id}`);
    assert.equal((await sql`select count(*)::int n from approval_requests where id = ${d.id}`)[0].n, 0);
    // 엑셀에 문서번호 열
    const x = await fetch(`${BASE}/api/approvals/requests/export?kind=purchase&month=${today.slice(0, 7)}`, { headers: { cookie: ctx.owner.cookie, origin: BASE } });
    assert.equal(x.status, 200);
  });
});
