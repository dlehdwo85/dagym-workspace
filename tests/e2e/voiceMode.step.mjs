// V38 3 음성 대화(운전 중): 메시지방 음성 모드 = 새 메시지 읽어 주기 + 말로 보내기("보낼까요?" → "보내" 음성 확인), AI 비서 음성 모드 = 말로 묻기 → 답 읽어 주기
import assert from 'node:assert/strict';
// 가짜 인식기: 시험이 window.__srQueue 에 넣은 말을 다음 듣기에서 한 번 들려주고, 없으면 조용히 끝남(실제 휴대폰처럼)
const FAKE_SR = () => {
  window.__srQueue = [];
  class FakeSR {
    start() {
      const t = window.__srQueue.shift();
      const res = (x) => { const r = [{ transcript: x }]; r.isFinal = true; return r; };
      if (t) { setTimeout(() => this.onresult?.({ results: [res(t)] }), 150); setTimeout(() => this.onend?.(), 400); }
      else setTimeout(() => this.onend?.(), 500);
    }
    stop() { this.onend?.(); }
  }
  window.SpeechRecognition = FakeSR;
};
export async function voiceMode({ browser, desk, ctx, sql, BASE, FAKE }) {
  // 이직원(staffA) 대화 목록은 건드리지 않음 — 뒤 메신저 시험이 그 목록에서 "김대표" 방을 누른다
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '음성 모드 시험방', userIds: [ctx.staffB.id] })).id;
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await c.addInitScript(FAKE_SR);
  const m = await c.newPage();
  try {
    await m.goto(`${BASE}/messages?room=${room}`);
    await m.getByTestId('chat-room').waitFor();
    await m.getByTestId('chat-voice').tap();
    await m.getByTestId('chat-voice-panel').waitFor();
    // 새 메시지 → "이름: 내용"으로 읽어 줌
    const [sa] = await sql`select name from users where id = ${ctx.staffB.id}`;
    await ctx.staffB.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '3시 미팅 장소가 바뀌었습니다' });
    await m.waitForFunction((t) => (window.__spoken ?? []).includes(t), `${sa.name}: 3시 미팅 장소가 바뀌었습니다`, { timeout: 20_000 });
    // 말로 보내기: 말함 → 읽어 주고 "보낼까요?" → "보내" → 전송
    await m.evaluate(() => window.__srQueue.push('현장에 도착했습니다'));
    await m.getByTestId('chat-voice-talk').tap();
    await m.getByTestId('chat-voice-heard').getByText('현장에 도착했습니다').waitFor({ timeout: 30_000 });
    await m.evaluate(() => window.__srQueue.push('보내'));
    await m.waitForFunction(() => (window.__spoken ?? []).includes('보냈습니다'), null, { timeout: 40_000 });
    assert.equal((await sql`select count(*)::int n from chat_messages where room_id = ${room} and body = '현장에 도착했습니다'`)[0].n, 1, '음성 확인 후 한 번만 전송');
    await m.getByTestId('chat-messages').getByText('현장에 도착했습니다').waitFor();
    // "취소"면 보내지 않음
    await m.evaluate(() => window.__srQueue.push('잘못 말한 메시지'));
    await m.getByTestId('chat-voice-talk').tap();
    await m.getByTestId('chat-voice-heard').waitFor({ timeout: 30_000 });
    await m.evaluate(() => window.__srQueue.push('취소'));
    await m.waitForFunction(() => (window.__spoken ?? []).includes('취소했습니다'), null, { timeout: 40_000 });
    assert.equal((await sql`select count(*)::int n from chat_messages where room_id = ${room} and body = '잘못 말한 메시지'`)[0].n, 0);
    // AI 비서 음성 모드: 말로 묻고 답을 읽어 줌
    await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: '오늘 남은 업무는 **2건**입니다.' }], stop_reason: 'end_turn' }] }) });
    await m.goto(`${BASE}/assistant`);
    await m.getByTestId('ai-voice-toggle').tap();
    await m.evaluate(() => window.__srQueue.push('오늘 남은 업무 알려 줘'));
    await m.getByTestId('ai-voice-talk').tap();
    await m.waitForFunction(() => (window.__spoken ?? []).includes('오늘 남은 업무는 2건입니다.'), null, { timeout: 40_000 });
  } finally { await c.close(); }
}
