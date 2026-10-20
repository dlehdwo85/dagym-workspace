// 대표 10/20 18:00: 월 운영 목표 화면(초안 → 고치기 → 승인) → 마케팅 홈 '이번 달 목표' 막대 → 새 콘텐츠 근거 칸 → 승인함 카드 '왜 이 글인가'
import assert from 'node:assert/strict';

export async function mktGoals({ owner, ctx, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/goals`);
  const page = owner.getByTestId('mkt-goals'); await page.waitFor();
  await owner.getByTestId('goals-empty').or(owner.getByTestId('goal-card')).first().waitFor(); // 목록을 다 받은 뒤 판단
  if (await owner.getByTestId('goals-empty').count()) { await owner.getByTestId('goals-draft').click(); }
  const card = owner.getByTestId('goal-card').first(); await card.waitFor();
  await card.getByTestId('goal-weeks').getByTestId('goal-week').first().waitFor();
  if ((await card.getByTestId('goal-status').innerText()) === '승인 대기') {
    await card.getByTestId('goal-edit').click();
    await card.getByTestId('goal-week-topic-1').fill('E2E 가을 이벤트 주제');
    await card.getByTestId('goal-t-posts').fill('10');
    await card.getByTestId('goal-save').click();
    await card.getByText('E2E 가을 이벤트 주제').waitFor();
    await owner.screenshot({ path: `${SHOTS}/164-mkt-goals.png`, fullPage: true });
    await card.getByTestId('goal-approve').click();
  }
  await card.getByTestId('goal-status').filter({ hasText: '승인됨' }).waitFor();
  await owner.goto(`${BASE}/s/marketing`);
  await owner.getByTestId('mkt-home-goal').waitFor();
  assert.match(await owner.getByTestId('mkt-goal-게시').innerText(), /\/10건$/, '홈 막대 목표 10건');
  // 새 콘텐츠 근거 칸 → 승인함 카드 '왜 이 글인가'
  await owner.goto(`${BASE}/s/marketing/approvals?new=1`);
  const f = owner.getByTestId('mkt-new'); await f.waitFor();
  await f.getByTestId('mkt-title').fill('E2E 근거 있는 글'); await f.getByTestId('mkt-body').fill('본문');
  await f.getByTestId('mkt-new-why').locator('summary').click();
  await f.getByTestId('mkt-why-purpose').fill('신규 문의'); await f.getByTestId('mkt-why-why').fill('E2E 1주 주제 이벤트 안내에 맞춤');
  await f.getByTestId('mkt-save').click();
  const c = owner.getByTestId('approval-card').filter({ hasText: 'E2E 근거 있는 글' }); await c.waitFor();
  assert.match(await c.getByTestId('mkt-why').innerText(), /왜 이 글인가[\s\S]*E2E 1주 주제 이벤트 안내에 맞춤[\s\S]*신규 문의/);
  await owner.screenshot({ path: `${SHOTS}/165-approval-why.png` });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/goals`); await owner.getByTestId('goal-card').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/164-mkt-goals-390.png`, fullPage: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
