// 397차 #1023(애플 11/06 반려 5.1.1(v) '앱 안에 계정 삭제를 시작하는 메뉴가 없음'): 설정 맨 위 [계정 삭제] → 아래 '계정 › 계정 삭제' 칸이 펼쳐져 보임(회사 계정 = 삭제 요청 · 직접 가입 = 회원 탈퇴)
import assert from 'node:assert/strict';

export async function iosReview1023({ owner, BASE }) {
  await owner.setViewportSize({ width: 390, height: 844 });
  try {
    await owner.goto(`${BASE}/settings`);
    const link = owner.getByTestId('to-delete-account'); await link.waitFor();
    const box = owner.getByTestId('delete-account');
    assert.equal(await box.locator('details[open]').count(), 0, '처음엔 접혀 있음');
    await link.click();
    await box.locator('details[open]').first().waitFor();
    assert.match(await box.innerText(), /^계정 삭제/);
    assert.match(await box.locator('details[open] summary').first().innerText(), /계정 삭제/);
    assert.ok(await box.locator('details[open] button').first().isVisible(), '삭제(요청) 단추가 보임');
    // 주소로 바로 와도 펼쳐짐(심사 메모의 경로)
    await owner.goto(`${BASE}/settings#delete-account`);
    await owner.getByTestId('delete-account').locator('details[open]').first().waitFor();
  } finally { await owner.setViewportSize({ width: 1366, height: 900 }); }
}
