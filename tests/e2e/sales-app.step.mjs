// 대표 검수 10/20 ② 앱 영업 공간 정리(390)(+#543 원문 없는 공고 = 번호 검색 안내·복사): 리드 카드 전화·문자 줄·홈페이지 칩·한국어 날짜 → 파이프라인은 칸반 대신 단계 칩 목록 → 입찰 카드 원문·공고문 내려받기·마감 한국어 → 입찰 상세 한국어 칸 + 관리자 원본 접힘(영문 키 없음) → 허브 시설 전화 줄·상세
import assert from 'node:assert/strict';

export async function salesAppFlow({ browser, desk, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
  const ids = ['E2E-APP-L1', 'E2E-APP-N1', 'E2E-APP-W1', 'E2E-APP-F1', 'E2E-APP-N2'];
  await sql`delete from sales_src_rows where src_id = any(${ids})`;
  await put('default', 'leads', { id: ids[0], name: 'E2E 앱 거래처', sales_status: '미팅예정', region: '경기', next_contact_date: ymd(2), phone: '031-123-4567', contact_name: '김소장', homepage: 'https://example.com/e2e', expected_revenue: '0.00', updated_at: `${ymd(0)}T01:00:00Z` });
  await put('global', 'procurement_notices', { id: ids[1], title: 'E2E 앱 체육시설 위탁운영', issuer: '성남시청', region: '경기', related: true, first_seen_at: `${ymd(0)}T00:30:00+09:00`, deadline_at: `${ymd(5)}T10:00:00`, current_status: '공고중', source_type: 'g2b_bid', fit_business: 'hilink', household_count: 800, source_url: 'https://example.com/notice/1', attachment_urls: ['https://www.g2b.go.kr/files/notice.hwp'], budget: '385000000.00', office_phone: '031-729-2600', complex_name: '분당 스포츠센터' });
  // #543: 바로 가는 공고 주소가 없는 원천(온비드 첫 화면 주소) → [원문] 대신 번호 검색 안내
  await put('global', 'procurement_notices', { id: ids[4], title: 'E2E 앱 스포츠센터 매점 사용허가', issuer: '시험구', region: '경기', related: true, first_seen_at: `${ymd(0)}T00:40:00+09:00`, deadline_at: `${ymd(6)}T10:00:00`, current_status: '공고중', source_type: 'onbid_lease', source_external_id: '202610-E2E-00', notice_no: '202610-E2E-00', fit_business: 'dagym', source_url: 'https://www.onbid.co.kr' });
  await put('default', 'opportunity_work', { id: ids[2], notice_id: ids[1], status: '검토 중', memo: '현장 설명회 10/25', next_action_date: ymd(3) });
  await put('global', 'operating_facility_prospects', { id: ids[3], name: 'E2E 앱 시설', address: '경기 수원시', household_count: 1500, facility_type: '아파트', region: '경기', office_phone: '031-222-3333', completion_date: '2024-05-13', first_seen_at: ymd(0) }); // S1-3: 원본 칸 이름(household_count·completion_date)
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const m = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', permissions: ['clipboard-read', 'clipboard-write'], storageState: await desk.storageState() });
  try {
    const p = await m.newPage();
    // 리드 카드: 전화·문자·홈페이지가 카드 안에, 날짜 10. 22.(목)
    await p.goto(`${BASE}/s/sales/leads`);
    const card = p.getByTestId('sales-lead-card').filter({ hasText: 'E2E 앱 거래처' });
    await card.waitFor();
    assert.match(await card.getByTestId('contact-call').innerText(), /전화 031-123-4567/);
    assert.equal(await card.getByTestId('contact-sms').count(), 1);
    assert.match(await card.getByTestId('contact-link').innerText(), /홈페이지/);
    assert.match(await card.innerText(), /다음 연락 \d{1,2}\. \d{1,2}\.\([일월화수목금토]\)/, '날짜 한국어');
    assert.ok(!/0\.00|2026-/.test(await card.innerText()), '0.00·ISO 날짜 없음');
    const tabs = (await p.getByTestId('mobile-tabs').locator(':scope > *').allInnerTexts()).map((x) => x.replace(/\d+/g, '').trim());
    assert.deepEqual(tabs, ['홈', '영업기회', '리드', '제안·계약', '메시지'], '#537 대표 10/24: 영업 하단 5칸 — 입찰은 영업기회 안(#438)');
    // #537 영업기회 = 허브 › 입찰(오늘 새 공고·마감 임박(3일)·진행 중) · 입찰 화면에서도 영업기회 칸 켜짐
    await p.getByTestId('mobile-tabs').getByRole('link', { name: '영업기회' }).tap();
    await p.waitForURL(/\/s\/sales\/hub\?tab=bids$/);
    const hb = p.getByTestId('sales-bids'); await hb.waitFor();
    assert.match(await p.getByTestId('sales-hub-bids').getAttribute('class'), /border-brand-600/, '입찰 칩 선택');
    assert.deepEqual((await hb.locator('button[data-testid^="sales-bids-tab-"]').allInnerTexts()).map((x) => x.trim()), ['오늘 새 공고', '마감 임박(3일)', '진행 중']);
    assert.equal(await hb.getByTestId('bids-all-link').getAttribute('href'), '/s/sales/bids');
    await hb.getByTestId('sales-bids-tab-open').tap();
    await hb.getByTestId('sales-bid').filter({ hasText: 'E2E 앱 체육시설' }).waitFor();
    assert.match(await p.getByTestId('mobile-tabs').getByRole('link', { name: '영업기회' }).getAttribute('class'), /font-bold/, '영업기회 칸 켜짐');
    await p.locator('#wos-intro').waitFor({ state: 'detached' }).catch(() => {}); // 첫 실행 애니메이션(약 1초)이 끝난 뒤
    await p.screenshot({ path: `${SHOTS}/226-sales-app-hub-bids.png` });
    await p.goto(`${BASE}/s/sales/leads`);
    await p.getByTestId('sales-lead-card').filter({ hasText: 'E2E 앱 거래처' }).waitFor();
    await p.screenshot({ path: `${SHOTS}/139-sales-app-leads.png` });
    // 대표 10/20 5): 영업 목록 상단 'AI에게 요청' → 예시 칩 → AI 비서(영업 맥락)로
    if (await p.getByTestId('ai-ask').count()) {
      await p.getByTestId('ai-ask').tap();
      await p.getByTestId('ai-ask-examples').getByRole('button', { name: '미팅 예정 리드 요약' }).tap();
      await p.waitForURL(/\/assistant\?space=sales&q=/);
      await p.goto(`${BASE}/s/sales/leads`);
      await p.getByTestId('sales-lead-card').filter({ hasText: 'E2E 앱 거래처' }).waitFor();
    }
    // 파이프라인: 휴대폰은 단계 칩 + 목록
    await p.goto(`${BASE}/s/sales/pipeline`);
    await p.getByTestId('pipeline-list').waitFor();
    assert.ok((await p.getByTestId('pipeline-stage').count()) >= 2, '전체 + 단계 칩');
    assert.ok((await p.getByTestId('pipeline-item').count()) >= 1);
    await p.getByTestId('pipeline-stage').filter({ hasText: '미팅예정' }).first().tap();
    await p.getByTestId('pipeline-item').filter({ hasText: 'E2E 앱 거래처' }).waitFor();
    assert.equal(await p.locator('section.w-60').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length), 0, '칸반은 PC 에서만');
    // 입찰 카드: 원문·공고문 내려받기·전화, 마감 한국어 → 상세 한국어 칸 + 관리자 원본 접힘
    await p.goto(`${BASE}/s/sales/bids`);
    const bid = p.getByTestId('sales-bid').filter({ hasText: 'E2E 앱 체육시설' });
    await bid.waitFor();
    assert.deepEqual(await bid.getByTestId('contact-link').allInnerTexts(), ['원문', '공고문 내려받기']);
    assert.match(await bid.getByTestId('bid-deadline').innerText(), /^마감 \d{1,2}\. \d{1,2}\.\([일월화수목금토]\) 10:00$/);
    assert.match(await bid.innerText(), /예산 385,000,000원/);
    assert.equal(await bid.getByTestId('bid-business').innerText(), '하이링크', 'S1-3: fit_business 로 사업 배지');
    assert.match(await bid.innerText(), /800세대/, 'S1-3: household_count');
    await bid.getByTestId('bid-open').tap();
    const d = p.getByTestId('bid-detail'); await d.waitFor();
    const dt = await d.innerText();
    for (const k of ['공고명', '단지', '발주처', '마감', '예산', '문서', '연락처', '상태', '메모', '다음 조치']) assert.ok(dt.includes(k), `상세 칸 ${k}`);
    assert.ok(!/source_url|office_phone|deadline_at/.test(dt), '영문 키 노출 없음(원본은 접힘)');
    // S1-4: 값 없는 정보 칸은 '후속조사 필요', 접힘 '과업·참가자격·요건 상세', 첨부는 같은 도메인 중계로
    assert.ok(/추정가격[\s\S]*후속조사 필요/.test(dt), '추정가격 없으면 후속조사 필요');
    assert.equal(await d.getByTestId('bid-detail-more').count(), 1);
    assert.match(await d.getByTestId('bid-doc-file').first().getAttribute('href'), /^\/api\/bids\/file\?u=https%3A%2F%2Fwww\.g2b\.go\.kr/, '공공 사이트 첨부는 같은 도메인 중계');
    assert.equal(await d.getByTestId('bid-raw').count(), 1, '관리자 원본 보기 접힘');
    assert.equal(await d.getByTestId('bid-raw').evaluate((el) => el.open), false);
    await p.screenshot({ path: `${SHOTS}/140-sales-app-bid-detail.png` });
    await p.getByRole('dialog').getByLabel('닫기').tap().catch(() => p.keyboard.press('Escape'));
    // #543: 온비드 첫 화면 주소 → 카드에 [원문] 없이 '온비드에서 공고번호 … 검색' + [번호 복사](상세도 같은 안내)
    const ob = p.getByTestId('sales-bid').filter({ hasText: 'E2E 앱 스포츠센터 매점' });
    await ob.waitFor();
    assert.equal(await ob.getByTestId('contact-link').count(), 0, '첫 화면 주소는 [원문]으로 걸지 않음');
    assert.match(await ob.getByTestId('bid-search-hint').innerText(), /^온비드에서 공고번호 202610-E2E-00 검색\s*번호 복사$/);
    assert.equal(await ob.getByTestId('bid-search-hint').getByRole('link', { name: '온비드' }).getAttribute('href'), 'https://www.onbid.co.kr');
    await ob.getByTestId('bid-search-copy').tap();
    await p.getByText('공고번호를 복사했습니다 — 온비드에서 붙여 넣어 검색하세요').waitFor();
    assert.equal(await p.evaluate(() => navigator.clipboard.readText()), '202610-E2E-00');
    await p.getByTestId('toast').getByLabel('알림 닫기').tap();
    await ob.getByTestId('bid-open').tap();
    const od = p.getByTestId('bid-detail'); await od.waitFor();
    assert.equal(await od.getByTestId('bid-doc-url').count(), 0);
    assert.match(await od.getByTestId('bid-search-hint').innerText(), /^온비드에서 공고번호 202610-E2E-00 검색/);
    await od.getByTestId('bid-search-hint').scrollIntoViewIfNeeded();
    await p.waitForTimeout(400); // 상세 창이 다 열린 뒤 화면 저장
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(over <= 1, `휴대폰 공고 상세 가로 넘침 ${over}px`);
    await p.screenshot({ path: `${SHOTS}/224-bid-search-hint-mobile.png` });
    await p.getByRole('dialog').getByLabel('닫기').tap().catch(() => p.keyboard.press('Escape'));
    // 허브 시설: 전화·문자 줄, 상세 한국어
    await p.goto(`${BASE}/s/sales/hub?tab=facilities`);
    const f = p.getByTestId('sales-hub-item').filter({ hasText: 'E2E 앱 시설' });
    await f.waitFor();
    assert.match(await f.getByTestId('contact-call').innerText(), /전화 031-222-3333/);
    assert.ok(!(await f.innerText()).split('\n').some((l) => /^\s*·/.test(l)), '앞에 점으로 시작하는 줄(· 준공…) 없음');
    assert.match(await f.innerText(), /DB 등록 \d{1,2}\. \d{1,2}\.\(.\) · 준공\(사용승인\) 2024\. 5\. 13\.\(월\)/, '날짜 한국어(올해 아니면 연도)');
    await f.getByRole('button', { name: 'E2E 앱 시설' }).tap();
    const hd = p.getByTestId('hub-detail'); await hd.waitFor();
    assert.match(await hd.innerText(), /관리사무소[\s\S]*전화 031-222-3333/);
    assert.equal(await hd.getByTestId('hub-raw').count(), 1);
  } finally {
    await m.close().catch(() => {});
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: false }).catch(() => {});
    await sql`delete from sales_src_rows where src_id = any(${ids})`.catch(() => {});
  }
}
