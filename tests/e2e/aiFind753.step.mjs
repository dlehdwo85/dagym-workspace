// #753(로컬 10/28 17:25, 대표 'AI 비서에게 자료실에서 필요한 자료를 찾아 달라고 하면 찾아 주는 기능'): AI 비서 답 아래 자료 카드 —
// [열기](자료실 그 폴더·그 파일 강조) · [내려받기] · [업무에 붙이기](입력칸에 첨부 부탁 글) · 패널(✨)도 같음 (가짜 AI 서버 — 실제 모델이 고르는 말은 로컬 확인)
import assert from 'node:assert/strict';

export async function aiFind753({ owner, ctx, BASE, FAKE, SHOTS }) {
  const q = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
  const toolUse = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use' });
  const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
  const init = await ctx.owner.ok('POST', '/api/library', { fileName: 'E2E753 로고 원본.txt', mimeType: 'text/plain', size: 5, folder: 'E2E753/디자인' });
  await fetch(BASE + init.upload.url, { method: 'PUT', headers: init.upload.headers, body: Buffer.from('hello') });
  await ctx.owner.ok('POST', `/api/library/${init.id}/complete`);
  const id = init.id;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(BASE + '/assistant');
    const box = owner.getByLabel('AI 에게 요청', { exact: true });
    await box.fill('E2E753 로고 원본 파일 찾아줘');
    await q([toolUse('f1', 'search_library', { query: 'E2E753 로고 원본 파일' }), say('자료실에서 「E2E753 로고 원본」을 찾았습니다. 아래 카드에서 열거나 내려받을 수 있어요.')]);
    await box.press('Enter');
    const cards = owner.getByTestId('ai-found-files').last(); await cards.waitFor();
    const card = cards.getByTestId('ai-found-file');
    assert.equal(await card.count(), 1);
    assert.match(await card.innerText(), /E2E753 로고 원본[\s\S]*E2E753\/디자인/);
    const open = card.getByRole('link', { name: '열기' });
    assert.equal(await open.getAttribute('href'), `/library?${new URLSearchParams({ folder: 'E2E753/디자인', file: id })}`);
    assert.equal(await card.getByRole('link', { name: '내려받기' }).getAttribute('href'), `/api/library/${id}/download`);
    await card.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/586-ai-found-files.png`, clip: await cards.boundingBox() });
    // [업무에 붙이기] = 입력칸에 부탁 글(업무 이름만 이어 쓰면 AI 가 첨부 제안)
    await card.getByTestId('ai-found-attach').click();
    assert.equal(await box.inputValue(), "'E2E753 로고 원본' 자료를 업무에 첨부해 줘 — 업무: ");
    await box.fill('');
    // [열기] → 자료실 그 폴더에서 그 파일 줄 강조
    await open.click();
    await owner.waitForURL(/\/library\?/);
    const row = owner.locator(`[data-file="${id}"]`); await row.waitFor();
    assert.match(await row.getAttribute('class'), /bg-amber-50/, '찾은 파일 줄 강조');
    // 패널(✨)도 같은 카드
    await owner.goto(BASE + '/tasks');
    await owner.getByTestId('ai-dock-open').click();
    const dock = owner.getByTestId('ai-dock');
    const db = dock.getByLabel('AI 에게 요청 (화면 맥락)');
    await db.fill('E2E753 로고 찾아줘');
    await q([toolUse('f2', 'search_library', { query: 'E2E753 로고' }), say('「E2E753 로고 원본」 파일이 있습니다.')]);
    await db.press('Enter');
    await dock.getByTestId('ai-found-file').filter({ hasText: 'E2E753 로고 원본' }).waitFor();
    await owner.keyboard.press('Escape');
  } finally {
    await ctx.owner.req('DELETE', `/api/library/${id}`);
  }
}
