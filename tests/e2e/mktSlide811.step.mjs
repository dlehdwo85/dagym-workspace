// 271차 #811(대표 10/29 'AI 영상 제작 비용 최소화'): 브랜드 영상 키트 '릴스·쇼츠 영상 만드는 방법' 고르기 · 승인함 릴스 카드 [실제 사진으로 영상 만들기 · 0원](사진이 3장이 안 되면 이유 안내)
import assert from 'node:assert/strict';

export async function mktSlide811({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E811 다짐' })).id;
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by)
    values ('default', ${brand}, 'E2E811 아침 운동 릴스', 'instagram', 'reels', now() + interval '3 days', 'pending', 1, ${ctx.ownerId}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, created_by) values (${c.id}, 1, '아침 7시, 문을 열면 가장 먼저 반겨 주는 곳.', ${ctx.ownerId})`;
  try {
    await owner.goto(`${BASE}/s/marketing/automation`);
    const kit = owner.getByTestId('brand-video-E2E811 다짐'); await kit.waitFor();
    await kit.getByTestId('brand-video-method').selectOption('photos');
    await owner.getByText('영상 키트를 저장했습니다').first().waitFor();
    for (let k = 0; k < 20 && !(await sql`select 1 from mkt_brands where id = ${brand} and video->>'method' = 'photos'`).length; k++) await new Promise((r) => setTimeout(r, 250));
    assert.ok((await sql`select 1 from mkt_brands where id = ${brand} and video->>'method' = 'photos'`).length, '저장됨');
    await kit.getByTestId('brand-video-method-row').getByText(/현장 사진 3~6장을 천천히 움직여/).waitFor();
    await kit.getByTestId('brand-video-method-row').screenshot({ path: `${SHOTS}/811-brand-video-method.png` });
    // 275차 #809 상용화 시험(우리 회사 관리자): 요금제 기준 원가·승인률 한 줄 + 브랜드별 표
    await owner.getByTestId('auto-trial').waitFor();
    assert.match(await owner.getByTestId('auto-trial-summary').innerText(), /기준 · 이번 달 원가 [\d,]+원.* · 승인률 (-|\d+%)\(문턱 70%\)/);
    await owner.getByTestId('auto-trial-total').waitFor();
    await owner.goto(`${BASE}/s/marketing/approvals`);
    await owner.getByTestId('mkt-approvable-count').waitFor();
    const tabs = owner.getByTestId('mkt-brand-tabs');
    if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^E2E811 다짐/ }).click();
    const card = owner.getByTestId('approval-card').filter({ hasText: 'E2E811 아침 운동 릴스' }).first();
    const btn = card.getByTestId('approval-slideshow'); await btn.waitFor();
    assert.equal(await btn.innerText(), '실제 사진으로 영상 만들기 · 0원');
    await btn.click();
    await owner.getByText(/^쓸 수 있는 실제 사진이 0장입니다\. 3장 넘게 필요합니다/).first().waitFor({ timeout: 15000 });
    assert.equal((await sql`select count(*)::int n from mkt_briefs where content_id = ${c.id}`)[0].n, 0, '사진이 없으면 의뢰 안 만듦');
    // 273차 1) 앱 화면 녹화: [녹화 파일로 영상 만들기 · 0원] → 녹화가 없으면 안내
    await card.getByTestId('approval-screen').click();
    await card.getByTestId('approval-screen-empty').waitFor();
    assert.match(await card.getByTestId('approval-screen-empty').innerText(), /마케팅\/화면 녹화'에 녹화 파일이 없습니다/);
  } finally {
    await sql`delete from mkt_contents where id = ${c.id}`;
  }
}
