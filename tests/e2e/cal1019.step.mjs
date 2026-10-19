// 대표 지적(10/19 캘린더): ① 상세에서 자동 저장 뒤 다시 고쳐 [완료] → 409 없이 저장, 겹친 일정은 나란히 → 누른 일정의 미리보기
// ② 일정별 색(상세 색 점)·캘린더 색 점 → 저장(나만) ③ 짧은 칸 2줄·월 보기 +N개
import assert from 'node:assert/strict';
export async function cal1019({ owner, ctx, sql, BASE }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  const cals = (await ctx.owner.ok('GET', '/api/calendars')).calendars;
  const personal = cals.find((c) => c.type === 'personal');
  const day = '2026-11-18';
  const mk = (title, s, e) => ctx.owner.ok('POST', '/api/events', { calendarId: personal.id, title, start: `${day}T${s}:00+09:00`, end: `${day}T${e}:00+09:00` });
  const a = await mk('E2E 겹침 가', '10:00', '11:00');
  await mk('E2E 겹침 나', '10:00', '11:00');
  await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${day}`);
  const ga = owner.locator('[data-ev-block]').filter({ hasText: 'E2E 겹침 가' }), gb = owner.locator('[data-ev-block]').filter({ hasText: 'E2E 겹침 나' });
  await ga.waitFor(); await gb.waitFor();
  const [ba, bb] = [await ga.boundingBox(), await gb.boundingBox()];
  assert.ok(ba.x + ba.width <= bb.x + 1 || bb.x + bb.width <= ba.x + 1, `겹친 일정은 나란히 (${JSON.stringify([ba, bb])})`);
  for (const t of ['E2E 겹침 가', 'E2E 겹침 나']) {
    await owner.locator('[data-ev-block]').filter({ hasText: t }).click();
    await owner.getByTestId('event-preview').getByText(t).waitFor();
    await owner.getByRole('button', { name: '미리보기 닫기' }).click(); await owner.getByTestId('event-preview').waitFor({ state: 'detached' });
  }
  // ① 자동 저장(버전 +1) 뒤 다시 고치고 바로 [완료] → 409 없이 저장
  await owner.goto(`${BASE}/calendar?event=${a.id}`);
  const title = owner.getByRole('dialog').getByLabel('제목');
  await title.fill('E2E 겹침 가 수정1');
  await owner.getByTestId('editor-autosave').filter({ hasText: '저장됨' }).waitFor();
  // ② 일정별 색: 토마토
  await owner.getByTestId('event-color').getByRole('radio', { name: '토마토' }).click();
  await title.fill('E2E 겹침 가 수정2');
  await owner.getByTestId('editor-close').click();
  await owner.getByText('저장했습니다').first().waitFor();
  const [row] = await sql`select title, color from events where id = ${a.id}`;
  assert.deepEqual([row.title, row.color], ['E2E 겹침 가 수정2', '#d50000'], '자동 저장 뒤 [완료]도 저장(409 아님)·일정 색');
  await owner.getByRole('dialog', { name: '일정 수정' }).waitFor({ state: 'detached' });
  await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${day}`);
  const bg = await owner.locator('.fc-event').filter({ hasText: 'E2E 겹침 가 수정2' }).first().evaluate((el) => getComputedStyle(el).backgroundColor);
  assert.equal(bg, 'rgb(213, 0, 0)', '일정 색으로 그림');
  // ② 캘린더 색 점(왼쪽 목록) → 포도, 나만 저장
  await owner.getByTestId('cal-color-personal').click();
  await owner.getByTestId('color-pop').getByRole('button', { name: '포도' }).click();
  await owner.waitForFunction(async () => (await (await fetch('/api/calendar-colors')).json()).colors.cals && Object.values((await (await fetch('/api/calendar-colors')).json()).colors.cals).includes('#8e24aa'));
  const [cs] = await sql`select cal_colors from user_settings where user_id = ${ctx.ownerId}`;
  assert.equal(cs.cal_colors.cals[personal.id], '#8e24aa');
  await owner.screenshot({ path: 'docs/screens/cal-1019-colors.png' });
  await owner.getByTestId('cal-color-personal').click();
  await owner.getByTestId('color-pop').getByRole('button', { name: '기본으로' }).click();
  // ③ 월 보기: 한 날짜에 일정 9건 → '+N개'
  for (let i = 0; i < 9; i++) await ctx.owner.ok('POST', '/api/events', { calendarId: personal.id, title: `E2E 월 ${i}`, start: '2026-11-25T00:00:00+09:00', end: '2026-11-26T00:00:00+09:00', allDay: true });
  await owner.goto(`${BASE}/calendar?view=dayGridMonth&date=2026-11-25`);
  await owner.locator('.fc-more-link').filter({ hasText: /^\+\d+개$/ }).first().waitFor();
}
