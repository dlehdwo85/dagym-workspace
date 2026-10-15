// V30 P1 ① 엑셀·CSV 업무 가져오기 화면: PC 표 미리보기·담당자 고르기·만들기·되돌리기, 휴대폰 카드 미리보기
import assert from 'node:assert/strict';
export async function v30import({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks`);
  const me = await owner.evaluate(async () => (await (await fetch('/api/auth/me')).json()).user);
  const csv = `﻿제목,담당자,마감일,우선순위,상태,설명\n월간 안전 점검표 제출,${me.name},2026-11-03,높음,진행 전,사진 첨부\n소방 설비 견적 받기,모르는사람,11/10,긴급,,업체 3곳\n회원 이용 현황 정리,${me.name},날짜아님,보통,진행 중,\n`;
  const file = { name: '업무_가져오기.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') };
  await owner.getByTestId('task-import-open').click();
  await owner.waitForURL(/\/tasks\/import$/);
  await owner.getByTestId('import-file').setInputFiles(file);
  await owner.getByTestId('import-preview').waitFor();
  assert.equal(await owner.getByTestId('map-title').inputValue(), '0');
  assert.equal(await owner.getByTestId('map-assignee').inputValue(), '1');
  await owner.getByTestId('import-unmatched').getByText('모르는사람').waitFor();
  await owner.getByTestId('count-errors').getByText('오류 1').waitFor();
  await owner.getByTestId('unmatched-select').selectOption(me.id);
  await owner.getByTestId('count-ready').getByText('만들 업무 2').waitFor();
  await owner.screenshot({ path: `${SHOTS}/v30-import-pc.png`, fullPage: true });
  await owner.getByTestId('import-run').click();
  await owner.getByTestId('import-done').getByText('업무 2건을 만들었습니다').waitFor();
  await owner.screenshot({ path: `${SHOTS}/v30-import-done.png` });
  owner.once('dialog', (d) => d.accept());
  await owner.getByTestId('import-undo').click();
  await owner.getByTestId('import-done').getByText('휴지통으로 옮겼습니다').waitFor();
  // 휴대폰: 같은 파일 → 카드 미리보기
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/tasks/import`);
  await owner.getByTestId('import-file').setInputFiles(file);
  await owner.getByTestId('preview-card').first().waitFor();
  assert.equal(await owner.getByTestId('preview-card').count(), 3);
  const sw = await owner.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= 392, `휴대폰 가로 넘침 ${sw}`);
  await owner.screenshot({ path: `${SHOTS}/v30-import-phone.png`, fullPage: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
}

/** 로컬 실기기 83: 휴대폰 업무 상세 → 문자·메일 시안 시트가 스크롤되고, 댓글 입력줄이 버튼 줄을 가리지 않음 */
export async function sheetPhone({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 390, height: 700 });
  const t = await owner.evaluate(async () => (await (await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '시트 스크롤 시험', approvalRequired: false }) })).json()));
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('comment-form').waitFor();
  await owner.getByTestId('mail-compose-open').click();
  await owner.getByTestId('mail-compose').waitFor();
  assert.equal(await owner.getByTestId('comment-form').isVisible(), false, '시트가 열린 동안 댓글 입력줄 숨김');
  for (const ch of ['email', 'sms']) {
    if (ch === 'sms') await owner.getByTestId('mail-channel-sms').click();
    const bar = owner.getByTestId('compose-actions');
    const box = await bar.boundingBox(); const dlg = await owner.getByRole('dialog').boundingBox();
    assert.ok(box && box.y + box.height <= Math.min(700, dlg.y + dlg.height) + 4 && box.y > 300, `${ch}: 버튼 줄이 화면 아래에 보임 (${box?.y}+${box?.height}, 시트 끝 ${dlg.y + dlg.height})`);
    const scrolled = await owner.getByRole('dialog').evaluate((d) => { d.scrollTop = 10000; return d.scrollTop > 0 || d.scrollHeight <= d.clientHeight; });
    assert.ok(scrolled, `${ch}: 시트 스크롤`);
  }
  await owner.screenshot({ path: `${SHOTS}/v31-sheet-phone.png` });
  await owner.keyboard.press('Escape');
  await owner.getByTestId('comment-form').waitFor();
  await owner.evaluate(async (id) => { await fetch(`/api/tasks/${id}`, { method: 'DELETE' }); }, t.id);
  await owner.setViewportSize({ width: 1366, height: 900 });
}
