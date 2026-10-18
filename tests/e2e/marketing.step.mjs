// V41 4-2 마케팅 공간: 켜기 → 개요 카드 → 승인 대기에서 새 콘텐츠(시안 없음) → 상세에서 승인하면 거절 안내 → 수정 요청(이유) →
// 캘린더에 칩 → 전화 문의 추가 → [영업 리드로] → 업무 보기 링크 → 끄기
import assert from 'node:assert/strict';
export async function marketing({ owner, BASE, sql }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-marketing').click();
  await owner.getByTestId('space-switch').waitFor();
  await owner.goto(`${BASE}/s/marketing`);
  await owner.getByTestId('space-home-marketing').waitFor();
  assert.equal(await owner.getByTestId('mkt-card').count(), 4);
  await owner.getByRole('link', { name: '승인 대기' }).first().click();
  await owner.waitForURL(/\/s\/marketing\/approvals$/);
  await owner.getByTestId('mkt-new-open').click();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  await owner.getByTestId('mkt-title').fill('E2E 가을 행사 게시물');
  await owner.getByTestId('mkt-date').fill(today);
  await owner.getByTestId('mkt-body').fill('가을 행사 안내 캡션');
  await owner.getByTestId('mkt-save').click();
  await owner.getByTestId('mkt-row').filter({ hasText: 'E2E 가을 행사 게시물' }).click();
  await owner.getByTestId('mkt-decide').waitFor();
  await owner.getByTestId('mkt-approve').click();
  await owner.getByText(/시안/).first().waitFor();
  assert.equal(await owner.getByTestId('mkt-status').textContent(), '승인 대기', '시안 없으면 승인 안 됨');
  await owner.getByLabel('결정 메모').fill('사진을 넣어 주세요');
  await owner.getByTestId('mkt-changes').click();
  await owner.getByTestId('mkt-status').filter({ hasText: '수정 요청' }).waitFor();
  await owner.keyboard.press('Escape');
  await owner.goto(`${BASE}/s/marketing/calendar`);
  const d = Number(today.slice(8));
  await owner.getByTestId(`mkt-day-${d}`).getByText('E2E 가을 행사 게시물').waitFor();
  await owner.goto(`${BASE}/s/marketing/calls`);
  // 로컬 검수 10/17: 하위 메뉴에 있으면 공간 첫 화면(현황)은 같이 강조하지 않음 — 강조는 하나
  await owner.getByTestId('call-phone').waitFor();
  assert.deepEqual(await owner.locator('aside a[aria-current="page"]').allInnerTexts(), ['전화 문의']);
  // 대표 지적(10/18): 공간 메뉴 아래 '공통'(업무·캘린더·메시지·자료실·AI 비서), 공통 메뉴로 가도 마케팅 공간 유지
  await owner.getByTestId('nav-common').waitFor();
  await owner.locator('aside').getByRole('link', { name: '업무', exact: true }).click();
  await owner.waitForURL(/\/tasks/);
  assert.equal(await owner.locator('.app-shell').getAttribute('data-space'), 'marketing');
  await owner.goto(`${BASE}/s/marketing/calls`);
  await owner.getByTestId('call-phone').waitFor();
  await owner.getByTestId('call-phone').fill('010-2222-3333');
  await owner.getByTestId('call-add').click();
  await owner.getByTestId('call-row').filter({ hasText: '010-2222-3333' }).getByTestId('call-convert').click();
  await owner.getByTestId('call-row').filter({ hasText: '010-2222-3333' }).getByRole('link', { name: '영업 업무 보기' }).waitFor();
  // 광고 성과(연결 전): 카드 4·빈 안내·네이버 연결 창(관리자)
  await owner.goto(`${BASE}/s/marketing/ads`);
  await owner.getByTestId('ads-card').first().waitFor();
  assert.equal(await owner.getByTestId('ads-card').count(), 4);
  await owner.getByText('광고 계정을 연결하면 매일 아침 성과가 들어옵니다').waitFor();
  await owner.getByTestId('ads-callbacks').getByText(/\/api\/marketing\/ads\/callback\/meta/).waitFor({ state: 'attached' });
  await owner.getByTestId('ads-add-naver').click();
  await owner.getByTestId('naver-form').waitFor();
  await owner.keyboard.press('Escape');
  // V41 4-3 자동 제작: 사용량 카드 4·요금제 3·규칙 추가(화·목 10:00)
  await owner.goto(`${BASE}/s/marketing/automation`);
  await owner.getByTestId('auto-usage').first().waitFor();
  assert.equal(await owner.getByTestId('auto-usage').count(), 5);
  await owner.getByTestId('auto-plan-standard').waitFor();
  await owner.getByTestId('auto-brand-name').fill('E2E 시험 브랜드');
  await owner.getByTestId('auto-brand-add').click();
  await owner.getByTestId('auto-brands').getByText('E2E 시험 브랜드', { exact: true }).waitFor();
  await owner.getByTestId('auto-rule-add').click();
  await owner.getByTestId('auto-rule').first().waitFor();
  // 로컬 검수 10/18 ②: 자동 제작 시안(시험·수정 요청 상태)도 승인 대기에서 눌러 본문·결정 화면이 열림
  const [{ tenant, created_by }] = await sql`select tenant, created_by from mkt_rules limit 1`;
  const [ac] = await sql`insert into mkt_contents (tenant, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produced_at, is_test, quality)
    values (${tenant}, '[시험] E2E 자동 시안', 'instagram', now() + interval '3 days', 'changes', 1, ${created_by}, 'feed', true, now(), true, ${sql.json({ passed: false, issues: ['채우지 않은 자리표시'], brief: '실사' })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${ac.id}, 1, '자동 본문', ${[]}, 'AI 자동 제작', ${created_by})`;
  await owner.goto(`${BASE}/s/marketing/approvals`);
  await owner.getByTestId('mkt-row').filter({ hasText: 'E2E 자동 시안' }).click();
  await owner.getByTestId('mkt-detail').getByText('자동 본문').waitFor();
  await owner.getByTestId('mkt-decide').waitFor();
  await owner.keyboard.press('Escape');
  // 원래대로
  await owner.evaluate(() => localStorage.setItem('wos_space', 'work'));
  await owner.goto(`${BASE}/admin/users`);
  await owner.getByTestId('tab-spaces').click();
  await owner.getByTestId('space-toggle-marketing').click();
  await owner.getByTestId('space-switch').waitFor({ state: 'detached' });
}
