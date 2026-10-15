// V24 음성 등록: AI 비서 마이크(화면·패널) — 말하는 동안 입력창에 실시간 글자 → 끝나면 회사 단어장 보정 → 입력창에 남기고 바로 보내지 않음 / 문구 "음성 등록" (가짜 브라우저 음성 인식)
import assert from 'node:assert/strict';
const FAKE_SR = () => {
  class FakeSR {
    start() {
      const res = (t, fin, alts = []) => { const r = [{ transcript: t }, ...alts.map((a) => ({ transcript: a }))]; r.isFinal = fin; return r; };
      setTimeout(() => this.onresult?.({ results: [res('최매니져 점검', false)] }), 150);
      setTimeout(() => this.onresult?.({ results: [res('최매니져 점검 일정 알려줘', true, ['최 매니저 점검 일정 알려줘'])] }), 600);
      setTimeout(() => this.onend?.(), 700);
    }
    stop() { this.onend?.(); }
  }
  window.SpeechRecognition = FakeSR;
};
export async function v24({ browser, desk, BASE, sql }) {
  const c = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await c.addInitScript(FAKE_SR);
  const p = await c.newPage();
  try {
    const n0 = (await sql`select count(*)::int n from ai_messages`)[0].n;
    await p.goto(BASE + '/assistant');
    await p.getByTestId('ai-enter-hint').waitFor();
    const box = p.getByLabel('AI 에게 요청', { exact: true });
    await box.fill('먼저 쓴 글');
    await p.getByRole('button', { name: '음성으로 요청' }).click();
    await p.waitForFunction(() => /최매니져 점검/.test(document.querySelector('textarea[aria-label="AI 에게 요청"]')?.value ?? ''));
    await p.waitForFunction(() => document.querySelector('textarea[aria-label="AI 에게 요청"]')?.value === '먼저 쓴 글 최매니저 점검 일정 알려줘');
    assert.equal((await sql`select count(*)::int n from ai_messages`)[0].n, n0, '바로 보내지 않음');
    // 패널(✨)에도 마이크
    await p.goto(BASE + '/tasks');
    await p.getByTestId('ai-dock-open').click();
    const dock = p.getByLabel('AI 에게 요청 (화면 맥락)');
    await dock.waitFor();
    await p.getByTestId('ai-dock').getByRole('button', { name: '음성으로 요청' }).click();
    await p.waitForFunction(() => document.querySelector('textarea[aria-label="AI 에게 요청 (화면 맥락)"]')?.value === '최매니저 점검 일정 알려줘');
    // 문구: 음성 등록
    await p.goto(BASE + '/help');
    assert.ok(!(await p.locator('body').innerText()).includes('말로 등록'));
  } finally { await c.close(); }
}
