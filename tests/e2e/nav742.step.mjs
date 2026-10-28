// 238차 되돌림(로컬 10/28 16:55 긴급 — 운영에서 238차 뒤 메뉴 이동 5.4초·가끔 60초 넘게 안 넘어감): 238차의 누를 때 틀(useLinkStatus)·아래 탭 미리 받기·공통 자료 공유를 빼고 237차 동작으로.
// 로컬이 정한 시험: 첫 화면을 연 뒤 0.5초·2초·5초에 메뉴를 눌러 3초 안에 넘어가는지(PC 왼쪽 메뉴·휴대폰 아래 탭) + 업무 → 캘린더 → 메시지 → 결재 → 홈을 연달아 눌러 모두 넘어가는지
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
/** 첫 화면 → wait 뒤 업무 메뉴 → 3초 안에 주소가 /tasks · 이어서 캘린더 → 메시지 → 결재 → 홈 */
async function run(page, BASE, linkOf, label) {
  const first = [];
  for (const wait of [500, 2000, 5000]) {
    await page.goto(BASE + '/', { waitUntil: 'load' });
    await page.waitForTimeout(wait);
    const t0 = Date.now();
    await linkOf('/tasks').click();
    await page.waitForURL((u) => u.pathname === '/tasks', { timeout: 3000 }).catch(() => { throw new Error(`${label}: 첫 화면 ${wait}ms 뒤 업무 메뉴 — 3초 안에 안 넘어감`); });
    first.push(`${wait}ms 뒤 ${Date.now() - t0}ms`);
  }
  const chain = [];
  for (const href of ['/calendar', '/messages', '/approvals', '/']) {
    const t0 = Date.now();
    await linkOf(href).click();
    await page.waitForURL((u) => u.pathname === href, { timeout: 5000 }).catch(() => { throw new Error(`${label}: 연달아 ${href} — 5초 안에 안 넘어감`); });
    chain.push(`${href} ${Date.now() - t0}ms`);
  }
  assert.equal(await page.getByTestId('route-loading').count(), 0, '238차 틀은 없음');
  console.log(`    ${label}: ${first.join(' · ')} | 연달아 ${chain.join(' · ')}`);
}

export async function nav742({ browser, devices, BASE }) {
  const desk = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const p = await login(desk, BASE, 'ceo@dagym.test', 'owner-pass-1234');
    await run(p, BASE, (h) => p.locator(`nav[aria-label="주 메뉴"] a[href="${h}"]`).first(), 'PC 메뉴');
  } finally { await desk.close(); }
  const mob = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const m = await login(mob, BASE, 'ceo@dagym.test', 'owner-pass-1234');
    await run(m, BASE, (h) => m.locator(`[data-testid="mobile-tabs"] a[href="${h}"]`).first(), '휴대폰 아래 탭');
  } finally { await mob.close(); }
}
