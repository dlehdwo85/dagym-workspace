// 239차(#743·#744 대표 10/28 '파일 열기 전에 참가자격 확인' · '현장설명회 일시도 표기'): 입찰 카드 — 현장설명 필수 D-n 배지(3일 안 빨강·카드 왼쪽 빨간 줄)
// · '필수 여부 공고문 참조' · 자격·조건 한 줄 → 펼치면 원문 칸 표 · 상세 '참가 조건 · 현장설명' · 휴대폰 폭 넘침 없음. 끝나면 넣은 공고·맞춤 조건을 되돌림
import assert from 'node:assert/strict';

export async function terms239({ owner, ctx, sql, BASE, SHOTS }) {
  const ID = (n) => `00000000-0000-4000-8000-000000239${String(n).padStart(3, '0')}`; const ids = [1, 2].map(ID);
  const kst = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const mdw = (d) => { const [y, m, dd] = d.split('-').map(Number); return `${m}/${dd}(${WD[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]})`; };
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const orig = (await ctx.owner.ok('GET', '/api/sales/digest/prefs')).prefs;
  const clean = () => sql`delete from sales_src_rows where scope = 'global' and tbl = 'procurement_notices' and src_id = any(${ids})`;
  await clean();
  const now = new Date().toISOString();
  const put = (n, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${ID(n)}, ${sql.json({ id: ID(n), source_type: 'kapt_bid', source_external_id: `E2E239-${n}`,
    source_url: `https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=E2E239-${n}`, notice_kind: 'new', current_status: '공고중', related: true, fit_business: '다짐', first_seen_at: now, posted_date: kst(0), terms_read_at: now, bid_method: '전자입찰', contract_method: '제한경쟁', ...row })}, 'workin')`;
  await put(1, { title: '[서울송파] 모의239아파트 커뮤니티 피트니스 위탁운영', issuer: '모의239아파트', deadline_at: `${kst(9)}T17:00:00+09:00`, award_method: '적격심사',
    site_briefing_kind: '필수', site_briefing_at: `${kst(2)}T10:00:00+09:00`, site_briefing_place: '생활지원센터 회의실', credit_rating_cert: '제출', performance_cert: '제출', bid_bond: '입찰가격의 5% 이상 제출',
    docs_deadline_at: `${kst(9)}T17:00:00+09:00`, payment_terms: '당단지 지급조건에 따름', task_scope: '첨부 공고문 참조' });
  await put(2, { title: '[경기광명] 모의239이아파트 헬스장 위탁운영', issuer: '모의239이아파트', deadline_at: `${kst(10)}T17:00:00+09:00`, award_method: '최저가',
    site_briefing_kind: '공고문 참조', site_briefing_at: `${kst(5)}T14:00:00+09:00`, site_briefing_place: '입주자대표회의실', credit_rating_cert: '공고문 참조', performance_cert: '공고문 참조', bid_bond: '공고문 참조' });
  await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: [], excludes: [], regions: [], issuers: [], itemCodes: [], amountMin: null, amountMax: null });
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/hub?tab=bids&bt=all&bq=${encodeURIComponent('모의239')}`);
    const one = owner.getByTestId('sales-bid').filter({ hasText: '모의239아파트 커뮤니티' }); await one.waitFor();
    const two = owner.getByTestId('sales-bid').filter({ hasText: '모의239이아파트' }); await two.waitFor();
    // 필수 현장설명 D-2: 빨간 배지 · 카드 왼쪽 빨간 줄(입찰 마감은 9일 뒤여도) · 일시·장소
    const b1 = one.getByTestId('bid-briefing');
    assert.match(await b1.innerText(), new RegExp(`현장설명 필수 D-2\\s*${mdw(kst(2)).replace(/[()]/g, '\\$&')} 10:00 · 생활지원센터 회의실`));
    assert.ok(await b1.locator('span').first().evaluate((e) => e.className.includes('bg-red-600')), '3일 안 필수 = 빨강');
    assert.equal(await one.getAttribute('data-urgent'), '1', '필수 현장설명 3일 안이면 마감 임박 줄');
    // 공고문 참조: 일시·장소 + '필수 여부 공고문 참조' · 배지는 회색 D-5
    assert.match(await two.getByTestId('bid-briefing').innerText(), new RegExp(`현장설명 D-5\\s*${mdw(kst(5)).replace(/[()]/g, '\\$&')} 14:00 · 입주자대표회의실 · 필수 여부 공고문 참조`));
    assert.equal(await two.getAttribute('data-urgent'), null);
    // 입찰 방식 한 줄(252차: '자격·조건' → '입찰 방식', 참가자격은 공고문 절) → 펼치기
    const more = one.getByTestId('bid-terms-more');
    assert.match(await more.locator('summary').innerText(), /입찰 방식 적격심사 · 제한경쟁 · 신용평가 제출 · 실적증명 제출 · 보증금 5%/);
    assert.match(await two.getByTestId('bid-terms-more').locator('summary').innerText(), /최저가 · 제한경쟁 · 공고문 참조: 신용평가·실적증명·보증금/);
    await more.locator('summary').click();
    const dl = more.locator('dl'); await dl.waitFor();
    const t = await dl.innerText();
    for (const w of ['입찰 보증금', '입찰가격의 5% 이상 제출', '신용평가등급확인서', '현장설명', `필수 ${mdw(kst(2))} 10:00 · 생활지원센터 회의실`, '지급 조건']) assert.ok(t.includes(w), `${w} — ${t}`);
    assert.ok(!t.includes('서류 제출 마감'), '입찰 마감과 같으면 뺌');
    await one.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/583-bid-terms.png`, clip: await one.boundingBox() });
    // 상세: '입찰 방식 · 조건 · 현장설명' 표 · 8칸 펼치기의 현장설명(참가 자격 칸은 공고문 절 — 입찰 방식 줄을 넣지 않음)
    await one.getByTestId('bid-open').click();
    const det = owner.getByTestId('bid-detail'); await det.waitFor();
    const td = det.getByTestId('bid-terms-detail'); await td.waitFor();
    assert.match(await td.innerText(), /입찰 방식 · 조건 · 현장설명[\s\S]*낙찰 방법[\s\S]*적격심사[\s\S]*입찰 보증금[\s\S]*입찰가격의 5% 이상 제출/);
    await det.getByTestId('bid-detail-more').locator('summary').click();
    const d8 = await det.getByTestId('bid-detail-more').innerText();
    assert.ok(!d8.includes('적격심사 · 제한경쟁 · 신용평가 제출') && d8.includes(`현장설명 필수 ${mdw(kst(2))} 10:00 · 생활지원센터 회의실`), d8);
    assert.ok(!d8.includes('첨부 공고문 참조'), "과업 칸에 '첨부 공고문 참조'를 넣지 않음");
    await owner.keyboard.press('Escape'); await det.waitFor({ state: 'detached' });
    // 휴대폰 폭
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/sales/hub?tab=bids&bt=all&bq=${encodeURIComponent('모의239')}`);
    await one.getByTestId('bid-briefing').waitFor();
    await one.getByTestId('bid-terms-more').locator('summary').click();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 가로 넘침 없음');
    await one.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/584-bid-terms-mobile.png`, clip: await one.boundingBox() });
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await ctx.owner.ok('PUT', '/api/sales/digest/prefs', { keywords: orig.keywords, excludes: orig.excludes, regions: orig.regions, issuers: orig.issuers, itemCodes: orig.item_codes, amountMin: orig.amount_min, amountMax: orig.amount_max });
    await clean();
  }
}
