// 386차(대표 11/09 "서로 업무배정뿐 아니라 스케줄도 배정"): 일정 창 '누구 일정'
// ① 직원이 대표에게 배정한 일정을 대표가 열면 '누구 일정 = 나' + '이직원님이 배정한 일정입니다'
// ② 대표가 내 일정(박직원 참석)을 열어 '누구 일정'을 박직원으로 → 안내 줄 · 캘린더 칸 숨김 → 자동 저장 → 박직원 캘린더로 옮겨지고 참석자 줄에서 빠짐 → 미리보기 '내가 배정'
import assert from 'node:assert/strict';

export async function eventAssign386({ owner, ctx, sql, BASE, SHOTS }) {
  const d = '2026-12-09';
  const a = await ctx.staffA.client.ok('POST', '/api/events', { ownerId: ctx.ownerId, title: 'E2E386 배정받은 미팅', start: `${d}T13:00:00+09:00`, end: `${d}T14:00:00+09:00` });
  const mine = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal');
  const b = await ctx.owner.ok('POST', '/api/events', { calendarId: mine.id, title: 'E2E386 넘길 일정', start: `${d}T15:00:00+09:00`, end: `${d}T16:00:00+09:00`, attendeeIds: [ctx.staffB.id] });
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    // ①
    await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}&event=${a.id}`);
    let dlg = owner.getByRole('dialog', { name: '일정 수정' }); await dlg.waitFor();
    assert.equal(await dlg.getByTestId('editor-owner-select').inputValue(), ctx.ownerId, '누구 일정 = 나');
    assert.match(await dlg.getByTestId('editor-assigned-by').innerText(), /이직원님이 배정한 일정입니다/);
    await owner.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' });
    // ②
    await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}&event=${b.id}`);
    dlg = owner.getByRole('dialog', { name: '일정 수정' }); await dlg.waitFor();
    await dlg.getByLabel('캘린더').waitFor();
    await dlg.getByTestId('editor-owner-select').selectOption(ctx.staffB.id);
    assert.match(await dlg.getByTestId('editor-owner-note').innerText(), /박직원님 캘린더에 생기고 박직원님에게 알림이 갑니다\. 나는 참석자로 들어가지 않습니다/);
    assert.equal(await dlg.getByLabel('캘린더').count(), 0, '남의 일정이면 캘린더 칸은 숨김');
    await owner.screenshot({ path: `${SHOTS}/386-event-assign.png` });
    await dlg.getByTestId('editor-autosave').filter({ hasText: '저장됨' }).waitFor({ timeout: 10000 });
    const [ev] = await sql`select c.owner_user_id from events e join calendars c on c.id = e.calendar_id where e.id = ${b.id}`;
    assert.equal(ev.owner_user_id, ctx.staffB.id, '박직원 캘린더로 옮겨짐');
    assert.equal((await sql`select count(*)::int n from event_attendees where event_id = ${b.id}`)[0].n, 0, '새 주인은 참석자 줄에서 빠짐');
    assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.staffB.id} and entity_id = ${b.id} and title like '일정 배정:%'`)[0].n, 1);
    await owner.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' });
    // 미리보기: '박직원님 일정 · 내가 배정'
    await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    await owner.locator('[data-ev-block]').filter({ hasText: 'E2E386 넘길 일정' }).first().click();
    const pv = owner.getByTestId('event-preview'); await pv.waitFor();
    assert.match(await pv.innerText(), /박직원님 일정 · 내가 배정/);
  } finally {
    await sql`update events set deleted_at = now() where id = any(${[a.id, b.id]}::uuid[])`;
  }
}
