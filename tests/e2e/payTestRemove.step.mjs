// #566(대표 10/24 저녁 3) 플랫폼 운영 › 결제 시험: 시험 회사 [지우기] — 확인 창 → '지웠습니다' → 목록에서 빠짐(결제 기록이 있는 회사는 숨기기, API 시험에서 확인)
import assert from 'node:assert/strict';

export async function payTestRemove({ owner, ctx, sql, BASE, SHOTS }) {
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const t = await ctx.owner.ok('POST', '/api/platform/pay-test', { name: 'E2E 지울 시험 회사' });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/platform?tab=paytest`);
  const row = owner.getByTestId('pay-test-tenant').filter({ hasText: 'E2E 지울 시험 회사' }); await row.waitFor();
  await row.screenshot({ path: `${SHOTS}/273-pay-test-remove.png` });
  owner.once('dialog', (d) => d.accept());
  await row.getByTestId('pay-test-remove').click();
  await owner.getByText('지웠습니다').first().waitFor();
  await row.waitFor({ state: 'detached' });
  assert.equal((await sql`select count(*)::int n from tenants where id = ${t.id}`)[0].n, 0);
}
