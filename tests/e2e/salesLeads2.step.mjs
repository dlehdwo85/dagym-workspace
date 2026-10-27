// 영업 S2 2차(감사 1-13~1-16): 새 리드 13칸 + 비슷한 거래처 경고 → 목록 칩·정렬·보기·CSV → 상세 업무 탭·타임라인·정보 수정 → 제안·계약·ROI 화면 → 삭제
import assert from 'node:assert/strict';

export async function salesLeads2({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const base = await ctx.owner.ok('POST', '/api/sales/leads', { name: 'E2E 동탄 센트럴 커뮤니티', region: '경기', force: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/sales/leads`);
  // 새 리드 13칸 + 비슷한 거래처 경고 → [그래도 만들기]
  await owner.getByTestId('lead-new').click();
  const f = owner.getByTestId('lead-new-form'); await f.waitFor();
  await f.getByTestId('lead-new-name').fill('E2E 동탄센트럴 커뮤니티 2차');
  await f.getByTestId('lead-new-similar').waitFor();
  await f.getByTestId('lead-new-facilityType').fill('아파트'); await f.getByTestId('lead-new-scale').fill('900세대'); await f.getByTestId('lead-new-expectedRevenue').fill('25,000,000');
  await f.getByTestId('lead-new-email').fill('e2e@example.com'); await f.getByTestId('lead-new-nextContactDate').fill(ymd(3));
  await owner.screenshot({ path: `${SHOTS}/159-lead-new-form.png` });
  await f.getByTestId('lead-new-save').click();
  await f.getByTestId('lead-new-save').filter({ hasText: '그래도 만들기' }).waitFor(); // 비슷한 거래처가 있으면 한 번 더 확인
  await f.getByTestId('lead-new-save').click();
  const detail = owner.getByTestId('sales-lead-detail'); await detail.waitFor();
  await detail.getByTestId('lead-tab-info').click(); // 첫 탭은 '진행'
  await detail.getByTestId('lead-info').getByText('900세대').waitFor();
  // 상세: 업무 탭 추가 → 타임라인 → 정보 수정(규모) → 상담(다음 연락일)
  await detail.getByTestId('lead-tab-tasks').click();
  await detail.getByTestId('lead-task-title').fill('E2E 제안서 보내기'); await detail.getByTestId('lead-task-add').click();
  await detail.getByTestId('lead-task').filter({ hasText: 'E2E 제안서 보내기' }).waitFor();
  await detail.getByTestId('lead-tab-timeline').click();
  await detail.getByTestId('lead-timeline').getByText(/E2E 제안서 보내기/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/160-lead-detail-timeline.png` });
  // 영업 재편 5) 진행 탭(첫 화면): 단계 띠로 이동 → 다음 연락 칩 → 메모 → 상담 기록 → 일정 추가(회사 캘린더) → 열린 업무·다가오는 일정 요약
  await detail.getByTestId('lead-tab-progress').click();
  await detail.getByTestId('lead-stage-strip').waitFor();
  await detail.getByTestId('lead-stage-미팅예정').click();
  await owner.getByText('미팅예정(으)로 옮겼습니다').waitFor();
  await detail.getByTestId('lead-stage-미팅예정').and(owner.locator('[aria-pressed="true"]')).waitFor();
  await detail.getByTestId('lead-stage-보류').click(); await detail.getByTestId('lead-stage-reason-box').waitFor(); await detail.getByTestId('lead-stage-reason-box').getByRole('button', { name: '취소' }).click(); // 보류는 사유 필수
  await detail.getByTestId('lead-next-chip-1').click(); await owner.getByText('다음 연락 내일').waitFor();
  await detail.getByTestId('lead-memo').fill('E2E 진행 메모'); await detail.getByTestId('lead-memo-save').click(); await owner.getByText('메모를 저장했습니다').waitFor();
  await detail.getByTestId('lead-event-title').fill('E2E 현장 미팅'); await detail.getByTestId('lead-event-date').fill(ymd(4)); await detail.getByTestId('lead-event-time').fill('14:00'); await detail.getByTestId('lead-event-add').click();
  await detail.getByTestId('lead-progress-events').getByText(/E2E 현장 미팅/).waitFor();
  assert.match(await detail.getByTestId('lead-progress-tasks').innerText(), /E2E 제안서 보내기/);
  await owner.screenshot({ path: `${SHOTS}/179-lead-progress.png` });
  await detail.getByTestId('lead-tab-events').click(); await detail.getByTestId('lead-event').filter({ hasText: 'E2E 현장 미팅' }).waitFor();
  await detail.getByTestId('lead-tab-progress').click();
  await detail.getByTestId('lead-act').fill('E2E 방문 상담'); await detail.getByTestId('lead-act-next').fill(ymd(5)); await detail.getByTestId('lead-act-action').fill('견적 보내기');
  await detail.getByTestId('lead-act-add').click();
  let next_contact_date = null;
  for (let i = 0; i < 40 && next_contact_date !== ymd(5); i++) { await new Promise((r) => setTimeout(r, 250)); [{ next_contact_date }] = await sql`select next_contact_date::text from sales_leads where name = 'E2E 동탄센트럴 커뮤니티 2차'`; }
  assert.equal(next_contact_date, ymd(5), '상담의 다음 연락 예정일이 리드에 반영');
  await owner.keyboard.press('Escape');
  // 목록: 단계 요약 칩·빠른 칩·정렬·보기·CSV 내보내기
  await owner.getByTestId('leads-stage-summary').getByTestId('leads-stage-chip').first().waitFor();
  await owner.getByTestId('leads-chip-week').click();
  const rowOf = (name) => owner.getByTestId('sales-lead-row').filter({ has: owner.locator(`input[value="${name}"]`) });
  await rowOf('E2E 동탄센트럴 커뮤니티 2차').waitFor();
  assert.equal(await rowOf('E2E 동탄 센트럴 커뮤니티').count(), 0, '이번 주 연락 칩 = 다음 연락 없는 리드는 빠짐');
  await owner.getByTestId('leads-chip-week').click();
  await owner.getByTestId('leads-sort').selectOption('name');
  await owner.getByTestId('leads-view-compact').click(); await owner.getByTestId('leads-compact').waitFor();
  await owner.getByTestId('leads-view-stages').click(); await owner.getByTestId('sales-pipeline').waitFor(); // 대표 10/21 12:00 ③: 단계별 = 예전 파이프라인(칸반)
  await owner.getByTestId('pipeline-funnel').waitFor(); assert.ok((await owner.getByTestId('funnel-stage').count()) >= 5, '전환율 깔때기(닫힌 단계 제외)'); // 영업 재편 5) 전환율 흡수
  await owner.getByTestId('pipeline-move').first().waitFor(); // 칸반 카드 단계 이동 select
  await owner.screenshot({ path: `${SHOTS}/161-leads-stages.png`, fullPage: true });
  await owner.getByTestId('leads-view-table').click();
  const [dl] = await Promise.all([owner.waitForEvent('download'), owner.getByTestId('leads-csv-export').click()]);
  const csv = await (await import('node:fs/promises')).readFile(await dl.path(), 'utf8'); // 헤드리스 크로미움은 파일 이름을 'download' 로만 알려 줘서 내용으로 확인(UTF-8 BOM + 머리줄)
  assert.ok(csv.startsWith('\uFEFF거래처명,단계,우선순위') && csv.includes('E2E 동탄센트럴 커뮤니티 2차'), csv.slice(0, 80));
  // 제안·계약·ROI
  await ctx.owner.ok('POST', `/api/sales/leads/${base.id}/records`, { kind: 'contracts', title: 'E2E 운영 계약', amount: 10000000, date: ymd(0), endDate: ymd(60) });
  await ctx.owner.ok('POST', '/api/sales/costs', { month: ymd(0).slice(0, 7), item: 'E2E 광고비', amount: 2000000 });
  await owner.goto(`${BASE}/s/sales/deals`);
  await owner.getByTestId('deals-kpi').waitFor();
  await owner.getByTestId('deals-row-contracts').filter({ hasText: 'E2E 운영 계약' }).waitFor();
  assert.equal(await owner.getByTestId('roi-ROI').innerText(), '400%');
  await owner.getByTestId('cost-list').getByText('E2E 광고비').waitFor();
  await owner.getByTestId('record-more').first().click(); await owner.getByTestId('record-more-fields').waitFor();
  await owner.screenshot({ path: `${SHOTS}/162-deals-roi.png`, fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/sales/leads`);
  await owner.getByTestId('sales-lead-card').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/159-leads-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 삭제(사유)
  await owner.goto(`${BASE}/s/sales/leads`);
  await owner.getByTestId('sales-lead-row').filter({ has: owner.locator('input[value="E2E 동탄센트럴 커뮤니티 2차"]') }).getByTestId('cell-contact').click(); // 이름·다음 연락 칸은 표 안 편집 입력이라 마지막 접촉 칸을 누름(197차 표 열)
  await owner.getByTestId('sales-lead-detail').waitFor();
  await owner.getByTestId('lead-tab-info').click(); // 기본 탭이 '진행'이라 삭제 버튼(정보 탭)으로
  await owner.getByTestId('lead-delete').click();
  await owner.getByTestId('lead-delete-reason').fill('E2E 중복'); await owner.getByTestId('lead-delete-go').click();
  await owner.getByTestId('sales-lead-detail').waitFor({ state: 'hidden' });
  assert.equal((await sql`select deleted_reason from sales_leads where name = 'E2E 동탄센트럴 커뮤니티 2차'`)[0].deleted_reason, 'E2E 중복');
}
