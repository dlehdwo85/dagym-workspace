// 로컬 검수 81: PC 1440px 에서 업무 상세 패널을 열어도 목록의 업무 이름이 눌리지 않음(1680px 미만은 패널이 덮개) (1280·1440·1720)
import assert from 'node:assert/strict';
export async function panel1440({ owner, BASE, SHOTS }) {
  for (const w of [1280, 1440, 1720]) {
    await owner.setViewportSize({ width: w, height: 900 });
    await owner.goto(`${BASE}/tasks?mode=list`);
    const link = owner.getByTestId('task-groups').locator('a[data-open-task]').first();
    await link.waitFor();
    const before = (await link.boundingBox()).width;
    await link.click();
    await owner.getByTestId('task-panel').waitFor();
    await owner.waitForTimeout(300);
    const after = (await link.boundingBox()).width;
    assert.ok(after >= Math.min(before, 120), `${w}px: 패널을 열어도 제목 폭 유지 (${before} → ${after})`);
    if (w === 1440) await owner.screenshot({ path: `${SHOTS}/v-panel-1440.png` });
    await owner.keyboard.press('Escape');
  }
  await owner.setViewportSize({ width: 1366, height: 900 });
}
