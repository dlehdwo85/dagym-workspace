// 399차 #1025(대표 11/13 "현재 네이버 하이링크 광고 현황 및 보완점 … 워크인에서 보기가 어렵네요. 한눈에 보기 쉽게"):
// 광고 집행 = 탭(요약·점검 / 네이버 세팅 / 메타 / 검색어 점검 / 변경 기록 / 전체) · 요약 맨 위 '사업별 한 장 요약'(숫자 → 잘 되는·돈만 쓰는 검색어 → 할 일)
// · 마케팅 홈 '사업별 광고 요약' 한 줄 · 휴대폰 폭에서 옆으로 넘치지 않음. 광고 성과는 DB 에 직접 넣음(매체 연동 = 구조 시험)
import assert from 'node:assert/strict';

export async function mktBrief1025({ owner, ctx, sql, BASE }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const NAME = 'E2E요약브랜드';
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const [b] = await sql`insert into mkt_brands (tenant, name, color) values ('default', ${NAME}, '#0EA5E9') returning id`;
  const [a] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, status, last_sync_at) values ('default', 'naver', 'e2e-1025', 'E2E 요약 계정', 'active', now()) returning id`;
  try {
    await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${a.id}, ${today}, 'e2e1025-c', ${`${NAME}_검색`}, 4000, 50, 70000)`;
    const kw = (id, name, imp, clicks, cost) => sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, campaign_id, campaign_name, impressions, clicks, cost_krw) values (${a.id}, ${today}, 'keyword', ${id}, ${name}, 'e2e1025-c', ${`${NAME}_검색`}, ${imp}, ${clicks}, ${cost})`;
    await kw('e2e1025-k1', '요약 잘되는 검색어', 1500, 30, 30000); await kw('e2e1025-k2', '요약 돈만쓰는 검색어', 2000, 20, 40000); await kw('e2e1025-k3', '요약 노출만 검색어', 500, 0, 0);
    await sql`insert into mkt_calls (tenant, phone, created_by, ad_keyword, ad_provider, brand_id, called_at) values ('default', '010-0000-1025', ${ctx.ownerId}, '요약 잘되는 검색어', 'naver', ${b.id}, ${`${today}T00:10:00+09:00`}::timestamptz)`;
    await ctx.owner.ok('PUT', '/api/marketing/ad-ops/watch', { brandPlans: { [b.id]: 200000 } });

    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/marketing/ad-ops`);
    await owner.getByTestId('ad-tabs').waitFor();
    assert.equal(await owner.getByTestId('ad-tab-summary').getAttribute('aria-selected'), 'true', '처음은 요약·점검');
    const card = owner.locator(`[data-testid="brief-card"][data-brand="${NAME}"]`); await card.waitFor();
    const t = await card.innerText();
    assert.match(t, /광고비\s*70,000원/); assert.match(t, /계획 200,000원의 35%/); assert.match(t, /클릭\s*50/); assert.match(t, /클릭률 1\.3%/); assert.match(t, /문의·신청\s*1건/);
    assert.match(await card.getByTestId('brief-good').innerText(), /1\. 요약 잘되는 검색어[\s\S]*문의 1/);
    assert.match(await card.getByTestId('brief-waste').innerText(), /1\. 요약 돈만쓰는 검색어[\s\S]*40,000원 · 클릭 20 · 문의 0[\s\S]*요약 노출만 검색어[\s\S]*노출 500 · 클릭 0/);
    assert.match(await card.getByTestId('brief-todos').innerText(), /'요약 돈만쓰는 검색어' 입찰가 내리기·중지 검토/);
    assert.equal(await card.getByTestId('brief-more').getAttribute('href'), `/s/marketing/ads?brand=${b.id}`);
    // 요약 탭에는 상한·점검만 — 세팅안·변경 기록은 다른 탭
    assert.equal(await owner.getByTestId('ad-cap').count(), 1); assert.equal(await owner.getByTestId('ad-watch').count(), 1);
    assert.equal(await owner.getByTestId('ad-changes').count() + await owner.getByTestId('ad-naver').count() + await owner.getByTestId('ad-leads').count(), 0, '요약 탭에는 긴 목록 없음');
    await owner.getByTestId('ad-tab-log').click();
    await owner.waitForURL(/ad-ops\?tab=log/); await owner.getByTestId('ad-changes').waitFor();
    assert.equal(await owner.getByTestId('brand-briefs').count() + await owner.getByTestId('ad-cap').count(), 0);
    await owner.getByTestId('ad-tab-naver').click(); await owner.getByTestId('ad-naver').waitFor();
    assert.match(await owner.getByTestId('ad-naver').innerText(), /꺼진 상태/);
    await owner.getByTestId('ad-tab-kw').click(); await owner.getByTestId('ad-leads').waitFor();
    await owner.getByTestId('ad-tab-all').click(); await owner.waitForURL(/tab=all/);
    await owner.getByTestId('ad-changes').waitFor(); await owner.getByTestId('brand-briefs').waitFor(); await owner.getByTestId('ad-naver').waitFor();
    await owner.getByTestId('ad-tab-summary').click(); await owner.waitForURL((u) => !u.search.includes('tab='));
    // 주소로 바로 열기
    await owner.goto(`${BASE}/s/marketing/ad-ops?tab=meta`); await owner.getByTestId('lead-ads').waitFor();
    assert.equal(await owner.getByTestId('ad-tab-meta').getAttribute('aria-selected'), 'true');
    // 마케팅 홈: 사업별 광고 요약 한 줄
    await owner.goto(`${BASE}/s/marketing`);
    const row = owner.locator(`[data-testid="mkt-home-brief-row"][data-brand="${NAME}"]`); await row.waitFor();
    assert.match(await row.innerText(), /광고비\s*70,000원[\s\S]*계획의 35%[\s\S]*클릭 50[\s\S]*문의 1건/);
    // 휴대폰 폭: 옆으로 넘치지 않음
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/marketing/ad-ops`); await card.waitFor();
    const over = await owner.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `휴대폰 폭에서 옆으로 ${over}px 넘침`);
    if (process.env.E2E_SHOT_1025) { await owner.screenshot({ path: `${process.env.E2E_SHOT_1025}/brief-phone.png`, fullPage: true }); await owner.setViewportSize({ width: 1366, height: 900 }); await owner.goto(`${BASE}/s/marketing/ad-ops`); await card.waitFor(); await owner.screenshot({ path: `${process.env.E2E_SHOT_1025}/brief-pc.png`, fullPage: true });
      await owner.goto(`${BASE}/s/marketing`); await row.waitFor(); await owner.screenshot({ path: `${process.env.E2E_SHOT_1025}/home-pc.png`, fullPage: true }); }
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await ctx.owner.req('PUT', '/api/marketing/ad-ops/watch', { brandPlans: { [b.id]: null } }).catch(() => {});
    await sql`delete from mkt_calls where tenant = 'default' and phone = '010-0000-1025'`;
    await sql`delete from mkt_ad_items where account_id = ${a.id}`; await sql`delete from mkt_ad_stats where account_id = ${a.id}`;
    await sql`delete from mkt_ad_accounts where id = ${a.id}`; await sql`delete from mkt_brands where id = ${b.id}`;
  }
}
