import assert from 'node:assert/strict';

/**
 * 199차 결정 15-27(대표 10/26): 아이폰 앱도 '휴대폰 알림 맞추기' — 브라우저에는 네이티브가 없어 시연 상태(localStorage wos_perm_demo, platform 'ios')로 그린다.
 * ① 지금 아이폰 앱(네이티브 권한 메서드 없음): 알림 허용 한 줄만, 거절했으면 [설정 열기] · 정확한 시각·잠금 화면·위젯 줄 없음
 * ② 1.1.4(네이티브가 알려 줌): 알림 허용됨 → 집중 모드에서도 알람 [설정 열기] · 잠금 화면 알람 [허용] · 홈 화면 위젯은 단추 없이 길게 누르기 안내
 */
async function fresh(browser, desk, BASE, demo) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await ctx.addInitScript((d) => { try { localStorage.setItem('wos_perm_demo', JSON.stringify(d)); } catch {} }, demo);
  const page = await ctx.newPage();
  await page.goto(BASE + '/');
  return { ctx, page };
}
const keys = (sheet) => sheet.locator('[data-testid^="perm-row-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').slice(9)));

export async function permIntroIos199({ browser, desk, BASE, SHOTS }) {
  const a = await fresh(browser, desk, BASE, { platform: 'ios', notifications: false, notifState: 'denied', focus: null, alarmKit: null, widgetSupported: false, widgets: 0, widgetPin: false });
  let sheet = a.page.getByTestId('perm-intro');
  await sheet.waitFor({ timeout: 10000 });
  assert.deepEqual(await keys(sheet), ['notifications'], '지금 아이폰 앱 = 알림 허용 한 줄');
  assert.equal(await sheet.getByTestId('perm-act-notifications').innerText(), '설정 열기', '거절한 뒤에는 시스템 창이 다시 안 떠서 설정으로');
  assert.match(await sheet.innerText(), /아이폰 설정 › 워크인/);
  await a.ctx.close();
  const b = await fresh(browser, desk, BASE, { platform: 'ios', notifications: true, notifState: 'granted', focus: false, alarmKit: 'prompt', widgetSupported: true, widgets: 0, widgetPin: false });
  sheet = b.page.getByTestId('perm-intro');
  await sheet.waitFor({ timeout: 10000 });
  assert.deepEqual(await keys(sheet), ['notifications', 'focus', 'fullScreen', 'widgets'], '1.1.4 네이티브 = 네 줄(정확한 시각 줄은 안드로이드만)');
  assert.deepEqual(await Promise.all(['notifications', 'focus', 'fullScreen', 'widgets'].map((k) => sheet.getByTestId(`perm-row-${k}`).getAttribute('data-ok'))), ['1', '0', '0', '0']);
  assert.equal(await sheet.getByTestId('perm-act-focus').innerText(), '설정 열기');
  assert.equal(await sheet.getByTestId('perm-act-fullScreen').innerText(), '허용');
  assert.equal(await sheet.getByTestId('perm-act-widgets').count(), 0, '아이폰은 위젯을 앱이 못 놓음 — 단추 없이 안내');
  assert.match(await sheet.getByTestId('perm-row-widgets').innerText(), /길게 눌러 \[편집\] → \[위젯 추가\]/);
  await b.page.screenshot({ path: `${SHOTS}/541-perm-intro-ios.png` });
  await sheet.getByTestId('perm-later').tap();
  await sheet.waitFor({ state: 'detached' });
  await b.ctx.close();
}
