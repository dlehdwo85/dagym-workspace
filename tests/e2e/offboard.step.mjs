// 대표 10/20 오후 7) 사용자 관리 — [퇴사 처리] 창(퇴사일·받을 사람·항목 개수) → 목록 '퇴사(날짜)'·퇴사자 접힘·[인수인계]·[복직]
import assert from 'node:assert/strict';
import { Client } from '../helpers.mjs';

export async function offboardFlow({ owner, ctx, BASE, SHOTS }) {
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'leaver@dagym.test', name: '이퇴사', role: 'staff', orgUnitIds: [ctx.hq] });
  const c = new Client('leaver'); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'leaver-pass-1234' });
  await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 퇴사자 업무', assigneeId: inv.userId, orgUnitId: ctx.hq, approvalRequired: false });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/admin/users`);
  const row = owner.getByTestId('users').locator('tr').filter({ hasText: '이퇴사' });
  await row.getByTestId('user-leave').click();
  const dlg = owner.getByTestId('offboard'); await dlg.waitFor();
  await dlg.getByTestId('offboard-date').fill('2026-10-20');
  await dlg.getByTestId('offboard-to').selectOption({ label: '이직원' });
  assert.equal(await dlg.getByTestId('offboard-item-tasks').isChecked(), true, '담당 업무 1건은 기본 체크');
  assert.match(await dlg.getByTestId('offboard-items').innerText(), /담당 업무\(진행 중\)\s*1/);
  await owner.screenshot({ path: `${SHOTS}/148-offboard.png` });
  await dlg.getByTestId('offboard-go').click();
  await owner.getByText(/퇴사 처리했습니다/).waitFor();
  // 목록: 퇴사자는 접힘 → 펼치면 '퇴사(10/20)'·[인수인계]·[복직]
  await owner.getByTestId('left-toggle').click();
  const row2 = owner.getByTestId('users').locator('tr').filter({ hasText: '이퇴사' });
  await row2.waitFor();
  assert.match(await row2.getByTestId('user-status').innerText(), /퇴사\(10\/20\)/);
  await row2.getByTestId('user-handover').waitFor(); await row2.getByTestId('user-rejoin').waitFor();
  assert.equal((await c.req('GET', '/api/auth/me')).status, 401, '퇴사 즉시 로그인 차단');
  const t = (await ctx.owner.ok('GET', `/api/tasks?limit=100&assigneeId=${ctx.staffA.id}`)).tasks.find((x) => x.title === 'E2E 퇴사자 업무');
  assert.ok(t, '담당 업무가 이직원에게 이전');
}
