import assert from 'node:assert/strict';

/**
 * #528(대표 10/23) 앱 처음 시작 '휴대폰 알림 맞추기' 안내(웹 몫) — 브라우저에는 네이티브가 없어 시연 상태(localStorage wos_perm_demo)로 그린다.
 * 꺼진 줄에는 단추·이유, 허용된 줄에는 체크 · [나중에] → 닫히고 같은 날 다시 안 뜸 · 네 가지가 다 돼 있으면 아예 안 뜸 · 설정 › 알림 [다시 보기]는 앱에서만(웹은 단추 없음)
 */
async function fresh(browser, desk, BASE, demo) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await ctx.addInitScript((d) => { try { localStorage.setItem('wos_perm_demo', JSON.stringify(d)); } catch {} }, demo);
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  return { ctx, page };
}

export async function permIntro528({ browser, desk, BASE, SHOTS }) {
  const r = await fresh(browser, desk, BASE, { notifications: false, fullScreen: false, exact: true, widgets: 0, widgetPin: true, sdk: 34 });
  const sheet = r.page.getByTestId('perm-intro');
  await sheet.waitFor({ timeout: 10000 });
  assert.equal(await sheet.getByRole('heading', { level: 2 }).innerText(), '휴대폰 알림 맞추기');
  assert.deepEqual(await Promise.all(['notifications', 'fullScreen', 'exact', 'widgets'].map((k) => sheet.getByTestId(`perm-row-${k}`).getAttribute('data-ok'))), ['0', '0', '1', '0'], '허용/꺼짐 상태');
  assert.equal(await sheet.getByTestId('perm-act-notifications').innerText(), '허용');
  assert.equal(await sheet.getByTestId('perm-act-fullScreen').innerText(), '설정 열기');
  assert.equal(await sheet.getByTestId('perm-act-exact').count(), 0, '허용된 줄은 단추 없음');
  assert.equal(await sheet.getByTestId('perm-act-widgets').innerText(), '위젯 추가');
  assert.match(await sheet.getByTestId('perm-row-notifications').innerText(), /앱이 닫혀 있어도/, '꺼진 줄에는 이유');
  await r.page.screenshot({ path: `${SHOTS}/528-perm-intro.png` });
  // 투어(#83)는 이 창이 떠 있는 동안 기다림(role=dialog)
  assert.equal(await r.page.getByTestId('tour-overlay').count(), 0, '권한 안내가 떠 있는 동안 투어 없음');
  await sheet.getByTestId('perm-later').tap();
  await sheet.waitFor({ state: 'detached' });
  await r.page.reload();
  await r.page.getByTestId('home-clock').waitFor();
  await r.page.waitForTimeout(1500);
  assert.equal(await sheet.count(), 0, '[나중에] 뒤 같은 날은 다시 안 뜸');
  await r.ctx.close();
  // 다 돼 있으면 안 뜸
  const ok = await fresh(browser, desk, BASE, { notifications: true, fullScreen: true, exact: true, widgets: 1, widgetPin: true, sdk: 34 });
  await ok.page.getByTestId('home-clock').waitFor();
  await ok.page.waitForTimeout(1500);
  assert.equal(await ok.page.getByTestId('perm-intro').count(), 0, '네 가지 다 허용이면 안 띄움');
  await ok.ctx.close();
}
