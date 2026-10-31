// 292차 #804·#814(대표 10/29 결정) 자료실 보관 범위: 업무 공간 탭 '전체 · 회사 전체 · 우리 팀 · 내 파일' — 내 파일 탭에서 올리면 올릴 곳 기본 = 내 파일,
// 목록에 '내 파일' 표시, 회사 전체 탭에는 안 보임 · 다른 사람(직원)에게도 안 보임
import assert from 'node:assert/strict';

export async function libScope292({ owner, ctx, BASE }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/library?space=work`);
  await owner.getByTestId('library-scopes').waitFor();
  await owner.getByTestId('library-scope-mine').click();
  assert.equal(await owner.getByTestId('library-upload-to').inputValue(), 'mine', '내 파일 탭이면 올릴 곳 기본 = 내 파일');
  await owner.getByTestId('library-file').setInputFiles({ name: 'E2E 개인 메모.txt', mimeType: 'text/plain', buffer: Buffer.from('나만 보는 메모') });
  const row = owner.locator('li[data-file]').filter({ hasText: 'E2E 개인 메모' });
  await row.getByTestId('scope-mine').waitFor();
  await owner.getByTestId('library-scope-company').click();
  await owner.getByTestId('library-scope-company').and(owner.locator('[aria-selected="true"]')).waitFor();
  await owner.locator('li[data-file]').filter({ hasText: 'E2E 개인 메모' }).waitFor({ state: 'detached' });
  const staff = await ctx.staffA.client.ok('GET', '/api/library?space=work');
  assert.ok(!staff.files.some((f) => f.title.includes('E2E 개인 메모')), '직원 목록에도 없음');
}
