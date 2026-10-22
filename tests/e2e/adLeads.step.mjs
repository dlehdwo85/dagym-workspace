// 광고 최적화 1차 ③ 통화 기반 최적화: 광고 운영 '전화·문의 기준 키워드 점검' — 요약(광고비·전화·문의·전환당 비용·목표) · 키워드 표(끄기 제안·잘 됨 배지)
// · 워크인 세팅안 키워드 [끄기](보내는 값) · [목표 바꾸기](회사 설정) · 기간 7일 · 휴대폰 폭 → 전화 문의 기록에 '광고 키워드'(고르기 목록) → 줄에 '광고: …'
// 시험 서버에는 가짜 네이버가 없다 → 키워드 성과·광고 유입 전화는 DB 에 만들고, 네이버로 가는 [끄기]는 보내는 요청만 확인(실제 경로는 tests/api/ad-leads.test.mjs)
import assert from 'node:assert/strict';

export async function adLeads({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'naver', '7654323', 'E2E 전화 네이버', ${ctx.ownerId})
    on conflict (tenant, provider, external_id) do update set label = excluded.label returning id`;
  const [plan] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, name, plan, status, external, created_by, approved_by, approved_at)
    values ('default', ${acc.id}, 'naver', 'E2E 전화 광고', ${sql.json({ dailyBudget: 10000, bidAmt: 300, channelId: 'bsn-1', keywords: ['두정동 헬스장', '두정역 PT'], ads: [{ headline: '가을 PT 상담', description: '첫 상담 무료', url: 'https://example.com' }] })},
      'active', ${sql.json({ campaignId: 'cmp-p', adgroupId: 'grp-p', keywordIds: ['nkw-e1', 'nkw-e2'], adIds: ['nad-p'] })}, ${ctx.ownerId}, ${ctx.ownerId}, now()) returning id`;
  for (const [id, name, clicks, cost] of [['nkw-e1', '두정동헬스장', 100, 30000], ['nkw-e2', '두정역PT', 120, 80000]]) {
    await sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, campaign_name, impressions, clicks, cost_krw) values (${acc.id}, ${today}, 'keyword', ${id}, ${name}, 'E2E 전화 광고', ${clicks * 20}, ${clicks}, ${cost})`;
  }
  // 광고로 들어온 사람의 전화 클릭 20건(두정동 헬스장) — 다른 단계가 남긴 '키워드 모름' 전화·문의보다 충분히 많게
  await sql`insert into mkt_ad_leads (tenant, day, provider, keyword_key, keyword_id, kind, keyword, n) values ('default', ${today}, 'naver', '두정동헬스장', 'nkw-e1', 'tel', '두정동헬스장', 20)`;
  await sql`insert into mkt_site_events (tenant, site, day, event, label, n) values ('default', 'e2e-leads', ${today}, 'cta', 'tel', 20)`;

  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  const box = owner.getByTestId('ad-leads');
  const r2 = box.getByTestId('ad-leads-row').filter({ hasText: '두정역PT' });
  await r2.waitFor();
  assert.match(await box.getByTestId('ad-leads-summary').innerText(), /전화 \d+건\(클릭 \d+ · 기록 \d+\) · 문의 \d+건 → 전환당 비용 [\d,]+원 · 목표 [\d,]+원\(기간 평균\)/);
  assert.equal(await r2.getAttribute('data-flag'), 'waste');
  assert.equal(await r2.getByTestId('ad-leads-flag').innerText(), '0건 — 끄기 제안');
  const r1 = box.getByTestId('ad-leads-row').filter({ hasText: '두정동헬스장' });
  assert.equal(await r1.getByTestId('ad-leads-flag').innerText(), '잘 됨');
  assert.match(await r1.innerText(), /30,000원\s+100\s+20\s+0\s+1,500원/, '광고비·클릭·전화·문의·전환당 비용');
  assert.equal(await box.getByTestId('ad-leads-row').first().getAttribute('data-flag'), 'waste', '끄기 제안이 맨 위');
  await box.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/204-ad-leads.png` });
  // [끄기] = 네이버 키워드 userLock — 보내는 값만 확인
  const sent = [];
  await owner.route('**/api/marketing/ad-ops/plans/*/action', async (r) => { sent.push({ url: r.request().url(), body: r.request().postDataJSON() }); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }); });
  await r2.getByTestId('ad-leads-pause').click();
  await owner.getByText("'두정역PT' 키워드를 껐습니다").waitFor();
  assert.ok(sent[0].url.includes(`/plans/${plan.id}/action`));
  assert.deepEqual(sent[0].body, { action: 'kw_pause', keywordIds: ['nkw-e2'] });
  await owner.unroute('**/api/marketing/ad-ops/plans/*/action');
  // 목표 전환당 비용 20,000원(회사 설정)
  owner.once('dialog', (d) => d.accept('20000'));
  await box.getByTestId('ad-leads-target').click();
  await owner.getByText('목표 전환당 비용을 저장했습니다').waitFor();
  await box.getByTestId('ad-leads-summary').getByText(/목표 20,000원\(회사 설정\)/).waitFor();
  // 기간 7일
  await box.getByTestId('ad-leads-days').selectOption('7');
  await box.getByTestId('ad-leads-row').filter({ hasText: '두정역PT' }).waitFor();
  // 휴대폰 폭: 표는 상자 안에서만 옆으로
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  await owner.getByTestId('ad-leads-row').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 전화 문의 기록: "어떻게 알고 전화하셨어요?" → 광고 키워드(고르기 목록 = 최근 광고비 많은 키워드)
  await owner.goto(`${BASE}/s/marketing/calls`);
  await owner.getByTestId('mkt-calls').waitFor();
  await owner.locator('#call-ad-keywords option').first().waitFor({ state: 'attached' }); // 목록을 읽어 온 뒤
  assert.deepEqual(await owner.locator('#call-ad-keywords option').evaluateAll((o) => o.slice(0, 2).map((x) => x.value)), ['두정역PT', '두정동헬스장']);
  await owner.getByTestId('call-phone').fill('010-4242-0001');
  await owner.getByTestId('call-ad-keyword').fill('두정동 헬스장');
  await owner.getByTestId('call-add').click();
  await owner.getByTestId('call-row').filter({ hasText: '010-4242-0001' }).getByText(/광고: 두정동 헬스장/).waitFor();
  const [c] = await sql`select ad_keyword from mkt_calls where phone = '010-4242-0001'`;
  assert.equal(c.ad_keyword, '두정동 헬스장');
  // 정리
  await sql`delete from mkt_calls where phone = '010-4242-0001'`;
  await sql`delete from mkt_ad_leads where keyword_id = 'nkw-e1'`;
  await sql`delete from mkt_site_events where site = 'e2e-leads'`;
  await sql`update mkt_settings set target_cpa = null where tenant = 'default'`;
  await sql`delete from mkt_ad_accounts where id = ${acc.id}`;
}
