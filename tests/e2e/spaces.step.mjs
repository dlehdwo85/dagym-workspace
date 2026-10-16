// V41 단계 1 공간 틀: 관리 › 사용자 › 공간에서 영업 켜기 → PC 공간 카드 드롭다운으로 영업(파란 강조) → Ctrl+1 로 업무 →
// 휴대폰 프로필 시트 공간 전환 → 뒤로가기 = 업무 · 영업 미배정 직원은 공간 카드 없음·주소 404 → 끄기
import assert from 'node:assert/strict';
export async function spaces({ browser, desk, owner, staff, BASE }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-sales').check();
  await owner.waitForLoadState('load');
  await owner.goto(`${BASE}/`);
  await owner.getByTestId('space-switch').click();
  await owner.getByTestId('space-menu').getByText(/내 업무 \d+/).waitFor();
  await owner.getByTestId('space-go-sales').click();
  await owner.waitForURL(/\/s\/sales$/);
  await owner.getByTestId('space-home-sales').waitFor();
  assert.equal(await owner.getByTestId('space-current').textContent(), '워크인 · 영업');
  assert.equal(await owner.locator('.app-shell').getAttribute('data-space'), 'sales');
  await owner.keyboard.press('Control+1');
  await owner.waitForURL(`${BASE}/`);
  assert.equal(await owner.getByTestId('space-current').textContent(), '워크인 · 업무');
  await owner.keyboard.press('Control+2');
  await owner.waitForURL(/\/s\/sales$/);
  await owner.goBack();
  await owner.waitForURL(`${BASE}/`);
  // 휴대폰(대표): 프로필 → 공간 시트
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  await m.goto(`${BASE}/tasks`);
  await m.getByRole('button', { name: '메뉴 더보기' }).tap();
  await m.getByTestId('mobile-spaces').waitFor();
  await m.getByTestId('mobile-space-sales').tap();
  await m.waitForURL(/\/s\/sales$/);
  assert.equal(await m.getByTestId('mobile-space-chip').textContent(), '영업');
  await m.getByRole('button', { name: '메뉴 더보기' }).tap();
  await m.getByTestId('mobile-space-work').tap(); // 마지막 공간 = 업무로 돌려 둠
  await m.waitForURL(/\/$/);
  await mc.close();
  // 영업 미배정 직원: 공간 카드 없음 · 주소 직접 입력 404
  await staff.goto(`${BASE}/tasks`);
  assert.equal(await staff.getByTestId('mobile-space-chip').count(), 0);
  const r = await staff.goto(`${BASE}/s/sales`);
  assert.equal(r.status(), 404);
  // 원래대로(다른 시험에 영향 없게): 업무 공간으로·영업 끄기
  await owner.keyboard.press('Control+1').catch(() => {});
  await owner.evaluate(() => localStorage.setItem('wos_space', 'work'));
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-sales').uncheck();
  await owner.waitForLoadState('load');
}
