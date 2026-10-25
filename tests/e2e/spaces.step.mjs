// V41 단계 1 공간 틀: 관리 › 사용자 › 공간에서 영업 켜기 → PC 공간 카드 드롭다운으로 영업(파란 강조) → Ctrl+1 로 업무 →
// 휴대폰 프로필 시트 공간 전환 → 뒤로가기 = 업무 · 영업 미배정 직원은 공간 카드 없음·주소 404 → 끄기
import assert from 'node:assert/strict';
export async function spaces(ctx) {
  try { await spacesMain(ctx); } finally { await spacesTeardown(ctx).catch(() => {}); }
}

async function spacesMain({ browser, desk, owner, staff, BASE, sql, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-sales').click(); // 저장 → 화면 새로고침(사이드바에 공간 카드)
  await owner.getByTestId('space-tabs').waitFor();
  await owner.goto(`${BASE}/`);
  // ⑦ 사이드바 3구역(대표 승인 10/20 오후): ① 맨 위 공간 전환 탭(요약은 title) ② '업무 메뉴'(홈·업무·프로젝트·내 주간 보고·결재) ③ '공통'(캘린더·알림·메시지·자료실·연락처·공지·AI 비서) + 관리(접힘)
  await owner.getByTestId('space-tabs').waitFor();
  await owner.waitForFunction(() => /내 업무 \d+/.test(document.querySelector('[data-testid="space-tab-work"]')?.getAttribute('title') ?? '')); // 요약은 /api/spaces 가 온 뒤
  const navLabels = async (tid) => (await owner.getByTestId(tid).getByRole('link').allInnerTexts()).map((x) => x.replace(/\d+$/, '').trim());
  assert.equal(await owner.getByTestId('nav-space-head').innerText(), '업무 메뉴');
  const side = owner.getByRole('navigation', { name: '주 메뉴' });
  const sideLabels = async () => (await side.getByRole('link').allInnerTexts()).map((x) => x.replace(/\d+$/, '').trim());
  const workLabels = await sideLabels();
  assert.deepEqual(workLabels.slice(0, 5), ['홈', '업무', '프로젝트', '내 주간 보고', '결재'], `업무 메뉴 ${workLabels}`);
  const commonWork = await navLabels('nav-common-v3');
  assert.deepEqual(commonWork.slice(0, 4), ['캘린더', '알림', '메시지', '자료실'].filter((l) => commonWork.includes(l)).slice(0, 4), `공통 ${commonWork}`);
  assert.ok(commonWork.includes('연락처') && commonWork.includes('공지'), `공통에 연락처·공지 ${commonWork}`);
  await owner.getByTestId('space-tab-sales').click();
  await owner.waitForURL(/\/s\/sales$/);
  await owner.getByTestId('space-home-sales').waitFor();
  assert.equal(await owner.getByTestId('space-current').textContent(), '워크인 · 영업');
  assert.equal(await owner.locator('.app-shell').getAttribute('data-space'), 'sales');
  assert.equal(await owner.getByTestId('nav-space-head').innerText(), '영업 메뉴');
  const commonSales = await navLabels('nav-common-v3');
  assert.deepEqual(commonSales, ['업무', ...commonWork.map((l) => (l === 'AI 비서' ? 'AI 세일즈' : l))], '공통은 어느 공간에서나 같은 자리(영업·마케팅은 맨 위 업무만 더) — 대표 10/21 12:20: 영업의 AI 는 AI 세일즈');
  // 대표 10/24 저녁(#567): 영업에서 공통(업무·캘린더·연락처)·관리(사용자 관리) 메뉴를 눌러도 상단 공간·사이드바는 영업 그대로 — 새로고침해도 유지, 업무 전용 화면(프로젝트)으로 갈 때만 업무
  const spaceIs = async (label, why) => {
    await owner.waitForFunction((l) => document.querySelector('[data-testid="space-current"]')?.textContent === l, label, { timeout: 5000 }).catch(() => {});
    assert.equal(await owner.getByTestId('space-current').textContent(), label, why);
  };
  for (const [name, url] of [['업무', /\/tasks$/], ['캘린더', /\/calendar$/], ['연락처', /\/contacts$/]]) {
    await owner.getByTestId('nav-common-v3').getByRole('link', { name, exact: true }).click();
    await owner.waitForURL(url);
    await spaceIs('워크인 · 영업', `공통 '${name}'에서도 영업`);
    assert.equal(await owner.getByTestId('nav-space-head').innerText(), '영업 메뉴');
  }
  const usersLink = owner.getByTestId('nav-admin').getByRole('link', { name: '사용자 관리' });
  if (!(await usersLink.count())) await owner.getByTestId('nav-admin').getByRole('button', { name: '관리' }).click();
  await usersLink.click();
  await owner.waitForURL(/\/admin\/users$/);
  await spaceIs('워크인 · 영업', '관리 › 사용자 관리에서도 영업');
  assert.equal(await owner.locator('.app-shell').getAttribute('data-space'), 'sales');
  await owner.reload();
  await spaceIs('워크인 · 영업', '새로고침해도 영업(마지막 공간 기억)');
  await owner.goto(`${BASE}/projects`);
  await spaceIs('워크인 · 업무', '업무 전용 화면(프로젝트)은 업무');
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
  await m.getByTestId('profile-menu').tap();
  await m.getByTestId('mobile-spaces').waitFor();
  // 로컬 검수: 시트가 화면보다 길어도 맨 위(프로필·업무 카드)가 화면 안
  const top = await m.getByTestId('mobile-space-work').boundingBox();
  assert.ok(top && top.y >= 0, `업무 카드 화면 안 (y=${top?.y})`);
  const sheet = await m.getByTestId('more-sheet').boundingBox();
  assert.ok(sheet.y >= 0 && sheet.height <= 780 * 0.9 + 1, `시트 높이 ${sheet.height}`);
  await m.getByTestId('mobile-space-sales').tap();
  await m.waitForURL(/\/s\/sales$/);
  assert.equal(await m.getByTestId('mobile-space-chip').textContent(), '영업');
  // 대표(10/19): 휴대폰 상단 공간 메뉴 칩 줄 없음 — 공간 메뉴는 더보기 시트의 '영업 메뉴'(입찰·공고 포함)
  assert.equal(await m.getByTestId('space-chips').count(), 0, '상단 칩 줄 없음');
  await m.getByTestId('profile-menu').tap();
  // #422 d: 하단 탭(제안·계약·영업기회)과 겹치는 메뉴는 시트에서 빠짐 — #438 입찰은 하단 탭이 아니라 시트 '영업 메뉴'에서
  assert.equal(await m.getByTestId('mobile-space-menu').getByRole('link', { name: '제안·계약' }).count(), 0, '하단 탭과 겹치는 제안·계약 없음');
  assert.equal(await m.getByTestId('mobile-space-menu').getByRole('link', { name: '입찰·공고' }).count(), 0, '#611(대표 10/25): 입찰·공고 메뉴 없음 — 허브 입찰 탭으로 합침');
  await m.getByTestId('more-sheet').getByLabel('닫기').tap();
  await m.getByTestId('mobile-tabs').getByRole('link', { name: '영업기회' }).tap(); // 대표 10/21 12:00 ③: 공공데이터·지역별·계약만료는 허브 카테고리 · #537 입찰을 켠 회사는 영업기회 › 입찰로
  await m.waitForURL(/\/s\/sales\/hub(\?tab=bids&bt=today)?$/);
  await m.getByTestId('sales-hub-prospects').tap(); await m.getByTestId('prospects').waitFor();
  await m.getByTestId('profile-menu').tap();
  await m.getByTestId('mobile-space-menu').getByRole('link', { name: '데이터 설정' }).tap();
  await m.waitForURL(/\/s\/sales\/sources$/);
  await m.getByTestId('sales-custom').waitFor(); // 로컬 10/19: 직접 추가한 출처(사이트·키워드·엑셀) 칸
  await m.getByTestId('profile-menu').tap();
  await m.getByTestId('mobile-space-work').tap(); // 마지막 공간 = 업무로 돌려 둠
  await m.waitForURL(/\/$/);
  // 대표(10/19): 앱 머리줄 로고·공간 이름 → PC 와 같은 공간 전환 시트(회사 이름·지금 공간 체크)
  await m.getByTestId('mobile-space-switch').tap();
  await m.getByTestId('space-sheet').waitFor();
  await m.getByTestId('sheet-space-work').getByLabel('지금 공간').waitFor();
  await m.getByTestId('sheet-space-sales').tap();
  await m.waitForURL(/\/s\/sales$/);
  assert.equal(await m.getByTestId('mobile-space-chip').textContent(), '영업');
  // 로컬 10/19(대표): 앱도 공간 색 — 머리줄 로고(공간 아이콘)·하단 탭 선택 색·강조 버튼이 영업 파랑, 공간 바꾸면 바로
  await m.getByTestId('mobile-space-logo').waitFor();
  const onColor = () => m.getByTestId('mobile-tabs').locator('a.font-bold').first().evaluate((el) => getComputedStyle(el).color);
  assert.equal(await onColor(), 'rgb(29, 78, 216)', '영업 하단 탭 선택 = 파랑');
  for (const w of [360, 390, 430]) { await m.setViewportSize({ width: w, height: 800 }); await m.waitForTimeout(200); await m.screenshot({ path: `${SHOTS}/app-space/sales-${w}.png` }); }
  // 대표 확정 10/22(#422): 하단 '더보기' 없음 — 같은 폭(나머지는 오른쪽 위 프로필 버튼 시트) · #537 대표 확정 10/24: 영업 5칸
  const tabs = async () => (await m.getByTestId('mobile-tabs').locator(':scope > *').allInnerTexts()).map((x) => x.replace(/\d+/g, '').trim());
  assert.deepEqual(await tabs(), ['홈', '영업기회', '영업 진행', '제안·계약', '메시지']); // #537 홈·영업기회(입찰은 그 안, #438)·리드·제안·계약·메시지
  const w = await m.getByTestId('mobile-tabs').locator(':scope > *').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  assert.ok(Math.max(...w) - Math.min(...w) <= 1, `같은 폭 ${w}`);
  // #567: 영업 하단 '메시지'를 눌러도 하단 탭·머리줄은 영업 그대로(공통 화면이라고 업무 탭으로 바뀌지 않음)
  await m.getByTestId('mobile-tabs').getByRole('link', { name: /메시지/ }).tap();
  await m.waitForURL(/\/messages$/);
  await m.waitForFunction(() => document.querySelector('[data-testid="mobile-tabs"]')?.getAttribute('data-space') === 'sales', null, { timeout: 5000 }).catch(() => {});
  assert.deepEqual(await tabs(), ['홈', '영업기회', '영업 진행', '제안·계약', '메시지'], '메시지 화면에서도 영업 하단 탭');
  assert.equal(await m.getByTestId('mobile-space-chip').textContent(), '영업');
  await m.getByTestId('mobile-space-switch').tap();
  await m.getByTestId('sheet-space-sales').getByLabel('지금 공간').waitFor();
  await m.getByTestId('sheet-space-work').tap(); // 업무로 돌려 둠
  await m.waitForURL(/\/$/);
  assert.deepEqual(await tabs(), ['홈', '업무', '캘린더', '메시지', '결재']); // 대표 확정 10/22(#422)
  await m.getByTestId('profile-menu').tap();
  const sheet2 = m.getByTestId('more-sheet');
  assert.deepEqual(await sheet2.getByTestId('mobile-space-menu').getByRole('link').allInnerTexts(), ['내 주간 보고'], '#422 c: 업무 메뉴 = 내 주간 보고만');
  for (const dup of ['홈', '업무', '캘린더', '메시지', '결재', '알림']) assert.equal(await sheet2.getByRole('link', { name: dup, exact: true }).count(), 0, `#422 d: 하단 탭·머리줄과 겹치는 '${dup}' 없음`);
  await sheet2.getByTestId('profile-links').getByRole('link', { name: '설정·알림' }).waitFor();
  assert.equal(await sheet2.getByTestId('more-create').count(), 0, '#422 b: 만들기 줄 없음');
  await sheet2.getByLabel('닫기').tap();
  assert.equal(await onColor(), 'rgb(17, 94, 89)', '업무로 돌아오면 바로 청록');
  assert.equal(await m.getByTestId('mobile-space-logo').count(), 0, '업무는 워크인 로고');
  for (const w of [360, 390, 430]) { await m.setViewportSize({ width: w, height: 800 }); await m.waitForTimeout(200); await m.screenshot({ path: `${SHOTS}/app-space/work-${w}.png` }); }
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
  await owner.getByTestId('sales-lead-detail').waitFor(); await owner.getByTestId('lead-tab-info').click(); // 영업 재편 5): 첫 탭은 '진행', 정보 수정은 '정보' 탭
  await owner.getByTestId('sales-lead-edit').waitFor();
  await owner.getByTestId('lead-next').fill('2026-12-01');
  await owner.getByTestId('lead-save').click();
  await owner.getByText('저장했습니다').waitFor();
  await owner.keyboard.press('Escape');
  // 로컬 10/19: 쓰기 열린 회사는 표 안에서 바로 고침(거래처명 칸 = 입력칸) → 엔터로 저장
  const nameCell = owner.getByTestId('sales-lead-row').getByTestId('cell-name').and(owner.locator('[value="E2E 새 거래처"]'));
  await nameCell.waitFor();
  await nameCell.fill('E2E 새 거래처2'); await owner.keyboard.press('Enter'); // 고친 뒤엔 value 가 바뀌어 같은 locator 로 못 찾음
  // 입력칸 값은 바로 바뀌므로 저장 완료는 DB 로 확인(최대 10초)
  let saved = 0;
  for (let k = 0; k < 40 && !saved; k++) { saved = (await sql`select count(*)::int n from sales_leads where name = 'E2E 새 거래처2'`)[0].n; if (!saved) await owner.waitForTimeout(250); }
  assert.equal(saved, 1, '표 안 수정 저장');
  for (const [path, id] of [['/s/sales', 'space-home-sales'], ['/s/sales/pipeline', 'sales-pipeline']]) { await owner.goto(`${BASE}${path}`); await owner.getByTestId(id).waitFor(); }
  await sql`update sales_cutover set writes_open = false where tenant = 'default'`;
}

/** 원래대로(다른 시험에 영향 없게): 업무 공간으로·영업 끄기 — 중간에 실패해도 실행(뒤 단계 연쇄 실패 방지) */
async function spacesTeardown({ owner, BASE }) {
  await owner.keyboard.press('Control+1').catch(() => {});
  await owner.evaluate(() => localStorage.setItem('wos_space', 'work'));
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-sales').click();
  await owner.getByTestId('space-switch').waitFor({ state: 'detached' });
}
