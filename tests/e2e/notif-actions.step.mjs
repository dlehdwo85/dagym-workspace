// 로컬 10/20 알림에서 바로 처리: 직원 알림 센터 — 배정 알림 [확인]·[오늘 할 일에 넣기] 버튼 → 누르면 그 자리에 "오늘 할 일에 넣음 ✓"·배지 감소 · 설정 화면 조용한 시간 칸
import assert from 'node:assert/strict';

export async function notifActionsFlow({ staff, ctx, BASE, SHOTS }) {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 알림 바로 처리', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false });
  await staff.goto(BASE + '/notifications');
  const li = staff.getByTestId('notifications').locator('li').filter({ hasText: 'E2E 알림 바로 처리' }).first();
  await li.waitFor();
  const acts = li.getByTestId('notif-actions');
  assert.deepEqual(await acts.getByRole('button').allInnerTexts(), ['확인', '오늘 할 일에 넣기']);
  await acts.getByTestId('na-today').click();
  await li.getByTestId('notif-done').waitFor(); // 방금 처리한 줄은 그 자리에 "오늘 할 일에 넣음 ✓"
  assert.match(await li.getByTestId('notif-done').innerText(), /오늘 할 일에 넣음/);
  await staff.screenshot({ path: `${SHOTS}/138-notif-actions.png` });
  await staff.goto(BASE + '/notifications'); // 다시 열어도 처리 표시 유지
  const all = staff.getByTestId('notif-all'); await all.click();
  const li2 = staff.getByTestId('notifications').locator('li').filter({ hasText: 'E2E 알림 바로 처리' }).first();
  await li2.getByTestId('notif-done').waitFor();
  assert.equal(await li2.getByTestId('notif-actions').count(), 0, '처리된 알림은 버튼 없음');
  const task = await ctx.staffA.client.ok('GET', `/api/tasks/${t.id}`);
  assert.ok(task.task.start_date, '시작일 오늘');
  // 설정: 조용한 시간 칸(쓰기 체크·시각)
  await staff.goto(BASE + '/settings');
  await staff.getByTestId('quiet-on').waitFor();
  await staff.getByLabel('조용한 시간 시작').waitFor();
}
