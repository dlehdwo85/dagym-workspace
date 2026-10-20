// 로컬 10/20(대표 재발) 캘린더 일정 생성 직후 편집 실패·색 고르기:
// ① 휴대폰(390): 빈 칸 탭 → 빠른 입력 첫 화면에 색 줄(quick-color) → 색 골라 저장 → 바로 미리보기 → [편집] → 제목 바꾸는 중 wos-refresh(빠른 입력 저장·다른 탭·알림)가 와도 입력이 안 지워지고 저장됨
// ② PC: 편집 창 자동 저장 뒤 다른 기기가 먼저 고친 상황(DB version +1) → [완료] → 409 없이 "다시 불러와 적용" 자동 재시도로 저장
import assert from 'node:assert/strict';

export async function calEditFlow({ browser, desk, owner, ctx, sql, BASE, SHOTS }) {
  const cals = (await ctx.owner.ok('GET', '/api/calendars')).calendars;
  const personal = cals.find((c) => c.type === 'personal');
  const d = '2026-12-02';
  // ① 휴대폰
  const mc = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  try {
    const m = await mc.newPage();
    await m.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    const lane = m.locator('td.fc-timegrid-slot-lane[data-time="14:00:00"]').first();
    await lane.waitFor(); await lane.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const colBox = await m.locator(`td.fc-timegrid-col[data-date="${d}"]`).boundingBox(); const laneBox = await lane.boundingBox();
    await m.touchscreen.tap(colBox.x + colBox.width / 2, laneBox.y + laneBox.height / 2);
    const sheet = m.getByTestId('quick-create'); await sheet.waitFor();
    await sheet.getByTestId('quick-color').waitFor(); // 색 줄이 첫 화면에
    await sheet.getByTestId('quick-color').getByRole('radio', { name: '토마토' }).tap();
    await sheet.getByLabel('빠른 입력 제목').fill('E2E 생성 직후 편집');
    await sheet.getByTestId('quick-save').tap();
    await m.getByText('일정을 저장했습니다').waitFor();
    const [created] = await sql`select id, color, version from events where title = 'E2E 생성 직후 편집' and deleted_at is null`;
    assert.equal(created.color, '#d50000', '빠른 입력에서 고른 색 저장');
    // 방금 만든 일정 → 미리보기 → [편집] (편집 창은 ?event= 로 열리는 같은 EventEditor)
    await m.locator('[data-ev-block]').filter({ hasText: 'E2E 생성 직후 편집' }).first().tap();
    await m.getByTestId('event-preview').waitFor();
    await m.getByTestId('event-preview').getByRole('button', { name: '일정 편집' }).tap().catch(() => {});
    let dlg = m.getByRole('dialog', { name: '일정 수정' });
    if (!(await dlg.isVisible().catch(() => false))) { await m.goto(`${BASE}/calendar?event=${created.id}`); dlg = m.getByRole('dialog', { name: '일정 수정' }); }
    await dlg.waitFor();
    const title = dlg.getByLabel('제목'); await title.waitFor();
    await dlg.getByTestId('event-color').waitFor(); // 편집 첫 화면에도 색 줄
    await title.fill('E2E 생성 직후 편집 — 고침');
    // 다른 곳의 새로고침 신호(빠른 입력 저장·알림·다른 탭)가 와도 입력이 지워지지 않는다
    await m.evaluate(() => window.dispatchEvent(new Event('wos-refresh')));
    await m.waitForTimeout(700);
    assert.equal(await title.inputValue(), 'E2E 생성 직후 편집 — 고침', '새로고침 뒤에도 입력 유지');
    await dlg.getByTestId('editor-autosave').filter({ hasText: '저장됨' }).waitFor({ timeout: 10000 });
    await dlg.getByTestId('event-color').getByRole('radio', { name: '바질' }).tap();
    await dlg.getByTestId('editor-close').tap();
    await m.getByRole('dialog', { name: '일정 수정' }).waitFor({ state: 'detached' });
    let row = null;
    for (let k = 0; k < 40; k++) { [row] = await sql`select title, color from events where id = ${created.id}`; if (row.title === 'E2E 생성 직후 편집 — 고침' && row.color === '#0b8043') break; await m.waitForTimeout(250); }
    assert.deepEqual([row.title, row.color], ['E2E 생성 직후 편집 — 고침', '#0b8043'], '생성 직후 편집·색 변경 저장');
    await m.screenshot({ path: `${SHOTS}/144-cal-edit-mobile.png` });
  } finally { await mc.close().catch(() => {}); }
  // ② PC: 다른 기기가 먼저 고친 뒤 [완료] → 자동 재시도로 저장(409 문구 없음)
  const b = await ctx.owner.ok('POST', '/api/events', { calendarId: personal.id, title: 'E2E 충돌 재시도', start: `${d}T16:00:00+09:00`, end: `${d}T17:00:00+09:00` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/calendar?event=${b.id}`);
  const pt = owner.getByRole('dialog').getByLabel('제목'); await pt.waitFor();
  await sql`update events set version = version + 1, location = '다른 기기', updated_at = now() where id = ${b.id}`; // 다른 기기가 먼저 고침
  await pt.fill('E2E 충돌 재시도 — 고침');
  await owner.getByTestId('editor-autosave').filter({ hasText: '저장됨' }).waitFor({ timeout: 10000 });
  await pt.fill('E2E 충돌 재시도 — 고침2');
  await owner.getByTestId('editor-close').click();
  await owner.getByText('저장했습니다').first().waitFor();
  assert.equal(await owner.getByText(/다른 곳에서 먼저 바뀌었습니다/).count(), 0, '409 안내 없이 자동 재시도');
  const [pr] = await sql`select title from events where id = ${b.id}`;
  assert.equal(pr.title, 'E2E 충돌 재시도 — 고침2');
}
