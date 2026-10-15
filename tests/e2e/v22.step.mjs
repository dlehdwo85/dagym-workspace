// V22 AI 비서 문서 엔진: 대화 → 파일 작업 카드(만드는 중 → 미리보기·쪽수) → [자료실에 저장] → [더 다듬기] 입력 채움 / 관리 > 회사 정보 (가짜 Anthropic 서버)
import assert from 'node:assert/strict';
export async function v22({ owner, ctx, sql, BASE, FAKE, SHOTS }) {
  const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  // 회사 정보 화면
  await owner.goto(BASE + '/admin/company');
  await owner.getByTestId('company-new').click();
  const form = owner.getByTestId('company-form');
  await form.getByLabel('구분 키').fill('e2eco');
  await form.getByLabel('상호', { exact: true }).fill('시험상호 이투이');
  await form.getByRole('button', { name: '저장' }).click();
  await owner.getByTestId('company-list').getByText('시험상호 이투이').waitFor();

  await ctl({ anthropicReset: true, anthropicFiles: { e2e_out: { filename: '이투이 안내문.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', b64: Buffer.from('PK e2e docx').toString('base64') },
    e2e_pv: { filename: 'preview.png', mime: 'image/png', b64: png.toString('base64') } },
    anthropicQueue: [
      { content: [{ type: 'tool_use', id: 'e1', name: 'run_file_task', input: { mode: 'create', kind: 'docx', title: '이투이 안내문', instructions: '휴관 안내 1페이지', company: 'e2eco' } }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: '안내문을 만드는 중입니다.' }], stop_reason: 'end_turn' },
      { content: [
        { type: 'server_tool_use', id: 's1', name: 'bash_code_execution', input: { command: 'python make.py' } },
        { type: 'bash_code_execution_tool_result', tool_use_id: 's1', content: { type: 'bash_code_execution_result', stdout: '', stderr: '', return_code: 0, content: [{ type: 'bash_code_execution_output', file_id: 'e2e_out' }, { type: 'bash_code_execution_output', file_id: 'e2e_pv' }] } },
        { type: 'text', text: '휴관 안내문을 만들었습니다.\nPAGES: 1' }], stop_reason: 'end_turn' }] });
  await owner.goto(BASE + '/assistant');
  const box = owner.getByLabel('AI 에게 요청', { exact: true });
  await owner.getByTestId('ai-enter-hint').waitFor(); // 화면 준비(hydration) 뒤 입력
  await box.fill('휴관 안내문 만들어줘');
  await box.press('Enter');
  await owner.getByTestId('ai-user-msg').last().waitFor();
  const card = owner.getByTestId('doc-job').last();
  await card.waitFor();
  await owner.waitForFunction(() => [...document.querySelectorAll('[data-testid=doc-job]')].pop()?.getAttribute('data-status') === 'done', null, { timeout: 30000 });
  await card.getByTestId('doc-job-preview').waitFor();
  assert.match(await card.innerText(), /1쪽/);
  await card.getByTestId('doc-job-preview').click();
  await owner.getByTestId('doc-job-preview-big').waitFor();
  await owner.keyboard.press('Escape');
  await owner.getByTestId('doc-job-preview-big').waitFor({ state: 'detached' });
  assert.equal(await card.getByTestId('doc-job-download').getAttribute('href') !== null, true);
  await owner.screenshot({ path: `${SHOTS}/v22-doc-card.png` });
  await card.getByTestId('doc-job-save').click();
  await card.getByText('자료실에 저장됨').waitFor();
  const saved = await sql`select f.title as name, f.folder from library_files f join ai_doc_jobs j on j.saved_file_id = f.id where j.title = '이투이 안내문'`;
  assert.equal(saved.length, 1); assert.equal(saved[0].name, '이투이 안내문'); assert.equal(saved[0].folder, 'AI 문서');
  await card.getByTestId('doc-job-refine').click();
  assert.match(await box.inputValue(), /「이투이 안내문」 v1을/);

  // 대화 다시 열어도 카드 유지
  await owner.reload();
  await owner.getByTestId('doc-job').last().waitFor();
  await owner.getByTestId('doc-job').last().getByText('자료실에 저장됨').waitFor();
  await ctl({ anthropicReset: true });
}
