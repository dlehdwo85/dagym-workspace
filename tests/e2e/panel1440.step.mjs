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

// 점검 2026-10-16 ①: 태블릿·좁은 창 목록 — 맨 끝 단계로(좁은 화면에서 뜨는 AI 호출이 앞 단계의 가짜 AI 응답 순서를 바꾸지 않게)
export async function listNarrow({ owner, BASE, SHOTS }) {
  for (const w of [768, 1024, 1100]) {
    await owner.setViewportSize({ width: w, height: 900 });
    await owner.goto(`${BASE}/tasks?mode=list`);
    const link = owner.getByTestId('task-groups').locator('a[data-open-task]').first();
    await link.waitFor();
    // 제목이 잘리지 않았거나(글자 폭 그대로) 잘려도 칸이 200px 이상 — 0~89px 로 눌리지 않음
    const m = await link.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, w: el.getBoundingClientRect().width }));
    assert.ok(m.sw <= m.cw + 1 || m.w >= 200, `${w}px: 업무 이름 칸 ${JSON.stringify(m)}`);
    if (w === 768) await owner.screenshot({ path: `${SHOTS}/v-list-768.png` });
  }
  await owner.setViewportSize({ width: 1366, height: 900 });
}
