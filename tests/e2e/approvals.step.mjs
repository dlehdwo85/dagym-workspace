// V30 ④ 결재 양식: 직원이 휴가 신청(양식) → 결재 목록 '진행 중' → 대표가 결재 업무에서 [승인] → 목록 '승인 · 캘린더 등록됨' → 관리자 양식 편집 화면
import assert from 'node:assert/strict';

export async function approvalsFlow({ owner, staff, ctx, sql, BASE, SHOTS, addDays, today }) {
  // 앞 단계들이 만든 결재선과 섞이지 않게: E2E 결재선(대표 1단계)을 휴가 양식의 기본 결재선으로
  const lineId = (await ctx.owner.ok('POST', '/api/approval-lines', { name: 'E2E 결재선', steps: [{ label: '대표', type: 'role', role: 'owner' }] })).id;
  const forms = await ctx.owner.ok('GET', '/api/approvals/forms');
  const leave = forms.forms.find((f) => f.kind === 'leave');
  await (leave.id ? ctx.owner.ok('PATCH', `/api/approvals/forms/${leave.id}`, { kind: 'leave', name: leave.name, fields: leave.fields, lineId }) : ctx.owner.ok('POST', '/api/approvals/forms', { kind: 'leave', name: leave.name, fields: leave.fields, lineId }));
  const from = addDays(today, 10), to = addDays(today, 11);
  await staff.goto(BASE + '/approvals');
  await staff.getByTestId('approval-new-leave').click();
  await staff.getByTestId('af-leave_type').selectOption('연차');
  await staff.getByTestId('af-period-from').fill(from);
  await staff.getByTestId('af-period-to').fill(to);
  await staff.getByTestId('af-reason').fill('E2E 가족 행사');
  await staff.getByTestId('approval-submit').click();
  await staff.getByText(/결재 요청을 올렸습니다/).waitFor();
  const row = staff.getByTestId('approval-row').filter({ hasText: '[휴가] 이직원 연차' });
  await row.waitFor();
  assert.equal(await row.getAttribute('data-status'), 'pending');
  await staff.screenshot({ path: `${SHOTS}/131-approvals-staff.png` });
  const [req] = await sql`select r.task_id, r.status from approval_requests r join users u on u.id = r.requester_id where u.id = ${ctx.staffA.id} and r.kind = 'leave' order by r.created_at desc limit 1`;
  assert.equal(req.status, 'pending');
  // 대표: 결재 업무에서 승인
  await owner.goto(`${BASE}/tasks/${req.task_id}`);
  await owner.getByTestId('appr-approve').click();
  await owner.getByText(/승인|완료/).first().waitFor();
  await owner.waitForFunction(async (id) => (await (await fetch(`/api/approvals/requests`)).json()).requests.find((r) => r.task_id === id)?.status === 'approved', req.task_id, { timeout: 15000 });
  await owner.goto(BASE + '/approvals');
  const orow = owner.getByTestId('approval-row').filter({ hasText: '[휴가] 이직원 연차' });
  await orow.waitFor();
  assert.equal(await orow.getAttribute('data-status'), 'approved');
  assert.match(await orow.innerText(), /캘린더 등록됨/);
  const [ev] = await sql`select e.title, e.kind from approval_requests r join events e on e.id = r.event_id where r.task_id = ${req.task_id}`;
  assert.deepEqual([ev.title, ev.kind], ['연차 (이직원)', 'vacation']);
  await owner.screenshot({ path: `${SHOTS}/132-approvals-owner.png` });
  // 양식 편집 화면
  await owner.goto(BASE + '/admin/approval-forms');
  await owner.getByTestId('approval-form-expense').waitFor();
  await owner.getByTestId('af-add-expense').click();
  await owner.getByTestId('af-save-expense').click();
  await owner.getByText('지출결의 양식을 저장했습니다').waitFor();
  assert.equal((await sql`select count(*)::int n from approval_forms where kind = 'expense'`)[0].n, 1);
}
