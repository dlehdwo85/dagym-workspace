// 스토어 심사(로컬 10/19 대표): 앱(네이티브·앱 user-agent) 안에서는 요금제 가입·변경·팩·결제창·가격을 숨기고 "요금제는 PC 웹(관리자)에서 관리합니다"만. 웹은 그대로
import assert from 'node:assert/strict';
export async function inApp({ browser, BASE, devices, owner }) {
  // 294차 #839: 아이폰 앱은 앱 밖 결제 안내도 없이 '사용량만' — 안드로이드 앱은 예전 그대로 'PC 웹에서 관리'
  for (const [dev, note] of [['Pixel 7', '요금제는 PC 웹(관리자)에서 관리합니다.'], ['iPhone 13', '이 화면은 사용량만 보여 줍니다.']]) {
    const c = await browser.newContext({ ...devices[dev], userAgent: `${devices[dev].userAgent} WorkInApp`, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
    await c.addCookies(await owner.context().cookies());
    const p = await c.newPage();
    await p.goto(`${BASE}/admin/usage`);
    await p.getByTestId('in-app-billing-note').getByText(note).waitFor();
    await p.getByTestId('meter-storage').waitFor();
    for (const id of ['plan-request', 'current-plan', 'plan-table', 'billing-subscribe', 'billing-window']) assert.equal(await p.getByTestId(id).count(), 0, `앱 안에 ${id} 없음`);
    assert.equal(await p.getByText(/1인 월|요금제 변경|결제창|카드 등록|추가 팩/).count(), 0, '가격·결제 글자 없음');
    if (dev === 'iPhone 13') { const hit = await p.getByText(/PC 웹|요금제/).allTextContents(); assert.deepEqual(hit, [], '아이폰 앱: 요금제·PC 웹 결제 안내 없음'); }
    await c.close();
  }
  // 웹은 그대로
  await owner.goto(`${BASE}/admin/usage`);
  await owner.getByTestId('plan-table').waitFor();
  assert.equal(await owner.getByTestId('in-app-billing-note').count(), 0);
}
