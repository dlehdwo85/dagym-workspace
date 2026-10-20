// 소개 사이트(대표 10/20 16:45): 로그인 전 / = 랜딩(H1·무료로 시작·앱 다운로드·세 공간·AI·3단계·요금 5명 무료·문의·푸터 계정 삭제·JSON-LD·OG) + 클릭 이벤트 + 390px, 로그인하면 홈
import assert from 'node:assert/strict';

export async function landing({ browser, owner, BASE, SHOTS }) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR' });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/?utm_source=naver&utm_medium=cpc&utm_campaign=launch`);
  assert.equal(new URL(p.url()).pathname, '/', '주소는 / 그대로(rewrite)');
  assert.equal(await p.getByTestId('landing-title').innerText(), '업무도, 영업도, 마케팅도 한 화면에서');
  assert.equal(await p.getByTestId('landing-space-work').count() + await p.getByTestId('landing-space-sales').count() + await p.getByTestId('landing-space-marketing').count(), 3);
  await p.getByTestId('landing-ai').waitFor(); await p.getByTestId('landing-steps').waitFor();
  assert.match(await p.getByTestId('pricing').innerText(), /0원[\s\S]*5명까지/); assert.equal(await p.getByTestId('pricing').getByText(/베이직|스탠다드|프로/).count(), 0, '요금은 5명 무료만');
  assert.match(await p.getByTestId('landing-contact').innerText(), /dagym-in@naver\.com/);
  await p.getByTestId('biz-footer').getByRole('link', { name: '계정 삭제' }).waitFor();
  const ld = JSON.parse(await p.locator('script[type="application/ld+json"]').first().innerHTML());
  assert.ok(ld['@graph'].some((x) => x['@type'] === 'SoftwareApplication' && x.offers.price === '0'), 'JSON-LD');
  assert.equal(await p.locator('meta[property="og:image"]').getAttribute('content'), 'https://www.work-in.dev/landing/og.png');
  assert.equal(await p.locator('meta[name="robots"]').getAttribute('content'), 'index, follow');
  assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('wos_utm') ?? '{}').source), 'naver', 'UTM 기억');
  const fired = await p.evaluate(() => new Promise((r) => { document.addEventListener('wos:landing', (e) => r(e.detail.kind), { once: true }); document.querySelector('[data-testid="landing-app"]').click(); }));
  assert.equal(fired, 'app', '앱 다운로드 클릭 이벤트');
  await p.getByTestId('landing-stores').getByText('Google Play').waitFor();
  await p.screenshot({ path: `${SHOTS}/163-landing.png`, fullPage: true });
  await p.setViewportSize({ width: 390, height: 844 }); await p.goto(`${BASE}/`);
  await p.getByTestId('landing-title').waitFor();
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390), '390 가로 넘침 없음');
  await p.screenshot({ path: `${SHOTS}/163-landing-390.png`, fullPage: true });
  await p.getByTestId('landing-start').click(); await p.waitForURL(/\/signup/);
  await ctx.close();
  await owner.goto(`${BASE}/`); await owner.waitForURL(`${BASE}/`);
  assert.equal(await owner.getByTestId('landing-title').count(), 0, '로그인 상태는 홈');
}
