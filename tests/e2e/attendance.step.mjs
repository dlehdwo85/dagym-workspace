// V30 ③ 출퇴근: 관리자 현장 등록 → 직원 홈 [출근](위치 동의 창 → 동의) → "출근 hh:mm · 강남점" → [퇴근] 현장 밖 → 사유 → 기록 → 관리자 날짜별 표에 현장 밖·사유
import assert from 'node:assert/strict';

export async function attendanceFlow({ browser, owner, ctx, BASE, SHOTS, login }) {
  await ctx.owner.ok('POST', '/api/attendance/sites', { name: 'E2E 강남점', lat: 37.4979, lng: 127.0276, radiusM: 150 });
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', geolocation: { latitude: 37.4981, longitude: 127.0276 }, permissions: ['geolocation'] });
  const staff = await login(c, ctx.staffB.email, ctx.staffB.password);
  await staff.goto(BASE + '/');
  const card = staff.getByTestId('home-clock');
  await card.waitFor();
  await card.getByTestId('clock-in').click();
  await staff.getByTestId('clock-consent').click();
  await card.getByTestId('home-clock-status').filter({ hasText: /출근 \d{2}:\d{2}/ }).waitFor();
  assert.match(await card.getByTestId('home-clock-status').innerText(), /E2E 강남점/);
  await staff.screenshot({ path: `${SHOTS}/129-clock-in.png` });
  // 퇴근: 현장 밖(판교) → 사유
  await c.setGeolocation({ latitude: 37.3948, longitude: 127.1112 });
  await card.getByTestId('clock-out').click();
  await staff.getByTestId('clock-reason').fill('판교 외근 후 퇴근');
  await staff.getByTestId('clock-reason-save').click();
  await card.getByTestId('home-clock-status').filter({ hasText: /퇴근 \d{2}:\d{2}/ }).waitFor();
  assert.match(await card.getByTestId('home-clock-status').innerText(), /E2E 강남점 밖 · 판교 외근 후 퇴근/);
  assert.equal(await card.getByTestId('clock-out').count(), 0, '퇴근 뒤 버튼 없음');
  await c.close();
  // 관리자 표
  await owner.goto(BASE + '/admin/attendance');
  const row = owner.getByTestId('attendance-row').filter({ hasText: '박직원' });
  await row.waitFor();
  assert.match(await row.innerText(), /E2E 강남점 밖 · 판교 외근 후 퇴근/);
  await owner.screenshot({ path: `${SHOTS}/130-attendance-admin.png` });
  await owner.getByTestId('attendance-tab-month').click();
  await owner.getByTestId('attendance-month').waitFor();
  await owner.getByTestId('attendance-tab-sites').click();
  await owner.getByTestId('site-list').getByText('E2E 강남점').waitFor();
}
