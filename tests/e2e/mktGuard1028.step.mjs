// 402차 #1028(대표 11/13 "하이링크는 절대 네이버 광고 비용이 닳아서 광고가 진행 안 되는 상황이 연출되어선 안 됩니다. 메일로 따로 알려 주세요"):
// 마케팅 › 연결 계정 › 매체 잔액 줄의 [끊김 방지 메일] — 켜면 저장되고 다시 열어도 켜져 있음, 끄면 꺼짐. 메일 단계(14·7·3일·0원)는 API 시험(mkt-guard-1028)
import assert from 'node:assert/strict';

export async function mktGuard1028({ owner, ctx, sql, BASE }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const LABEL = 'E2E 끊김방지 계정';
  await ctx.owner.ok('PUT', '/api/marketing/ads/balances', { provider: 'google', label: LABEL, balanceKrw: 500000 });
  const [b] = await sql`select id from mkt_ad_balances where tenant = 'default' and label = ${LABEL}`;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/marketing/connections`);
    const li = owner.locator('[data-testid="ads-balance"]', { hasText: LABEL }); await li.waitFor();
    const box = li.getByTestId('ads-balance-guard');
    assert.equal(await box.isChecked(), false, '처음은 꺼짐');
    assert.match(await li.innerText(), /끊김 방지 메일/);
    await box.click(); // 저장한 뒤 서버 값으로 다시 그림(누른 순간 바로 바뀌지 않음)
    await owner.getByText('끊김 방지 메일을 켰습니다').first().waitFor();
    assert.equal((await sql`select guard from mkt_ad_balances where id = ${b.id}`)[0].guard, true);
    await owner.waitForFunction((label) => [...document.querySelectorAll('[data-testid="ads-balance"]')].some((x) => x.textContent.includes(label) && x.querySelector('[data-testid="ads-balance-guard"]')?.checked), LABEL, { timeout: 10000 });
    await owner.reload(); await li.waitFor();
    assert.equal(await li.getByTestId('ads-balance-guard').isChecked(), true, '다시 열어도 켜짐');
    await li.getByTestId('ads-balance-guard').click();
    await owner.getByText('끊김 방지 메일을 껐습니다').first().waitFor();
    assert.equal((await sql`select guard from mkt_ad_balances where id = ${b.id}`)[0].guard, false);
    // 휴대폰 폭: 줄이 옆으로 넘치지 않음
    await owner.setViewportSize({ width: 390, height: 844 }); await owner.reload(); await li.waitFor();
    const over = await owner.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `휴대폰 폭에서 옆으로 ${over}px 넘침`);
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await sql`delete from mkt_proposals where tenant = 'default' and body->>'signal' = ${`recharge:google:${LABEL}`}`.catch(() => {});
    await sql`delete from mkt_ad_balances where id = ${b.id}`;
  }
}
