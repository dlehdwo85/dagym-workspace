// V14 32-보정(대표 2026-10-14): 자료실에 올리면 "○○ → 폴더로 정리했어요 · 열기" 안내(토스트 + 진행 목록), 여러 개면 "n개 정리: 폴더 a · 폴더 b" 요약
import assert from 'node:assert/strict';

export async function libraryOrganizeNotice({ owner, BASE, FAKE, SHOTS }) {
  const organized = (folder) => ({ content: [{ type: 'text', text: JSON.stringify({ folder, tags: ['시험'], title: '', summary: '시험', confidence: 0.9, security: 'internal' }) }], stop_reason: 'end_turn' });
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [organized('인사/근로계약')] }) });
  await owner.goto(BASE + '/library');
  await owner.getByTestId('library-file').setInputFiles([{ name: '근로계약서 E2E.txt', mimeType: 'text/plain', buffer: Buffer.from('근로계약서 본문') }]);
  await owner.getByText(/근로계약서 E2E\.txt → 인사\/근로계약 으로 정리했어요/).waitFor();
  assert.ok(await owner.getByRole('button', { name: '열기' }).first().isVisible(), '토스트 열기 버튼');
  await owner.getByTestId('upload-note').filter({ hasText: '→ 인사/근로계약 으로 정리했어요' }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/122-library-organized-notice.png` });
  await owner.getByRole('button', { name: '열기' }).first().click();
  await owner.getByTestId('library-path').getByText('근로계약').waitFor();
  // 여러 개 → 요약
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [organized('운영/업무 보고'), organized('운영/업무 보고'), organized('재무/관리비')] }) });
  await owner.goto(BASE + '/library');
  await owner.getByTestId('library-file').setInputFiles([
    { name: '업무보고 1.txt', mimeType: 'text/plain', buffer: Buffer.from('a') }, { name: '업무보고 2.txt', mimeType: 'text/plain', buffer: Buffer.from('b') }, { name: '관리비.txt', mimeType: 'text/plain', buffer: Buffer.from('c') }]);
  await owner.getByText(/3개 정리: 업무 보고 2 · 관리비 1/).waitFor();
  assert.equal(await owner.getByTestId('upload-note').count(), 3, '파일마다 어디로 갔는지');
}
