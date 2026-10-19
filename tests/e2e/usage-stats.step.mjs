// V30 ⑤ 이용 현황: 사용량·요금제 → "이용 현황" 탭 → 요약 4칸·날짜별 막대·사용자 표(대표·직원 행)·기간 7일 전환·엑셀 링크, 360 폭 넘침 없음
import assert from 'node:assert/strict';

export async function usageStatsFlow({ owner, ctx, BASE, SHOTS }) {
  await ctx.owner.ok('POST', '/api/tasks', { title: '이용 현황 시험 업무', orgUnitId: ctx.hq, approvalRequired: false }); // E2E_ONLY 로 혼자 돌 때도 대표가 만든 업무 1건
  await owner.goto(BASE + '/admin/usage?tab=stats');
  await owner.getByTestId('usage-stats').waitFor();
  await owner.getByTestId('stats-summary').waitFor();
  const rows = owner.getByTestId('stats-user-row');
  await rows.first().waitFor();
  assert.ok((await rows.count()) >= 4, '사용자 행');
  const me = owner.locator(`[data-testid="stats-user-row"][data-user="${ctx.ownerId}"]`);
  assert.match(await me.getByTestId('stats-last').innerText(), /방금|시간 전/);
  assert.ok(Number(await me.getByTestId('stats-created').innerText()) >= 1, '대표가 만든 업무 수');
  assert.ok((await owner.getByTestId('stats-daily').locator('div').count()) >= 30, '30일 막대');
  await owner.getByTestId('stats-range-7').click();
  await owner.waitForFunction(() => document.querySelectorAll('[data-testid="stats-daily"] > div').length === 7);
  assert.match(await owner.getByTestId('stats-export').getAttribute('href'), /days=7/);
  await owner.screenshot({ path: `${SHOTS}/133-usage-stats.png`, fullPage: true });
  await owner.getByTestId('usage-tab-plan').click();
  await owner.getByTestId('current-plan').waitFor();
}
