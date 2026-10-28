// 242차 #759(대표 10/28 '26년도 입주 아파트 리스트'): 영업기회(공공데이터) [올해 입주] → 'YYYY년 입주 n곳 · 입주가 가까운 순 · 아파트만' · 달 칩(건수) → 한 달만 · ‹ 전체 ·
// 더 보기(100건 넘게) · 아파트만 끄면 오피스텔도 · K-apt 준공·입주 단지 칸(허브로) · 휴대폰 폭 넘침 없음 — 구조 시험(영업기회 줄을 직접 심음)
import assert from 'node:assert/strict';

export async function movein759({ owner, ctx, sql, BASE, SHOTS }) {
  const [Y, M] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date()).split('-').map(Number);
  const mm = (n) => String(n).padStart(2, '0');
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const put = (k, moveIn, detail = {}) => sql`insert into prospects (source_code, ext_id, name, address, sido, status, opened_on, category, detail, raw, base_date)
    values ('15098547', ${'e2e759:' + k}, ${'E2E759 ' + k}, '경기도 구리시 인창동 1', '경기', '모집공고', current_date, '민영 · 500세대', ${sql.json({ moveIn, households: 500, kind: '아파트', ...detail })}, ${sql.json({})}, current_date)
    on conflict (source_code, ext_id) do nothing`;
  for (let i = 0; i < 105; i++) await put(`단지${String(i).padStart(3, '0')}`, `${Y}-${mm((i % 12) + 1)}-01`);
  await put('오피스텔', `${Y}-${mm(M)}-01`, { kind: '오피스텔·도시형·민간임대·생활숙박', households: 5 });
  await ctx.owner.ok('PUT', '/api/sales/sources/15098547', { enabled: true });
  const fid = '00000000-0000-4000-8000-000000759901';
  await sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'operating_facility_prospects', ${fid}, ${sql.json({ id: fid, name: 'E2E759 K-apt준공단지', completion_date: `${Y}-03-15`, household_count: 820, region: '경기', address: '경기도 구리시' })}, 'workin') on conflict do nothing`;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/prospects`);
    const box = owner.getByTestId('prospects'); await box.waitFor();
    await box.getByLabel('영업기회 검색').fill('E2E759'); await box.getByLabel('영업기회 검색').press('Enter');
    await box.getByTestId(`prospects-mi-${Y}`).click();
    await owner.waitForURL(new RegExp(`mi=${Y}`));
    const count = box.getByTestId('prospects-movein-count');
    await owner.waitForFunction((y) => document.querySelector('[data-testid="prospects-movein-count"]')?.textContent?.startsWith(`${y}년 입주 105곳`), Y);
    assert.equal(await count.innerText(), `${Y}년 입주 105곳 · 입주가 가까운 순 · 아파트만`);
    assert.equal(await box.getByTestId('prospect-card').count(), 100, '처음 100곳');
    assert.match(await box.getByTestId('prospect-movein-label').first().innerText(), /이번 달 입주/, '가까운 순 — 이번 달이 맨 위');
    assert.equal(await box.getByTestId('prospects-month').count(), 12);
    // 더 보기
    const more = box.getByTestId('prospects-more'); assert.match(await more.innerText(), /더 보기 \(100 \/ 105\)/);
    await more.click(); await owner.waitForFunction(() => document.querySelectorAll('[data-testid="prospect-card"]').length === 105);
    assert.equal(await more.count(), 0, '끝까지 보면 단추 없음');
    // K-apt 준공·입주 단지 칸
    const kapt = box.getByTestId('prospects-kapt'); await kapt.waitFor();
    assert.match(await kapt.innerText(), new RegExp(`K-apt·신규 단지 준공·입주 ${Y}년 \\d+곳`));
    const krow = kapt.getByTestId('prospects-kapt-row').filter({ hasText: 'E2E759 K-apt준공단지' });
    assert.match(await krow.innerText(), /준공 \d{4}-03 · 820세대 · K-apt/);
    await box.getByTestId('prospects-movein-row').scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/588-prospects-movein-year.png` });
    // 달 칩 → 그 달만 · ‹ 전체
    await box.getByTestId('prospects-month').filter({ hasText: /^3월 / }).click();
    await owner.waitForURL(new RegExp(`mi=${Y}-03`));
    await owner.waitForFunction((y) => document.querySelector('[data-testid="prospects-movein-count"]')?.textContent?.startsWith(`${y}년 3월 입주 9곳`), Y);
    await box.getByTestId('prospects-month-all').click();
    await owner.waitForFunction((y) => document.querySelector('[data-testid="prospects-movein-count"]')?.textContent?.startsWith(`${y}년 입주 105곳`), Y);
    // 아파트만 끄면 오피스텔도
    await box.getByTestId('prospects-apt').click();
    await owner.waitForFunction((y) => document.querySelector('[data-testid="prospects-movein-count"]')?.textContent === `${y}년 입주 106곳 · 입주가 가까운 순`, Y);
    // 허브로: K-apt 단지 줄 → 허브 상세
    await krow.locator('a').click();
    await owner.waitForURL(/\/s\/sales\/hub\?tab=facilities&id=/);
    // 휴대폰 폭
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/sales/prospects?mi=${Y}`);
    await owner.getByTestId('prospects-movein-count').waitFor();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 가로 넘침 없음');
    await owner.screenshot({ path: `${SHOTS}/589-prospects-movein-390.png` });
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await sql`delete from prospects where ext_id like 'e2e759:%'`;
    await sql`delete from sales_src_rows where src_id = ${fid}`;
  }
}
