// 221차 #531 광고 성과 캠페인 단위 브랜드: 여러 브랜드가 같이 쓰는 계정의 캠페인을 이름으로 나눔 → 전체 화면 브랜드별 카드·브랜드×매체 표 →
// 캠페인 표 [브랜드] 직접 고르기 → '찾는 낱말' 저장 → 카드 숫자 바뀜 → 카드 누르면 그 브랜드만 · 휴대폰 폭 넘침 없음
import assert from 'node:assert/strict';

export async function adsBrand221({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()); const month = today.slice(0, 7);
  const ga = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E가온' })).id;
  const na = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E나래' })).id;
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'naver', '2210221', 'E2E 공용 검색광고', ${ctx.ownerId}) returning id`;
  for (const [cid, name, clicks, cost] of [['e221-ga', '[E2E가온] 파워링크', 30, 30000], ['e221-na', 'E2E나래_지역 검색', 20, 20000], ['e221-co', 'E2E 공동 행사', 10, 10000], ['e221-en', 'GAON221 리타게팅', 5, 5000]]) {
    await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${acc.id}, ${today}::date, ${cid}, ${name}, ${clicks * 20}, ${clicks}, ${cost})`;
  }
  await owner.goto(`${BASE}/s/marketing/ads?month=${month}`);
  const card = (n) => owner.getByTestId('ads-brand-card').and(owner.locator(`[data-brand="${n}"]`));
  await card('E2E가온').filter({ hasText: '30,000원' }).waitFor();
  await card('E2E나래').filter({ hasText: '20,000원' }).waitFor();
  await card('(브랜드 없음)').waitFor(); await owner.getByTestId('ads-brand-none-hint').waitFor();
  await owner.getByTestId('ads-by-brand').getByTestId('ads-brand-row').and(owner.locator('[data-brand="E2E가온"]')).waitFor();
  await owner.getByTestId('ads-brand-cards').scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/572-ads-brand-cards.png` });
  // 캠페인 표: 공동 행사 → E2E나래 직접 지정
  const row = owner.getByTestId('ads-camp-row').filter({ hasText: 'E2E 공동 행사' });
  assert.equal(await row.getByTestId('ads-camp-brand').inputValue(), 'auto');
  assert.match(await row.getByTestId('ads-camp-brand').locator('option[value="auto"]').innerText(), /자동 · 정하지 않음/);
  await owner.getByTestId('ads-camp-unbranded').waitFor();
  await row.getByTestId('ads-camp-brand').selectOption(na);
  await card('E2E나래').filter({ hasText: '30,000원' }).waitFor();
  assert.equal(await row.getByTestId('ads-camp-brand').inputValue(), na);
  assert.equal(await owner.getByTestId('ads-camp-row').filter({ hasText: '[E2E가온] 파워링크' }).getByTestId('ads-camp-brand-cell').getAttribute('data-source'), 'name');
  await row.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/573-ads-campaign-brand.png` });
  // 찾는 낱말: GAON221 → E2E가온
  const al = owner.getByTestId('ads-aliases'); await al.locator('summary').click();
  const ar = al.getByTestId('ads-alias-row').and(owner.locator('[data-brand="E2E가온"]'));
  await ar.getByTestId('ads-alias-input').fill('GAON221');
  await ar.getByTestId('ads-alias-save').click();
  await card('E2E가온').filter({ hasText: '35,000원' }).waitFor();
  assert.deepEqual((await sql`select ad_aliases from mkt_brands where id = ${ga}`)[0].ad_aliases, ['GAON221']);
  // 카드 누르면 그 브랜드만
  await card('E2E가온').click();
  await owner.getByTestId('ads-card').filter({ hasText: '광고비' }).filter({ hasText: '35,000원' }).waitFor();
  assert.equal(await owner.getByTestId('ads-brand').inputValue(), ga);
  assert.equal(await owner.getByTestId('ads-brand-cards').count(), 0, '브랜드를 고르면 브랜드별 카드·표 숨김');
  // 휴대폰 폭: 전체로 돌아가 넘침 없음
  await owner.getByTestId('ads-brand').selectOption('');
  await owner.setViewportSize({ width: 390, height: 844 });
  await card('E2E가온').waitFor();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 390), '휴대폰 폭 넘침 없음');
  await owner.getByTestId('ads-brand-cards').scrollIntoViewIfNeeded();
  await owner.waitForFunction(() => !document.querySelector('[data-testid="toast"]'), null, { timeout: 12_000 }).catch(() => {}); // 알림창이 사라진 뒤 찍기
  await owner.screenshot({ path: `${SHOTS}/574-ads-brand-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
