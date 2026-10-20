// 대표 10/20 23:40·23:55: 마감일 날짜 버튼 크기(시각 칩과 같은 높이, 한 줄 두 칸) + 업무 첨부 [자료실에서 가져오기](검색·체크·여러 개 → 연결, 타임라인 '자료실에서')
import assert from 'node:assert/strict';

export async function attachLibrary({ owner, ctx, BASE, SHOTS }) {
  const lf = await ctx.owner.ok('POST', '/api/library', { fileName: '현장 안내문 E2E.pdf', mimeType: 'application/pdf', size: 12, folder: '안내' });
  await fetch(BASE + lf.upload.url, { method: 'PUT', headers: lf.upload.headers, body: Buffer.from('%PDF-1.4 abc') });
  await ctx.owner.ok('POST', `/api/library/${lf.id}/complete`);
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 자료실 첨부 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.hq, approvalRequired: false })).id;
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks/${t}`);
  // 마감일 버튼: 높이 ≥ 32, 선택 창의 날짜 칸 높이 ≥ 36
  const due = owner.getByTestId('detail-due').getByTestId('due-picker'); await due.waitFor();
  const db = await due.boundingBox(); assert.ok(db && db.height >= 32, `마감일 버튼 높이 ${db?.height}`);
  await due.click();
  const row = owner.getByTestId('due-date-row'); await row.waitFor();
  const ib = await row.getByTestId('due-date-input').boundingBox(); assert.ok(ib && ib.height >= 36 && ib.width >= 150, `날짜 칸 ${ib?.width}×${ib?.height}`);
  await owner.keyboard.press('Escape');
  // 자료실에서 가져오기
  await owner.getByTestId('att-from-library').click();
  const pick = owner.getByTestId('lib-pick'); await pick.waitFor();
  await pick.getByTestId('lib-pick-q').fill('현장 안내문'); await pick.getByTestId('lib-pick-q').press('Enter');
  const item = pick.getByTestId('lib-pick-item').filter({ hasText: '현장 안내문 E2E' }); await item.waitFor();
  await item.getByRole('checkbox').check();
  await owner.screenshot({ path: `${SHOTS}/169-attach-from-library.png` });
  await pick.getByTestId('lib-pick-go').click();
  await owner.getByText(/자료실 파일 1건을 첨부/).waitFor();
  const att = owner.getByTestId('attachments'); await att.getByText('현장 안내문 E2E').first().waitFor();
  await att.getByText('자료실', { exact: true }).first().waitFor();
  const d = await ctx.owner.ok('GET', `/api/tasks/${t}`);
  assert.equal(d.attachments.length, 1); assert.equal(d.attachments[0].source, 'library');
  assert.ok(d.history.some((h) => h.action === 'file_attached' && h.changes?.from === 'library'), '타임라인 자료실에서 첨부');
  // 휴대폰
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/tasks/${t}`);
  await owner.getByTestId('att-from-library').waitFor();
  await owner.screenshot({ path: `${SHOTS}/169-attach-from-library-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
