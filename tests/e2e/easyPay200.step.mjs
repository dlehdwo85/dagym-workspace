// 200차 #706(대표 10/26 '간편결제 창 띄울 수 있을 것'): 결제 화면 간편결제 바로 열기 — 켠 간편결제만 버튼 · 고르면 [필수] 결제 대행 약관 동의 칸 · 동의 없으면 안 열림 ·
// 결제창 요청 = 카드 + 간편결제 + 동의 · 카드·계좌를 다시 고르면 간편결제 풀림 · 결제 내역에 간편결제 이름 · 1366·390 넘침 없음
// 구조 시험: 대표 계정은 내부 공간이라 결제 칸이 없으므로 /api/billing 응답을 시험용으로 바꿔 화면만 본다. 실제 나이스페이 결제창(외부)은 열지 않고 결제창 요청 본문만 확인
import assert from 'node:assert/strict';

export async function easyPay200({ owner, BASE, SHOTS }) {
  const sent = [];
  const until = async (n) => { for (let i = 0; i < 100 && sent.length < n; i++) await new Promise((r) => setTimeout(r, 100)); assert.equal(sent.length, n, '결제창 요청 수'); };
  const q = (cycle, amount) => ({ planCode: 'w_standard', name: '스탠다드', cycle, seats: 3, supply: Math.round(amount / 1.1), amount });
  const fake = { enabled: true, mode: 'test', card: null, sub: { plan_code: 'trial', status: 'trial' }, autoRenewConsent: null, addons: [], quotes: [q('monthly', 14850), q('annual', 142560)],
    payments: [{ id: 'e2e-pay-706', kind: 'subscription', plan_code: 'w_standard', amount: 14850, status: 'paid', canceled_amount: 0, result_msg: '카드 결제 성공', card_name: '네이버페이', card_no: '45678912****9876', paid_at: new Date().toISOString(), created_at: new Date().toISOString(), tid: null, pay_method: 'CARD', easy_pay: 'naverpay', vbank: null }],
    easyPays: [{ key: 'naverpay', label: '네이버페이' }, { key: 'kakaopay', label: '카카오페이' }] };
  await owner.route('**/api/billing', (route) => route.request().method() === 'GET' ? route.fulfill({ json: fake }) : route.continue());
  await owner.route('**/api/billing/window', async (route) => { sent.push(route.request().postDataJSON()); await route.fulfill({ status: 400, json: { error: { code: 'bad_request', message: 'E2E 결제창은 열지 않음' } } }); });
  try {
    for (const [w, h] of [[1366, 900], [390, 844]]) {
      sent.length = 0;
      await owner.setViewportSize({ width: w, height: h });
      await owner.goto(`${BASE}/admin/usage`);
      const bill = owner.getByTestId('billing'); await bill.waitFor();
      assert.deepEqual(await bill.getByTestId(/^billing-easypay-(naverpay|kakaopay|tosspay)$/).allInnerTexts(), ['네이버페이', '카카오페이'], '켠 간편결제만');
      assert.match(await owner.getByTestId('billing-payments').innerText(), /스탠다드|w_standard/);
      assert.match(await owner.getByTestId('billing-payments').innerText(), /· 네이버페이/, '결제 내역에 간편결제 이름');
      await bill.getByLabel('구독할 요금제').selectOption('w_standard');
      const radio = (name) => owner.getByTestId('billing-paymethod').getByRole('radio', { name, exact: true });
      await owner.getByTestId('billing-easypay-naverpay').click();
      assert.equal(await radio('네이버페이').getAttribute('aria-checked'), 'true');
      assert.equal(await radio('카드').getAttribute('aria-checked'), 'false', '간편결제를 고르면 카드 칩은 꺼짐');
      const consent = owner.getByTestId('billing-easypay-consent'); await consent.waitFor();
      assert.match(await consent.innerText(), /\[필수\] 결제 대행 약관 동의 — 네이버페이 결제 화면을 바로 엽니다/);
      assert.match(await consent.innerText(), /정기결제\(자동 결제\)는 카드 등록으로만 됩니다/);
      assert.equal(await consent.locator('a[href="https://www.nicepay.co.kr/cs/terms/policy1.do"]').count(), 1);
      // 동의 없이 → 결제창 요청 없음
      await owner.getByTestId('billing-window-monthly').click();
      await owner.getByText('간편결제는 결제 대행 약관에 동의해야 열 수 있습니다').first().waitFor();
      assert.equal(sent.length, 0, '동의 전에는 요청 안 보냄');
      await consent.getByRole('checkbox').check();
      if (w === 390) await bill.screenshot({ path: `${SHOTS}/543-billing-easypay.png` });
      await owner.getByTestId('billing-window-monthly').click();
      await until(1); await owner.getByText('E2E 결제창은 열지 않음').first().waitFor();
      assert.deepEqual(sent.at(-1), { kind: 'monthly', planCode: 'w_standard', payMethod: 'CARD', easyPay: 'naverpay', agree: true });
      // 카카오페이로 바꾸면 동의를 다시 받음
      await owner.getByTestId('billing-easypay-kakaopay').click();
      assert.equal(await consent.getByRole('checkbox').isChecked(), false, '간편결제를 바꾸면 동의 다시');
      // 계좌이체를 고르면 간편결제 풀림 → 예전 결제창 그대로
      await radio('계좌이체').click();
      assert.equal(await owner.getByTestId('billing-easypay-consent').count(), 0);
      await owner.getByTestId('billing-window-monthly').click();
      await until(2);
      assert.deepEqual(sent.at(-1), { kind: 'monthly', planCode: 'w_standard', payMethod: 'BANK' }, '간편결제 칸 없이');
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${w}px 가로 넘침 없음`);
    }
  } finally {
    await owner.unroute('**/api/billing'); await owner.unroute('**/api/billing/window');
    await owner.setViewportSize({ width: 1366, height: 900 });
  }
}
