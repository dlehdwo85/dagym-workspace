// 208차 #667 설계 파트너(결정 15-30): [고객사 추가] 구분 = 설계 파트너 → 기간 꼭 적기(기본값 없음)·요금제 체험 고정·안내 → 회사 관리 '설계 파트너 기간' 상자(AI 월 5,000원·마케팅 크레딧 0)
// → 끝 3일 전 슈퍼관리자 알림 링크(?tenant=)로 그 회사 관리 창이 바로 열림 → [기간 +30일] · [지금 종료] → 파트너 대표 화면 띠 '설계 파트너 기간이 끝나 읽기 전용'
import assert from 'node:assert/strict';

export async function partner208({ owner, browser, ctx, sql, BASE, SHOTS, tick, Client }) {
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/platform?tab=company`);
  await owner.getByTestId('platform-add-company').click();
  const f = owner.getByTestId('new-company');
  await f.getByTestId('new-company-name').fill('E2E 설계파트너');
  await f.getByTestId('new-company-owner').fill('정파트너');
  await f.getByTestId('new-company-email').fill('e2e-partner208@dagym.test');
  const days = f.getByTestId('new-company-trial-days');
  assert.equal(await days.inputValue(), '14', '일반 고객 체험은 14일 기본');
  await f.getByTestId('new-company-segment').selectOption('partner');
  assert.equal(await days.inputValue(), '', '파트너 기간은 기본값 없음');
  assert.equal(await f.getByTestId('new-company-plan').isDisabled(), true, '요금제는 체험 고정');
  assert.match(await f.getByTestId('new-company-partner-note').innerText(), /AI 월 예산 5,000원 · 마케팅 크레딧 0/);
  await f.getByTestId('new-company-go').click(); // 기간 없이 → 브라우저가 막음
  assert.equal(await days.evaluate((el) => el.validity.valueMissing), true);
  assert.equal(await owner.getByTestId('new-company-done').count(), 0);
  await days.fill('45');
  await owner.screenshot({ path: `${SHOTS}/551-platform-partner-add.png` });
  await f.getByTestId('new-company-go').click();
  const done = owner.getByTestId('new-company-done'); await done.waitFor();
  const invite = await done.getByTestId('new-company-link').getAttribute('href');
  await done.getByTestId('new-company-open').click();
  const box = owner.getByTestId('company-detail').getByTestId('company-partner'); await box.waitFor();
  assert.match(await box.getByTestId('company-partner-period').innerText(), /D-4[45]/);
  assert.match(await box.getByTestId('company-partner-preset').innerText(), /AI 월 예산 5,000원 · 마케팅 월 크레딧 0 \(파트너 기본값\)/);
  const [t] = await sql`select id from tenants where name = 'E2E 설계파트너'`;
  await owner.keyboard.press('Escape');

  // 끝 3일 전 → 슈퍼관리자 알림 → 링크로 그 회사 관리 창이 바로 열림
  await sql`update tenant_subscriptions set trial_ends_at = now() + interval '2 days' where tenant = ${t.id}`;
  await tick();
  const [n] = await sql`select link, title from notifications where user_id = ${ctx.ownerId} and title = '설계 파트너 기간이 2일 남았습니다 — E2E 설계파트너'`;
  assert.ok(n, '슈퍼관리자 알림');
  await owner.goto(`${BASE}${n.link}`);
  const box2 = owner.getByTestId('company-detail').getByTestId('company-partner'); await box2.waitFor();
  assert.match(await box2.getByTestId('company-partner-period').innerText(), /D-2$/);
  await owner.screenshot({ path: `${SHOTS}/552-platform-partner-box.png` });
  await box2.getByTestId('partner-extend-30').click();
  await box2.getByTestId('company-partner-period').filter({ hasText: /D-3[12]$/ }).waitFor();
  owner.once('dialog', (dlg) => dlg.accept());
  await box2.getByTestId('partner-end').click();
  await box2.getByTestId('company-partner-period').filter({ hasText: /^끝남 — 읽기 전용/ }).waitFor();
  assert.equal(await box2.getByTestId('partner-end').count(), 0, '끝난 뒤엔 [지금 종료] 없음');

  // 파트너 대표: 초대 수락 → 화면 띠 '설계 파트너 기간이 끝나 읽기 전용입니다'
  const c = new Client('partner208');
  await c.ok('POST', `/api/invitations/${invite.split('/').pop()}/accept`, { password: 'partner-208-pass' });
  await sql`update tenants set onboarded_at = now() where id = ${t.id}`; // 첫 로그인 안내 창은 이 시험과 무관 — 띠가 보이게
  const pc = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    await pc.addCookies([{ name: 'wos_session', value: c.cookie.slice('wos_session='.length), url: BASE }]);
    await pc.addInitScript(() => { try { sessionStorage.setItem('wos_intro', '1'); } catch { /* 시작 애니메이션 건너뜀 */ } });
    const p = await pc.newPage();
    await p.goto(`${BASE}/tasks`);
    const band = p.getByTestId('trial-banner'); await band.waitFor();
    assert.match(await band.innerText(), /설계 파트너 기간이 끝나 읽기 전용입니다/);
    await p.waitForLoadState('networkidle').catch(() => {});
    await p.screenshot({ path: `${SHOTS}/553-partner-read-only-band.png` });
  } finally { await pc.close(); }
}
