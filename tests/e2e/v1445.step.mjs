// V14 45번: PC 묶음 끝 "업무 추가" 줄 마감 칩 → 선택 창이 칩 바로 아래(공간 없으면 위)·칩 왼쪽에 맞춤·화면 안, 시각 버튼까지 보이거나 창 안에서 스크롤
import assert from 'node:assert/strict';
export async function v1445({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1400, height: 760 });
  await owner.goto(`${BASE}/tasks?mode=list`);
  const add = owner.getByTestId('task-groups').getByTestId('inline-add').last();
  await add.waitFor();
  await add.getByLabel('업무 추가 제목').fill('선택 창 위치 시험');
  const chip = add.getByTestId('due-picker');
  await chip.scrollIntoViewIfNeeded();
  // 칩을 화면 아래쪽에 두고 연다(아래 공간이 모자란 경우)
  await owner.evaluate(() => window.scrollBy(0, -(window.innerHeight - 140)));
  await owner.evaluate((y) => window.scrollTo(0, y), await chip.evaluate((el) => window.scrollY + el.getBoundingClientRect().top - (window.innerHeight - 90)));
  await chip.click();
  const pop = owner.locator('[data-popover]').last();
  await pop.waitFor();
  await pop.getByRole('button', { name: /^내일/ }).click();
  const [c, p, vh] = await Promise.all([chip.boundingBox(), pop.boundingBox(), owner.evaluate(() => window.innerHeight)]);
  assert.ok(p.y >= 0 && p.y + p.height <= vh + 0.5, `창이 화면 안 (${p.y}~${p.y + p.height} / ${vh})`);
  assert.ok(Math.abs(p.x - c.x) <= 8 || p.x === 8, `칩 왼쪽에 맞춤 (${p.x} vs ${c.x})`);
  assert.ok(p.y + p.height <= c.y + 1 || p.y >= c.y + c.height - 1, '칩을 가리지 않음(위 또는 아래)');
  const t = pop.getByRole('button', { name: '09:00' });
  await t.scrollIntoViewIfNeeded(); await t.click();
  await owner.screenshot({ path: `${SHOTS}/v14-45-due-popover.png` });
  await owner.keyboard.press('Escape');
  await owner.setViewportSize({ width: 1366, height: 900 });
}
