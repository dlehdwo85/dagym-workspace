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
  // 336차(대표 11/02 17:3x ①): 줄을 누르면 오른쪽 미리보기(PDF 첫 장 틀 · 파일 정보 · 본문 앞부분 · [새 탭에서 열기]) · 패널 [이 파일 선택] → 체크
  await item.getByTestId('lib-pick-view').click();
  const pv = pick.getByTestId('lib-preview'); await pv.waitFor();
  assert.equal(await pv.getAttribute('data-kind'), 'pdf');
  await pv.getByTestId('lib-preview-media').waitFor();
  await pv.getByTestId('lib-preview-info').getByText(/PDF/).first().waitFor();
  await pv.getByTestId('lib-preview-text').getByText('불러오는 중', { exact: false }).waitFor({ state: 'hidden' });
  assert.equal((await pv.getByTestId('lib-preview-open').textContent())?.trim(), '새 탭에서 열기');
  const lb = await pick.getByTestId('lib-pick-list').boundingBox(); const vb = await pv.boundingBox();
  assert.ok(lb && vb && vb.x >= lb.x + lb.width - 1, `PC 에서는 미리보기가 목록 오른쪽에 ${JSON.stringify([lb, vb])}`);
  assert.equal(await item.getByRole('checkbox').isChecked(), false, '미리보기만으로는 선택되지 않음');
  await pv.getByTestId('lib-preview-pick').click();
  assert.equal(await item.getByRole('checkbox').isChecked(), true, '패널 [이 파일 선택] → 체크');
  await pv.getByTestId('lib-preview-pick').getByText('선택 해제').waitFor();
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
  // 336차 휴대폰: 줄을 누르면 목록 자리에 미리보기 · [‹ 목록]으로 돌아감
  await owner.getByTestId('att-from-library').click();
  const pick2 = owner.getByTestId('lib-pick'); await pick2.waitFor();
  await pick2.getByTestId('lib-pick-q').fill('현장 안내문'); await pick2.getByTestId('lib-pick-q').press('Enter');
  const item2 = pick2.getByTestId('lib-pick-item').filter({ hasText: '현장 안내문 E2E' }); await item2.waitFor();
  await item2.getByTestId('lib-pick-view').click();
  const pv2 = pick2.getByTestId('lib-preview'); await pv2.waitFor();
  await pick2.getByTestId('lib-pick-list').waitFor({ state: 'hidden' });
  await owner.screenshot({ path: `${SHOTS}/336-lib-preview-390.png` });
  await pv2.getByTestId('lib-preview-back').click();
  await pick2.getByTestId('lib-pick-list').waitFor();
  await owner.keyboard.press('Escape');
  await owner.setViewportSize({ width: 1366, height: 900 });
}
