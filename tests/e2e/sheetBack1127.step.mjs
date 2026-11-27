// 로컬 11/27 33·34번(대표 갤럭시 "마감일 창이 열린 채 뒤로가기를 누르면 홈으로 감"): 휴대폰 아래 시트·떠 있는 창은 앱 뒤로 버튼(closeTopSheet — native.ts 와 같은 함수)이 창만 닫고 화면 주소는 그대로.
// 예전: 목록 칩 팝오버(마감일·담당 등)가 뒤로 버튼 목록에 없어 closeTopSheet() = false → 이전 화면/홈으로 감
import assert from 'node:assert/strict';

const kstPlus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));

export async function sheetBack1127({ browser, ctx, BASE, SHOTS, login }) {
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '뒤로 버튼 시트 시험', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: kstPlus(4), approvalRequired: false });
  const sc = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const p = await login(sc, 'ceo@dagym.test', 'owner-pass-1234');
    await p.goto(`${BASE}/tasks`);
    const row = p.locator(`[data-task-id="${t.id}"]`).first(); await row.waitFor({ timeout: 20_000 });
    const back = () => p.evaluate(() => window.__wosCloseTopSheet?.() ?? null);
    assert.equal(await back(), false, '열린 창이 없으면 false(앱은 이전 화면으로)');
    // ① 마감일 칩 → 아래 시트 → 뒤로 = 시트만 닫힘
    await row.getByTestId('due-picker').click();
    const sheet = p.locator('[data-sheet]').last(); await sheet.waitFor({ timeout: 10_000 });
    await p.screenshot({ path: `${SHOTS}/1127-sheet-back-due-375.png` });
    assert.equal(await back(), true, '뒤로 버튼이 시트를 닫음');
    await sheet.waitFor({ state: 'detached', timeout: 10_000 });
    assert.equal(new URL(p.url()).pathname, '/tasks', '주소 그대로(홈으로 안 감)');
    // ② 담당 칩도 같은 팝오버
    const who = row.getByTestId('assignee-picker').first();
    if (await who.count()) {
      await who.click(); await p.locator('[data-sheet]').last().waitFor({ timeout: 10_000 });
      assert.equal(await back(), true); await p.locator('[data-sheet]').waitFor({ state: 'detached', timeout: 10_000 });
    }
    // ③ 목록 [더보기] 아래 시트
    await p.getByTestId('tasks-more').click();
    await p.waitForTimeout(300);
    assert.equal(await back(), true, '더보기 시트도 뒤로 = 닫힘');
    assert.equal(await p.getByTestId('tasks-more').getAttribute('aria-expanded'), 'false');
    assert.equal(new URL(p.url()).pathname, '/tasks');
    assert.equal(await back(), false, '다 닫힌 뒤에는 false');
  } finally { await sc.close(); }
}
