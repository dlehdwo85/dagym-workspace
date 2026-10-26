// P2 조직 개편(대표 확정 10/26 · #679~#681): 부서·팀 탭 4단(본사 › 사업부 › 부서 › 팀) — 종류 카드 4개(한 줄 설명), 고른 종류에 맞는 위 단위만,
// 본사로 만들며 맨 위 부서를 아래로(이관), 장 이름 자동·'장 없음'·이름-종류 검사 · 사용자 목록 왕관 칩·장 비게 됨 경고 · 업무 '함께하는 부서'.
// 본사가 생기면 맨 위 부서를 새로 만들 수 없으므로 E2E 맨 끝에서 돈다.
import assert from 'node:assert/strict';

export async function orgLevels({ owner, ctx, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/admin/users?tab=teams');
  const tree = owner.getByTestId('team-tree'); await tree.waitFor();
  await owner.getByTestId('org-no-hq').waitFor(); // 앞 단계들이 만든 맨 위 부서만 있고 본사는 없음
  // 1) 본사 만들기: 종류 카드 4개 · 본사는 위 단위 칸 없음 · 맨 위 부서를 본사 아래로 옮기기(기본 켬)
  await owner.getByTestId('team-new').click();
  const dlg = owner.getByRole('dialog', { name: '부서·팀 만들기' }); await dlg.waitFor();
  for (const k of ['hq', 'division', 'dept', 'team']) await dlg.getByTestId(`team-kind-${k}`).waitFor();
  assert.equal(await dlg.getByText('부서(상위 없음)').count(), 0, "#679 '부서(상위 없음)' 문구 없음");
  await dlg.getByTestId('team-kind-hq').check();
  await dlg.getByTestId('team-hq-note').waitFor();
  assert.equal(await dlg.getByTestId('team-parent').count(), 0, '본사는 위 단위 칸 없음');
  const adopt = dlg.getByTestId('team-adopt'); await adopt.waitFor();
  assert.match(await adopt.innerText(), /맨 위에 있는 \d+곳/);
  await dlg.getByLabel('팀 이름').fill('E2E 본사');
  await dlg.getByLabel(`${(await ctx.owner.ok('GET', '/api/auth/me')).user.name} 팀원`).check();
  await dlg.getByTestId('team-lead-summary').filter({ hasText: /· 대표 / }).waitFor(); // 장 이름 자동: 본사 = 대표
  await owner.screenshot({ path: `${SHOTS}/532-org-new-hq.png` });
  await dlg.getByTestId('team-save').click();
  await owner.getByText(/본사 아래로 옮겼습니다/).first().waitFor();
  await owner.getByTestId('org-no-hq').waitFor({ state: 'detached' });
  const card = (name) => tree.locator(`[data-testid="team-card"][data-name="${name}"]`);
  const hqCard = card('E2E 본사'); await hqCard.waitFor();
  assert.equal(await hqCard.getAttribute('data-kind'), 'hq');
  assert.equal(await hqCard.getAttribute('data-depth'), '0');
  await card('영업부').getByTestId('team-title').filter({ hasText: 'E2E 본사 ›' }).waitFor(); // 이관: 영업부가 본사 아래로
  assert.equal(await card('영업부').getAttribute('data-depth'), '1');
  // 2) 사업부: 위 단위는 본사만, 구성원 없이 저장하면 '사업부장 없음'
  await owner.getByTestId('team-new').click();
  await dlg.waitFor();
  await dlg.getByTestId('team-kind-division').check();
  const opts = await dlg.getByTestId('team-parent').locator('option:not([value=""])').allInnerTexts(); // 안내 줄(값 없음) 빼고
  assert.ok(opts.every((o) => /\(본사\)$/.test(o)), `사업부 위 단위는 본사만: ${JSON.stringify(opts)}`);
  await dlg.getByLabel('팀 이름').fill('E2E 플랫폼사업부');
  await dlg.getByTestId('team-save').click();
  const divCard = card('E2E 플랫폼사업부'); await divCard.waitFor();
  await divCard.getByTestId('team-no-lead').filter({ hasText: '사업부장 없음' }).waitFor();
  // 3) 이름-종류 검사 · 본사가 있으면 부서는 '맨 위' 고르기 없음
  await owner.getByTestId('team-new').click();
  await dlg.waitFor();
  await dlg.getByTestId('team-kind-dept').check();
  await dlg.getByLabel('팀 이름').fill('영업3팀');
  await dlg.getByTestId('team-name-warn').filter({ hasText: "이름은 '팀' 같은데 종류는 '부서'입니다" }).waitFor();
  const dOpts = await dlg.getByTestId('team-parent').locator('option').allInnerTexts();
  assert.ok(!dOpts.some((o) => o.includes('없음 — 맨 위')), '본사가 있으면 맨 위 부서 없음');
  assert.ok(!dOpts.some((o) => /\(팀\)$/.test(o)), '팀은 위 단위가 될 수 없음');
  await owner.screenshot({ path: `${SHOTS}/533-org-dept-warn.png` });
  await dlg.getByRole('button', { name: '취소' }).click();
  await owner.screenshot({ path: `${SHOTS}/534-org-tree-4.png`, fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 391), '휴대폰 가로 넘침 없음');
  await owner.screenshot({ path: `${SHOTS}/534-org-tree-4-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 4) 사용자 목록: '장' 한 글자 대신 왕관 칩(부서장) · 장이던 곳을 빼면 '부서장이 비게 됩니다' + 새 장 고르기
  await owner.getByTestId('tab-users').click();
  const row = owner.getByTestId('users').locator('tr').filter({ hasText: ctx.managerA.email });
  await row.getByTestId('lead-chip').filter({ hasText: '부서장' }).first().waitFor();
  await row.getByRole('button', { name: '편집' }).click();
  const ed = owner.getByRole('dialog', { name: '사용자 편집' }); await ed.waitFor();
  await ed.getByLabel('E2E 본사 › 영업부 소속', { exact: true }).uncheck();
  const loss = ed.getByTestId('lead-loss'); await loss.waitFor();
  await loss.locator('b', { hasText: '영업부' }).first().waitFor(); assert.match(await loss.innerText(), /영업부의 부서장이 비게 됩니다/);
  await loss.getByTestId('lead-loss-pick').locator('option', { hasText: '부서장 없이 두기' }).waitFor({ state: 'attached' });
  await owner.screenshot({ path: `${SHOTS}/535-user-lead-loss.png` });
  await ed.getByRole('button', { name: '취소' }).click();
  // 5) 업무 '함께하는 부서': 부서 추가 → 칩 → 서버에도
  const hq = (await ctx.owner.ok('GET', '/api/teams')).teams.find((t) => t.name === 'E2E 본사');
  const sales = (await ctx.owner.ok('GET', '/api/teams')).teams.find((t) => t.name === '영업부');
  const task = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 부서 협업 업무', teamId: hq.id, assigneeId: ctx.ownerId, approvalRequired: false })).id;
  await owner.goto(BASE + `/tasks/${task}`);
  const ct = owner.getByTestId('collab-teams'); await ct.waitFor();
  await ct.getByTestId('collab-team-add').click();
  const pick = ct.getByTestId('collab-team-pick'); await pick.waitFor();
  await pick.locator('option', { hasText: 'E2E 본사 › 영업부' }).first().waitFor({ state: 'attached' });
  await pick.selectOption({ label: sales.path });
  await ct.getByTestId('collab-team').filter({ hasText: '영업부' }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/536-task-collab-team.png` });
  const d = await ctx.owner.ok('GET', `/api/tasks/${task}`);
  assert.deepEqual(d.collabTeams.map((x) => x.name), ['영업부']);
}
