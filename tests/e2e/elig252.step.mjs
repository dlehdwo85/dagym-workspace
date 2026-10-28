// 252차 #786(대표 10/29 00:20): 입찰 카드 '참가자격' 한 줄(공고문 '참가자격' 절에서 뽑은 요건) → 펼치면 원문 · '입찰 방식'(적격심사·제한경쟁) 따로 ·
// 못 찾은 공고는 이유와 함께 · 상세 '참가자격' 상자(원문·공고문 이름·[공고문 다시 읽기]) · 휴대폰 폭. 끝나면 넣은 공고를 지움
import assert from 'node:assert/strict';

export async function elig252({ owner, ctx, sql, BASE, SHOTS }) {
  const ID = (n) => `00000000-0000-4000-8000-000000252${String(n).padStart(3, '0')}`; const ids = [1, 2].map(ID);
  const kst = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const orig = (await ctx.owner.ok('GET', '/api/sales/digest/prefs')).prefs;
  const clean = () => sql`delete from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = any(${ids})`;
  await clean();
  const now = new Date().toISOString();
  const TEXT = '5. 참가자격\n가. 사업자선정지침 제26조제1항 각호에 해당하지 않는 사업자\n나. 공고일 현재 주민운동시설 위탁운영 등록업체로서 자본금 5억원 이상인 업체';
  const LINE = '자본금 5억 이상 · 주민운동시설 위탁운영 등록업체';
  const put = (n, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID(n)}, ${sql.json({ id: ID(n), notice_kind: 'new', current_status: '공고중', related: true, fit_business: '다짐',
    first_seen_at: now, posted_date: kst(0), contract_method: '제한경쟁', ...row })}, 'workin')`;
  await put(1, { source_type: 'kapt_bid', source_external_id: 'E2E252-1', title: '[경기용인] 모의252아파트 주민운동시설 위탁운영 사업자 선정', issuer: '모의252아파트', deadline_at: `${kst(9)}T17:00:00+09:00`, award_method: '적격심사',
    eligibility: { text: TEXT, items: [{ k: 'capital', label: '자본금 5억 이상' }, { k: 'license', label: '주민운동시설 위탁운영 등록업체' }], line: LINE, error: null, file: { name: '입찰공고문.hwp', url: 'https://www.k-apt.go.kr/cmm/file/BID/fileDownload.do?key=1&bidNum=E2E252-1' }, readAt: now, sig: '', tries: 0 } });
  await put(2, { source_type: 'g2b_bid', source_external_id: 'E2E252-2-000', title: '모의252 체육센터 운영 용역', issuer: '모의252시청', deadline_at: `${kst(12)}T10:00:00+09:00`, award_method: '협상에 의한 계약', region_restriction: '경기도' });
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: [], excludes: [], regions: [], issuers: [], itemCodes: [], amountMin: null, amountMax: null });
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/hub?tab=bids&bt=all&bq=${encodeURIComponent('모의252')}`);
    const one = owner.getByTestId('sales-bid').filter({ hasText: '모의252아파트' }); await one.waitFor();
    const two = owner.getByTestId('sales-bid').filter({ hasText: '모의252 체육센터' }); await two.waitFor();
    // 참가자격 한 줄 → 펼치면 공고문 원문 · 입찰 방식은 따로
    const el = one.getByTestId('bid-elig');
    assert.equal(await el.getByTestId('bid-elig-line').innerText(), LINE);
    assert.match(await one.getByTestId('bid-terms-more').locator('summary').innerText(), /^입찰 방식 적격심사 · 제한경쟁/);
    assert.equal(await el.getByTestId('bid-elig-text').isVisible(), false);
    await el.locator('summary').click();
    assert.equal(await el.getByTestId('bid-elig-text').innerText(), TEXT);
    assert.match(await el.innerText(), /공고문: 입찰공고문\.hwp/);
    // 아직 안 읽은 나라장터 공고 = API 지역만
    assert.equal(await two.getByTestId('bid-elig-line').innerText(), '지역 경기도');
    await one.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/600-bid-elig-line.png`, clip: await one.boundingBox() });
    // 상세: 참가자격 상자(원문) · [공고문 다시 읽기] — 첨부가 없는 공고는 이유와 함께
    await one.getByTestId('bid-open').click();
    const det = owner.getByTestId('bid-detail'); await det.waitFor();
    const box = det.getByTestId('bid-elig-detail');
    assert.equal(await box.getByTestId('bid-elig-detail-line').innerText(), LINE);
    assert.equal(await box.getByTestId('bid-elig-detail-text').innerText(), TEXT);
    assert.match(await box.innerText(), /공고문: 입찰공고문\.hwp · 읽은 때/);
    assert.match(await det.getByTestId('bid-terms-detail').innerText(), /^입찰 방식 · 조건 · 현장설명/);
    await owner.screenshot({ path: `${SHOTS}/601-bid-elig-detail.png` });
    await owner.keyboard.press('Escape'); await det.waitFor({ state: 'detached' });
    await two.getByTestId('bid-open').click(); await det.waitFor();
    assert.match(await det.getByTestId('bid-elig-detail').innerText(), /아직 공고문을 읽지 않았습니다/);
    await det.getByTestId('bid-elig-read').click();
    const miss = det.getByTestId('bid-elig-detail-miss'); await miss.waitFor();
    assert.equal(await miss.innerText(), '공고문에서 참가자격을 못 찾음 — 원문 확인(이유: 첨부 공고문 없음)');
    assert.equal((await sql`select row->'eligibility'->>'error' e from sales_src_rows where src_id = ${ID(2)}`)[0].e, '첨부 공고문 없음');
    await owner.keyboard.press('Escape'); await det.waitFor({ state: 'detached' });
    await two.getByTestId('bid-elig-miss').waitFor(); // 목록 줄에도 같은 말
    assert.match(await two.getByTestId('bid-elig').innerText(), /참가자격 지역 경기도 · 공고문에서 참가자격을 못 찾음 — 원문 확인\(이유: 첨부 공고문 없음\)/);
    // 휴대폰 폭
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/sales/hub?tab=bids&bt=all&bq=${encodeURIComponent('모의252')}`);
    await one.getByTestId('bid-elig').locator('summary').click();
    await one.getByTestId('bid-elig-text').waitFor();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 가로 넘침 없음');
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: orig.keywords, excludes: orig.excludes, regions: orig.regions, issuers: orig.issuers, itemCodes: orig.item_codes, amountMin: orig.amount_min, amountMax: orig.amount_max });
    await clean();
  }
}
