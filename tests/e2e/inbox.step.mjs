// 대표 10/21 02:30·03:00: 승인함 통합 — 종류별 탭(콘텐츠/운영 제안/광고 예산/월 목표/제작 의뢰)·건수 배지·카드 바로 승인·반려, 예산 브랜드 표 + '세팅안 필요', [예산 총액 적기], 월 목표 [반려]
import assert from 'node:assert/strict';

export async function inbox({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  for (const n of ['하이링크', '워크인', '바디랩', '다짐']) await ctx.owner.req('POST', '/api/marketing/brands', { name: n });
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 7);
  // 운영 제안(대기 없으면 만들기) · 예산 총액 → 초안 · 월 목표 초안
  const ops = await ctx.owner.ok('GET', '/api/marketing/ops');
  if (!ops.proposals.some((p) => p.status === 'pending')) await ctx.owner.ok('POST', '/api/marketing/ops', { kinds: ['analysis', 'direction'] });
  await ctx.owner.ok('PUT', '/api/marketing/ops/budget/total', { monthly: 2000000, month });
  await ctx.owner.ok('POST', '/api/marketing/ops/budget', { month });
  const goals = await ctx.owner.ok('GET', `/api/marketing/goals?month=${month}`);
  if (!goals.goals.some((g) => g.status === 'pending')) await ctx.owner.ok('POST', '/api/marketing/goals', { month });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/approvals`);
  const tabs = owner.getByTestId('mkt-inbox-tabs'); await tabs.waitFor();
  await owner.getByTestId('mkt-inbox-count-proposals').waitFor();
  assert.ok(Number(await owner.getByTestId('mkt-inbox-tab-budget').getAttribute('data-count')) >= 1, '광고 예산 건수');
  assert.ok(Number(await owner.getByTestId('mkt-inbox-tab-goals').getAttribute('data-count')) >= 1, '월 목표 건수');
  // 운영 제안 탭: 카드 바로 반려(사유 필수) → AI 없으면 반려로 끝
  await owner.getByTestId('mkt-inbox-tab-proposals').click();
  const card = owner.locator('[data-testid="ops-card"][data-status="pending"]').first(); await card.waitFor();
  const before = Number(await owner.getByTestId('mkt-inbox-tab-proposals').getAttribute('data-count'));
  await card.getByTestId('ops-reject').click();
  assert.equal(await card.getByTestId('ops-reject-go').isDisabled(), true);
  await card.getByTestId('ops-reject-note').fill('E2E 반려 사유');
  await card.getByTestId('ops-reject-go').click();
  await owner.getByText(/반려했습니다/).waitFor();
  await owner.getByTestId('mkt-inbox-tab-proposals').filter({ hasText: String(before - 1) }).or(owner.getByTestId('mkt-inbox-tab-proposals').filter({ hasNot: owner.getByTestId('mkt-inbox-count-proposals') })).first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/170-inbox-proposals.png`, fullPage: true });
  // 광고 예산 탭: 브랜드 표(4줄·세팅안 필요) + 총액 기준
  await owner.getByTestId('mkt-inbox-tab-budget').click();
  const budget = owner.getByTestId('ops-budget'); await budget.waitFor();
  await budget.getByTestId('budget-brands').waitFor();
  const nBrands = (await sql`select count(*)::int n from mkt_brands where tenant = 'default'`)[0].n; // 앞 단계가 브랜드를 더 만들었을 수 있음(전체 실행)
  assert.equal(await budget.getByTestId('budget-brands').locator('tbody tr').count(), nBrands, `브랜드 ${nBrands}줄`);
  await budget.getByTestId('budget-brand-needs-바디랩').waitFor();
  assert.match(await budget.getByTestId('budget-brand-바디랩').innerText(), /천안/);
  assert.match(await budget.getByTestId('budget-total').innerText(), /2,000,000원/, '대표 입력 총액 2,000,000');
  await owner.screenshot({ path: `${SHOTS}/171-inbox-budget.png`, fullPage: true });
  // 월 목표 탭: [반려] 사유 입력 → AI 없으면 반려 → 탭에서 사라짐
  await owner.getByTestId('mkt-inbox-tab-goals').click();
  const goal = owner.getByTestId('goal-card').first(); await goal.waitFor();
  const goalsBefore = await owner.getByTestId('goal-card').count();
  await goal.getByTestId('goal-reject').click();
  await goal.getByTestId('goal-reject-note').fill('E2E 목표 반려');
  await goal.getByTestId('goal-reject-go').click();
  // 앞서 제안 반려 토스트(같은 글자)가 남아 있을 수 있어 글자 대신 카드가 줄어드는 것으로 기다림(AI 없으면 반려 → 탭에서 사라짐)
  for (let i = 0; i < 60 && (await owner.getByTestId('goal-card').count()) >= goalsBefore; i++) await owner.waitForTimeout(250);
  let g; for (let i = 0; i < 20 && !g; i++) { [g] = await sql`select status, reject_note from mkt_goals where reject_note = 'E2E 목표 반려' order by updated_at desc limit 1`; if (!g) await owner.waitForTimeout(250); } // 승인함 월 목표 탭은 월 역순(다른 달 초안이 먼저일 수 있음) · E2E 회사 tenant 는 default 가 아닐 수 있음
  assert.ok(g && g.status === 'rejected', JSON.stringify(g));
  // 운영실: [예산 총액 적기]
  await owner.goto(`${BASE}/s/marketing/ops`);
  await owner.getByTestId('budget-total-row').waitFor();
  assert.match(await owner.getByTestId('budget-owner-total').innerText(), /2,000,000원/);
  await owner.getByTestId('budget-total-edit').click();
  await owner.getByTestId('budget-total-in').fill('2500000');
  await owner.getByTestId('budget-total-save').click();
  await owner.getByTestId('budget-owner-total').filter({ hasText: '2,500,000원' }).waitFor();
  // 대표 03:00 ①②: 매출 목표 [AI 추천 받기](AI 없으면 기본 계산 3안) → 기본안 고르기 → 저장 · 지금 상태 [지금 검토]
  const rg = owner.getByTestId('revenue-goal').first();
  await rg.getByTestId('revenue-recommend').click();
  await rg.getByTestId('revenue-suggest').waitFor();
  await rg.getByTestId('revenue-option-base').click();
  await rg.getByTestId('revenue-save').click();
  await owner.getByText('매출 목표를 저장했습니다').waitFor();
  await owner.getByTestId('ops-review-now').click();
  await owner.getByText(/검토 완료/).waitFor();
  await owner.getByTestId('ops-review-status').filter({ hasText: /정상|주의|조치 필요/ }).waitFor();
  await owner.getByTestId('ops-review-at').filter({ hasText: '최근 검토' }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/172-ops-live.png`, fullPage: true });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/approvals?tab=budget`);
  await owner.getByTestId('budget-brands').waitFor();
  await owner.screenshot({ path: `${SHOTS}/171-inbox-budget-390.png`, fullPage: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
