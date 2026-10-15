// V28-3 슈퍼 계정: /platform 회사 관리 목록 → [관리] → 상세(사용자·한도)
import assert from 'node:assert/strict';
export async function v283({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/platform`);
  const list = owner.getByTestId('platform-company-list');
  await list.waitFor();
  await list.getByTestId('company-open-default').click();
  const d = owner.getByTestId('company-detail');
  await d.waitFor();
  assert.ok((await d.getByTestId('company-users').locator('li').count()) >= 1);
  await d.getByTestId('ov-save').waitFor();
  await owner.screenshot({ path: `${SHOTS}/v28-3-platform-company.png` });
  await owner.keyboard.press('Escape');
}
