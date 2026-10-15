// V14 43번: 업무 목록 왼쪽 동그라미 없음, 상태 칩 = 버튼(테두리·▾·32px↑, 처음엔 "눌러서 상태 바꾸기"), 메뉴 맨 위 [✓ 완료] → 완료·되돌리기, 남의 업무는 잠김 표시, "확인 완료" 문구 없음
import assert from 'node:assert/strict';
export async function v1443({ browser, desk, ctx, BASE, SHOTS, sql }) {
  const mine = (await ctx.owner.ok('POST', '/api/tasks', { title: '상태칩 버튼 시험', assigneeId: ctx.ownerId, approvalRequired: false })).id;
  const other = (await ctx.owner.ok('POST', '/api/tasks', { title: '상태칩 남의 업무', assigneeId: ctx.staffA.id, approvalRequired: false })).id;
  const mc = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  try {
    await m.goto(`${BASE}/tasks?mode=list`);
    await m.getByLabel('업무 검색').fill('상태칩');
    const row = m.locator(`[data-row="${mine}"]`);
    const chip = row.getByTestId('row-status-chip').filter({ visible: true });
    await chip.waitFor();
    assert.equal(await m.getByTestId('check-circle').count(), 0, '동그라미 없음');
    const st = await chip.evaluate((el) => ({ h: el.getBoundingClientRect().height, bw: parseFloat(getComputedStyle(el).borderTopWidth), svg: el.querySelectorAll('svg').length }));
    assert.ok(st.h >= 31.5 && st.bw >= 1 && st.svg >= 1, `버튼 모양 ${JSON.stringify(st)}`);
    assert.equal(await m.getByText('확인 완료', { exact: false }).count(), 0, '"확인 완료" 문구 없음');
    await m.screenshot({ path: `${SHOTS}/v14-43-row-412.png`, clip: { x: 0, y: 0, width: 412, height: 520 } });
    await chip.tap();
    const quick = m.getByTestId('status-quick');
    assert.match(await quick.innerText(), /완료/);
    await quick.tap();
    await m.getByText('완료했습니다').waitFor();
    assert.equal((await sql`select status from tasks where id = ${mine}`)[0].status, 'done');
    await m.getByRole('button', { name: '되돌리기', exact: true }).tap();
    for (let i = 0; i < 20 && (await sql`select status from tasks where id = ${mine}`)[0].status === 'done'; i++) await m.waitForTimeout(150);
    assert.notEqual((await sql`select status from tasks where id = ${mine}`)[0].status, 'done', '되돌리기');
    const locked = m.locator(`[data-row="${other}"]`).getByTestId('row-status-locked').filter({ visible: true });
    await locked.waitFor();
    assert.equal(await m.locator(`[data-row="${other}"]`).getByTestId('row-status-chip').count(), 0, '남의 업무는 버튼 아님');
  } finally { await mc.close(); for (const id of [mine, other]) await ctx.owner.ok('DELETE', `/api/tasks/${id}`).catch(() => {}); }
}
