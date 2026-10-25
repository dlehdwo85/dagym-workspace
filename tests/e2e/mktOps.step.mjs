// 대표 10/20 20:00: 운영실(AI 마케터 승인 카드 → 승인 → 제작의뢰 · 광고 예산 계획 고치기 → 승인·집행 · 월 매출 목표 막대) → 마케팅 홈·영업 홈 매출 막대 → 월간 보고 CAC·ROI
import assert from 'node:assert/strict';

export async function mktOps({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/ops`);
  await owner.getByTestId('mkt-ops').waitFor();
  await owner.getByTestId('ops-empty').or(owner.getByTestId('ops-card')).first().waitFor();
  if (await owner.getByTestId('ops-empty').count()) await owner.getByTestId('ops-propose').click();
  const plan = owner.getByTestId('ops-card').filter({ has: owner.locator('[data-kind="plan"][data-status="pending"]') }).or(owner.locator('[data-testid="ops-card"][data-kind="plan"][data-status="pending"]')).first();
  await plan.waitFor();
  await plan.getByTestId('ops-card-why').waitFor();
  // 반려는 사유 필수(버튼 비활성) → 취소 → 승인 → 제작의뢰실 링크
  const analysis = owner.locator('[data-testid="ops-card"][data-kind="analysis"][data-status="pending"]').first();
  await analysis.getByTestId('ops-reject').click();
  assert.equal(await analysis.getByTestId('ops-reject-go').isDisabled(), true, '사유 없으면 반려 못 함');
  await analysis.getByTestId('ops-reject-note').fill('E2E 지금은 안 함');
  await analysis.getByTestId('ops-reject-go').click();
  await owner.getByText('수정을 요청했습니다').waitFor(); // 대표 02:30 ②(126차): 반려 = 사유를 AI 에 보내 고친 안을 다시 올리게 — 단추 '수정 요청 보내기'
  await owner.screenshot({ path: `${SHOTS}/167-mkt-ops.png`, fullPage: true });
  await plan.getByTestId('ops-approve').click();
  await owner.getByText('승인했습니다').waitFor();
  const [b] = await sql`select count(*)::int n from mkt_briefs where refs->>'proposalId' is not null and status = 'queued'`;
  assert.ok(b.n >= 1, '계획 승인 → 제작의뢰(대기)');
  // 광고 예산: 초안 없으면 만들기(연결 계정 없으면 기본 배분) → 고치기 → 승인·집행(연결 없음 → 안내만)
  const budget = owner.getByTestId('ops-budget');
  if (await budget.getByTestId('budget-empty').count()) { await budget.getByTestId('budget-draft').click(); await budget.getByTestId('budget-table').waitFor(); }
  if ((await budget.getByTestId('budget-status').innerText()) === '승인 대기') {
    await budget.getByTestId('budget-edit').click();
    await budget.getByTestId('budget-in-naver').fill('250000');
    await budget.getByTestId('budget-save').click();
    await owner.getByText('저장했습니다').waitFor();
    await budget.getByTestId('budget-row-naver').getByText('250,000원').waitFor();
    owner.once('dialog', (d) => d.accept()); // 승인·집행 확인 창(로컬 23:00: 금액 확인)
    await budget.getByTestId('budget-approve').click();
    await budget.getByTestId('budget-status').filter({ hasText: '승인됨' }).waitFor();
  }
  await budget.getByTestId('budget-executed').waitFor();
  await budget.getByTestId('budget-draft').waitFor(); // 로컬 00:10: 승인 뒤에도 [AI 다시 계획] 버튼이 보임(승인 대기 상태에서도 같은 버튼)
  assert.notEqual((await budget.getByTestId('budget-total').innerText()).trim(), '0원', '로컬 23:55: 계획 금액이 0원이면 안 됨'); // 기본 배분(실적 비례)도 금액이 들어감
  // 월 매출 목표 적기 → 막대
  const rg = owner.getByTestId('revenue-goal').first();
  await rg.getByTestId('revenue-edit').click();
  await rg.getByTestId('revenue-target').fill('10000000');
  await rg.getByTestId('revenue-save').click();
  await rg.getByText(/10,000,000원/).waitFor();
  await owner.screenshot({ path: `${SHOTS}/168-mkt-ops-budget.png`, fullPage: true });
  // 마케팅 홈·영업 홈 막대
  await owner.goto(`${BASE}/s/marketing`);
  await owner.getByTestId('revenue-goal').getByText(/10,000,000원/).first().waitFor(); // 실적 내역 줄(계약 1건 10,000,000원)과 겹칠 수 있음
  await owner.goto(`${BASE}/s/sales`);
  await owner.getByTestId('revenue-goal').getByText(/10,000,000원/).first().waitFor();
  // 월간 보고 CAC·ROI 칸
  await owner.goto(`${BASE}/s/marketing/report?month=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7)}`);
  await owner.getByTestId('report-roi').getByText('ROI').waitFor();
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/ops`);
  await owner.getByTestId('ops-budget').waitFor();
  await owner.screenshot({ path: `${SHOTS}/167-mkt-ops-390.png`, fullPage: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
