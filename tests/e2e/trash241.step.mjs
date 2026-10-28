// 241차(로컬 10/28 19:20 '10/29 면접 일정 1건이 사라짐 — 누가·언제 지웠는지 · 휴지통(되살리기)'): 캘린더 왼쪽 [지운 일정] → 일정·일시·캘린더·지운 사람·때 →
// [되살리기] → 캘린더에 다시 · 일정 미리보기에서 지우면 안내의 [되돌리기]로 바로 되살림 · 휴대폰은 칩 줄 [지운 일정](가로 넘침 없음)
import assert from 'node:assert/strict';

export async function trash241({ owner, ctx, sql, BASE, SHOTS }) {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + 33 * 864e5));
  const [cal] = await sql`select id from calendars where type = 'personal' and owner_user_id = ${ctx.ownerId}`;
  const ev = await ctx.owner.ok('POST', '/api/events', { calendarId: cal.id, title: 'E2E241 면접(팀장)', start: `${d}T15:00:00+09:00`, end: `${d}T15:30:00+09:00`, allDay: false });
  await ctx.owner.ok('DELETE', `/api/events/${ev.id}?scope=all`);
  const block = () => owner.locator('.fc-timegrid-event', { hasText: 'E2E241 면접(팀장)' }).first();
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    await owner.locator(`td.fc-timegrid-col[data-date="${d}"]`).waitFor();
    assert.equal(await block().count(), 0, '지운 일정은 캘린더에 없음');
    await owner.getByTestId('cal-trash-side').click();
    const box = owner.getByTestId('deleted-events'); await box.waitFor();
    const row = box.getByTestId('deleted-event').filter({ hasText: 'E2E241 면접(팀장)' }); await row.waitFor();
    assert.match(await row.innerText(), /E2E241 면접\(팀장\)[\s\S]*오후 3:00~3:30 · 내 일정[\s\S]*지운 사람 김대표 · /);
    await owner.screenshot({ path: `${SHOTS}/587-cal-trash.png`, clip: await owner.getByRole('dialog', { name: '지운 일정' }).boundingBox() });
    await row.getByTestId('deleted-event-restore').click();
    await row.waitFor({ state: 'detached' });
    await owner.keyboard.press('Escape'); await box.waitFor({ state: 'detached' });
    await block().waitFor();
    // 미리보기에서 지우기 → 안내의 [되돌리기]
    await block().click();
    owner.once('dialog', (x) => x.accept());
    await owner.getByRole('button', { name: '일정 삭제' }).click();
    const t = owner.getByTestId('toast').filter({ hasText: '삭제했습니다' }); await t.waitFor();
    await block().waitFor({ state: 'detached' });
    await t.getByRole('button', { name: '되돌리기' }).click();
    await block().waitFor();
    assert.equal((await sql`select deleted_at from events where id = ${ev.id}`)[0].deleted_at, null);
    // 휴대폰: 칩 줄 [지운 일정]
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/calendar?date=${d}`);
    await owner.getByTestId('cal-trash').click();
    await owner.getByTestId('deleted-events').waitFor();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 가로 넘침 없음');
    await owner.keyboard.press('Escape');
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await sql`update events set deleted_at = now() where id = ${ev.id}`;
  }
}
