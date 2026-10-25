// 154차 #615 ②·④(대표 10/25 '파일 상세에서 뒤로가기 단추가 없어 헤맴' · 로컬 18:00 ④ 얼굴 사진 촬영 동의 경고):
// 자료실 사진은 새 탭 대신 앱 안 보기창([← 목록]·내려받기·새 탭, 뒤로가기로 닫힘) · 얼굴 나온 실사 배지 + 보기창 경고 · 문서 화면 [← 목록] → 그 폴더로 돌아가 줄 강조
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function libraryDetail({ owner, ctx, sql, BASE, SHOTS }) {
  const png = await readFile('public/favicon-32.png');
  const name = 'E2E 얼굴 사진.png'; // 자료실 제목은 확장자를 뗀 'E2E 얼굴 사진'
  let fileId = null, docId = null;
  try {
    await owner.goto(`${BASE}/library`);
    await owner.getByTestId('library-file').setInputFiles({ name, mimeType: 'image/png', buffer: png });
    const list = owner.getByTestId('library-list');
    const row = list.locator('li').filter({ hasText: 'E2E 얼굴 사진' }).first();
    await row.waitFor();
    fileId = await row.getAttribute('data-file');
    assert.ok(fileId, '올린 파일 줄');
    // AI 설명이 '얼굴 있음'으로 판정한 것처럼
    await sql`update library_files set vision = ${sql.json({ v: 1, at: new Date().toISOString(), caption: '회원이 운동하는 사진', scene: '', tags: [], kind: 'photo', text: 'none', promo: false, seen: '', people: 1, faces: true, quality: 'good' })} where id = ${fileId}::uuid`;
    await owner.reload();
    const row2 = list.locator(`[data-file="${fileId}"]`); await row2.waitFor();
    await row2.getByTestId('photo-faces').waitFor();
    // 제목 클릭 → 새 탭이 아니라 앱 안 보기창(주소에 ?file=)
    await row2.getByTestId('media-open').click();
    const viewer = owner.getByTestId('library-viewer'); await viewer.waitFor();
    await viewer.getByTestId('library-viewer-faces').waitFor();
    await owner.waitForURL(/[?&]file=/);
    await owner.screenshot({ path: `${SHOTS}/300-library-viewer.png` });
    await viewer.getByTestId('library-viewer-back').click();
    await viewer.waitFor({ state: 'detached' });
    await list.waitFor();
    assert.equal(await list.locator(`[data-file="${fileId}"]`).count(), 1, '[← 목록] 뒤 같은 목록(폴더 유지)');
    // 다시 열고 브라우저 뒤로가기로도 닫힘
    await row2.getByTestId('media-open').click(); await viewer.waitFor();
    await owner.goBack(); await viewer.waitFor({ state: 'detached' });
    // 문서 화면 [← 목록] → 그 폴더 + 줄 강조
    const d = await ctx.owner.ok('POST', '/api/library/docs', { title: 'E2E 뒤로가기 문서', folder: '' }); docId = d.id;
    await owner.goto(`${BASE}/library/doc/${docId}`);
    await owner.getByTestId('doc-back').click();
    await owner.waitForURL(new RegExp(`/library\\?folder=&file=${docId}`));
    const drow = owner.getByTestId('library-list').locator(`[data-file="${docId}"]`); await drow.waitFor();
    assert.match(await drow.getAttribute('class'), /bg-amber-50|ring-2/, '돌아온 줄 강조');
  } finally {
    await sql`update library_files set deleted_at = now() where tenant = 'default' and (id = ${fileId}::uuid or id = ${docId}::uuid or title like 'E2E %') and deleted_at is null`.catch(() => {});
  }
}
