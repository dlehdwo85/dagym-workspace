// 294차 #839 App Store 심사 거절(10/28) — 아이폰 앱은 로그인만: 카카오·네이버·구글 로그인·가입 링크·무료 체험 문구 없음,
// 가입·소개 주소는 로그인으로 · 안드로이드 앱은 가입 주소 그대로
import assert from 'node:assert/strict';

export async function iosApp839({ browser, BASE, devices }) {
  const ios = await browser.newContext({ ...devices['iPhone 13'], userAgent: `${devices['iPhone 13'].userAgent} WorkInApp`, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await ios.newPage();
  await p.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await p.getByTestId('invite-only').getByText('계정은 회사 관리자의 초대로 만들어집니다.').waitFor();
  await p.getByTestId('ios-password-hint').waitFor();
  assert.equal(await p.getByTestId('to-signup').count(), 0, '가입(무료 체험) 링크 없음');
  assert.equal(await p.getByTestId('social-buttons').count(), 0, '카카오·네이버·구글 로그인 없음');
  assert.equal(await p.getByText(/무료|체험|요금/).count(), 0, '무료·체험·요금 글자 없음');
  for (const path of ['/signup', '/welcome']) {
    await p.goto(`${BASE}${path}`);
    await p.waitForURL((u) => u.pathname === '/login');
  }
  await ios.close();
  // 아이패드 가로(왼쪽 소개 판이 보이는 폭): 무료 체험 문구 없음
  const ipad = await browser.newContext({ viewport: { width: 1180, height: 820 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) WorkInApp', locale: 'ko-KR' });
  const q = await ipad.newPage();
  await q.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await q.getByText('회사 관리자가 초대한 계정으로 로그인').waitFor();
  assert.equal(await q.getByText(/무료|체험/).count(), 0, '아이패드 앱도 무료 체험 문구 없음');
  await ipad.close();
  // 안드로이드 앱은 그대로(가입 주소 막지 않음)
  const and = await browser.newContext({ ...devices['Pixel 7'], userAgent: `${devices['Pixel 7'].userAgent} WorkInApp`, locale: 'ko-KR' });
  const a = await and.newPage();
  await a.goto(`${BASE}/signup`);
  assert.equal(new URL(a.url()).pathname, '/signup', '안드로이드 앱은 가입 화면 그대로');
  await and.close();
}
