// V14 43번: 업무 목록 왼쪽 동그라미 없음, 상태 칩 = 버튼(테두리·▾·32px↑, 처음엔 "눌러서 상태 바꾸기"), 메뉴 맨 위 [✓ 완료] → 완료·(#508) 맨 아래 '완료됨'에서 되돌리기, 남의 업무는 잠김 표시, "확인 완료" 문구 없음
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
    assert.ok(st.h >= 23.5 && st.h <= 28 && st.bw >= 1 && st.svg >= 1, // 대표 10/16: 너무 큼 → 24px(누르는 범위는 hit 44px)
       `버튼 모양 ${JSON.stringify(st)}`);
    assert.equal(await m.getByText('확인 완료', { exact: false }).count(), 0, '"확인 완료" 문구 없음');
    await m.screenshot({ path: `${SHOTS}/v14-43-row-412.png`, clip: { x: 0, y: 0, width: 412, height: 520 } });
    await chip.tap();
    const quick = m.getByTestId('status-quick');
    assert.match(await quick.innerText(), /완료/);
    await quick.tap();
    await m.getByText('완료로 옮겼습니다').waitFor(); // 334차(대표 11/02 16:4x): 완료는 목록에 남지 않고 '완료' 칩에서
    assert.equal((await sql`select status from tasks where id = ${mine}`)[0].status, 'done');
    await m.locator(`[data-row="${mine}"]`).waitFor({ state: 'detached' });
    await m.getByRole('button', { name: '완료 보기' }).tap(); // 되돌리기는 완료 보기의 상태 칩에서
    const doneRow = m.locator(`[data-row="${mine}"]`).first(); await doneRow.waitFor();
    await doneRow.getByTestId('row-status-chip').filter({ visible: true }).tap(); await m.getByTestId('status-quick').tap();
    for (let i = 0; i < 20 && (await sql`select status from tasks where id = ${mine}`)[0].status === 'done'; i++) await m.waitForTimeout(150);
    assert.notEqual((await sql`select status from tasks where id = ${mine}`)[0].status, 'done', '되돌리기');
    await m.getByRole('button', { name: '완료', exact: true }).tap(); // 완료 칩 끄기 → 목록
    // 334차(대표 11/02 16:4x): 대표·관리자급은 남의 업무도 [완료]만은 누를 수 있음 → 칩은 버튼이되 메뉴에서 완료만 켜지고 보류·진행은 꺼짐(자물쇠는 직원끼리)
    const otherChip = m.locator(`[data-row="${other}"]`).getByTestId('row-status-chip').filter({ visible: true });
    await otherChip.waitFor();
    await otherChip.tap();
    assert.match(await m.getByTestId('status-quick').innerText(), /완료/, '관리자는 남의 업무에 완료만');
    assert.equal(await m.getByRole('button', { name: '보류', exact: true }).isDisabled(), true, '보류는 담당자만');
    assert.equal(await m.getByRole('button', { name: '진행 중', exact: true }).isDisabled(), true, '진행 중도 담당자만');
    await m.keyboard.press('Escape');
  } finally { await mc.close(); for (const id of [mine, other]) await ctx.owner.ok('DELETE', `/api/tasks/${id}`).catch(() => {}); }
}
