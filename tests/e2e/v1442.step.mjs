// V14 42번: 업무 보기 칩 7개가 412px 에서 스크롤 없이 모두 보임(4칸 2줄), 건수(API 와 같음·0건 숨김·지연 빨간 점), 사람 칩은 둘째 줄, PC 는 한 줄
import assert from 'node:assert/strict';
export async function v1442({ browser, desk, ctx, BASE, SHOTS, addDays, today }) {
  const ids = [];
  ids.push((await ctx.owner.ok('POST', '/api/tasks', { title: '칩 건수 지연 업무', assigneeId: ctx.ownerId, dueDate: addDays(today, -3), approvalRequired: false })).id);
  const api = (await ctx.owner.ok('GET', '/api/tasks/counts?includeDone=recent')).counts;
  assert.ok(api.overdue >= 1 && api.my >= 1);
  const mc = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  try {
    await m.goto(`${BASE}/tasks`);
    const chips = m.getByTestId('view-chips');
    await chips.locator('[data-count="overdue"]').waitFor();
    for (const name of ['전체', '내 업무', '내가 지시한 업무', '지연', '이번 주', '검토 대기', '완료']) {
      const b = await chips.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(b && b.x >= 0 && b.x + b.width <= 412 + 0.5, `${name} 칩 화면 안 (${b?.x}+${b?.width})`);
    }
    assert.equal(Number(await chips.locator('[data-count="overdue"]').innerText()), api.overdue, '지연 건수 = API');
    assert.equal(await chips.locator('[data-count="requested"]').count(), api.requested ? 1 : 0, '0건은 숨김');
    const vy = (await chips.getByRole('button', { name: '전체', exact: true }).boundingBox()).y;
    const py = await m.getByTestId('people-chips').boundingBox();
    assert.ok(!py || py.y > vy + 30, '사람 칩은 아래 줄');
    await m.screenshot({ path: `${SHOTS}/v14-42-chips-412.png`, clip: { x: 0, y: 0, width: 412, height: 360 } });
    // PC: 보기 칩 한 줄
    const p = await desk.newPage();
    await p.goto(`${BASE}/tasks`);
    const pc = p.getByTestId('view-chips');
    await pc.getByRole('button', { name: '완료', exact: true }).waitFor();
    const ys = await Promise.all(['전체', '완료'].map(async (n) => (await pc.getByRole('button', { name: n, exact: true }).boundingBox()).y));
    assert.ok(Math.abs(ys[0] - ys[1]) < 4, 'PC 는 한 줄');
    await p.close();
  } finally { await mc.close(); for (const id of ids) await ctx.owner.ok('DELETE', `/api/tasks/${id}`).catch(() => {}); }
}
