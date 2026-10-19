// V41 단계 1 공간 틀: 관리 › 사용자 › 공간에서 영업 켜기 → PC 공간 카드 드롭다운으로 영업(파란 강조) → Ctrl+1 로 업무 →
// 휴대폰 프로필 시트 공간 전환 → 뒤로가기 = 업무 · 영업 미배정 직원은 공간 카드 없음·주소 404 → 끄기
import assert from 'node:assert/strict';
export async function spaces({ browser, desk, owner, staff, BASE, sql }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-sales').click(); // 저장 → 화면 새로고침(사이드바에 공간 카드)
  await owner.getByTestId('space-switch').waitFor();
  await owner.goto(`${BASE}/`);
  await owner.getByTestId('space-switch').click();
  await owner.getByTestId('space-menu').getByText(/내 업무 \d+/).waitFor();
  await owner.getByTestId('space-go-sales').click();
  await owner.waitForURL(/\/s\/sales$/);
  await owner.getByTestId('space-home-sales').waitFor();
  assert.equal(await owner.getByTestId('space-current').textContent(), '워크인 · 영업');
  assert.equal(await owner.locator('.app-shell').getAttribute('data-space'), 'sales');
  await owner.keyboard.press('Control+1');
  await owner.waitForURL(`${BASE}/`);
  assert.equal(await owner.getByTestId('space-current').textContent(), '워크인 · 업무');
  await owner.keyboard.press('Control+2');
  await owner.waitForURL(/\/s\/sales$/);
  await owner.goBack();
  await owner.waitForURL(`${BASE}/`);
  // 휴대폰(대표): 프로필 → 공간 시트
  const mc = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  await m.goto(`${BASE}/tasks`);
  await m.getByRole('button', { name: '메뉴 더보기' }).tap();
  await m.getByTestId('mobile-spaces').waitFor();
  // 로컬 검수: 시트가 화면보다 길어도 맨 위(프로필·업무 카드)가 화면 안
  const top = await m.getByTestId('mobile-space-work').boundingBox();
  assert.ok(top && top.y >= 0, `업무 카드 화면 안 (y=${top?.y})`);
  const sheet = await m.getByTestId('more-sheet').boundingBox();
  assert.ok(sheet.y >= 0 && sheet.height <= 780 * 0.9 + 1, `시트 높이 ${sheet.height}`);
  await m.getByTestId('mobile-space-sales').tap();
  await m.waitForURL(/\/s\/sales$/);
  assert.equal(await m.getByTestId('mobile-space-chip').textContent(), '영업');
  // 대표 제보(10/18): 휴대폰에서도 공간 메뉴로 — 첫 화면 위 칩 · 더보기 시트의 '영업 메뉴'
  const chips = m.getByTestId('space-chips');
  await chips.getByRole('link', { name: '공공데이터' }).tap();
  await m.waitForURL(/\/s\/sales\/prospects$/);
  assert.equal(await chips.locator('a[aria-current="page"]').textContent(), '공공데이터');
  await m.getByRole('button', { name: '메뉴 더보기' }).tap();
  await m.getByTestId('mobile-space-menu').getByRole('link', { name: '데이터 설정' }).tap();
  await m.waitForURL(/\/s\/sales\/sources$/);
  await m.getByRole('button', { name: '메뉴 더보기' }).tap();
  await m.getByTestId('mobile-space-work').tap(); // 마지막 공간 = 업무로 돌려 둠
  await m.waitForURL(/\/$/);
  // 대표(10/19): 앱 머리줄 로고·공간 이름 → PC 와 같은 공간 전환 시트(회사 이름·지금 공간 체크)
  await m.getByTestId('mobile-space-switch').tap();
  await m.getByTestId('space-sheet').waitFor();
  await m.getByTestId('sheet-space-work').getByLabel('지금 공간').waitFor();
  await m.getByTestId('sheet-space-sales').tap();
  await m.waitForURL(/\/s\/sales$/);
  assert.equal(await m.getByTestId('mobile-space-chip').textContent(), '영업');
  // 대표 결정(10/19): 하단 탭 = 공간마다 같은 크기 5칸(+ 버튼 없음)
  const tabs = async () => (await m.getByTestId('mobile-tabs').locator(':scope > *').allInnerTexts()).map((x) => x.replace(/\d+/g, '').trim());
  assert.deepEqual(await tabs(), ['현황', '리드', '파이프라인', '입찰·공고', '더보기']);
  const w = await m.getByTestId('mobile-tabs').locator(':scope > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  assert.ok(Math.max(...w) - Math.min(...w) <= 1, `5칸 같은 폭 ${w}`);
  await m.getByTestId('tab-more').tap();
  await m.getByTestId('more-new-lead').waitFor(); // 더보기 › 만들기 = 그 공간 맥락
  await m.getByTestId('more-sheet').getByLabel('닫기').tap();
  await m.getByTestId('mobile-space-switch').tap();
  await m.getByTestId('sheet-space-sales').getByLabel('지금 공간').waitFor();
  await m.getByTestId('sheet-space-work').tap(); // 업무로 돌려 둠
  await m.waitForURL(/\/$/);
  assert.deepEqual(await tabs(), ['홈', '업무', '캘린더', '메시지', '더보기']);
  assert.equal(await m.getByTestId('fab').count(), 0, '가운데 + 버튼 없음');
  await mc.close();
  // 영업 미배정 직원: 공간 카드 없음 · 주소 직접 입력 404
  await staff.goto(`${BASE}/tasks`);
  assert.equal(await staff.getByTestId('mobile-space-chip').count(), 0);
  const r = await staff.goto(`${BASE}/s/sales`);
  assert.equal(r.status(), 404);
  // 영업 전환 T-5(로컬 검수 10/19): 쓰기 열린 회사 — [새 리드] 입력 창 → 상세 수정(다음 연락일 있는 리드로 현황·파이프라인·지역 정상)
  await sql`insert into sales_cutover (tenant, ok, writes_open) values ('default', true, true) on conflict (tenant) do update set ok = true, writes_open = true`;
  await owner.goto(`${BASE}/s/sales/leads`);
  await owner.getByTestId('lead-new').click();
  await owner.getByTestId('lead-new-name').fill('E2E 새 거래처');
  await owner.getByTestId('lead-new-save').click();
  await owner.getByTestId('sales-lead-edit').waitFor();
  await owner.getByTestId('lead-next').fill('2026-12-01');
  await owner.getByTestId('lead-save').click();
  await owner.getByText('저장했습니다').waitFor();
  await owner.keyboard.press('Escape');
  await owner.getByTestId('sales-lead-row').filter({ hasText: 'E2E 새 거래처' }).waitFor();
  for (const [path, id] of [['/s/sales', 'space-home-sales'], ['/s/sales/pipeline', 'sales-pipeline']]) { await owner.goto(`${BASE}${path}`); await owner.getByTestId(id).waitFor(); }
  await sql`update sales_cutover set writes_open = false where tenant = 'default'`;
  // 원래대로(다른 시험에 영향 없게): 업무 공간으로·영업 끄기
  await owner.keyboard.press('Control+1').catch(() => {});
  await owner.evaluate(() => localStorage.setItem('wos_space', 'work'));
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-sales').click();
  await owner.getByTestId('space-switch').waitFor({ state: 'detached' });
}
