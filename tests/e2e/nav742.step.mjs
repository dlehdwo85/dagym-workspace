// 238차(#742 대표 10/28 '버튼을 누르고 화면 전환이 오래 걸림 — 즉시 넘어가게'): 서버 응답(다음 화면 자료)을 3초 늦춰도
// ① PC 왼쪽 메뉴: 누르자마자 그 메뉴가 강조되고 다음 화면 틀(route-loading)이 보임 → 자료가 오면 화면
// ② 휴대폰 아래 탭: 누르자마자 그 칸이 강조됨 → 화면이 오면 그대로
// 미리 받기(prefetch)는 늦추지 않음(실제 운영처럼 첫 화면 뒤 미리 받아 둔 상태)
import assert from 'node:assert/strict';

async function login(context, BASE, email, password) {
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(BASE + '/');
  return page;
}
const slowDown = (page, paths, ms) => page.route((u) => paths.includes(new URL(u).pathname), async (route) => {
  const h = route.request().headers();
  if (h['rsc'] === '1' && !h['next-router-prefetch']) await new Promise((r) => setTimeout(r, ms));
  await route.continue().catch(() => {});
});

export async function nav742({ browser, devices, BASE, SHOTS }) {
  const desk = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const p = await login(desk, BASE, 'ceo@dagym.test', 'owner-pass-1234');
    await p.goto(BASE + '/tasks');
    await p.getByRole('heading', { name: '업무', exact: true }).first().waitFor();
    await p.waitForTimeout(2000); // 메뉴 링크 미리 받기(다음 화면 틀까지)
    await slowDown(p, ['/notices'], 3000);
    const link = p.locator('nav[aria-label="주 메뉴"] a[href="/notices"]');
    const t0 = Date.now();
    await link.click();
    await p.getByTestId('route-loading').waitFor({ timeout: 1500 });
    const frame = Date.now() - t0;
    assert.equal(await link.getAttribute('aria-current'), 'page', '누른 메뉴가 바로 강조');
    assert.ok(await p.getByTestId('route-loading').isVisible(), '서버 응답 전 다음 화면 틀');
    await p.screenshot({ path: `${SHOTS}/582-nav-loading-frame.png` });
    await p.getByTestId('notices-page').waitFor({ timeout: 15000 });
    assert.ok(Date.now() - t0 >= 2500, '자료는 늦춘 만큼 뒤에 옴(틀이 먼저)');
    assert.equal(await p.getByTestId('route-loading').count(), 0, '화면이 오면 틀은 사라짐');
    console.log(`    PC 메뉴 → 틀 ${frame}ms`);
  } finally { await desk.close(); }

  const mob = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const m = await login(mob, BASE, 'ceo@dagym.test', 'owner-pass-1234');
    await m.waitForTimeout(2000);
    await slowDown(m, ['/calendar'], 3000);
    const tabs = m.getByTestId('mobile-tabs');
    const cal = tabs.getByRole('link', { name: '캘린더', exact: true });
    const t0 = Date.now();
    await cal.click();
    await m.waitForFunction(() => document.querySelector('[data-testid="mobile-tabs"] a[href="/calendar"]')?.className.includes('font-bold'), null, { timeout: 1000 });
    const lit = Date.now() - t0;
    assert.ok(!(await tabs.getByRole('link', { name: '홈', exact: true }).getAttribute('class'))?.includes('font-bold'), '앞 칸(홈) 강조는 바로 꺼짐');
    await m.waitForURL((u) => u.pathname === '/calendar', { timeout: 15000 });
    await m.locator('.fc').first().waitFor({ timeout: 15000 });
    assert.ok((await cal.getAttribute('class'))?.includes('font-bold'), '도착 뒤에도 강조 유지');
    console.log(`    휴대폰 아래 탭 → 강조 ${lit}ms`);
  } finally { await mob.close(); }
}
