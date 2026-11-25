// #1181-2(대표 11/26 '승인함 4건이 아니라 3건으로 보였다'): 기타(광고 문구)는 '글 시안'으로 바로 [승인] · 수정 요청 칸의 사진 필요 글은
// 승인함 위쪽 '사진 필요 n건' 줄과 묶음으로 함께 보임(머리줄 '승인할 시안 1건 사진 필요 1건')
import assert from 'node:assert/strict';

export async function mktText1181({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 글시안 브랜드' })).id;
  const ad = await ctx.owner.ok('POST', '/api/marketing/contents', { title: 'E2E 파워링크 문구', channel: 'other', mode: 'ad', brandId: brand, body: '사무실 일정, 한 화면에서.\n14일 무료 체험.', mediaIds: [] });
  const blog = await ctx.owner.ok('POST', '/api/marketing/contents', { title: 'E2E 사진 없는 블로그', channel: 'blog', brandId: brand, body: '■ 소제목\n본문 첫 줄입니다.', mediaIds: [] });
  assert.equal((await sql`select status from mkt_contents where id = ${blog.id}`)[0].status, 'changes');

  await owner.setViewportSize({ width: 1366, height: 1100 });
  await owner.goto(`${BASE}/s/marketing/approvals`);
  await owner.getByTestId('mkt-approvable-count').waitFor();
  const tabs = owner.getByTestId('mkt-brand-tabs');
  if (await tabs.waitFor({ timeout: 5000 }).then(() => true, () => false)) await tabs.getByRole('button', { name: /^E2E 글시안 브랜드/ }).click();
  const head = owner.getByTestId('mkt-approvable-count');
  await owner.waitForFunction(() => /사진 필요 1건/.test(document.querySelector('[data-testid="mkt-approvable-count"]')?.textContent ?? ''), null, { timeout: 15000 });
  assert.match(await head.innerText(), /승인할 시안 1건[\s\S]*사진 필요 1건/, '머리줄에 사진 필요 수도 함께');
  const need = owner.getByTestId('mkt-photo-need');
  assert.match(await need.locator(':scope > summary').innerText(), /사진 필요 1건/);
  const row = need.getByTestId('mkt-photo-need-row').filter({ hasText: 'E2E 사진 없는 블로그' });
  assert.match(await row.innerText(), /블로그는 표지 1장 \+ 본문 사진 1장 이상 필요/);
  const card = owner.getByTestId('approval-card').filter({ hasText: 'E2E 파워링크 문구' });
  assert.match(await card.getByTestId('approval-no-media').innerText(), /글 시안[\s\S]*글만으로 승인할 수 있습니다/);
  assert.equal(await card.getByTestId('approval-no-media').getAttribute('data-blocked'), null, '막힘 아님');
  await owner.screenshot({ path: `${SHOTS}/1181-approvals-text-photo.png`, fullPage: false });
  await card.getByTestId('card-approve').click();
  for (let i = 0; i < 40; i++) { if ((await sql`select status from mkt_contents where id = ${ad.id}`)[0].status === 'approved') break; await owner.waitForTimeout(250); }
  assert.equal((await sql`select status from mkt_contents where id = ${ad.id}`)[0].status, 'approved', '글 시안 승인');
}
