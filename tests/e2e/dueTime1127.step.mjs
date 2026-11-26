// 로컬 11/27 18~20번(대표 "마감일자 고르고 시간 선택하는게 없네요" — 업무 목록 마감 칩 팝오버에 날짜만 있었음):
// ① 요청자(대표): 목록 마감 칩 → 날짜 고름(팝오버 그대로) → 시각 14:00 → 칩이 '날짜 14:00 D-n' · 마감일 지우기 = 시각도 지움
// ② 담당자: 같은 날짜에서 시각을 뒤로 미루면 [마감 연장] 창(날짜·시각 그대로, 사유 필수) · 앞당기면 바로
// ③ 빠른 선택에 같은 날짜가 두 번 나오지 않음(오늘이 금요일이면 '이번 주 금요일' 대신 '다음 주 금요일')
import assert from 'node:assert/strict';

const kstPlus = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));

export async function dueTime1127({ browser, desk, ctx, BASE, SHOTS, login }) {
  const d6 = kstPlus(6), d9 = kstPlus(9);
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: '마감 시각 고르기 시험(목록 칩)', orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: kstPlus(3), approvalRequired: false });
  const task = async () => (await ctx.owner.ok('GET', `/api/tasks/${t.id}`)).task;
  // ① 대표(요청자) — 데스크톱
  const p = await desk.newPage();
  try {
    await p.goto(`${BASE}/tasks`);
    const row = p.locator(`[data-task-id="${t.id}"]`).first(); await row.waitFor({ timeout: 20_000 });
    await row.getByTestId('due-picker').click();
    const pop = p.getByRole('dialog').last();
    // ③ 빠른 선택 날짜가 겹치지 않음
    const dates = await pop.locator('button:has(span.tabular-nums)').evaluateAll((bs) => bs.map((b) => b.querySelector('span.tabular-nums')?.textContent?.trim()).filter(Boolean));
    assert.equal(new Set(dates).size, dates.length, `빠른 선택 날짜 중복: ${dates.join(', ')}`);
    await pop.locator('input[type="date"]').fill(d6);
    await p.waitForFunction(async ([u, id, d]) => (await (await fetch(`${u}/api/tasks/${id}`)).json()).task.due_date?.slice(0, 10) === d, [BASE, t.id, d6]);
    assert.ok(await pop.isVisible(), '날짜를 고른 뒤에도 팝오버가 열려 있어 시각을 이어서 고름');
    await pop.getByRole('button', { name: '14:00', exact: true }).click();
    await p.waitForFunction(async ([u, id]) => (await (await fetch(`${u}/api/tasks/${id}`)).json()).task.due_time?.slice(0, 5) === '14:00', [BASE, t.id]);
    await p.keyboard.press('Escape');
    await row.getByTestId('due-picker').getByText(`${Number(d6.slice(5, 7))}/${Number(d6.slice(8))} 14시`).waitFor({ timeout: 10_000 }); // 380차: 정시는 'n시'
    assert.equal(await row.getByTestId('due-picker').getByTestId('due-dday').textContent(), 'D-6');
    await p.screenshot({ path: `${SHOTS}/1127-due-time-list.png` });
  } finally { await p.close(); }
  // ② 담당자 — 휴대폰(375)
  const sc = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const sp = await login(sc, ctx.staffA.email, ctx.staffA.password);
    await sp.goto(`${BASE}/tasks`);
    const row = sp.locator(`[data-task-id="${t.id}"]`).first(); await row.waitFor({ timeout: 20_000 });
    await row.getByTestId('due-picker').click();
    let pop = sp.getByRole('dialog').last();
    await pop.getByRole('button', { name: '18:00', exact: true }).click(); // 뒤로 미룸 → 연장 창
    const dlg = sp.getByTestId('extend-dialog'); await dlg.waitFor({ timeout: 10_000 });
    assert.match(await dlg.getByTestId('extend-to').innerText(), new RegExp(`${Number(d6.slice(5, 7))}/${Number(d6.slice(8))} 18:00`), '연장 창은 같은 날짜·고른 시각');
    assert.equal((await task()).due_time?.slice(0, 5), '14:00', '사유 없이 바로 바뀌지 않음');
    await sp.screenshot({ path: `${SHOTS}/1127-due-time-extend-375.png` });
    await sp.keyboard.press('Escape'); await dlg.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => {});
    await row.getByTestId('due-picker').click(); pop = sp.getByRole('dialog').last();
    await pop.getByRole('button', { name: '10:00', exact: true }).click(); // 앞당김 → 바로
    await sp.waitForFunction(async ([u, id]) => (await (await fetch(`${u}/api/tasks/${id}`)).json()).task.due_time?.slice(0, 5) === '10:00', [BASE, t.id]);
  } finally { await sc.close(); }
  // ① 이어서: 마감일 지우기 = 시각도 지움(대표)
  const p2 = await desk.newPage();
  try {
    await p2.goto(`${BASE}/tasks`);
    const row = p2.locator(`[data-task-id="${t.id}"]`).first(); await row.waitFor({ timeout: 20_000 });
    await row.getByTestId('due-picker').click();
    await p2.getByRole('dialog').last().getByTestId('due-clear').click();
    await p2.waitForFunction(async ([u, id]) => { const x = (await (await fetch(`${u}/api/tasks/${id}`)).json()).task; return !x.due_date && !x.due_time; }, [BASE, t.id]);
  } finally { await p2.close(); }
  void d9;
}
