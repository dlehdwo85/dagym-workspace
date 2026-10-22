// #429 (대표 10/22 23:15) 팀별·양식별 다단계 결재: (양식 × 부서·팀) 배정 · 소속 장(팀장·본부장) 단계 · 1차·2차·3차 순서대로 알림·승인 · 중간 반려 사유
// · 양식 기본보다 팀 배정 우선 · 조건 단계(n일 이상이면 대표 추가) · 부재 대결 · 다른 회사 대표에게 알림이 가지 않음 · 예시 결재선 · 권한
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, addDays, bootstrap, resetDb, seoulToday, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql;
const P = {};
const today = seoulToday();
const nextMon = (() => { let d = addDays(today, 7); while (new Date(d + 'T00:00:00Z').getUTCDay() !== 1) d = addDays(d, 1); return d; })();
const invite = async (k, name, unit) => {
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: `${k}@dagym.test`, name, role: 'staff', orgUnitIds: [unit] });
  const c = new Client(k); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: `${k}-pass-1234` });
  return { c, id: (await c.ok('GET', '/api/auth/me')).user.id };
};
const leave = (c, from, to, extra = {}) => c.ok('POST', '/api/approvals/requests', { kind: 'leave', data: { leave_type: '연차', period: { from, to }, reason: '개인 사유', ...extra } });
const steps = (taskId) => sql`select step, label, approver_type, approver_user_id, approver_role, status, comment from task_approvals where task_id = ${taskId} and round = (select max(round) from task_approvals where task_id = ${taskId}) order by step`;
const notes = (userId, taskId) => sql`select title, body from notifications where user_id = ${userId} and entity_id = ${taskId} order by created_at`;

