// 대표 10/23 #475 업무 공동 배정 + 10/24 다시 설계('담당자 칸 하나에 모두 나란히 · 누구나 내 몫 완료 · 모두 끝나면 완료'):
// 업무 등록 시트에서 여러 명 = 기본 '함께 담당'(1건, 완료 규칙 칸 없음) → 상세 '담당자' 칸 하나에 칩 3개(빼기·[+] 추가) → 담당자별 묶음에 같이
// → 휴대폰(함께 맡은 직원) 상태 칩 '· 0/3' → [내 몫 완료] → '내 몫 완료 · 1/3'(흐리게, 목록에 남음) · 상세 '담당 3명 중 1명 완료'. 서버 규칙은 API 시험 co-assign
import assert from 'node:assert/strict';

export async function coAssign({ owner, staff, ctx, sql, BASE, SHOTS }) {
  // 팀 소속 작성자는 시트가 열릴 때 '내 팀' 태그가 붙는다 — 그래도 '함께 담당'은 고른 사람이 담당(전체 E2E 에서 팀 경로로 빠졌던 것)
  if (!(await sql`select 1 from team_members where user_id = ${ctx.ownerId}`).length) {
    const [tm] = await sql`insert into teams (tenant, name) values ('default', 'E2E 공동 담당 팀') returning id`;
    await sql`insert into team_members (team_id, user_id) values (${tm.id}, ${ctx.ownerId})`;
  }
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('create-menu').click();
  await owner.getByRole('menuitem', { name: /업무/ }).first().click();
  const dlg = owner.getByRole('dialog', { name: '업무 등록' });
  await dlg.getByLabel('제목').fill('E2E 공동 담당 점검');
  await dlg.getByLabel('담당자', { exact: true }).selectOption({ label: '최매니저' });
  await dlg.getByTestId('multi-assignee').getByRole('button', { name: /담당자 여러 명/ }).click();
  await dlg.getByTestId('multi-assignee').getByRole('button', { name: '이직원' }).click();
  await dlg.getByTestId('multi-assignee').getByRole('button', { name: '박직원' }).click();
  assert.ok(await dlg.getByTestId('multi-together').isChecked(), '여러 명 = 기본 함께 담당');
  assert.equal(await dlg.getByTestId('quick-complete-rule').count(), 0, '완료 규칙 칸 없음(대표 10/24 — 항상 모두 끝나면 완료)');
  await dlg.getByRole('button', { name: '3명이 함께 담당 · 저장' }).click();
  await owner.getByText('3명이 함께 담당하는 업무를 만들었습니다').first().waitFor();
  const rows = await sql`select id, assignee_id, complete_rule, team_id from tasks where title = 'E2E 공동 담당 점검' and deleted_at is null`;
  assert.equal(rows.length, 1, '업무 1건');
  const t = rows[0];
  assert.equal(t.assignee_id, ctx.managerA.id);
  assert.ok(t.team_id, '팀은 태그로만 붙음');
  const co = async () => (await sql`select user_id from task_assignees where task_id = ${t.id} order by added_at`).map((r) => r.user_id);
  assert.deepEqual((await co()).sort(), [ctx.staffA.id, ctx.staffB.id].sort());
  // 상세: '담당자' 칸 하나에 칩 3개(같은 모양) · 요약 '외 2명 · 0/3 완료' · 관리자는 빼기·추가·[+]
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('sum-co').getByText('외 2명').waitFor();
  assert.match(await owner.getByTestId('sum-parts').innerText(), /0\/3 완료/);
  const box = owner.getByTestId('assignees');
  assert.deepEqual(await box.getByTestId('assignee-chip').evaluateAll((els) => els.map((e) => e.getAttribute('data-user'))), [ctx.managerA.id, ctx.staffA.id, ctx.staffB.id]);
  assert.equal(await owner.getByRole('group', { name: '공동 담당' }).count(), 0, "'공동 담당' 줄 없음");
  await box.locator(`[data-testid="assignee-chip"][data-user="${ctx.staffB.id}"]`).getByTestId('assignee-remove').click();
  await owner.getByText('박직원님을 담당에서 뺐습니다').first().waitFor();
  await box.locator(`[data-testid="assignee-chip"][data-user="${ctx.staffB.id}"]`).waitFor({ state: 'detached' }); // 화면이 새로 읽힌 뒤(칩이 사라진 뒤) 다시 추가
  assert.deepEqual(await co(), [ctx.staffA.id]);
  await owner.getByTestId('sum-assignee-add').click(); // 휴대폰에서도 담당자 칩 옆 [+] → 담당자 추가 칸으로(초점 + 목록 열기)
  for (let i = 0; i < 20 && (await owner.evaluate(() => document.activeElement?.getAttribute('aria-label'))) !== '담당자 추가'; i++) await owner.waitForTimeout(100);
  assert.equal(await owner.evaluate(() => document.activeElement?.getAttribute('aria-label')), '담당자 추가', '[+] → 담당자 추가 칸에 초점');
  // 추가 칸 목록에 이미 담당인 사람(최매니저·이직원)은 안 보임 · 줄마다 한 줄 설명(담당자 여럿 = 각자 완료)
  const opts = await box.getByLabel('담당자 추가').locator('option').allInnerTexts();
  assert.ok(!opts.some((o) => o.startsWith('최매니저') || o.startsWith('이직원')) && opts.some((o) => o.startsWith('박직원')), JSON.stringify(opts));
  assert.deepEqual(await owner.getByTestId('prop-hint').allInnerTexts(), ['각자 완료 · 모두 끝나면 완료', '보기·댓글 알림만']);
  await box.getByLabel('담당자 추가').selectOption({ label: '박직원' });
  await owner.getByText('담당자를 추가했습니다').first().waitFor();
  await box.locator(`[data-testid="assignee-chip"][data-user="${ctx.staffB.id}"]`).waitFor(); // 다시 읽힌 화면에 칩 3개
  await owner.evaluate(() => document.activeElement?.blur?.()); // 열린 선택 목록 닫기(머리 없는 브라우저는 목록이 열린 채 남음)
  assert.deepEqual(await co(), [ctx.staffA.id, ctx.staffB.id]);
  assert.equal((await sql`select assignee_id from tasks where id = ${t.id}`)[0].assignee_id, ctx.managerA.id, '첫 담당자 그대로');
  await owner.getByTestId('hist-co').first().waitFor({ state: 'attached' }); // 활동 기록 '담당 추가·빼기 박직원'
  await box.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await owner.screenshot({ path: `${SHOTS}/213-co-assign-detail.png`, clip: await box.boundingBox() });
  // 담당자별 묶음: 주 담당·공동 담당 묶음에 모두 · 행에 +2
  await owner.goto(BASE + '/tasks');
  for (const id of [ctx.managerA.id, ctx.staffA.id, ctx.staffB.id]) await owner.locator(`[data-group="${id}"]`).getByText('E2E 공동 담당 점검').first().waitFor();
  assert.equal(await owner.locator(`[data-group="${ctx.managerA.id}"] [data-row="${t.id}"]`).getByTestId('row-co').first().innerText(), '+2');
  // 휴대폰(이직원 = 함께 맡은 담당자): 상태 칩 '진행 전 · 0/3' → 눌러 [내 몫 완료] → '내 몫 완료 · 1/3'(흐리게, 목록에 남음 · 업무 상태 그대로)
  await staff.goto(BASE + '/tasks');
  const mine = staff.locator(`[data-row="${t.id}"]`).first();
  const chip = mine.getByTestId('row-status-chip').filter({ visible: true }).first();
  await chip.waitFor();
  assert.match(await chip.innerText(), /0\/3/);
  await chip.click();
  await staff.getByTestId('status-quick').filter({ hasText: '내 몫 완료' }).click();
  await staff.getByText(/^내 몫 완료\(1\/3\) — 최매니저, 박직원님까지 끝내면 업무가 완료됩니다/).first().waitFor();
  const part = mine.getByTestId('row-part-chip').filter({ visible: true }).first();
  await part.waitFor();
  assert.match(await part.innerText(), /내 몫 완료 · 1\/3/);
  for (let i = 0; i < 20 && !(await sql`select done_at from task_assignees where task_id = ${t.id} and user_id = ${ctx.staffA.id}`)[0].done_at; i++) await staff.waitForTimeout(200);
  assert.ok((await sql`select done_at from task_assignees where task_id = ${t.id} and user_id = ${ctx.staffA.id}`)[0].done_at, '내 몫 완료 저장');
  assert.equal((await sql`select status from tasks where id = ${t.id}`)[0].status, 'todo', '업무 상태 그대로');
  await mine.screenshot({ path: `${SHOTS}/214-co-part-mobile.png` });
  // 상세: '담당 3명 중 1명 완료 — 남은 사람' 상자 + [내 몫 완료 취소] · 직원에게는 담당자 추가 [+] 없음
  await staff.goto(`${BASE}/tasks/${t.id}`);
  const pbox = staff.getByTestId('part-box');
  await pbox.waitFor();
  assert.equal(await pbox.getAttribute('data-done'), '1');
  assert.match(await pbox.innerText(), /담당 3명 중 1명 완료 — 남은 사람: 최매니저, 박직원/);
  assert.equal(await staff.getByTestId('sum-assignee-add').count(), 0, '직원은 담당자 추가 못 함');
  const over = await staff.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
}
