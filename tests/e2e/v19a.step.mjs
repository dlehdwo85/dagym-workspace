// V19 부록 A: AI 비서 줄바꿈(휴대폰 Enter = 줄바꿈·PC Enter = 보내기)·자동 높이·[멈춤]·[수정]·[복사] + 업무 보기 칩 다시 누르면 해제
import assert from 'node:assert/strict';
export async function v19a({ browser, desk, owner, ctx, sql, BASE, FAKE, SHOTS }) {
  const q = (items) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: items }) });
  const say = (text, extra = {}) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', ...extra });

  // 완료 칩: 켜기 → 다시 누르면 해제(전체), 오래전 완료 업무는 해제 뒤 목록에서 빠짐
  const old = (await ctx.owner.ok('POST', '/api/tasks', { title: '지난달 완료 칩 시험', assigneeId: ctx.ownerId, approvalRequired: false })).id;
  await ctx.owner.ok('PATCH', `/api/tasks/${old}`, { status: 'done' });
  await sql`update tasks set completed_at = now() - interval '40 days' where id = ${old}`;
  await owner.goto(BASE + '/tasks');
  const chip = owner.getByTestId('done-chip').getByRole('button');
  await chip.click();
  assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  await owner.locator('[data-testid="task-groups"][data-group-by="month"]').waitFor(); // 완료 보관(달별) 화면
  await chip.click();
  await owner.waitForFunction(() => document.querySelector('[data-testid=done-chip] button')?.getAttribute('aria-pressed') === 'false');
  await owner.locator('[data-testid="task-groups"][data-group-by="month"]').waitFor({ state: 'detached' });
  assert.equal(await owner.getByText('지난달 완료 칩 시험').count(), 0, '해제하면 지난 완료 업무는 목록에서 빠짐');
  const mine = owner.getByRole('button', { name: '내 업무', exact: true }).first();
  await mine.click(); assert.equal(await mine.getAttribute('aria-pressed'), 'true');
  await mine.click(); assert.equal(await mine.getAttribute('aria-pressed'), 'false', '다른 보기 칩도 다시 누르면 해제');

  // PC: Enter = 보내기, Shift+Enter = 줄바꿈, 안내 표시
  await owner.goto(BASE + '/assistant');
  const box = owner.getByLabel('AI 에게 요청', { exact: true });
  await owner.getByTestId('ai-enter-hint').waitFor();
  await box.fill('PC 첫 줄');
  await box.press('Shift+Enter');
  await box.pressSequentially('PC 둘째 줄');
  assert.equal(await box.inputValue(), 'PC 첫 줄\nPC 둘째 줄');
  await q([say('PC 답\n\n단락 둘')]);
  await box.press('Enter');
  await owner.getByTestId('ai-answer').filter({ hasText: 'PC 답' }).waitFor();
  assert.equal((await owner.getByTestId('ai-user-msg').last().innerText()).trim(), 'PC 첫 줄\nPC 둘째 줄');
  // [수정]: 마지막 질문을 입력창으로 → 고쳐 보내면 이전 답 교체
  await owner.getByTestId('ai-edit-last').click();
  assert.equal(await box.inputValue(), 'PC 첫 줄\nPC 둘째 줄');
  assert.equal(await owner.getByTestId('ai-answer').filter({ hasText: 'PC 답' }).count(), 0, '고치는 동안 이전 답은 사라짐');
  await box.fill('PC 고친 질문');
  await q([say('고친 질문의 답')]);
  await box.press('Enter');
  await owner.getByTestId('ai-answer').filter({ hasText: '고친 질문의 답' }).waitFor();
  assert.equal(await owner.getByTestId('ai-user-msg').filter({ hasText: 'PC 첫 줄' }).count(), 0);
  // [다시 답하기]
  await q([say('다시 만든 답')]);
  await owner.getByTestId('ai-regenerate').click();
  await owner.getByTestId('ai-answer').filter({ hasText: '다시 만든 답' }).waitFor();
  assert.equal(await owner.getByTestId('ai-answer').filter({ hasText: '고친 질문의 답' }).count(), 0);
  assert.ok(await owner.getByRole('button', { name: '복사' }).count() >= 2, '말풍선마다 복사');
  // [멈춤]: 늦는 답 → 멈춤 → 표시·다시 보내기 가능
  await q([say('늦은 답', { delayMs: 5000 })]);
  await box.fill('늦게 답하는 질문');
  await box.press('Enter');
  await owner.getByTestId('ai-stop').click();
  await owner.getByTestId('ai-stopped').last().waitFor();
  await owner.getByRole('button', { name: '보내기' }).waitFor();
  await owner.waitForTimeout(5500);
  assert.equal(await owner.getByText('늦은 답').count(), 0, '멈춘 뒤 늦게 온 답은 표시 안 함');
  await owner.screenshot({ path: `${SHOTS}/v19a-assistant-pc.png` });

  // 휴대폰: Enter = 줄바꿈(보내지지 않음), 입력창이 늘어남, 보내기 버튼으로만
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  await m.goto(BASE + '/assistant');
  const mb = m.getByLabel('AI 에게 요청', { exact: true });
  await mb.waitFor();
  await m.getByTestId('ai-enter-hint').waitFor({ state: 'detached' }); // 휴대폰엔 Shift 안내 없음
  const h0 = (await mb.boundingBox()).height;
  await mb.click();
  await mb.pressSequentially('첫째 줄'); await mb.press('Enter');
  await mb.pressSequentially('둘째 줄'); await mb.press('Enter');
  await mb.pressSequentially('셋째 줄');
  assert.equal(await mb.inputValue(), '첫째 줄\n둘째 줄\n셋째 줄', 'Enter = 줄바꿈');
  assert.equal(await m.getByTestId('ai-user-msg').count(), 0, 'Enter 로는 보내지지 않음');
  const grown = await mb.evaluate((el) => ({ h: el.getBoundingClientRect().height, fits: el.scrollHeight <= el.clientHeight + 2 }));
  assert.ok(grown.h >= 78 && grown.h >= h0 && grown.fits, `입력창이 3줄만큼 늘어남(${h0}→${grown.h})`);
  await q([say('휴대폰 답')]);
  await m.getByRole('button', { name: '보내기' }).tap();
  await m.getByTestId('ai-answer').filter({ hasText: '휴대폰 답' }).waitFor();
  assert.equal((await m.getByTestId('ai-user-msg').last().innerText()).trim().split('\n').length, 3, '말풍선에 3줄 그대로');
  await m.screenshot({ path: `${SHOTS}/v19a-assistant-mobile.png` });
  await mc.close();

  // 패널(✨)도 같은 입력창·수정
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('ai-dock-open').click();
  const dock = owner.getByTestId('ai-dock');
  const db = dock.getByLabel('AI 에게 요청 (화면 맥락)');
  await db.fill('패널 질문');
  await q([say('패널 답')]);
  await db.press('Enter');
  await dock.getByTestId('ai-answer').filter({ hasText: '패널 답' }).waitFor();
  await dock.getByTestId('ai-edit-last').click();
  assert.equal(await db.inputValue(), '패널 질문');
  await dock.getByRole('button', { name: '닫기' }).click();
}
