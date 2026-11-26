// 계약 관리 1단계 화면(대표 11/19 · docs/contract-docs-design.md): 관리 메뉴 [계약 관리] → 빈 화면 [첫 계약 등록] → 등록(계약명·상대방·꼬리표·만료일·금액) →
// 상세(만료 임박 · D-n) → 계약서 파일 올리기 → 목록 요약(30일 안 만료 1) → 갱신 등록(지난 기간) → 자동 연장 계약은 '통보 기한 D-n' →
// 홈 '계약' 카드(챙길 것·30일 안) → 알림 날짜 바꾸기 → 종료 → 휴대폰 폭 넘침 없음 → 권한 없는 직원은 메뉴·화면 없음
import assert from 'node:assert/strict';

export async function agreements({ owner, staff, ctx, sql, BASE, SHOTS }) {
  const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/');
  await owner.locator('aside a[href="/agreements"]').click(); // 관리 묶음 '전자계약' 아래 [계약 관리]
  await owner.getByTestId('agreements-page').waitFor();
  await owner.getByText('등록한 계약이 없습니다').waitFor();
  await owner.getByRole('button', { name: '첫 계약 등록' }).click();
  const form = owner.getByTestId('agr-form'); await form.waitFor();
  await form.getByTestId('agr-title').fill('본사 사무실 임대차');
  await form.getByTestId('agr-counterparty').fill('한빛빌딩');
  await form.getByTestId('agr-tags').fill('임대차, 본사');
  await form.getByTestId('agr-end').fill(day(25));
  await form.getByTestId('agr-amount').fill('3300000');
  await form.getByTestId('agr-memo').fill('보증금 별도');
  await owner.screenshot({ path: `${SHOTS}/agreements-form.png` });
  await form.getByTestId('agr-save').click();
  // 등록하면 상세가 열림: 만료 임박 · D-25, 알림 받는 사람 = 등록한 사람
  const det = owner.getByTestId('agr-detail'); await det.waitFor();
  assert.match(await det.getByTestId('agr-detail-state').innerText(), /만료 임박 · D-25/);
  assert.match(await det.getByTestId('agr-detail-notify').innerText(), /만료일 기준 회사 기본 날짜 · 받는 사람: 김대표/);
  await det.getByText('3,300,000원').waitFor();
  // 계약서 파일 올리기
  await det.getByTestId('agr-file-input').setInputFiles({ name: '임대차 계약서.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await det.getByTestId('agr-files').getByText('임대차 계약서.pdf').waitFor({ timeout: 15000 });
  const [f] = await sql`select f.file_name, f.upload_status, f.storage_key from agreement_files f join agreements a on a.id = f.agreement_id where a.title = '본사 사무실 임대차'`;
  assert.deepEqual([f.file_name, f.upload_status, /^agr\/default\//.test(f.storage_key)], ['임대차 계약서.pdf', 'ready', true], '계약서 파일은 자료실과 따로 보관');
  await owner.waitForTimeout(300); await owner.screenshot({ path: `${SHOTS}/agreements-detail.png` });
  await owner.keyboard.press('Escape'); await det.waitFor({ state: 'hidden' });
  // 목록: 요약 숫자 · 줄의 남은 날
  assert.deepEqual([await owner.getByTestId('agr-in30').innerText(), await owner.getByTestId('agr-in90').innerText(), await owner.getByTestId('agr-attention').innerText()], ['1', '1', '0']);
  const row = owner.getByTestId('agr-row').filter({ hasText: '본사 사무실 임대차' });
  assert.equal((await row.getByTestId('agr-left').innerText()).trim(), 'D-25'); assert.equal(await row.getAttribute('data-state'), 'soon');
  // 자동 연장 + 해지 통보 30일 전(만료 50일 뒤) → 통보 마감일 기준으로 보임 · 만료가 지난 계약은 '챙길 것'
  await ctx.owner.ok('POST', '/api/agreements', { title: '보안 용역', counterparty: '든든보안', endDate: day(50), autoRenew: true, noticeDays: 30, tags: ['용역'] });
  await ctx.owner.ok('POST', '/api/agreements', { title: '지난 유지보수', endDate: day(-3) });
  await owner.reload(); await owner.getByTestId('agr-list').waitFor();
  assert.deepEqual(await owner.getByTestId('agr-row').evaluateAll((els) => els.map((e) => [e.querySelector('b').textContent, e.querySelector('[data-testid=agr-left]').textContent.trim()])),
    [['지난 유지보수', '만료 3일 지남'], ['보안 용역', '통보 기한 D-20'], ['본사 사무실 임대차', 'D-25']], '챙길 것 → 임박한 순');
  assert.equal(await owner.getByTestId('agr-attention').innerText(), '1');
  await owner.screenshot({ path: `${SHOTS}/agreements-list.png` });
  // #1110 홈 개편(대표 11/22): 계약 카드 대신 '회사 현황 · 점검·계약' 칸 — 계약 만료 가장 빠른 D-n
  await owner.goto(BASE + '/');
  // 대표 11/26: 휴대폰·태블릿 회사 현황은 목록 줄(home-company-row-check), 데스크톱은 칸(home-cell-check) — 보이는 쪽
  const hc = owner.locator('[data-testid="home-cell-check"]:visible, [data-testid="home-company-row-check"]:visible').first(); await hc.waitFor({ timeout: 15000 });
  assert.match(await hc.innerText(), /계약 만료 가장 빠른 D-\d+/);
  await hc.scrollIntoViewIfNeeded(); await owner.screenshot({ path: `${SHOTS}/agreements-home-card.png` });
  await owner.goto(BASE + '/agreements');
  await owner.getByTestId('agr-row').filter({ hasText: '보안 용역' }).click(); await det.waitFor();
  await owner.waitForFunction(() => /통보 기한 D-20/.test(document.querySelector('[data-testid=agr-detail-state]')?.textContent ?? ''), null, { timeout: 15000 }); // 누른 줄(보안 용역)의 상세
  await owner.keyboard.press('Escape'); await det.waitFor({ state: 'hidden' });
  await owner.getByTestId('agr-list').waitFor();
  await owner.getByTestId('agr-state-attention').click();
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid=agr-row]').length === 1);
  await owner.getByTestId('agr-state-open').click();
  await owner.getByTestId('agr-tag').selectOption('용역');
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid=agr-row]').length === 1 && document.querySelector('[data-testid=agr-row] b').textContent === '보안 용역');
  await owner.getByTestId('agr-tag').selectOption('');
  // 갱신 등록: 지난 기간이 남고 새 만료일로
  await owner.getByTestId('agr-row').filter({ hasText: '본사 사무실 임대차' }).click();
  await det.waitFor();
  await det.getByTestId('agr-renew').click();
  const rf = owner.getByTestId('agr-renew-form'); await rf.waitFor();
  await rf.getByTestId('agr-renew-end').fill(day(390));
  await rf.getByTestId('agr-renew-amount').fill('3500000');
  await rf.getByTestId('agr-renew-memo').fill('월 20만 인상');
  await rf.getByTestId('agr-renew-save').click();
  await det.getByTestId('agr-terms').waitFor();
  assert.match(await det.getByTestId('agr-detail-state').innerText(), /진행 중 · D-390/);
  assert.match(await det.getByTestId('agr-terms').innerText(), /1번째 .* 3,300,000원[\s\S]*월 20만 인상 · 김대표 갱신 등록/);
  await owner.keyboard.press('Escape'); await det.waitFor({ state: 'hidden' });
  // 알림 날짜(회사 기본) 바꾸기 → 머리말에 반영
  await owner.getByTestId('agr-settings').click();
  const sf = owner.getByTestId('agr-settings-form'); await sf.waitFor();
  await owner.waitForFunction(() => document.querySelector('[data-testid=agr-settings-days]')?.value === '90, 60, 30, 7');
  await sf.getByTestId('agr-settings-days').fill('60, 14');
  await sf.getByTestId('agr-settings-save').click();
  await owner.getByText('만료 60·14일 전에 알림이 갑니다').waitFor();
  await ctx.owner.ok('PUT', '/api/agreements/settings', { alertDays: null });
  // 종료: 종료 탭으로
  await owner.getByTestId('agr-row').filter({ hasText: '지난 유지보수' }).click();
  await det.waitFor();
  await det.getByTestId('agr-end-open').click();
  await owner.getByTestId('agr-end-reason').fill('업체 변경');
  await owner.getByTestId('agr-end-save').click();
  await det.getByText('업체 변경').waitFor();
  await owner.keyboard.press('Escape'); await det.waitFor({ state: 'hidden' });
  await owner.getByTestId('agr-state-ended').click();
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid=agr-row]').length === 1 && document.querySelector('[data-testid=agr-left]').textContent.trim() === '종료');
  // D-05(대표 11/23): 보관(숨김) → 보관함 → 되살리기 → 다시 보관 → 대표만 완전 삭제
  await owner.getByTestId('agr-row').filter({ hasText: '지난 유지보수' }).click(); await det.waitFor();
  await det.getByTestId('agr-archive').click();
  await owner.getByTestId('confirm-ok').click();
  await det.waitFor({ state: 'hidden' });
  await owner.waitForFunction(() => ![...document.querySelectorAll('[data-testid=agr-row] b')].some((b) => b.textContent === '지난 유지보수'));
  await owner.getByTestId('agr-state-archived').click();
  const ar = owner.getByTestId('agr-archived-row').filter({ hasText: '지난 유지보수' }); await ar.waitFor();
  await ar.getByTestId('agr-restore').click(); await ar.waitFor({ state: 'detached' });
  await owner.getByTestId('agr-state-ended').click();
  await owner.getByTestId('agr-row').filter({ hasText: '지난 유지보수' }).click(); await det.waitFor();
  await det.getByTestId('agr-archive').click();
  await owner.getByTestId('confirm-ok').click();
  await det.waitFor({ state: 'hidden' });
  await owner.getByTestId('agr-state-archived').click(); await ar.waitFor();
  await ar.getByTestId('agr-purge').click();
  assert.match(await owner.getByTestId('confirm-message').innerText(), /되돌릴 수 없습니다/); await owner.getByTestId('confirm-ok').click();
  await ar.waitFor({ state: 'detached' });
  await owner.getByText('완전히 지웠습니다').first().waitFor();
  await owner.getByTestId('agr-state-open').click();
  // 휴대폰 폭
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.getByTestId('agr-list').waitFor();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 390), '390 가로 넘침 없음');
  await owner.screenshot({ path: `${SHOTS}/agreements-mobile.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 권한 없는 직원: 메뉴에도 없고, 주소로 들어가도 화면 없음(서버도 404)
  await staff.goto(BASE + '/agreements');
  await staff.getByTestId('admin-no-access').waitFor({ timeout: 15000 });
  assert.equal(await staff.getByTestId('agr-row').count(), 0);
  assert.equal(await staff.evaluate(() => fetch('/api/agreements').then((r) => r.status)), 404);
  await staff.goto(BASE + '/');
}