before(async () => {
  await resetDb(); srv = await startServer(); sql = testDb(); ctx = await bootstrap();
  P.bonbu = await invite('bonbu', '박본부장', ctx.hq);
  P.lead = await invite('saleslead', '한팀장', ctx.hq);
  P.sales = await invite('sales1', '정영업', ctx.hq);
  P.ops = await invite('ops1', '오운영', ctx.siteB); // 다른 현장 — 지정 결재자(최매니저·현장A)가 원래는 볼 수 없는 업무
  P.dept = (await ctx.owner.ok('POST', '/api/teams', { name: '영업부', kind: 'dept', members: [{ userId: P.bonbu.id, lead: true }] })).id;
  P.team = (await ctx.owner.ok('POST', '/api/teams', { name: '영업1팀', kind: 'team', parentId: P.dept, members: [{ userId: P.lead.id, lead: true }, { userId: P.sales.id, lead: false }] })).id;
  P.opsTeam = (await ctx.owner.ok('POST', '/api/teams', { name: '운영팀', kind: 'dept', members: [{ userId: P.ops.id, lead: true }] })).id;
  // 다른 회사(대표 1명) — 대표 단계 알림이 회사 밖으로 새지 않는지
  await sql`insert into tenants (id, name) values ('t_appr', '남의회사') on conflict do nothing`;
  P.otherOwner = (await sql`insert into users (email, name, role, status, tenant) values ('boss@other-appr.test', '남대표', 'owner', 'active', 't_appr') returning id`)[0].id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('#429 팀별·양식별 다단계 결재', () => {
  test('예시 결재선(2단계·3단계·휴가 조건) · 결재선 회사 기록 · 배정 권한(직원 404) · 다른 회사 결재선 404', async () => {
    P.L3 = (await ctx.owner.ok('POST', '/api/approval-lines/templates', { preset: 'three' })).id;
    P.L2t = (await ctx.owner.ok('POST', '/api/approval-lines/templates', { preset: 'two' })).id;
    P.LC = (await ctx.owner.ok('POST', '/api/approval-lines/templates', { preset: 'leave3' })).id;
    const lines = (await ctx.owner.ok('GET', '/api/approval-lines')).lines;
    const l3 = lines.find((l) => l.id === P.L3);
    assert.deepEqual(l3.steps.map((s) => [s.label, s.type, s.up ?? s.role]), [['팀장', 'lead', 0], ['본부장', 'lead', 1], ['대표', 'role', 'owner']]);
    assert.deepEqual(lines.find((l) => l.id === P.LC).steps[1].when, { minDays: 3 });
    assert.equal((await sql`select tenant from approval_lines where id = ${P.L3}`)[0].tenant, 'default', '회사 전체 결재선도 만든 사람의 회사로(예전엔 빠졌음)');
    P.L2 = (await ctx.owner.ok('POST', '/api/approval-lines', { name: '운영 2단계', steps: [{ label: '현장관리자', type: 'user', userId: ctx.managerA.id }, { label: '대표', type: 'role', role: 'owner' }] })).id;
    P.L1 = (await ctx.owner.ok('POST', '/api/approval-lines', { name: '대표 1단계', steps: [{ label: '대표', type: 'role', role: 'owner' }] })).id;
    // 조건 단계만 있는 결재선은 안 됨 · 다른 회사 사람을 결재자로 넣을 수 없음
    assert.equal((await ctx.owner.req('POST', '/api/approval-lines', { name: 'x', steps: [{ label: '대표', type: 'role', role: 'owner', when: { minDays: 3 } }] })).status, 400);
    assert.equal((await ctx.owner.req('POST', '/api/approval-lines', { name: 'x', steps: [{ label: '남', type: 'user', userId: P.otherOwner }] })).status, 404);
    // 다른 회사 결재선: 고치기·배정 404
    const other = (await sql`insert into approval_lines (name, steps, tenant) values ('남의 결재선', '[{"label":"대표","type":"role","role":"owner"}]'::jsonb, 't_appr') returning id`)[0].id;
    assert.equal((await ctx.owner.req('PATCH', `/api/approval-lines/${other}`, { name: '뺏기', steps: [{ label: '대표', type: 'role', role: 'owner' }] })).status, 404);
    assert.equal((await ctx.owner.req('PUT', '/api/approval-lines/assignments', { kind: 'leave', teamId: P.dept, lineId: other })).status, 404);
    assert.ok(!(await ctx.owner.ok('GET', '/api/approval-lines')).lines.some((l) => l.id === other));
    // 직원은 배정 보기·바꾸기·확인 모두 못 함
    assert.equal((await ctx.staffA.client.req('GET', '/api/approval-lines/assignments')).status, 404);
    assert.ok([403, 404].includes((await ctx.staffA.client.req('PUT', '/api/approval-lines/assignments', { kind: 'leave', teamId: null, lineId: P.L1 })).status));
    assert.equal((await ctx.staffA.client.req('GET', `/api/approval-lines/resolve?userId=${ctx.staffA.id}`)).status, 404);
  });

  test('배정: 휴가 × 영업부 = 3단계, 휴가 × 운영팀 = 2단계, 휴가 양식 기본 = 대표 1단계 — 목록·부서 트리', async () => {
    // 양식 기본(휴가 × 회사 전체)은 양식 화면에서 — 배정 표에도 같은 값
    const leaveForm = (await ctx.owner.ok('GET', '/api/approvals/forms')).forms.find((f) => f.kind === 'leave');
    await ctx.owner.ok('POST', '/api/approvals/forms', { kind: 'leave', name: leaveForm.name, fields: leaveForm.fields, lineId: P.L1 });
    await ctx.owner.ok('PUT', '/api/approval-lines/assignments', { kind: 'leave', teamId: P.dept, lineId: P.L3 });
    await ctx.owner.ok('PUT', '/api/approval-lines/assignments', { kind: 'leave', teamId: P.opsTeam, lineId: P.L2 });
    const a = await ctx.owner.ok('GET', '/api/approval-lines/assignments');
    const key = (r) => `${r.kind}:${r.team_id ?? '-'}:${r.line_id}`;
    assert.deepEqual(a.assignments.map(key).sort(), [`leave:-:${P.L1}`, `leave:${P.dept}:${P.L3}`, `leave:${P.opsTeam}:${P.L2}`].sort(), '양식 기본도 배정 표에(휴가 × 회사 전체)');
    assert.equal(a.teams.find((t) => t.id === P.team).path, '영업부 › 영업1팀');
    assert.equal(a.teams.find((t) => t.id === P.dept).lead_name, '박본부장');
    assert.equal((await ctx.owner.ok('GET', '/api/approvals/forms')).forms.find((f) => f.kind === 'leave').lineId, P.L1);
  });

  test('① 영업1팀 직원 휴가 → 미리보기 1차 한팀장 → 2차 박본부장 → 3차 김대표(양식×팀 배정, 상위 부서) → 순서대로 알림·승인 → 완료 · 다른 회사 대표 알림 0', async () => {
    const pv = await P.sales.c.ok('GET', '/api/approvals/line-preview?kind=leave');
    assert.deepEqual([pv.lineId, pv.source, pv.via], [P.L3, 'kind_team', '영업부'], '팀 배정이 양식 기본(대표 1단계)보다 먼저 · 팀에 없으면 상위 부서');
    assert.deepEqual(pv.steps.map((s) => [s.order, s.label, s.names.join()]), [[1, '팀장', '한팀장'], [2, '본부장', '박본부장'], [3, '대표', '김대표']]);
    const r = await leave(P.sales.c, nextMon, addDays(nextMon, 1));
    P.t1 = r.taskId;
    const st = await steps(r.taskId);
    assert.deepEqual(st.map((s) => [s.step, s.label, s.approver_type, s.approver_user_id ?? s.approver_role, s.status]),
      [[1, '팀장', 'user', P.lead.id, 'pending'], [2, '본부장', 'user', P.bonbu.id, 'waiting'], [3, '대표', 'role', 'owner', 'waiting']], '소속 장은 올릴 때 사람으로 정해 둠');
    const ln = (await notes(P.lead.id, r.taskId)).find((n) => /결재 요청 \(팀장\)/.test(n.title));
    assert.ok(ln, '1차 팀장에게 결재 요청'); assert.match(ln.body, /1차 결재 · 총 3단계/);
    assert.ok(!(await notes(P.bonbu.id, r.taskId)).some((n) => /결재 요청/.test(n.title)), '2차는 1차 승인 전까지 알림 없음');
    assert.equal((await P.bonbu.c.req('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' })).status, 403, '2차 결재자는 1차 전에 못 함');
    assert.equal((await P.lead.c.ok('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' })).status, 'next');
    const bn = (await notes(P.bonbu.id, r.taskId)).filter((n) => /결재 요청/.test(n.title));
    assert.equal(bn.length, 1); assert.match(bn[0].title, /결재 요청 \(본부장\)/); assert.match(bn[0].body, /2차 결재 · 총 3단계 · 1차 팀장 승인/);
    assert.equal((await ctx.owner.req('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' })).status, 403, '3차(대표)는 2차 전에 못 함');
    assert.equal((await P.bonbu.c.ok('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' })).status, 'next');
    assert.ok((await notes(ctx.ownerId, r.taskId)).some((n) => /결재 요청 \(대표\)/.test(n.title) && /3차 결재/.test(n.body)), '3차 대표에게');
    assert.equal((await ctx.owner.ok('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' })).status, 'done');
    const [req] = await sql`select status, event_id from approval_requests where task_id = ${r.taskId}`;
    assert.equal(req.status, 'approved'); assert.ok(req.event_id, '휴가 일정 자동 등록');
    assert.ok((await notes(P.sales.id, r.taskId)).some((n) => /최종 결재 완료/.test(n.title) && /3차 대표 승인으로 완료/.test(n.body)));
    assert.equal((await sql`select count(*)::int n from notifications where user_id = ${P.otherOwner}`)[0].n, 0, '다른 회사 대표에게는 알림이 가지 않음(예전 버그)');
    // 업무 상세: 3단계 모두 승인, 결재자 이름
    const d = await P.sales.c.ok('GET', `/api/tasks/${r.taskId}`);
    assert.deepEqual(d.approvals.filter((x) => x.round === 1).map((x) => [x.step, x.status]), [[1, 'approved'], [2, 'approved'], [3, 'approved']]);
  });

  test('② 운영팀(2단계) → 다른 현장의 지정 결재자(최매니저)도 결재 업무를 보고 승인 → 대표 → 2단계로 끝', async () => {
    const pv = await P.ops.c.ok('GET', '/api/approvals/line-preview?kind=leave');
    assert.deepEqual([pv.lineId, pv.source, pv.via, pv.steps.map((s) => s.names.join())], [P.L2, 'kind_team', '운영팀', ['최매니저', '김대표']]);
    const r = await leave(P.ops.c, nextMon, nextMon);
    assert.equal((await steps(r.taskId)).length, 2);
    assert.equal((await ctx.managerA.client.get(`/api/tasks/${r.taskId}`)).status, 200, '결재자는 다른 현장 업무여도 결재 업무를 봄');
    assert.equal((await ctx.managerA.client.ok('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' })).status, 'next');
    assert.equal((await ctx.owner.ok('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' })).status, 'done');
    assert.equal((await sql`select status from approval_requests where task_id = ${r.taskId}`)[0].status, 'approved');
    assert.equal((await ctx.staffB.client.get(`/api/tasks/${r.taskId}`)).status, 404, '결재와 무관한 사람은 그대로 404');
  });

  test('③ 중간(2차) 반려 → 사유와 함께 기안자에게 · 반려 상태·사유 · 업무 진행 중으로', async () => {
    const r = await leave(P.sales.c, addDays(nextMon, 7), addDays(nextMon, 8));
    await P.lead.c.ok('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' });
    assert.equal((await P.bonbu.c.req('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'reject' })).status, 400, '사유 필수');
    assert.equal((await P.bonbu.c.ok('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'reject', comment: '분기 마감 주간이라 다음 주로 옮겨 주세요' })).status, 'rejected');
    const [req] = await sql`select status, reject_reason from approval_requests where task_id = ${r.taskId}`;
    assert.deepEqual([req.status, req.reject_reason], ['rejected', '분기 마감 주간이라 다음 주로 옮겨 주세요']);
    const n = (await notes(P.sales.id, r.taskId)).find((x) => /결재 반려/.test(x.title));
    assert.match(n.title, /결재 반려 \(2차 본부장\)/); assert.equal(n.body, '분기 마감 주간이라 다음 주로 옮겨 주세요');
    assert.equal((await sql`select status from tasks where id = ${r.taskId}`)[0].status, 'in_progress');
    assert.deepEqual((await steps(r.taskId)).map((s) => s.status), ['approved', 'rejected', 'waiting']);
    assert.ok(!(await notes(ctx.ownerId, r.taskId)).some((x) => /결재 요청/.test(x.title)), '3차(대표)까지 가지 않음');
  });

  test('④ 우선순위: 팀 배정 > 양식 기본(대표 1단계) > 팀 기본(모든 양식 × 팀) > 회사 기본 — 소속 없는 직원은 양식 기본', async () => {
    const a = await ctx.staffA.client.ok('GET', '/api/approvals/line-preview?kind=leave');
    assert.deepEqual([a.lineId, a.source], [P.L1, 'form'], '부서·팀이 없으면 양식 기본');
    // 팀 기본(운영팀 모든 양식 = 3단계 예시)은 휴가에선 팀 배정에 밀리고, 배정 없는 지출결의에선 쓰임
    await ctx.owner.ok('PUT', '/api/approval-lines/assignments', { kind: '*', teamId: P.opsTeam, lineId: P.L2t });
    assert.equal((await P.ops.c.ok('GET', '/api/approvals/line-preview?kind=leave')).lineId, P.L2);
    const e = await P.ops.c.ok('GET', '/api/approvals/line-preview?kind=expense');
    assert.deepEqual([e.lineId, e.source, e.via], [P.L2t, 'team', '운영팀']);
    // 회사 기본(모든 양식 × 회사 전체) — 영업1팀 구매에 적용(팀 기본·양식 기본 없음)
    await ctx.owner.ok('PUT', '/api/approval-lines/assignments', { kind: '*', teamId: null, lineId: P.L1 });
    const pu = await P.sales.c.ok('GET', '/api/approvals/line-preview?kind=purchase');
    assert.deepEqual([pu.lineId, pu.source], [P.L1, 'company']);
    // 작성자가 직접 고른 결재선이 가장 먼저
    assert.deepEqual([(await P.sales.c.ok('GET', `/api/approvals/line-preview?kind=leave&lineId=${P.L1}`)).source], ['chosen']);
    // 지우기
    await ctx.owner.ok('PUT', '/api/approval-lines/assignments', { kind: '*', teamId: null, lineId: null });
    assert.notEqual((await P.sales.c.ok('GET', '/api/approvals/line-preview?kind=purchase')).source, 'company');
  });

  test('⑤ 조건 단계: 휴가 × 영업1팀 = 팀장 + (3일 이상이면) 대표 — 2일은 1단계, 3일은 2단계, 반차 0.5일 · 미리보기에 건너뜀 표시', async () => {
    await ctx.owner.ok('PUT', '/api/approval-lines/assignments', { kind: 'leave', teamId: P.team, lineId: P.LC });
    const d2 = JSON.stringify({ period: { from: nextMon, to: addDays(nextMon, 1) }, leave_type: '연차' });
    const p2 = await P.sales.c.ok('GET', `/api/approvals/line-preview?kind=leave&d=${encodeURIComponent(d2)}`);
    assert.deepEqual([p2.lineId, p2.via], [P.LC, '영업1팀'], '더 가까운 팀 배정이 상위 부서 배정보다 먼저');
    assert.deepEqual(p2.steps.map((s) => [s.order, s.label, s.skipped, s.cond]), [[1, '팀장', false, null], [null, '대표', true, '3일 이상일 때']]);
    const r2 = await leave(P.sales.c, addDays(nextMon, 14), addDays(nextMon, 15));
    assert.deepEqual((await steps(r2.taskId)).map((s) => s.label), ['팀장'], '2일 = 대표 단계 건너뜀');
    const r3 = await leave(P.sales.c, addDays(nextMon, 21), addDays(nextMon, 23));
    assert.deepEqual((await steps(r3.taskId)).map((s) => s.label), ['팀장', '대표'], '3일(평일) = 대표 추가');
    const rw = await leave(P.sales.c, addDays(nextMon, 25), addDays(nextMon, 28)); // 금~월 = 평일 2일
    assert.deepEqual((await steps(rw.taskId)).map((s) => s.label), ['팀장'], '주말은 일수에서 뺌');
    const rh = await leave(P.sales.c, addDays(nextMon, 35), addDays(nextMon, 35), { leave_type: '반차(오전)' });
    assert.equal((await steps(rh.taskId)).length, 1);
    assert.equal((await P.lead.c.ok('POST', `/api/tasks/${r2.taskId}/approval`, { decision: 'approve' })).status, 'done', '1단계로 끝');
  });

  test('⑥ 대결: 지정 결재자(최매니저)가 오늘 부재·대리인(이직원) → 대리인 결재할 것 목록·승인([대결] 기록) → 대표', async () => {
    await ctx.managerA.client.ok('PUT', '/api/account/away', { from: today, to: addDays(today, 2), deputyId: ctx.staffA.id, note: '출장' });
    const r = await leave(P.ops.c, addDays(nextMon, 2), addDays(nextMon, 2));
    assert.ok((await notes(ctx.staffA.id, r.taskId)).some((n) => /결재 요청 \(현장관리자\)/.test(n.title)), '대리인에게도 결재 요청 알림');
    const todo = await ctx.staffA.client.ok('GET', '/api/approvals/requests?view=todo');
    assert.ok(todo.requests.some((x) => x.task_id === r.taskId && x.my_turn), '대리인의 결재할 것 목록에');
    assert.equal((await ctx.staffA.client.get(`/api/tasks/${r.taskId}`)).status, 200, '대리인은 결재 업무를 봄');
    assert.equal((await ctx.staffA.client.ok('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve', comment: '대신 확인' })).status, 'next');
    assert.equal((await steps(r.taskId))[0].comment, '[대결] 대신 확인');
    assert.equal((await ctx.staffB.client.req('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' })).status, 404, '무관한 사람은 여전히 못 봄');
    await ctx.managerA.client.ok('DELETE', '/api/account/away');
    assert.equal((await ctx.owner.ok('POST', `/api/tasks/${r.taskId}/approval`, { decision: 'approve' })).status, 'done');
  });

  test('누구에게 어떻게 적용되나(관리자 확인) · 소속 장이 없으면 올릴 때 이유와 함께 막힘', async () => {
    const res = await ctx.owner.ok('GET', `/api/approval-lines/resolve?userId=${P.sales.id}`);
    assert.equal(res.path, '영업부 › 영업1팀');
    const lv = res.results.find((x) => x.kind === 'leave');
    assert.deepEqual([lv.lineId, lv.sourceLabel, lv.via, lv.steps.map((s) => `${s.label}:${s.names.join()}:${s.cond ?? ''}`)], [P.LC, '양식 × 팀 배정', '영업1팀', ['팀장:한팀장:', '대표:김대표:3일 이상일 때']]);
    assert.equal(res.results.length, 6);
    assert.equal((await ctx.owner.req('GET', `/api/approval-lines/resolve?userId=${P.otherOwner}`)).status, 404, '다른 회사 사람 404');
    // 팀장 본인이 휴가 → 자기 결재는 건너뛰고 상위 부서장(박본부장)이 1차
    const pl = await P.lead.c.ok('GET', '/api/approvals/line-preview?kind=leave');
    assert.equal(pl.steps[0].names.join(), '박본부장', '본인이 장이면 그 위 부서의 장');
    // 소속 장이 없는 부서(장 해제) → 올릴 때 400 + 이유
    await ctx.owner.ok('PUT', '/api/approval-lines/assignments', { kind: 'trip', teamId: P.opsTeam, lineId: P.L3 });
    const bad = await P.ops.c.req('POST', '/api/approvals/requests', { kind: 'trip', data: { destination: '부산', period: { from: nextMon, to: nextMon }, purpose: '점검' } });
    assert.equal(bad.status, 400); assert.match(bad.body?.error?.message ?? '', /1차\(팀장\) 결재자가 없습니다/);
    assert.equal((await sql`select count(*)::int n from approval_requests where requester_id = ${P.ops.id} and kind = 'trip'`)[0].n, 0, '결재자가 없으면 업무·요청을 만들지 않음');
  });
});
