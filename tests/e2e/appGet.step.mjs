// 대표 11/20 "사이트 주소를 공유하면 직원들이 앱을 내려받은 후 진행할 수 있도록": 앱 받기 화면(/app) · 휴대폰 브라우저 맨 위 띠 · 초대 수락 뒤 '앱 받기' 한 단계 · 초대 창 안내 문구
// 소개 첫 화면 [앱 다운로드] → /app(PC: QR) · 안드로이드 브라우저: 소개·로그인에 띠 → [앱 받기] → Google Play 단추 · 닫으면 다시 안 뜸 · 아이폰: '홈 화면에 추가' 안내
// · 앱 안·앱이 띄운 로그인 창·PC 에는 띠 없음 · 직원 초대 창에 앱 받기 주소 + 안내 문구 복사 · 휴대폰에서 초대 수락 → 가입 완료 화면 [앱 받기]·[웹으로 계속하기]
import assert from 'node:assert/strict';

const UA = {
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  app: 'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.0.0 Mobile Safari/537.36 WorkInApp',
};
const PLAY = 'https://play.google.com/store/apps/details?id=kr.co.dagym.workos';
const phone = (browser, userAgent) => browser.newContext({ viewport: { width: 390, height: 844 }, userAgent, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const noOverflow = async (p, what) => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${what}: 가로 넘침 없음`);

export async function appGet({ browser, owner, BASE, SHOTS, sql }) {
  // ① PC: 소개 첫 화면 [앱 다운로드] → 앱 받기 화면(QR · 두 스토어 · 웹 로그인) · PC 에는 띠 없음
  const pcCtx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR' });
  const pc = await pcCtx.newPage();
  await pc.goto(`${BASE}/`); await pc.getByTestId('landing-title').waitFor();
  await pc.waitForTimeout(400); assert.equal(await pc.getByTestId('app-get-bar').count(), 0, 'PC 에는 띠 없음');
  await pc.getByTestId('landing-app').click(); await pc.waitForURL(`${BASE}/app`);
  await pc.getByTestId('app-get-title').waitFor();
  assert.equal(await pc.getByTestId('app-get').getAttribute('data-os'), 'pc');
  assert.ok((await pc.getByTestId('app-get-qr').locator('svg').boundingBox()).width >= 150, 'QR 이 보임');
  assert.equal(await pc.getByTestId('app-get-url').innerText(), 'www.work-in.dev/app');
  assert.equal(await pc.getByTestId('app-get-play').getAttribute('href'), PLAY);
  await pc.getByTestId('app-get-appstore-soon').waitFor();
  await pc.screenshot({ path: `${SHOTS}/app-get-pc.png` });
  await pc.getByTestId('app-get-os-ios').click(); await pc.waitForURL(/\/app\?os=ios/); await pc.getByTestId('app-get-ios-steps').waitFor();
  await pc.goto(`${BASE}/app`); await pc.getByTestId('app-get-web').click(); await pc.waitForURL(/\/login/);
  await pc.waitForTimeout(400); assert.equal(await pc.getByTestId('app-get-bar').count(), 0, 'PC 로그인 화면에도 띠 없음');
  await pcCtx.close();

  // ② 안드로이드 휴대폰 브라우저: 소개·로그인 맨 위 띠 → [앱 받기] → Google Play 단추 + 3단계 · 닫으면 다시 안 뜸
  const aCtx = await phone(browser, UA.android); const a = await aCtx.newPage();
  await a.goto(`${BASE}/`); await a.getByTestId('landing-title').waitFor();
  const bar = a.getByTestId('app-get-bar'); await bar.waitFor();
  assert.match(await bar.innerText(), /앱으로 쓰면 알림을 받습니다[\s\S]*앱 받기/);
  assert.ok((await bar.boundingBox()).y < 5, '띠는 맨 위'); await noOverflow(a, '소개(띠)');
  await a.goto(`${BASE}/login`); await a.getByRole('button', { name: /로그인/ }).first().waitFor();
  await bar.waitFor(); assert.ok((await bar.boundingBox()).y < 5, '로그인 화면도 맨 위'); await noOverflow(a, '로그인(띠)');
  await a.screenshot({ path: `${SHOTS}/app-get-bar-login.png` });
  await a.getByTestId('app-get-bar-go').click(); await a.waitForURL(`${BASE}/app`);
  assert.equal(await a.getByTestId('app-get').getAttribute('data-os'), 'android');
  assert.equal(await a.getByTestId('app-get-play').getAttribute('href'), PLAY);
  assert.equal(await a.getByTestId('app-get-steps').locator('li').count(), 3);
  assert.equal(await a.getByTestId('app-get-qr').count(), 0, '휴대폰에는 QR 없음');
  assert.ok((await a.getByTestId('app-get-play').boundingBox()).height >= 48, '단추 높이 48 이상'); await noOverflow(a, '앱 받기(안드로이드)');
  assert.doesNotMatch(await a.locator('body').innerText(), /무료|체험|요금|결제/, '요금 글자 없음');
  await a.screenshot({ path: `${SHOTS}/app-get-android.png` });
  await a.goto(`${BASE}/login`); await bar.waitFor();
  await a.getByTestId('app-get-bar-close').click(); await bar.waitFor({ state: 'detached' });
  await a.reload(); await a.getByRole('button', { name: /로그인/ }).first().waitFor(); await a.waitForTimeout(500);
  assert.equal(await bar.count(), 0, '닫은 띠는 다시 안 뜸');
  await a.goto(`${BASE}/`); await a.getByTestId('landing-title').waitFor(); await a.waitForTimeout(400);
  assert.equal(await bar.count(), 0, '소개 화면에서도 안 뜸');

  // ③ 아이폰 브라우저: App Store 주소가 없는 동안은 '홈 화면에 추가' 안내 · 앱 안·앱이 띄운 로그인 창에는 띠 없음(/app 도 로그인으로)
  const iCtx = await phone(browser, UA.iphone); const i = await iCtx.newPage();
  await i.goto(`${BASE}/login`); const ibar = i.getByTestId('app-get-bar'); await ibar.waitFor();
  assert.match(await ibar.innerText(), /홈 화면에 추가하면 앱처럼 씁니다[\s\S]*방법 보기/);
  await i.getByTestId('app-get-bar-go').click(); await i.waitForURL(`${BASE}/app`);
  await i.getByTestId('app-get-ios-soon').waitFor();
  assert.equal(await i.getByTestId('app-get-ios-steps').locator('li').count(), 3);
  assert.equal(await i.getByTestId('app-get-play').count() + await i.getByTestId('app-get-appstore').count(), 0, '아이폰 화면에 스토어 단추 없음');
  await noOverflow(i, '앱 받기(아이폰)'); await i.screenshot({ path: `${SHOTS}/app-get-iphone.png` });
  await i.getByTestId('app-get-open').click(); await i.waitForURL(/\/login/);
  await iCtx.addCookies([{ name: 'wos_app', value: '1', url: BASE }]); // 앱이 띄운 로그인 창 표시
  await i.goto(`${BASE}/login`); await i.getByRole('button', { name: /로그인/ }).first().waitFor(); await i.waitForTimeout(500);
  assert.equal(await ibar.count(), 0, '앱이 띄운 로그인 창에는 띠 없음');
  await i.goto(`${BASE}/app`); await i.waitForURL(/\/login/);
  await iCtx.close();
  const appCtx = await phone(browser, UA.app); const ap = await appCtx.newPage();
  await ap.goto(`${BASE}/login`); await ap.getByRole('button', { name: /로그인/ }).first().waitFor(); await ap.waitForTimeout(500);
  assert.equal(await ap.getByTestId('app-get-bar').count(), 0, '앱 안에는 띠 없음');
  await ap.goto(`${BASE}/app`); await ap.waitForURL(/\/login/);
  await appCtx.close();

  // ④ 직원 초대 창: 앱 받기 주소 + 안내 문구 복사 → 휴대폰에서 초대 수락 → 가입 완료 화면 [앱 받기]·[웹으로 계속하기]
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('invite-open').click();
  const dlg = owner.getByRole('dialog', { name: '직원 초대' });
  await dlg.getByLabel('이름').fill('앱받기 직원'); await dlg.getByLabel('회사 이메일').fill('appget@dagym.test');
  await dlg.getByRole('button', { name: '초대 링크 만들기' }).click();
  const link = await owner.getByTestId('invite-link').inputValue(); assert.ok(link.includes('/invite/'));
  const guide = owner.getByTestId('invite-app-guide'); await guide.waitFor();
  assert.match(await guide.innerText(), /www\.work-in\.dev\/app/);
  await owner.getByTestId('invite-guide-copy').click(); await owner.getByText('안내 문구를 복사했습니다').waitFor();
  await owner.keyboard.press('Escape');
  // 로컬 11/21: 잘못 보낸 초대는 화면에서 [초대 취소] — 한 번 더 확인 → 목록에 '초대 취소됨'
  await owner.getByTestId('invite-open').click();
  const dlg2 = owner.getByRole('dialog', { name: '직원 초대' });
  await dlg2.getByLabel('이름').fill('잘못보낸 초대'); await dlg2.getByLabel('회사 이메일').fill('appget-oops@dagym.test');
  await dlg2.getByRole('button', { name: '초대 링크 만들기' }).click(); await owner.getByTestId('invite-link').waitFor(); await owner.keyboard.press('Escape');
  const oops = owner.locator('tr', { hasText: 'appget-oops@dagym.test' });
  let nativeDialog = false; const onNative = (d) => { nativeDialog = true; d.dismiss(); }; owner.on('dialog', onNative);
  await oops.getByTestId('user-cancel-invite').click();
  // 로컬 11/21: 브라우저 기본 confirm() 대신 화면 안 확인 창(자동 조작 도구가 멈추지 않게) — [취소]면 아무것도 안 바뀜, [초대 취소]면 취소
  const cdlg = owner.getByTestId('confirm-dialog'); await cdlg.waitFor();
  assert.match(await owner.getByTestId('confirm-message').innerText(), /잘못보낸 초대\(appget-oops@dagym\.test\) 초대를 취소할까요\?/);
  await owner.getByTestId('confirm-cancel').click(); await cdlg.waitFor({ state: 'detached' });
  await oops.getByTestId('user-cancel-invite').waitFor();
  await oops.getByTestId('user-cancel-invite').click(); await cdlg.waitFor();
  await owner.getByTestId('confirm-ok').click();
  owner.off('dialog', onNative); assert.equal(nativeDialog, false, '브라우저 기본 확인 창이 뜨지 않음');
  await owner.getByText('잘못보낸 초대 초대를 취소했습니다').first().waitFor();
  await oops.getByTestId('user-status').getByText('초대 취소됨').waitFor();
  assert.equal(await oops.getByTestId('user-cancel-invite').count() + await oops.getByTestId('user-reinvite').count() + await oops.getByTestId('user-contract').count(), 0, '취소한 줄에는 초대·전자계약서 단추가 없음');
  await a.goto(link); await a.getByText('초대했습니다').waitFor();
  await a.getByLabel('비밀번호 (8자 이상)').fill('appget-pass-1'); await a.getByLabel('비밀번호 확인').fill('appget-pass-1');
  // #1086: 초대 수락에도 [선택] AI 기능 이용 동의 한 줄 — 체크하면 AI 동의(지금 판)로 저장
  assert.match(await a.getByTestId('ai-consent-line').innerText(), /\[선택\] AI 기능 이용 동의/); assert.equal(await a.getByTestId('agree-ai').isChecked(), false);
  await a.getByTestId('agree-ai').check(); await noOverflow(a, '초대 수락(AI 줄)');
  await a.getByRole('button', { name: '가입하고 시작하기' }).click();
  const done = a.getByTestId('invite-done'); await done.waitFor();
  assert.match(await done.innerText(), /가입이 끝났습니다[\s\S]*appget@dagym\.test[\s\S]*앱 받기[\s\S]*웹으로 계속하기/);
  assert.equal(await a.getByTestId('invite-app').getAttribute('href'), '/app');
  if (sql) assert.deepEqual((await sql`select c.agreed from consents c join users u on u.id = c.user_id where u.email = 'appget@dagym.test' and c.kind = 'ai_share'`).map((r) => r.agreed), [true], '초대 수락 때 체크 = AI 동의');
  await a.screenshot({ path: `${SHOTS}/app-get-invite-done.png` });
  await a.getByTestId('invite-web').click(); await a.waitForURL(`${BASE}/`);
  assert.equal(await a.getByTestId('landing-title').count(), 0, '가입한 채로 홈(소개 화면 아님)');
  await aCtx.close();
}
