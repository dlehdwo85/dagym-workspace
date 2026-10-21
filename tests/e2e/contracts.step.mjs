// #116 전자계약서: 관리 › 사용자 줄 [전자계약서] → 근로계약서 칸 채워 보내기 → 링크·접속 코드 → (로그인 없는 새 브라우저) 코드 → 본문 → 서명 그리기 → 동의 → 서명 완료 → 전자계약서 탭 1/2 → 상세 감사 추적
import assert from 'node:assert/strict';

export async function contractsFlow({ browser, owner, ctx, BASE, SHOTS, sql }) {
  await owner.goto(BASE + '/admin/users');
  const row = owner.locator('tr', { hasText: '이직원' }).first();
  await row.getByTestId('user-contract').click();
  await owner.getByTestId('contract-form').waitFor();
  await owner.getByTestId('cf-start_date').fill('2026-11-01');
  await owner.getByTestId('cf-workplace').fill('다짐 강남점');
  await owner.getByTestId('cf-duties').fill('현장 운영');
  await owner.getByTestId('cf-work_hours').fill('09:00~18:00 (휴게 12:00~13:00)');
  await owner.getByTestId('cf-work_days').fill('주 5일(월~금), 주휴일 일요일');
  await owner.getByTestId('cf-salary').fill('월 2,800,000원');
  await owner.getByTestId('cf-pay_day').fill('매월 25일');
  await owner.getByTestId('contract-send').click();
  await owner.getByTestId('contract-sent').waitFor();
  const dv = owner.getByTestId('contract-delivery').filter({ has: owner.locator('[data-role="employee"]') }).or(owner.locator('[data-testid="contract-delivery"][data-role="employee"]')).first();
  const link = await dv.getByTestId('contract-link').inputValue();
  const code = (await dv.getByTestId('contract-code').innerText()).trim();
  assert.match(link, /\/sign\/[A-Za-z0-9_-]{20,}$/); assert.match(code, /^\d{6}$/);
  await owner.screenshot({ path: `${SHOTS}/186-contract-sent.png` });
  await owner.keyboard.press('Escape');
  // 로그인 없는 서명자 브라우저(휴대폰 폭)
  const sc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const signer = await sc.newPage();
  try {
    await signer.goto(link);
    await signer.getByTestId('sign-title').waitFor();
    assert.match(await signer.getByTestId('sign-title').innerText(), /근로계약서 — 이직원/);
    await signer.getByTestId('sign-code').fill('000000');
    await signer.getByTestId('sign-open').click();
    await signer.getByTestId('sign-error').waitFor();
    await signer.getByTestId('sign-code').fill(code);
    await signer.getByTestId('sign-open').click();
    await signer.getByTestId('sign-body').waitFor();
    assert.match(await signer.getByTestId('sign-body').innerText(), /다짐 강남점[\s\S]*월 2,800,000원/);
    assert.equal(await signer.getByTestId('sign-submit').isDisabled(), true, '서명·동의 전엔 비활성');
    // 서명 그리기(포인터)
    await signer.getByTestId('sig-canvas').scrollIntoViewIfNeeded(); // 휴대폰 폭에서는 본문 아래라 화면 밖 → 스크롤 뒤 좌표
    const box = await signer.getByTestId('sig-canvas').boundingBox();
    await signer.mouse.move(box.x + 30, box.y + 80); await signer.mouse.down();
    for (let i = 1; i <= 12; i++) await signer.mouse.move(box.x + 30 + i * 18, box.y + 80 + Math.sin(i) * 25);
    await signer.mouse.up();
    await signer.getByTestId('sign-agree').check();
    await signer.screenshot({ path: `${SHOTS}/187-contract-sign.png` });
    await signer.getByTestId('sign-submit').click();
    await signer.getByTestId('sign-done').waitFor();
    assert.match(await signer.getByTestId('sign-done').innerText(), /서명이 완료되었습니다/);
  } finally { await sc.close(); }
  const [c] = await sql`select c.status, (select count(*)::int from contract_signers s where s.contract_id = c.id and s.status = 'signed') as signed from contracts c where c.title = '근로계약서 — 이직원' order by c.created_at desc limit 1`;
  assert.deepEqual([c.status, c.signed], ['partially_signed', 1]);
  // 전자계약서 탭·상세
  await owner.goto(BASE + '/admin/users?tab=contracts');
  const crow = owner.getByTestId('contract-row').filter({ hasText: '근로계약서 — 이직원' }).first();
  await crow.waitFor();
  assert.equal(await crow.getAttribute('data-status'), 'partially_signed');
  assert.equal((await crow.getByTestId('contract-progress').innerText()).trim(), '1/2');
  await crow.getByTestId('contract-open').click();
  await owner.getByTestId('contract-detail').waitFor();
  const signers = owner.getByTestId('contract-signer');
  assert.equal(await signers.first().getAttribute('data-status'), 'signed');
  await owner.getByText(/감사 추적 \d+건/).click();
  await owner.getByTestId('contract-events').waitFor();
  assert.match(await owner.getByTestId('contract-events').innerText(), /서명/);
  await owner.screenshot({ path: `${SHOTS}/188-contract-detail.png` });
  await owner.keyboard.press('Escape');
}
