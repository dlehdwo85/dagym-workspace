// AI 동의(대표 11/19 결정 — 애플 11/15 반려 5.1.2): 바깥 AI 로 보내기 전에 무엇을·어디로·왜 보내는지 알리고 허락받기
// ① 아직 정하지 않은 사람은 들어오면 동의 창(무엇을·어디로·왜·동의하지 않으면, 받는 곳 = Anthropic) ② [나중에 정하기] → 이 기기에서는 다시 안 뜸
// ③ 동의하지 않은 사람이 AI 를 누르면 짧은 안내 → [내용 보고 정하기] → [AI 기능 쓰기] → AI 가 답함 ④ 설정 › 개인정보·AI 에서 끄고 다시 켜기
// ⑤ 관리 › 회사 정보의 '회사 자료 자동 AI 처리' ⑥ 휴대폰 폭에서 넘침 없음. (시험 서버는 '아직 정하지 않음'을 동의함으로 보므로, 들어올 때 뜨는 창은 상태 응답만 바꿔서 봄)
// 대표 11/23 #1087: 웹·안드로이드는 필수 동의 — ⓪ 아직 동의하지 않은 사람(정하지 않음·쓰지 않기)은 닫을 수 없는 동의 화면([동의하고 계속]·[로그아웃]) ·
// 설정은 [필수]·끄기 없음. ①~⑥ 의 예전(선택) 흐름은 아이폰 앱(1.2.0 심사 통과 전까지 그대로)으로 — 앱 표시(WorkInApp) 붙은 창에서 봄
import assert from 'node:assert/strict';

export async function aiConsent({ owner: web, browser, BASE, FAKE, SHOTS }) {
  await aiConsentRequired({ web, BASE, SHOTS });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await web.context().storageState(),
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WorkInApp' });
  const owner = await ctx.newPage();
  try { await aiConsentIos({ owner, BASE, FAKE, SHOTS }); } finally { await ctx.close(); }
}

/** #1087 웹(필수): 들어오면 닫을 수 없는 동의 화면 · 쓰지 않기로 했던 사람도 다시 · 설정은 [필수]·끄기 없음 · [내용 다시 보기]는 닫기만 */
async function aiConsentRequired({ web, BASE, SHOTS }) {
  const put = (agreed) => web.evaluate((a) => fetch('/api/account/ai-consent', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agreed: a }) }).then((r) => r.json()), agreed);
  let fakeNone = true;
  const route = (r) => (fakeNone && r.request().method() === 'GET' ? r.fulfill({ json: { state: 'none', at: null, version: '2026-11', stt: false } }) : r.continue());
  await web.route('**/api/account/ai-consent', route);
  try {
    await web.setViewportSize({ width: 1366, height: 900 });
    await web.goto(BASE + '/tasks');
    const req = web.getByTestId('ai-consent-required');
    await req.waitFor({ timeout: 15000 });
    const dlg = web.getByRole('dialog', { name: 'AI 기능 이용 동의(필수)' });
    assert.equal(await dlg.count(), 1, '필수 동의 창 제목');
    assert.equal(await dlg.getByRole('button', { name: '닫기' }).count(), 0, '닫기 단추 없음');
    for (const t of ['ai-consent-later', 'ai-consent-refuse']) assert.equal(await web.getByTestId(t).count(), 0, `${t} 없음(나중에·쓰지 않기 없음)`);
    await web.getByTestId('ai-consent-logout').waitFor(); // [로그아웃]은 있음(누르지는 않음 — 뒤 단계가 이 로그인을 씀)
    await web.keyboard.press('Escape'); await web.waitForTimeout(200);
    assert.equal(await req.isVisible(), true, 'Esc 로 안 닫힘');
    await web.mouse.click(5, 5); await web.waitForTimeout(200);
    assert.equal(await req.isVisible(), true, '바깥을 눌러도 안 닫힘');
    assert.match(await req.getByTestId('ai-consent-required-lead').innerText(), /워크인을 계속 쓰려면/);
    await req.getByTestId('ai-consent-more').locator('summary').click();
    await req.getByText('AI 처리는 워크인의 핵심 기능이라 꼭 동의를 받습니다.').waitFor();
    await req.getByText('AI 처리는 워크인의 핵심 기능이라, 동의하지 않으면 워크인을 쓸 수 없습니다.').waitFor();
    assert.equal(await req.getByText('동의하지 않아도 업무·일정·메신저·결재는 그대로 씁니다.').count(), 0, '선택일 때의 문장은 없음');
    assert.match(await req.getByTestId('ai-consent-transfer').innerText(), /받는 곳·나라: Anthropic\(미국\)/, '국외 이전 고지');
    await web.screenshot({ path: `${SHOTS}/ai-consent-required.png` });
    await web.setViewportSize({ width: 390, height: 844 });
    assert.ok(await web.evaluate(() => document.documentElement.scrollWidth <= 390), '390 가로 넘침 없음');
    const b = await web.getByTestId('ai-consent-required-agree').boundingBox();
    assert.ok(b && b.y + b.height <= 844, '[동의하고 계속]이 화면 안에 보임');
    await web.screenshot({ path: `${SHOTS}/ai-consent-required-mobile.png` });
    await web.setViewportSize({ width: 1366, height: 900 });
    fakeNone = false;
    await web.getByTestId('ai-consent-required-agree').click();
    await req.waitFor({ state: 'hidden' });
    // 예전에 '쓰지 않기'로 정한 사람도 들어오면 다시 필수 동의 화면
    assert.equal((await put(false)).state, 'declined');
    await web.goto(BASE + '/tasks');
    await req.waitFor({ timeout: 15000 });
    await web.getByTestId('ai-consent-required-agree').click();
    await req.waitFor({ state: 'hidden' });
    // 설정 › 개인정보·AI: [필수] · 끄기 없음 · 탈퇴 안내 · [내용 다시 보기]는 닫기만
    await web.goto(BASE + '/settings');
    const set = web.getByTestId('ai-consent-setting');
    await set.scrollIntoViewIfNeeded();
    await set.getByText('[필수]').waitFor();
    assert.equal(await web.getByTestId('ai-consent-toggle').count(), 0, '끄기 없음');
    assert.match(await set.getByTestId('ai-consent-required-note').innerText(), /끌 수 없습니다[\s\S]*탈퇴/);
    assert.match(await set.innerText(), /동의/);
    await set.getByTestId('ai-consent-review').click();
    await web.getByTestId('ai-consent').waitFor();
    assert.equal(await web.getByTestId('ai-consent-refuse').count(), 0, '다시 보기 창에 쓰지 않기 없음');
    await web.getByTestId('ai-consent-close').click();
    await web.getByTestId('ai-consent').waitFor({ state: 'hidden' });
  } finally {
    await web.unroute('**/api/account/ai-consent', route);
    await put(true).catch(() => {});
  }
}

