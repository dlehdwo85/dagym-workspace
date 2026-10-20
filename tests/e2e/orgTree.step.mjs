// 대표 10/20 15:15 부서·팀 재정비: 부서·팀 탭 트리(들여쓰기·경로) → 직원 초대 '소속' 하나(주 소속 라디오 + 겸직 체크, 고급 접힘) → 목록에 경로 표시
import assert from 'node:assert/strict';

export async function orgTree({ owner, ctx, BASE, SHOTS }) {
  const sales = (await ctx.owner.ok('POST', '/api/teams', { name: '영업부', kind: 'dept', members: [{ userId: ctx.managerA.id, lead: true }] })).id;
  await ctx.owner.ok('POST', '/api/teams', { name: '영업1팀', parentId: sales, members: [{ userId: ctx.staffA.id, lead: true }] });
  const metro = (await ctx.owner.ok('POST', '/api/teams', { name: '수도권영업부', kind: 'dept', parentId: sales, members: [{ userId: ctx.managerA.id, lead: true }] })).id;
  await ctx.owner.ok('POST', '/api/teams', { name: '수도권1팀', parentId: metro, members: [{ userId: ctx.staffB.id, lead: true }] });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/admin/users?tab=teams');
  const tree = owner.getByTestId('team-tree'); await tree.waitFor();
  const m1 = tree.getByTestId('team-card').filter({ hasText: '수도권1팀' });
  assert.equal(await m1.getAttribute('data-depth'), '2', '트리 깊이');
  await m1.getByTestId('team-title').getByText('영업부 › 수도권영업부 ›').waitFor();
  // 편집: 부서도 상위 부서를 고를 수 있고, 장은 1명(라디오)
  await m1.getByRole('button', { name: '편집' }).click();
  await owner.getByTestId('team-parent').waitFor();
  assert.equal(await owner.getByLabel('박직원 장').isChecked(), true);
  await owner.keyboard.press('Escape');
  await owner.screenshot({ path: `${SHOTS}/154-org-tree.png` });
  // 초대: '소속' 하나 — 체크 + 주 소속 라디오, 고급(접근 조직)은 접힘
  await owner.getByTestId('tab-users').click();
  await owner.getByTestId('invite-open').click();
  const dlg = owner.getByRole('dialog', { name: '직원 초대' }); await dlg.waitFor();
  assert.equal(await dlg.getByText('부서/팀', { exact: true }).count(), 0, "'소속'과 별도의 '부서/팀' 항목 없음");
  assert.equal(await dlg.getByTestId('invite-advanced').getAttribute('open'), null, '고급(접근 조직)은 접힘');
  await dlg.getByLabel('이름').fill('이트리'); await dlg.getByLabel('회사 이메일').fill('e2e-tree@dagym.test');
  await dlg.getByLabel('영업부 › 영업1팀 소속').check();
  await dlg.getByLabel('영업부 › 수도권영업부 › 수도권1팀 소속').check();
  await dlg.getByLabel('영업부 › 수도권영업부 › 수도권1팀 주 소속').check();
  await owner.screenshot({ path: `${SHOTS}/155-invite-org.png` });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.screenshot({ path: `${SHOTS}/155-invite-org-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await dlg.getByRole('button', { name: '초대 링크 만들기' }).click();
  await owner.getByTestId('invite-link').waitFor();
  await owner.keyboard.press('Escape');
  const row = owner.getByTestId('users').locator('tr').filter({ hasText: '이트리' });
  await row.getByText('수도권1팀').waitFor();
  const [u] = await ctx.owner.ok('GET', '/api/admin/users').then((r) => r.users.filter((x) => x.name === '이트리'));
  assert.deepEqual(u.teams.map((t) => [t.name, t.primary]), [['수도권1팀', true], ['영업1팀', false]]);
  assert.deepEqual(u.org_unit_ids, [ctx.hq], '접근 조직은 본사 자동');
}
