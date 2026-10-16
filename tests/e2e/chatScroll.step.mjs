// V38 1 메시지방 흔들림: 휴대폰 390 — 위로 올려 보는 중 새 메시지가 와도 보던 자리 그대로·"새 메시지 n ↓" → 누르면 맨 아래, 맨 아래면 따라감, 화면 전체는 움직이지 않음
import assert from 'node:assert/strict';
export async function chatScroll({ browser, desk, ctx, BASE }) {
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '흔들림 시험방', userIds: [ctx.staffA.id] })).id;
  for (let i = 1; i <= 40; i++) await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: `지난 메시지 ${i}` });
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await c.newPage();
  try {
    await m.goto(`${BASE}/messages?room=${room}`);
    const list = m.getByTestId('chat-messages');
    await list.getByText('지난 메시지 40').waitFor();
    const gap = () => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
    await m.waitForFunction(() => { const el = document.querySelector('[data-testid="chat-messages"]'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 5; });
    // 위로 올려 보는 중
    await list.evaluate((el) => { el.scrollTop = 200; el.dispatchEvent(new Event('scroll')); });
    await m.waitForTimeout(200);
    const before = await list.evaluate((el) => el.scrollTop);
    const pageY = await m.evaluate(() => window.scrollY);
    await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '새로 온 메시지 A' });
    await m.getByTestId('chat-new-below').getByText('새 메시지 1 ↓').waitFor();
    assert.equal(await list.evaluate((el) => el.scrollTop), before, '보던 자리 그대로');
    assert.equal(await m.evaluate(() => window.scrollY), pageY, '화면 전체가 움직이지 않음');
    await m.getByTestId('chat-new-below').tap();
    await m.waitForFunction(() => { const el = document.querySelector('[data-testid="chat-messages"]'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 5; });
    assert.equal(await m.getByTestId('chat-new-below').count(), 0);
    // 맨 아래를 보고 있으면 새 메시지를 따라감
    await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '새로 온 메시지 B' });
    await list.getByText('새로 온 메시지 B').waitFor();
    await m.waitForTimeout(300);
    assert.ok((await gap()) < 5, '맨 아래 따라감');
    assert.equal(await m.getByTestId('chat-new-below').count(), 0);
  } finally { await c.close(); }
}