/** 아이폰 앱(심사 통과 전까지 예전 그대로 — 선택): ①~⑥ */
async function aiConsentIos({ owner, BASE, FAKE, SHOTS }) {
  const q = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
  const say = (text) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
  const put = (agreed) => owner.evaluate((a) => fetch('/api/account/ai-consent', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agreed: a }) }).then((r) => r.json()), agreed);
  let fakeNone = true; // 들어올 때: 아직 정하지 않은 사람처럼
  const route = (r) => (fakeNone && r.request().method() === 'GET' ? r.fulfill({ json: { state: 'none', at: null, version: '2026-11', stt: false } }) : r.continue());
  await owner.route('**/api/account/ai-consent', route);
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(BASE + '/privacy'); // 새 창(빈 페이지)은 저장소를 못 읽음 — 같은 사이트의 앱 틀 없는 화면을 먼저
    await owner.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('wos_ai_later_')) localStorage.removeItem(k); });
    // ① 들어오면 동의 창
    await owner.goto(BASE + '/tasks');
    const box = owner.getByTestId('ai-consent');
    await box.waitFor({ timeout: 15000 });
    // 대표 11/20 #1086 '약관처럼 상세를 접어서': 펼치지 않아도 보이는 것 = 한 문장(무엇을 위해·받는 곳 이름). 세 줄·항목·나라·까닭·국외 이전은 [자세히 보기] 안(접혀 있음)
    // 창 제목·[자세히 보기]·[나중에 정하기]·[AI 기능 쓰기] 글자는 아이폰 1.2.0 심사 메모에 적힌 그대로 둔다(심사 통과 뒤 2단계에서 바꿈)
    assert.equal((await owner.getByRole('dialog', { name: 'AI 기능 사용 안내' }).count()) > 0, true, '창 제목');
    assert.match(await box.getByTestId('ai-consent-lead').innerText(), /답을 만들 때만, 그때 필요한 내용만 AI 회사\(Anthropic\)에 보내 처리합니다/);
    assert.equal(await box.getByText('보낸 내용은 AI를 가르치는 데 쓰이지 않습니다.').isVisible(), false, '세 줄도 접혀 있음');
    assert.equal(await box.getByText('무엇을 보내나요', { exact: true }).isVisible(), false, '자세한 것은 접혀 있음');
    assert.ok(!/미국/.test(await box.getByTestId('ai-consent-lead').innerText()), '펼치지 않은 본문에는 나라 없이 받는 곳 이름만');
    await owner.screenshot({ path: `${SHOTS}/ai-consent-short.png` });
    await box.getByTestId('ai-consent-more').locator('summary').click();
    assert.equal(await box.getByTestId('ai-consent-points').locator('li').count(), 3, '세 줄(펼치면)');
    await box.getByText('보낸 내용은 AI를 가르치는 데 쓰이지 않습니다.').waitFor();
    await box.getByText('동의하지 않아도 업무·일정·메신저·결재는 그대로 씁니다.').waitFor();
    for (const t of ['무엇을 보내나요', '어디로 보내나요', '왜 보내나요', '동의하지 않으면', '국외 이전']) await box.getByText(t, { exact: true }).waitFor();
    assert.match(await box.getByTestId('ai-consent-transfer').innerText(), /받는 곳·나라: Anthropic\(미국\)[\s\S]*이전 시기·방법: AI 기능을 쓸 때마다[\s\S]*보유 기간: 위탁 계약 종료 또는 탈퇴 시까지/, '국외 이전 고지(시기·방법·보유 기간)');
    const where = await owner.getByTestId('ai-consent-recipients').innerText();
    assert.match(where, /Anthropic\(미국\)/); assert.ok(!/OpenAI/.test(where), '지금 실제로 보내는 곳만(받아쓰기 키 없음 → OpenAI 줄 없음)');
    await box.getByText('AI 기능만 쓸 수 없습니다. 업무·일정·메신저·결재는 그대로 씁니다.').waitFor();
    await owner.screenshot({ path: `${SHOTS}/ai-consent.png` });
    // ⑥ 휴대폰 폭
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.getByTestId('ai-consent-agree').waitFor();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 390), '390 가로 넘침 없음');
    const btn = await owner.getByTestId('ai-consent-agree').boundingBox();
    assert.ok(btn && btn.y + btn.height <= 844, '동의 단추가 화면 안에 보임');
    await owner.screenshot({ path: `${SHOTS}/ai-consent-mobile-open.png` }); // 펼친 채로도 단추 줄은 아래에 붙어 보임
    await owner.getByTestId('ai-consent-more').locator('summary').click(); // 다시 접기
    await owner.waitForTimeout(150);
    await owner.screenshot({ path: `${SHOTS}/ai-consent-mobile.png` });
    await owner.getByTestId('ai-consent-more').locator('summary').click();
    await owner.setViewportSize({ width: 1366, height: 900 });
    // ② 나중에 정하기 → 닫히고, 다시 들어와도 이 기기에서는 안 뜸
    await owner.getByTestId('ai-consent-later').click();
    await box.waitFor({ state: 'hidden' });
    await owner.reload(); await owner.waitForTimeout(2500);
    assert.equal(await box.count(), 0, '나중에 정하기를 누른 기기에서는 들어올 때 다시 안 뜸');
    // ③ 동의하지 않음 상태에서 AI 를 누름 → 짧은 안내 → 내용 보고 정하기 → 동의 → AI 가 답함
    fakeNone = false;
    assert.equal((await put(false)).state, 'declined');
    await owner.goto(BASE + '/assistant');
    const ask = owner.getByLabel('AI 에게 요청', { exact: true });
    await ask.fill('이번 주 내 업무 정리해줘'); await ask.press('Enter');
    const blocked = owner.getByTestId('ai-consent-blocked');
    await blocked.waitFor();
    await blocked.getByText(/Anthropic\(미국\)/).waitFor();
    await owner.getByTestId('ai-consent-blocked-open').click();
    await box.waitFor();
    await owner.getByTestId('ai-consent-agree').click();
    await box.waitFor({ state: 'hidden' });
    await owner.getByText(/AI 기능을 켰습니다/).first().waitFor();
    await q([say('이번 주 업무는 2건입니다.')]);
    await ask.fill('이번 주 내 업무 정리해줘'); await ask.press('Enter');
    await owner.getByTestId('ai-chat').getByText('이번 주 업무는 2건입니다.').waitFor({ timeout: 20000 });
    // ④ 설정 › 개인정보·AI: 끄기 → 다시 켜기(켤 때는 안내 글을 읽고 동의)
    await owner.goto(BASE + '/settings');
    const set = owner.getByTestId('ai-consent-setting');
    await set.scrollIntoViewIfNeeded();
    const tg = owner.getByTestId('ai-consent-toggle');
    await owner.waitForFunction(() => document.querySelector('[data-testid=ai-consent-toggle]')?.checked === true);
    await set.getByText(/Anthropic\(미국\).*전송됩니다/).waitFor();
    await tg.click();
    await owner.getByText(/AI 기능을 껐습니다/).first().waitFor();
    await owner.waitForFunction(() => document.querySelector('[data-testid=ai-consent-toggle]')?.checked === false);
    await set.getByText('동의하지 않음').waitFor();
    await tg.click(); // 켜기 = 동의 창
    await box.waitFor();
    await owner.getByTestId('ai-consent-agree').click();
    await owner.waitForFunction(() => document.querySelector('[data-testid=ai-consent-toggle]')?.checked === true);
    await owner.getByTestId('ai-consent-review').click(); // 내용 다시 보기
    await box.waitFor();
    await owner.keyboard.press('Escape');
    // ⑤ 관리 › 회사 정보: 회사 자료 자동 AI 처리(기본 회사는 켜짐)
    await owner.goto(BASE + '/admin/company');
    const auto = owner.getByTestId('ai-auto-setting');
    await auto.scrollIntoViewIfNeeded();
    await auto.getByText('회사 자료 자동 AI 처리').waitFor();
    assert.equal(await owner.getByTestId('ai-auto-toggle').isChecked(), true);
  } finally {
    await owner.unroute('**/api/account/ai-consent', route);
    fakeNone = false;
    await put(true).catch(() => {}); // 뒤 단계가 AI 를 그대로 쓰게 동의 상태로 둠
  }
}
