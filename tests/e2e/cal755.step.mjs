// #755·#756·#757(대표 10/28 '구글 캘린더처럼'): ① 30분 일정 4건이 이어지면(14:00~16:00) 좌우로 쪼개지지 않고 칸 너비 그대로 위아래로 · 한 줄 '제목, 오후 2:30'
// ② 시간 글자는 칸 안이 아니라 그 시각 가로줄 가운데에 걸침 · 맨 위 첫 글자 숨김 ③ 빈 칸 한 번 누르기 = 누른 자리 15분 칸부터 1시간 · 시각 목록에 :15·:45 · 휴대폰 폭도 쪼개지지 않음
import assert from 'node:assert/strict';

export async function cal755({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const d = ymd(3);
  const [cal] = await sql`select id from calendars where type = 'personal' and owner_user_id = ${ctx.ownerId}`;
  const ids = [];
  for (const [k, s, e] of [[1, '14:00', '14:30'], [2, '14:30', '15:00'], [3, '15:00', '15:30'], [4, '15:30', '16:00']]) {
    ids.push((await ctx.owner.ok('POST', '/api/events', { calendarId: cal.id, title: `E2E면접${k}`, start: `${d}T${s}:00+09:00`, end: `${d}T${e}:00+09:00`, allDay: false })).id);
  }
  const boxes = async () => Promise.all([1, 2, 3, 4].map(async (k) => { const ev = owner.locator('.fc-timegrid-event', { hasText: `E2E면접${k}` }).first(); await ev.waitFor(); return ev.boundingBox(); }));
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    const col = owner.locator(`td.fc-timegrid-col[data-date="${d}"]`); await col.waitFor();
    await owner.locator('.fc-timegrid-event', { hasText: 'E2E면접1' }).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await owner.waitForTimeout(300);
    const cb = await col.boundingBox(); const bs = await boxes();
    for (const b of bs) {
      assert.ok(Math.abs(b.x - bs[0].x) <= 1 && Math.abs(b.width - bs[0].width) <= 1, `안 겹치는 일정은 같은 자리·같은 너비: ${JSON.stringify(bs.map((x) => [Math.round(x.x), Math.round(x.width)]))}`);
      assert.ok(b.width >= cb.width * 0.8, `칸 너비 그대로(나란히 쪼개지지 않음): ${Math.round(b.width)} / ${Math.round(cb.width)}`);
    }
    for (let i = 1; i < 4; i++) assert.ok(bs[i].y >= bs[i - 1].y + bs[i - 1].height - 3, '위아래로 이어짐(겹쳐 그리지 않음)');
    assert.match(await owner.locator('.fc-timegrid-event', { hasText: 'E2E면접2' }).first().locator('[data-short-block]').innerText(), /^E2E면접2, 오후 2:30$/);
    await owner.screenshot({ path: `${SHOTS}/585-cal-30min-stack.png`, clip: { x: cb.x - 60, y: bs[0].y - 40, width: cb.width + 70, height: bs[3].y + bs[3].height - bs[0].y + 80 } });
    // ② 시간 글자 = 그 시각 가로줄 가운데에 걸침 · 맨 위 첫 글자 숨김
    const lbl = await owner.locator('td.fc-timegrid-slot-label[data-time="14:00:00"] .fc-timegrid-slot-label-cushion').first().boundingBox();
    const lane = await owner.locator('td.fc-timegrid-slot-lane[data-time="14:00:00"]').first().boundingBox();
    assert.ok(Math.abs(lbl.y + lbl.height / 2 - lane.y) <= 3, `글자 가운데(${Math.round(lbl.y + lbl.height / 2)})가 14시 줄(${Math.round(lane.y)})에`);
    assert.equal(await owner.locator('.fc-timegrid-slots tbody tr:first-child .fc-timegrid-slot-label-cushion').first().evaluate((el) => getComputedStyle(el).visibility), 'hidden', '맨 위 첫 글자 숨김');
    // ③ 빈 칸 한 번 누르기 = 15분 칸부터 1시간(10:40 쯤 → 10:30)
    const l10 = owner.locator('td.fc-timegrid-slot-lane[data-time="10:00:00"]').first();
    await l10.evaluate((el) => el.scrollIntoView({ block: 'center' })); await owner.waitForTimeout(200);
    const c2 = await owner.locator(`td.fc-timegrid-col[data-date="${d}"]`).boundingBox(); const lb = await l10.boundingBox();
    await owner.mouse.click(c2.x + c2.width / 2, lb.y + lb.height * 0.7);
    const qc = owner.getByTestId('quick-create'); await qc.waitFor();
    assert.deepEqual([await qc.getByLabel('시작 시각').inputValue(), await qc.getByLabel('종료 시각').inputValue()], ['10:30', '11:30'], '누른 자리 15분 칸부터 1시간');
    const opts = await qc.getByLabel('시작 시각').evaluate((el) => [...el.options].map((o) => o.value));
    assert.ok(opts.includes('10:15') && opts.includes('10:45') && opts.includes('07:15'), '시각 목록에 15분 단위');
    await qc.getByLabel('빠른 입력 제목').press('Escape'); await qc.waitFor({ state: 'detached' });
    // 휴대폰 폭(주 보기 1시간 40px → 30분 20px): 그래도 쪼개지지 않음
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    await owner.locator('.fc-timegrid-event', { hasText: 'E2E면접1' }).first().waitFor();
    await owner.locator('.fc-timegrid-event', { hasText: 'E2E면접1' }).first().evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await owner.waitForTimeout(300);
    const ms = await boxes();
    for (const b of ms) assert.ok(Math.abs(b.x - ms[0].x) <= 1 && Math.abs(b.width - ms[0].width) <= 1, `휴대폰도 같은 자리·같은 너비: ${JSON.stringify(ms.map((x) => [Math.round(x.x), Math.round(x.width)]))}`);
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    for (const id of ids) await ctx.owner.ok('DELETE', `/api/events/${id}`).catch(() => {});
  }
}
