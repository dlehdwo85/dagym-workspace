// 대표 16:30 핫픽스: 안드로이드 대화방에서 키보드를 열면 입력창이 하단 탭 아래로 밀려 안 보임 → 대화방 열린 동안 하단 탭 숨김, 뷰포트가 줄어도(키보드 흉내: 높이 500) 입력창이 보임
import assert from 'node:assert/strict';
export async function chatKeyboard({ browser, desk, ctx, BASE, SHOTS }) {
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '키보드 시험방', userIds: [ctx.staffA.id] })).id;
  for (let i = 1; i <= 25; i++) await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: `키보드 메시지 ${i}` });
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await c.newPage();
  try {
    await m.goto(`${BASE}/messages`);
    await m.getByTestId('mobile-tabs').waitFor({ state: 'visible' });
    await m.goto(`${BASE}/messages?room=${room}`);
    await m.getByTestId('chat-messages').getByText('키보드 메시지 25').waitFor();
    assert.equal(await m.getByTestId('mobile-tabs').isVisible(), false, '대화방이 열리면 하단 탭 숨김');
    const vis = async () => { const b = await m.getByTestId('chat-input').boundingBox(); const h = m.viewportSize().height; return !!b && b.y >= 0 && b.y + b.height <= h + 1; };
    assert.ok(await vis(), '844: 입력창이 화면 안');
    // 키보드 흉내: 뷰포트 높이 500
    await m.setViewportSize({ width: 390, height: 500 });
    await m.getByTestId('chat-input').focus();
    await m.waitForTimeout(300);
    assert.ok(await vis(), '500(키보드 열림): 입력창이 화면 안');
    assert.equal(await m.getByTestId('mobile-tabs').isVisible(), false);
    await m.waitForFunction(() => { const el = document.querySelector('[data-testid="chat-messages"]'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 40; }, null, { timeout: 5000 });
    await m.screenshot({ path: `${SHOTS}/156-chat-keyboard-500.png` });
    await m.getByTestId('chat-input').fill('키보드 위에서 보냄'); await m.getByTestId('chat-send').tap();
    await m.getByTestId('chat-messages').getByText('키보드 위에서 보냄').waitFor();
    // 목록으로 돌아가면 탭 다시
    await m.setViewportSize({ width: 390, height: 844 });
    await m.getByLabel('목록으로').tap();
    await m.getByTestId('mobile-tabs').waitFor({ state: 'visible' });
  } finally { await c.close(); }
}
