// 대표 10/20 오후 4) 팀별 보기: 업무 화면 '팀별' 칩(전체·부서 › 팀, 볼 수 있는 팀만) → 칩을 누르면 그 팀 업무만(목록·보드) → 사용자 관리 › 메뉴 권한 '팀 업무 보기' 사람별 전체/자기 팀만/지정 팀 → 직원 화면 칩이 바뀜
import assert from 'node:assert/strict';
import { Client } from '../helpers.mjs';

export async function teamChipsFlow({ browser, owner, ctx, sql, BASE, SHOTS, login }) {
  const inv = await ctx.owner.ok('POST', '/api/admin/users', { email: 'chip@dagym.test', name: '칩직원', role: 'staff', orgUnitIds: [ctx.hq] });
  const c = new Client('chip'); await c.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'chip-pass-1234' });
  const dept = (await ctx.owner.ok('POST', '/api/teams', { name: 'E2E 본부', members: [{ userId: ctx.ownerId, lead: true }] })).id;
  const t1 = (await ctx.owner.ok('POST', '/api/teams', { name: 'E2E 칩팀', parentId: dept, isolated: false, members: [{ userId: inv.userId, lead: true }] })).id;
  const t2 = (await ctx.owner.ok('POST', '/api/teams', { name: 'E2E 다른팀', parentId: dept, isolated: false, members: [{ userId: ctx.staffA.id, lead: true }] })).id;
  await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 칩팀 업무', teamId: t1, orgUnitId: ctx.hq, approvalRequired: false });
  await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 다른팀 업무', teamId: t2, orgUnitId: ctx.hq, approvalRequired: false });
  // 대표: 모든 팀 칩, 칩 → 그 팀 업무만
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks`);
  const chips = owner.getByTestId('team-chips'); await chips.waitFor();
  await chips.getByRole('button', { name: '팀 E2E 칩팀' }).click();
  await owner.getByText('E2E 다른팀 업무').first().waitFor({ state: 'detached' }); // 칩 = 그 팀 업무만(목록 다시 읽힌 뒤)
  await owner.getByText('E2E 칩팀 업무').first().waitFor();
  assert.equal(await chips.getByRole('button', { name: '팀 E2E 칩팀' }).getAttribute('aria-pressed'), 'true');
  await chips.getByRole('button', { name: '모든 팀' }).click();
  await owner.getByText('E2E 다른팀 업무').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/147-team-chips.png` });
  // 직원(자기 팀만): 자기 팀 칩만 → 메뉴 권한에서 지정 팀 → 다른 팀 칩이 생김
  const sc = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const s = await login(sc, 'chip@dagym.test', 'chip-pass-1234');
    await s.goto(`${BASE}/tasks`);
    const sChips = s.getByTestId('team-chips'); await sChips.waitFor();
    assert.deepEqual((await sChips.getByRole('button').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim()), ['전체', 'E2E 본부 › E2E 칩팀']);
    await owner.goto(`${BASE}/admin/users`);
    await owner.getByTestId('tab-menus').click();
    const perm = owner.getByTestId('team-view-perm'); await perm.waitFor();
    await perm.getByTestId('team-view-user').selectOption({ label: '칩직원 (직원)' });
    await perm.getByTestId('team-view-pick').click();
    await perm.getByTestId('team-view-teams').waitFor();
    await perm.getByTestId('team-view-teams').getByText('E2E 본부 › E2E 다른팀').click();
    await perm.getByTestId('team-view-list').getByText(/칩직원: 지정 팀 E2E 다른팀/).waitFor();
    await s.reload();
    await s.getByTestId('team-chips').getByRole('button', { name: '팀 E2E 다른팀' }).waitFor();
    await s.getByTestId('team-chips').getByRole('button', { name: '팀 E2E 다른팀' }).click();
    await s.getByText('E2E 다른팀 업무').first().waitFor();
    // 전체 → 자기 팀만으로 되돌리면 칩 사라짐
    await perm.getByTestId('team-view-own').click();
    await perm.getByTestId('team-view-list').waitFor({ state: 'detached' });
    await s.reload();
    await s.getByTestId('team-chips').waitFor();
    assert.equal(await s.getByTestId('team-chips').getByRole('button', { name: '팀 E2E 다른팀' }).count(), 0);
  } finally { await sc.close().catch(() => {}); }
}
