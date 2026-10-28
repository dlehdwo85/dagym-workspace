// 199차 #690(대표 10/26 16:40, 구글 캘린더 레퍼런스): 주 보기에서 일정을 끌면 15분 단위로 옮겨짐(예전 1시간) · PC 왼쪽 목록 [끌기 단위 15분|30분] · 휴대폰 칩 'N분 단위'(이 기기 기억)
import assert from 'node:assert/strict';

export async function calSnap199({ owner, ctx, sql, BASE }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const d = ymd(2);
  const [cal] = await sql`select id from calendars where type = 'personal' and owner_user_id = ${ctx.ownerId}`;
  const r = await ctx.owner.ok('POST', '/api/events', { calendarId: cal.id, title: 'E2E 15분 끌기', start: `${d}T10:00:00+09:00`, end: `${d}T11:00:00+09:00`, allDay: false });
  const startOf = async () => (await sql`select to_char(start_at at time zone 'Asia/Seoul', 'HH24:MI') as s from events where id = ${r.id}`)[0].s;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.evaluate(() => { try { localStorage.removeItem('wos_cal_snap'); } catch { /* 없음 */ } });
    await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    const side = owner.getByTestId('cal-snap-side'); await side.waitFor();
    assert.equal(await side.getByRole('button', { name: '15분' }).getAttribute('aria-pressed'), 'true', '기본 15분');
    const drag = async (frac) => {
      const ev = owner.locator('.fc-timegrid-event', { hasText: 'E2E 15분 끌기' }).first(); await ev.waitFor();
      await ev.evaluate((el) => el.scrollIntoView({ block: 'center' })); await owner.waitForTimeout(200);
      const slotH = await owner.locator('td.fc-timegrid-slot').first().evaluate((el) => el.getBoundingClientRect().height); // 한 칸 = 1시간
      const box = await ev.boundingBox();
      await owner.mouse.move(box.x + box.width / 2, box.y + 6); await owner.mouse.down();
      await owner.mouse.move(box.x + box.width / 2, box.y + 6 + slotH * frac / 2, { steps: 6 });
      await owner.mouse.move(box.x + box.width / 2, box.y + 6 + slotH * frac + 3, { steps: 6 }); await owner.mouse.up();
      await owner.getByText('일정을 이동했습니다').first().waitFor();
    };
    await drag(0.25); // 15분만큼 아래로
    for (let i = 0; i < 20 && (await startOf()) === '10:00'; i++) await owner.waitForTimeout(200);
    assert.equal(await startOf(), '10:15', '15분 단위로 옮겨짐(예전 1시간 단위면 제자리 · 잡은 자리 보정이 없으면 45분 튐)');
    // #756(대표 10/28): 한 번 클릭도 누른 자리 15분 칸부터 1시간(199차의 '정시부터'를 바꿈) · 끌어서 그리면 15분 단위
    const lane = owner.locator('td.fc-timegrid-slot-lane[data-time="14:00:00"]').first();
    await lane.evaluate((el) => el.scrollIntoView({ block: 'center' })); await owner.waitForTimeout(200);
    const col = await owner.locator(`td.fc-timegrid-col[data-date="${d}"]`).boundingBox();
    const lb = await lane.boundingBox();
    await owner.mouse.click(col.x + col.width / 2, lb.y + lb.height * 0.7); // 14:40 쯤
    let qc = owner.getByTestId('quick-create'); await qc.waitFor();
    assert.deepEqual([await qc.getByLabel('시작 시각').inputValue(), await qc.getByLabel('종료 시각').inputValue()], ['14:30', '15:30'], '클릭 = 누른 자리 15분 칸(14:40 → 14:30)부터 1시간');
    await qc.getByLabel('빠른 입력 제목').press('Escape'); await qc.waitFor({ state: 'detached' });
    await owner.mouse.move(col.x + col.width / 2, lb.y + lb.height * 0.34); await owner.mouse.down(); // 14:20 → 14:15 칸
    await owner.mouse.move(col.x + col.width / 2, lb.y + lb.height * 0.6, { steps: 5 });
    await owner.mouse.move(col.x + col.width / 2, lb.y + lb.height * 0.84, { steps: 5 }); await owner.mouse.up(); // 14:50 → 14:45 칸
    qc = owner.getByTestId('quick-create'); await qc.waitFor();
    assert.deepEqual([await qc.getByLabel('시작 시각').inputValue(), await qc.getByLabel('종료 시각').inputValue()], ['14:15', '15:00'], '끌어서 그리기 = 15분 단위');
    await qc.getByLabel('빠른 입력 제목').press('Escape'); await qc.waitFor({ state: 'detached' });
    await side.getByRole('button', { name: '30분' }).click();
    await owner.waitForFunction(() => document.querySelector('[data-testid="cal-snap-side"] button[aria-pressed="true"]')?.textContent === '30분');
    assert.equal(await owner.evaluate(() => localStorage.getItem('wos_cal_snap')), '30', '이 기기에 기억');
    await owner.waitForTimeout(400);
    await drag(0.25); // 30분 단위면 15분 끌어도 다음 30분 칸으로
    for (let i = 0; i < 20 && (await startOf()) === '10:15'; i++) await owner.waitForTimeout(200);
    assert.equal(await startOf(), '10:45', '30분 단위');
    // 휴대폰 폭: 칩 줄의 'N분 단위' 칩 — PC 에서 고른 30분을 그대로 기억, 누르면 15분
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    const chip = owner.getByTestId('cal-snap'); await chip.waitFor();
    assert.match(await chip.innerText(), /30분 단위/, '이 기기 기억');
    await chip.click(); await owner.waitForFunction(() => document.querySelector('[data-testid="cal-snap"]')?.textContent?.includes('15분'));
    assert.equal(await owner.evaluate(() => localStorage.getItem('wos_cal_snap')), '15', '되돌려 둠');
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await ctx.owner.ok('DELETE', `/api/events/${r.id}`).catch(() => {});
  }
}
