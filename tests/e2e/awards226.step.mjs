// 226차 #497 R21-4 낙찰 분석: 영업기회 › 입찰 [낙찰 분석] → 업체별 줄(법인 표시 빼고 묶음 · 낙찰 n건 · 금액 합 · 평균 낙찰률·참가 · 지역) · 우리 회사 표시
// → 업체 펼치기 → 최근 낙찰 → 누르면 공고 상세 · 기간 칩(주소 ?ad=) · 휴대폰 폭 넘침 없음. 끝나면 맞춤 조건·넣은 결과·회사 정보를 되돌림
import assert from 'node:assert/strict';

export async function awards226({ owner, ctx, sql, BASE, SHOTS }) {
  const ID = (n) => `00000000-0000-4000-8000-000000226${String(n).padStart(3, '0')}`; const ids = [1, 2, 3, 4, 5, 6].map(ID);
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - n * 864e5));
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const orig = (await ctx.owner.ok('GET', '/api/sales/digest/prefs')).prefs;
  const clean = async () => { await sql`delete from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = any(${ids})`; await sql`delete from company_profiles where tenant = 'default' and key = 'e2eaward226'`; };
  await clean();
  const res = (n, title, ago, extra) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID(n)}, ${sql.json({ id: ID(n), source_type: 'kapt_bid',
    source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=E2E226-${n}`, title, notice_kind: 'new', current_status: '낙찰', award_date: ymd(ago), related: true, ...extra })}, 'workin')`;
  // 다른 단계 자료와 겹치지 않게 지어낸 업체 이름 — 같은 업체를 '(주)'·'주식회사'로 다르게 적은 2건 · 다른 업체 1건 · 우리 회사(사업자번호) 1건 · 유찰 1건
  await res(1, '[경기] 모의일아파트 헬스장 위탁운영', 4, { winner_name: '(주)모의스포츠', winner_amount: 150000000, winner_rate: 88.2, bidders: 5, region: '경기' });
  await res(2, '[서울] 모의이아파트 헬스장 위탁운영', 15, { winner_name: '모의스포츠 주식회사', winner_amount: 90000000, winner_rate: 91.4, bidders: 3, region: '서울' });
  await res(3, '[인천] 모의삼아파트 헬스장 위탁운영', 9, { winner_name: '모의관리', winner_amount: 40000000, region: '인천' });
  await res(4, '[경기] 모의사아파트 헬스장 위탁운영', 2, { winner_name: 'E2E우리회사', winner_biz_no: '9876543210', region: '경기' });
  await res(5, '[경기] 모의오아파트 헬스장 위탁운영', 6, { current_status: '유찰' });
  // 231차: 우리 회사가 참여했지만 남이 낙찰(K-apt 참여업체 표) → '진 입찰' · 1위와 응찰금액 차
  await res(6, '[경기] 모의육아파트 헬스장 위탁운영', 3, { winner_name: '육모의서비스(주)', winner_amount: 95000000, bidders: 2, region: '경기', participants: [
    { name: 'E2E우리회사(주)', bizNo: '9876543210', amount: 99000000, won: false, invalid: false }, { name: '육모의서비스(주)', bizNo: '1112223334', amount: 95000000, won: true, invalid: false }] });
  await sql`insert into company_profiles (tenant, key, name, biz_no, is_default) values ('default', 'e2eaward226', 'E2E우리회사(주)', '987-65-43210', false)`;
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: [], excludes: [], regions: [], issuers: [], itemCodes: [], amountMin: null, amountMax: null });
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/hub?tab=bids`);
    await owner.getByTestId('sales-bids-tab-awards').click();
    const box = owner.getByTestId('award-stats'); await box.waitFor();
    await owner.waitForURL(/bt=awards/);
    const mo = box.getByTestId('award-row').filter({ hasText: '(주)모의스포츠' });
    await mo.waitFor();
    assert.match(await mo.innerText(), /낙찰 2건/, '(주)·주식회사 표기가 달라도 한 업체');
    assert.match(await mo.getByTestId('award-row-meta').innerText(), /낙찰금액 합 2\.4억 · 평균 낙찰률 89\.8% · 평균 참가 4곳 · 경기·서울 · 최근 \d+\/\d+/);
    const ours = box.getByTestId('award-row').filter({ hasText: 'E2E우리회사' });
    await ours.getByTestId('award-ours').waitFor();
    assert.equal(await box.getByTestId('award-row').filter({ hasText: '모의관리' }).count(), 1);
    assert.match(await box.getByTestId('award-summary').innerText(), /관련 결과 \d+건 · 낙찰 \d+ · 유찰 \d+ · 낙찰 업체 \d+곳.* · 우리 회사 낙찰 \d+건/);
    assert.match(await box.getByTestId('award-me').innerText(), /우리 회사로 보는 기준: .*E2E우리회사\(주\).* · 사업자번호 \d+개/, '227차: 무엇을 우리 회사로 보는지 안내');
    // 231차: 우리 회사 참여 · 진 입찰 — 펼치면 1위·우리 금액·차이·참가 수
    const lost = box.getByTestId('award-lost');
    assert.match(await lost.locator('summary').innerText(), /우리 회사 참여 \d+건 · 낙찰 \d+건 · 진 입찰 1건/);
    await lost.locator('summary').click();
    assert.match(await lost.getByTestId('award-lost-row').first().innerText(), /모의육아파트 헬스장 위탁운영[\s\S]*1위 육모의서비스\(주\) 9,500만원 · 우리 9,900만원 · 차이 \+400만원 · 참가 2곳/);
    await mo.locator('button[aria-expanded]').click();
    const recent = mo.getByTestId('award-recent'); await recent.waitFor();
    assert.equal(await recent.getByTestId('award-recent-open').count(), 2);
    assert.match(await recent.getByTestId('award-recent-open').first().innerText(), /모의일아파트 헬스장 위탁운영 · 1\.5억 · 88\.2% · 참가 5곳/, '최근 순');
    await box.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/579-award-stats.png`, clip: await box.boundingBox() });
    // 최근 낙찰을 누르면 그 공고 상세
    await recent.getByTestId('award-recent-open').first().click();
    const det = owner.getByTestId('bid-detail'); await det.waitFor();
    assert.match(await det.innerText(), /낙찰[\s\S]*\(주\)모의스포츠/);
    await owner.keyboard.press('Escape'); await det.waitFor({ state: 'detached' });
    // 기간 칩 — 주소에 남음
    await box.getByTestId('award-days-30').click();
    await owner.waitForURL(/ad=30/);
    await box.getByTestId('award-row').filter({ hasText: '(주)모의스포츠' }).waitFor();
    // 휴대폰 폭
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/sales/hub?tab=bids&bt=awards`);
    await box.getByTestId('award-row').filter({ hasText: '(주)모의스포츠' }).waitFor();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 가로 넘침 없음');
    await box.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/580-award-stats-mobile.png` });
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: orig.keywords, excludes: orig.excludes, regions: orig.regions, issuers: orig.issuers, itemCodes: orig.item_codes, amountMin: orig.amount_min, amountMax: orig.amount_max });
    await clean();
  }
}
