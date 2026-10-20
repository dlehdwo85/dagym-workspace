// 대표 10/20 11:40 ① 플랫폼 운영 [고객사 추가] → 회사·대표 초대 링크 → 회사 관리에 초대 대기·공간·메모·감사 기록
import assert from 'node:assert/strict';

export async function platformAdd({ owner, BASE, SHOTS, sql }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/platform');
  await owner.getByTestId('platform-add-company').click();
  const f = owner.getByTestId('new-company');
  await f.getByTestId('new-company-name').fill('E2E 고객사');
  const chips = f.getByTestId('new-company-industries').getByRole('button');
  await chips.nth(0).click(); await chips.nth(1).click();
  await f.getByTestId('new-company-size').selectOption('11-30');
  await f.getByTestId('new-company-trial-days').fill('30');
  await f.getByTestId('new-company-space-marketing').check();
  await f.getByTestId('new-company-owner').fill('이고객');
  await f.getByTestId('new-company-email').fill('e2e-cust@dagym.test');
  await f.getByTestId('new-company-memo').fill('E2E 메모');
  await owner.screenshot({ path: `${SHOTS}/152-platform-add-company.png` });
  await f.getByTestId('new-company-go').click();
  const done = owner.getByTestId('new-company-done'); await done.waitFor();
  const link = await done.getByTestId('new-company-link').getAttribute('href'); // 시험 서버는 메일 미설정 → 링크 표시
  assert.match(link ?? '', /^\/invite\//);
  await done.getByTestId('new-company-open').click();
  const d = owner.getByTestId('company-detail'); await d.waitFor();
  await d.getByTestId('company-invite-pending').waitFor();
  assert.equal(await d.getByTestId('company-space-marketing').isChecked(), true);
  assert.equal(await d.getByTestId('company-space-sales').isChecked(), false);
  assert.equal(await d.getByTestId('company-memo').inputValue(), 'E2E 메모');
  await d.getByTestId('company-audit-toggle').click();
  await d.getByTestId('company-audit').getByText('platform.tenant_create').waitFor();
  await owner.screenshot({ path: `${SHOTS}/153-platform-company-ops.png` });
  const [t] = await sql`select industries, spaces, platform_memo from tenants where name = 'E2E 고객사'`;
  assert.equal(t.industries.length, 2); assert.deepEqual(t.spaces, ['work', 'marketing']); assert.equal(t.platform_memo, 'E2E 메모');
  await owner.keyboard.press('Escape');
}
