import assert from 'node:assert/strict';

/**
 * #483(대표 10/23): 하루 첫 진입 환영 문구 — 새 브라우저(저장소 비어 있음)로 로그인하면 인사 한 줄이 0.8초 보였다 사라지고,
 * 같은 날 다시 들어오면 안 보임. 동작 줄이기(prefers-reduced-motion)면 움직임 없이(animation none) 나타남. 화면 조작을 막지 않음.
 */
async function fresh(browser, BASE, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', ...opts });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  await page.getByLabel('이메일', { exact: true }).fill('ceo@dagym.test');
  await page.getByLabel('비밀번호').fill('owner-pass-1234');
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(BASE + '/');
  return { ctx, page };
}

export async function welcome483({ browser, BASE, SHOTS }) {
  const { ctx, page } = await fresh(browser, BASE);
  const w = page.getByTestId('daily-welcome');
  await w.waitFor({ timeout: 8000 });
  const text = await w.innerText();
  assert.match(text, /좋은 (아침|오후|저녁)입니다, .+님/, `인사 + 이름 (${text})`);
  assert.match(text, /\d+월 \d+일 .요일/, `오늘 날짜 (${text})`);
  assert.equal(await w.evaluate((el) => getComputedStyle(el).pointerEvents), 'none', '화면 조작을 막지 않음');
  await page.screenshot({ path: `${SHOTS}/483-daily-welcome.png` });
  await w.waitFor({ state: 'detached', timeout: 5000 }); // 0.8초 + 사라짐 0.3초
  // 같은 날 두 번째 진입 = 없음
  await page.reload();
  await page.getByTestId('home-clock').waitFor();
  await page.waitForTimeout(1200);
  assert.equal(await w.count(), 0, '같은 날 다시 들어오면 인사 없음');
  await ctx.close();
  // 동작 줄이기: 보이기는 하되 움직임 없음
  const r = await fresh(browser, BASE, { reducedMotion: 'reduce' });
  const w2 = r.page.getByTestId('daily-welcome');
  await w2.waitFor({ timeout: 8000 });
  assert.equal(await r.page.getByTestId('daily-welcome-icon').evaluate((el) => getComputedStyle(el).animationName), 'none', '동작 줄이기면 로고 움직임 없음');
  await r.ctx.close();
}
