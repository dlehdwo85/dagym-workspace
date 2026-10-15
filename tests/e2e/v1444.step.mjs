// V14 44번: PC 업무 줄 선택 체크박스 = 왼쪽 고정 홈(여백 12px 안팎)·세로 가운데·마우스 올려도 제목 안 움직임·체크박스와 제목 간격 좁게
import assert from 'node:assert/strict';
export async function v1444({ owner, ctx, BASE, SHOTS }) {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '체크박스 자리 시험', assigneeId: ctx.ownerId, approvalRequired: false })).id;
  try {
    await owner.setViewportSize({ width: 1400, height: 900 });
    await owner.goto(`${BASE}/tasks?mode=list`);
    await owner.getByLabel('업무 검색').fill('체크박스 자리');
    const row = owner.locator(`[data-row="${id}"]`);
    await row.waitFor();
    const title = row.locator('a[data-open-task]').first();
    const before = (await title.boundingBox()).x;
    await row.hover();
    const cb = row.getByTestId('row-hover-select');
    await owner.waitForFunction((el) => getComputedStyle(el).opacity === '1', await cb.elementHandle());
    const [r, c, t] = await Promise.all([row.boundingBox(), cb.boundingBox(), title.boundingBox()]);
    assert.equal(t.x, before, '마우스를 올려도 제목이 안 움직임');
    assert.ok(c.x - r.x >= 10, `왼쪽 여백 ${c.x - r.x}px`);
    assert.ok(t.x - (c.x + c.width) <= 16, `체크박스-제목 간격 ${t.x - (c.x + c.width)}px`);
    assert.ok(Math.abs((c.y + c.height / 2) - (r.y + r.height / 2)) <= 2, '세로 가운데');
    await owner.screenshot({ path: `${SHOTS}/v14-44-row-hover.png`, clip: { x: r.x - 4, y: r.y - 4, width: Math.min(700, r.width + 8), height: r.height + 8 } });
  } finally { await ctx.owner.ok('DELETE', `/api/tasks/${id}`).catch(() => {}); }
}
