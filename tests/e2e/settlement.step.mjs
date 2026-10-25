// V32 2 정산: /platform 정산 칸 — 이번 달 집계·장부 줄(수수료 추정 *)·[정산 완료] 표시 → 상태 바뀜 → 세금계산서 탭 → 고객 사용량·요금제 결제 내역의 [세금계산서] 요청 → 운영자 탭에 요청 1
import assert from 'node:assert/strict';

export async function settlementFlow({ owner, ctx, BASE, SHOTS, sql }) {
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await sql`insert into payments (tenant, kind, plan_code, moid, tid, amount, status, paid_at, card_name, meta, created_by) values ('default', 'subscription', 'w_standard', 'E2E-M1', 'E2E-T1', 14850, 'paid', now(), '[KB국민]', '{"payMethod":"CARD"}', ${ctx.ownerId}) on conflict (moid) do nothing`;
  await owner.goto(BASE + '/platform?tab=billing');
  const sec = owner.getByTestId('platform-settlement');
  await sec.waitFor();
  await sec.getByTestId('settle-summary').waitFor();
  const row = sec.getByTestId('settle-row').filter({ hasText: 'E2E' }).or(sec.locator('[data-testid="settle-row"]').first());
  await row.first().waitFor();
  assert.equal(await row.first().getAttribute('data-settlement'), 'pending');
  await row.first().getByTestId('settle-mark').click();
  await owner.getByText('정산 완료로 표시했습니다').waitFor();
  await owner.waitForFunction(() => document.querySelector('[data-testid="settle-row"]')?.getAttribute('data-settlement') === 'settled');
  await owner.screenshot({ path: `${SHOTS}/136-settlement.png`, fullPage: true });
  // 고객 쪽 요청: 우리 회사(내부 요금제)는 사용량 화면에 결제 칸이 없어 API 로 요청(화면 버튼은 유료 회사에서, API 시험 settlement.test 에서 확인)
  const [pay] = await sql`select id from payments where moid = 'E2E-M1'`;
  await ctx.owner.ok('POST', '/api/billing/tax-invoice', { paymentId: pay.id, companyName: '주식회사 다짐', bizNo: '1234567890', ceo: '김대표', email: 'tax@dagym.test' });
  await owner.goto(BASE + '/platform?tab=billing');
  await owner.getByTestId('settle-tab-tax').click();
  const tax = owner.getByTestId('tax-row').first();
  await tax.waitFor();
  assert.equal(await tax.getAttribute('data-status'), 'requested');
  await tax.getByTestId('tax-issued').click(); // 서버 반영 뒤 다시 불러와 체크됨(즉시 바뀌지 않음)
  await owner.getByText('발행 완료로 표시했습니다').waitFor();
  await owner.waitForFunction(() => document.querySelector('[data-testid="tax-row"]')?.getAttribute('data-status') === 'issued');
  await owner.screenshot({ path: `${SHOTS}/137-settlement-tax.png` });
}
