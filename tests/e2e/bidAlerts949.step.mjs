// #949(대표 승인 11/04): 입찰 공고 아침 메일 무료 구독 소개 페이지 — 로그인 없이 이메일·지역·분야·동의 → [무료로 받기] → 신청됨 안내 · 소개 페이지 방문 1번 · 화면에 가격 숫자 없음
import assert from 'node:assert/strict';

export async function bidAlerts949({ browser, BASE, SHOTS, sql }) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR' });
  const p = await ctx.newPage();
  const views = []; p.on('request', (r) => { if (r.url().includes('/api/public/landing-view')) views.push(r.postDataJSON()?.page); });
  await p.goto(`${BASE}/landing/bid-alerts?utm_source=meta&utm_medium=cpc&utm_campaign=bid-alerts`);
  assert.equal(await p.getByTestId('landing-h1').innerText(), '관심 지역 입찰 공고, 매일 아침 메일로 받으세요');
  assert.doesNotMatch(await p.locator('body').innerText(), /[0-9][0-9,]*\s*원(?![가-힣])|최고|1위/, 'kit-ko-copy: 가격 숫자·과장 없음');
  await p.getByTestId('bid-alert-form').screenshot({ path: `${SHOTS}/949-bid-alert-form.png` });
  // 빈 채 누르면 안내 · 채우고 누르면 신청됨
  await p.getByTestId('bid-alert-submit').click();
  assert.match(await p.getByTestId('bid-alert-error').innerText(), /이메일 주소를 확인해 주세요/);
  await p.getByTestId('bid-alert-email').fill('e2e949@sample.test');
  await p.getByTestId('bid-alert-regions').getByRole('button', { name: '경기', exact: true }).click();
  await p.getByTestId('bid-alert-field-cleaning').click(); // 기본 '주민공동시설' + 청소
  await p.getByTestId('bid-alert-submit').click();
  assert.match(await p.getByTestId('bid-alert-error').innerText(), /동의/);
  await p.getByTestId('bid-alert-agree').check();
  await p.getByTestId('bid-alert-submit').click();
  await p.getByTestId('bid-alert-done').waitFor();
  assert.match(await p.getByTestId('bid-alert-done').innerText(), /신청됐습니다[\s\S]*경기 · 주민공동시설 위탁운영·청소·미화·방역/);
  await p.screenshot({ path: `${SHOTS}/949-bid-alert-done.png` });
  const [s] = await sql`select regions, fields, status, utm from bid_alert_subscribers where email = 'e2e949@sample.test'`;
  assert.deepEqual([s.status, s.regions, s.fields, s.utm?.source, s.utm?.page], ['active', ['경기'], ['community', 'cleaning'], 'meta', 'bid-alerts'], '신청 저장 + 광고 출처·소개 페이지 기억');
  await p.waitForFunction(() => JSON.parse(localStorage.getItem('wos_utm') ?? '{}').page === 'bid-alerts');
  assert.ok(views.includes('bid-alerts'), '소개 페이지 방문 1번');
  await ctx.close();
}
