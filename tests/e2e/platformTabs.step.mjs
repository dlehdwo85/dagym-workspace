// #565(대표 10/24 "너무 많고 이해하기 어렵다 · 종류별로"): 플랫폼 운영 맨 위 '오늘 볼 것' 숫자 5개 → 누르면 그 탭 · 종류별 탭 5개(한 줄 설명·주소에 남음)
// · 예전 주소(?tab=paytest·#support)도 해당 탭 · 휴대폰 폭에서 탭 가로로 넘김
import assert from 'node:assert/strict';

export async function platformTabs({ owner, ctx, sql, BASE, SHOTS }) {
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/platform`);
  const today = owner.getByTestId('platform-today'); await today.waitFor();
  assert.equal(await today.getByRole('button').count(), 5, "'오늘 볼 것' 5개");
  await today.getByTestId('today-company').getByText(/곳$/).waitFor();
  assert.equal(await owner.getByTestId('platform-tabs').getByRole('tab').count(), 5);
  assert.equal(await owner.getByTestId('platform-tab-company').getAttribute('aria-selected'), 'true', '처음은 회사·가입');
  await owner.getByTestId('platform-company-list').waitFor();
  await owner.screenshot({ path: `${SHOTS}/274-platform-tabs.png` });
  await today.getByTestId('today-support').click();
  await owner.waitForURL(/\/platform\?tab=support/);
  await owner.getByTestId('support-inbox').waitFor();
  assert.match(await owner.getByTestId('platform-tab-desc').innerText(), /고객 문의에 답하고/);
  assert.equal(await owner.getByTestId('platform-company-list').count(), 0, '다른 탭 칸은 안 보임');
  await owner.getByTestId('platform-tab-ai').click();
  await owner.getByTestId('platform-tts').waitFor();
  await owner.getByText('영상 내레이션(목소리 만들기)').first().waitFor();
  await owner.reload();
  await owner.getByTestId('platform-tts').waitFor(); // 새로 고쳐도 같은 탭
  await owner.goto(`${BASE}/platform?tab=paytest`);
  await owner.getByTestId('pay-test').waitFor(); // 예전 결제 시험 주소
  assert.equal(await owner.getByTestId('platform-tab-billing').getAttribute('aria-selected'), 'true');
  await owner.goto(`${BASE}/platform#support`);
  await owner.getByTestId('support-inbox').waitFor(); // 예전 문의 주소
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/platform?tab=sales`);
  await owner.getByTestId('platform-today').waitFor();
  const w = await owner.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(w <= 392, `휴대폰 폭 가로 넘침 없음 ${w}`);
  await owner.screenshot({ path: `${SHOTS}/275-platform-tabs-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
