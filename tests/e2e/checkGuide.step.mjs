// 점검 1단계 — 점검 가이드 화면(휴대폰 폭 375): 처음 열면 공통 기본 템플릿이 설치돼 있음 → 찾기·거름 → 항목 추가(양호 기준·놓치기 쉬운 곳) →
// 기준 사진 올리기 → 직원에게 공유(2판) → 개정 이력 → [직원 공유 양호 기준] 탭 · 글자로 복사 → [분야·공간] 탭에서 업종 템플릿 넣기 →
// 직원(가이드 권한 없음)은 탭 없이 공유된 양호 기준과 기준 사진만 봄 · 메뉴에 '점검'
import assert from 'node:assert/strict';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR42mNk+M+AFzAxDCgY4dIATT0CDxO0HKMAAAAASUVORK5CYII=', 'base64');

export async function checkGuide({ owner, staff, BASE, SHOTS }) {
  await owner.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await owner.setViewportSize({ width: 375, height: 812 });
  await owner.goto(BASE + '/check');
  await owner.getByTestId('check-home').waitFor();
  await owner.getByTestId('check-tab-guide').click(); // 점검 2단계부터: 점검하기 권한이 있으면 '점검하기' 탭이 먼저 열림
  // 처음 열면 공통 기본 템플릿(분야 8개 묶음)
  await owner.getByTestId('check-group').first().waitFor({ timeout: 20000 });
  assert.ok(await owner.getByTestId('check-item-row').count() >= 19, '공통 기본 항목이 보임');
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 375), '375 가로 넘침 없음');
  await owner.screenshot({ path: `${SHOTS}/check-guide-mobile.png` });
  // 찾기
  await owner.getByTestId('check-search').fill('화장실');
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid=check-item-row]').length === 1);
  await owner.getByTestId('check-item-row').getByText('바닥 물기·냄새 없음, 휴지·비누 채워짐').waitFor();
  await owner.getByTestId('check-search').fill('');
  // 항목 추가 → 저장하면 같은 창에서 기준 사진
  await owner.getByTestId('check-item-add').click();
  const form = owner.getByTestId('check-item-form');
  await owner.getByTestId('check-item-title').fill('E2E 진열대 정리');
  await owner.getByTestId('check-item-pass').fill('가격표가 상품과 맞고 빈 칸이 없음');
  await owner.getByTestId('check-item-blind').fill('맨 아래 칸\n뒤쪽 줄');
  await form.getByText('저장한 뒤 기준 사진을 올릴 수 있습니다.').waitFor();
  await owner.getByTestId('check-item-save').click();
  await owner.getByText('저장했습니다').first().waitFor();
  await owner.getByTestId('check-photo-input').setInputFiles({ name: 'shelf.png', mimeType: 'image/png', buffer: PNG });
  await owner.getByTestId('check-photo').first().waitFor({ timeout: 15000 });
  // 그림 칸이 생긴 직후에는 아직 받는 중일 수 있다(CI 에서 한 번 실패) → 다 열릴 때까지 기다린 뒤 확인
  await owner.waitForFunction(() => { const img = document.querySelector('[data-testid=check-photo]'); return !!img && img.complete && img.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
  assert.ok(await owner.getByTestId('check-photo').first().evaluate((img) => img.complete && img.naturalWidth > 0), '기준 사진이 실제로 열림');
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 375), '항목 창도 375 가로 넘침 없음');
  await owner.screenshot({ path: `${SHOTS}/check-item-mobile.png` });
  // 직원에게 공유 + 고친 까닭 → 2판 · 개정 이력
  await owner.getByTestId('check-item-share').check();
  await owner.getByTestId('check-item-reason').fill('직원 공유 시작');
  await owner.getByTestId('check-item-save').click();
  await owner.getByText('저장했습니다 — 2판').first().waitFor();
  await owner.getByTestId('check-item-history').locator('summary').click();
  await owner.getByTestId('check-item-history').getByText(/2판 .*직원 공유 시작/).waitFor();
  await form.getByRole('button', { name: '닫기' }).click();
  await owner.getByTestId('check-item-row').getByText('E2E 진열대 정리').waitFor();
  // 직원 공유 양호 기준 탭 · 글자로 복사
  await owner.getByTestId('check-tab-shared').click();
  const mine = owner.getByTestId('check-shared-item').filter({ hasText: 'E2E 진열대 정리' });
  await mine.getByText('가격표가 상품과 맞고 빈 칸이 없음').waitFor();
  await mine.getByText('놓치기 쉬운 곳: 맨 아래 칸 · 뒤쪽 줄').waitFor();
  await owner.getByTestId('check-shared-copy').click();
  await owner.getByText('양호 기준을 복사했습니다').first().waitFor();
  const copied = await owner.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (copied) assert.match(copied, /· E2E 진열대 정리: 가격표가 상품과 맞고 빈 칸이 없음\n {2}놓치기 쉬운 곳 — 맨 아래 칸, 뒤쪽 줄/);
  // 분야·공간 탭: 업종 템플릿 넣기(한 번만)
  await owner.getByTestId('check-tab-setup').click();
  await owner.getByTestId('check-setup-categories').getByText('청결').first().waitFor();
  const tpl = owner.getByTestId('check-template-cafe');
  await tpl.getByRole('button', { name: '넣기' }).click();
  await owner.getByText('카페·음료 템플릿을 넣었습니다 — 항목 4개').first().waitFor();
  await tpl.getByText('넣음').waitFor();
  await owner.getByTestId('check-setup-place-types').getByText('바(제조 공간)').waitFor();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 375), '분야·공간 탭 375 가로 넘침 없음');
  await owner.setViewportSize({ width: 1366, height: 900 });
  // PC: 사이드바에 '점검'
  await owner.goto(BASE + '/check');
  await owner.getByRole('link', { name: '점검', exact: true }).first().waitFor();
  // 직원(가이드 권한 없음): 탭 없이 공유된 양호 기준과 기준 사진만
  await staff.goto(BASE + '/check');
  await staff.getByTestId('check-home').waitFor();
  const st = staff.getByTestId('check-shared-item').filter({ hasText: 'E2E 진열대 정리' });
  await st.getByText('가격표가 상품과 맞고 빈 칸이 없음').waitFor();
  assert.ok(await st.locator('img').first().evaluate((img) => new Promise((r) => { if (img.complete) r(img.naturalWidth > 0); else { img.onload = () => r(true); img.onerror = () => r(false); } })), '직원도 공유 항목의 기준 사진을 봄');
  assert.equal(await staff.getByTestId('check-tab-guide').count(), 0, '직원에게는 가이드·분야 탭이 없음');
  assert.equal(await staff.getByTestId('check-item-add').count(), 0);
  assert.ok(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '직원 화면 가로 넘침 없음');
  await staff.screenshot({ path: `${SHOTS}/check-shared-staff.png` });
}
