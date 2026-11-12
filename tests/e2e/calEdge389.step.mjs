// 389차(대표 11/12 "스케줄 옮길 때 드래그해서 다음주로 넘기는게 불가함"): 구글 캘린더처럼 일정을 끌어 달력 오른쪽 끝에 잠깐 대면 다음 주로 넘어가고
// 끌기는 그대로 이어져 다음 주 원하는 날에 놓임 · 왼쪽 끝은 지난주 · 놓으면 끝 칸 표시가 사라짐
// · 휴대폰 손가락(길게 눌러 끌기): 넘어간 뒤 잡은 블록이 화면에서 빠져도 끝에서 벗어난 걸 알아 한 주 더 넘어가지 않음(만들며 찾은 문제)
import assert from 'node:assert/strict';

export async function calEdge389({ owner, ctx, sql, BASE }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const plus = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const d = ymd(1);
  const [cal] = await sql`select id from calendars where type = 'personal' and owner_user_id = ${ctx.ownerId}`;
  const TITLE = 'E2E 다음 주로 끌기';
  const r = await ctx.owner.ok('POST', '/api/events', { calendarId: cal.id, title: TITLE, start: `${d}T08:00:00+09:00`, end: `${d}T09:00:00+09:00`, allDay: false });
  const at = async () => (await sql`select to_char(start_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') s, to_char(end_at at time zone 'Asia/Seoul', 'HH24:MI') e from events where id = ${r.id}`)[0];
  const firstCol = () => owner.locator('.fc-timegrid-body td.fc-timegrid-col[data-date]').first().getAttribute('data-date');
  /** 일정을 잡아 한쪽 끝에 대고 있다가(기간이 넘어가면) 그 주의 nth 번째 날 칸에 놓음 → 놓은 칸 날짜 */
  const dragVia = async (side, wantFirst, nth) => {
    const ev = owner.locator('.fc-timegrid-event', { hasText: TITLE }).first(); await ev.waitFor();
    await ev.evaluate((el) => el.scrollIntoView({ block: 'center' })); await owner.waitForTimeout(200);
    const pt = await ev.evaluate((el) => { // 다른 일정에 가려지지 않은 점(calSnap199 와 같은 방식)
      const b = el.getBoundingClientRect();
      for (const fx of [0.5, 0.75, 0.9, 0.25, 0.1]) { const x = b.left + b.width * fx, y = b.top + 6; if (document.elementFromPoint(x, y)?.closest('.fc-timegrid-event') === el) return { x, y }; }
      return { x: b.left + b.width / 2, y: b.top + 6, hidden: true };
    });
    assert.ok(!pt.hidden, '끌 일정 블록이 보임');
    await owner.mouse.move(pt.x, pt.y); await owner.mouse.down();
    await owner.mouse.move(pt.x + 12, pt.y, { steps: 4 }); await owner.mouse.move(pt.x + 24, pt.y, { steps: 4 });
    const cols = owner.locator('.fc-timegrid-body td.fc-timegrid-col[data-date]');
    const edgeBox = await cols.nth(side > 0 ? 6 : 0).boundingBox();
    const ex = side > 0 ? edgeBox.x + edgeBox.width - 6 : edgeBox.x - 10; // 오른쪽 끝 칸 안쪽 6px · 왼쪽은 시간 눈금 칸
    await owner.mouse.move(ex, pt.y, { steps: 8 });
    const strip = owner.getByTestId(side > 0 ? 'cal-edge-next' : 'cal-edge-prev');
    await strip.waitFor(); // 끄는 동안 끝 칸 표시
    await owner.waitForFunction(([sel]) => document.querySelector(sel)?.getAttribute('data-hot') === '1', [`[data-testid="${side > 0 ? 'cal-edge-next' : 'cal-edge-prev'}"]`], { timeout: 5000 });
    // 0.6초 뒤 다음(이전) 주로 넘어감 — 넘어가자마자 끝에서 손을 뗌(계속 대고 있으면 1.2초마다 한 주씩 더)
    await owner.waitForFunction(([w]) => document.querySelector('.fc-timegrid-body td.fc-timegrid-col[data-date]')?.getAttribute('data-date') === w, [wantFirst], { timeout: 5000, polling: 50 });
    const tb = await cols.nth(nth).boundingBox();
    await owner.mouse.move(tb.x + tb.width / 2, pt.y, { steps: 4 }); await owner.waitForTimeout(250);
    const dropped = await owner.evaluate(([x, y]) => document.elementsFromPoint(x, y).map((e) => e.closest?.('td.fc-timegrid-col[data-date]')).find(Boolean)?.getAttribute('data-date'), [tb.x + tb.width / 2, pt.y]);
    assert.ok(await owner.locator('.fc-event-mirror').count(), '넘어간 뒤에도 끌기가 이어짐(미리 보기 블록)');
    await owner.mouse.up();
    await owner.getByText('일정을 이동했습니다').first().waitFor();
    await strip.waitFor({ state: 'detached' }); // 놓으면 끝 칸 표시가 사라짐
    return dropped;
  };
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    await owner.locator('.fc-timegrid-event', { hasText: TITLE }).first().waitFor();
    const w0 = await firstCol();
    // 오른쪽 끝 → 다음 주로 넘어가 다음 주 월요일(둘째 칸)에 놓음
    const t1 = await dragVia(1, plus(w0, 7), 1);
    assert.equal(t1, plus(w0, 8), '놓은 칸 = 다음 주 월요일');
    for (let i = 0; i < 25 && (await at()).s.slice(0, 10) === d; i++) await owner.waitForTimeout(200);
    assert.deepEqual(await at(), { s: `${t1} 08:00`, e: '09:00' }, '다음 주 월요일 같은 시각으로 옮겨짐(시간 길이 그대로)');
    assert.equal(await firstCol(), plus(w0, 7), '화면은 다음 주에 머묾');
    // 왼쪽 끝 → 지난주(처음 주)로 돌아와 원래 날짜에 놓음
    const nth = Math.round((Date.parse(d) - Date.parse(w0)) / 864e5);
    const t2 = await dragVia(-1, w0, nth);
    assert.equal(t2, d);
    for (let i = 0; i < 25 && (await at()).s.slice(0, 10) !== d; i++) await owner.waitForTimeout(200);
    assert.deepEqual(await at(), { s: `${d} 08:00`, e: '09:00' }, '왼쪽 끝 = 지난주로 넘어가 원래 날짜로');
    // 휴대폰 손가락: 길게 눌러 끌어 오른쪽 끝 → 다음 주 → 천천히(1.2초 넘게) 월요일로 옮겨 놓음 — 한 주 더 넘어가지 않음
    const pc = await owner.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await owner.context().storageState() });
    try {
      const ph = await pc.newPage();
      await ph.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
      const ev = ph.locator('.fc-timegrid-event', { hasText: TITLE }).first(); await ev.waitFor();
      await ev.evaluate((el) => el.scrollIntoView({ block: 'center' })); await ph.waitForTimeout(300);
      const bb = await ev.boundingBox();
      const pcols = ph.locator('.fc-timegrid-body td.fc-timegrid-col[data-date]');
      const pw0 = await pcols.first().getAttribute('data-date');
      const cdp = await pc.newCDPSession(ph);
      const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
      const x = bb.x + bb.width / 2, y = bb.y + 8;
      await touch('touchStart', x, y); await ph.waitForTimeout(600); // 길게 누름(0.35초)
      for (let i = 1; i <= 4; i++) { await touch('touchMove', x + i * 3, y); await ph.waitForTimeout(30); }
      const lb = await pcols.last().boundingBox();
      for (let xx = x + 12; xx < lb.x + lb.width - 6; xx += 15) { await touch('touchMove', xx, y); await ph.waitForTimeout(20); }
      await touch('touchMove', lb.x + lb.width - 6, y);
      await ph.waitForFunction(([w]) => document.querySelector('.fc-timegrid-body td.fc-timegrid-col[data-date]')?.getAttribute('data-date') === w, [plus(pw0, 7)], { timeout: 5000, polling: 50 });
      const mb = await pcols.nth(1).boundingBox();
      const steps = 12; // 끝 → 월요일을 약 1.8초에 걸쳐
      for (let i = 1; i <= steps; i++) { await touch('touchMove', lb.x + lb.width - 6 + ((mb.x + mb.width / 2) - (lb.x + lb.width - 6)) * (i / steps), y); await ph.waitForTimeout(150); }
      assert.equal(await ph.getByTestId('cal-edge-next').getAttribute('data-hot'), '0', '끝에서 벗어난 걸 앎(손가락)');
      assert.equal(await pcols.first().getAttribute('data-date'), plus(pw0, 7), '한 주 더 넘어가지 않음');
      await touch('touchEnd', 0, 0);
      await ph.getByText('일정을 이동했습니다').first().waitFor();
      for (let i = 0; i < 25 && (await at()).s.slice(0, 10) === d; i++) await ph.waitForTimeout(200);
      assert.deepEqual(await at(), { s: `${plus(pw0, 8)} 08:00`, e: '09:00' }, '휴대폰 손가락으로 다음 주 월요일에 놓음');
    } finally { await pc.close(); }
  } finally {
    await ctx.owner.ok('DELETE', `/api/events/${r.id}`).catch(() => {});
  }
}
