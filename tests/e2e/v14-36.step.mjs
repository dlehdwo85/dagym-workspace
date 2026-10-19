// V14 36~39번: 캘린더 스와이프 이동 · 업무 동그라미 제거 · 블록 글자 가독성(12px·여러 줄·계단 겹침·휴대폰 3일) · 뒤로가기 = 오버레이만 닫힘
import assert from 'node:assert/strict';
export async function v1436({ browser, desk, owner, ctx, sql, BASE, SHOTS, addDays, today }) {
  let d = addDays(today, 7); // 다음 주(공휴일이어도 무관)
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
  const iso = (t) => `${d}T${t}:00+09:00`;
  await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '겹침 회의 가나다라마바사', start: iso('10:00'), end: iso('11:00') });
  await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '겹침 둘째 일정 제목이 깁니다', start: iso('10:00'), end: iso('11:30') });
  await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '혼자 있는 긴 제목 회의 일정', start: `${addDays(d, 1)}T13:00:00+09:00`, end: `${addDays(d, 1)}T14:00:00+09:00` });
  const tid = (await ctx.owner.ok('POST', '/api/tasks', { title: '동그라미 없는 업무', assigneeId: ctx.ownerId, dueDate: d, dueTime: '15:00', approvalRequired: false })).id;

  // ㊲ 업무 동그라미 없음(캘린더·홈) — 업무는 왼쪽 굵은 선
  await owner.goto(`${BASE}/calendar?date=${d}`);
  const item = owner.locator(`[data-task-item="${tid}"]`).first();
  await item.waitFor();
  assert.equal(await owner.locator('.fc-event.task-item .rounded-full').count(), 0, '캘린더 업무에 동그라미 없음');
  assert.equal(await owner.locator('.fc-event [aria-label="완료"], .fc-event [aria-label="업무"]').count(), 0);
  const bl = await owner.locator('.fc-event.task-item').first().evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth));
  assert.ok(bl >= 3.5, `업무 = 왼쪽 굵은 선 ${bl}px`);

  // ㊳ 블록 글자: 12px, 겹친 둘째 칸도 제목·시간이 블록 안에(아래 잘림 없음), 계단식 겹침
  for (const name of ['겹침 회의 가나다라마바사', '겹침 둘째 일정 제목이 깁니다']) {
    const r = await owner.locator('[data-ev-block]', { hasText: name }).first().evaluate((el) => {
      const box = el.getBoundingClientRect(), last = el.lastElementChild.getBoundingClientRect();
      return { fs: getComputedStyle(el).fontSize, inside: last.bottom <= box.bottom + 1 && last.height > 0, time: el.lastElementChild.textContent };
    });
    assert.equal(r.fs, '12px', `${name} 12px`);
    assert.ok(r.inside, `${name}: 시간 줄이 블록 안에 보임`);
    assert.match(r.time, /10/, `${name}: 시간은 제목 아래 작은 글자`);
  }
  assert.ok(await owner.locator('.fc-timegrid-event-harness-inset').count() >= 1, '겹친 일정은 계단식(뒤 블록이 일부만 가림)');
  await owner.locator('[data-ev-block]', { hasText: '겹침 회의' }).first().scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/v14-38-blocks-week.png` });

  // ㊴ 뒤로가기 = 상세(오버레이)만 닫힘, 캘린더 날짜·보기 유지
  await item.click();
  await owner.getByTestId('task-panel').waitFor();
  await owner.goBack();
  await owner.getByTestId('task-panel').waitFor({ state: 'detached' });
  assert.match(owner.url(), new RegExp(`/calendar\\?.*date=${d}`), `뒤로가기 뒤에도 캘린더 그 날짜: ${owner.url()}`);
  assert.match(owner.url(), /view=timeGridWeek/);
  await owner.locator('[data-ev-block]', { hasText: '겹침 회의' }).first().click();
  await owner.getByTestId('event-preview').waitFor();
  await owner.goBack();
  await owner.getByTestId('event-preview').waitFor({ state: 'detached' });
  assert.ok(owner.url().includes('/calendar'), '일정 미리보기도 뒤로가기로 닫힘');
  // 버튼으로 닫으면 기록 칸을 되돌려, 다음 뒤로가기는 원래 이전 화면으로
  await owner.goto(BASE + '/tasks');
  await owner.goto(`${BASE}/calendar?date=${d}`);
  await item.click();
  await owner.getByTestId('task-panel').getByRole('button', { name: '패널 닫기' }).click();
  await owner.getByTestId('task-panel').waitFor({ state: 'detached' });
  await owner.goBack();
  await owner.waitForURL(/\/tasks/);
  // 홈 이번 주 줄에도 동그라미 없음
  await owner.goto(BASE + '/');
  await owner.getByTestId('home-week').waitFor();
  assert.equal(await owner.locator('[data-week-task] button.rounded-full, [data-week-task] [role="checkbox"]').count(), 0, '홈 이번 주 업무 동그라미(체크 버튼) 없음 — 색 막대·꼬리표만');

  // 휴대폰: 기본 3일 보기, 블록 글자 5자 넘게 보임, 좌우로 밀어 이동, 스크롤 위치 복원
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await mc.addInitScript(() => { try { localStorage.removeItem('wos_cal_view2'); } catch {} });
  const m = await mc.newPage();
  await m.goto(`${BASE}/calendar?date=${d}`);
  await m.getByTestId('cal-mobile-head').waitFor();
  await m.getByTestId('cal-mobile-head').getByRole('button', { name: '3일', pressed: true }).waitFor({ timeout: 8000 }); // 휴대폰 기본 = 3일
  assert.equal(await m.locator('[data-day-head]').count(), 3);
  const blk = m.locator('[data-ev-block]', { hasText: '혼자 있는 긴 제목' }).first();
  await blk.waitFor();
  const shown = await blk.evaluate((el) => { const t = el.firstElementChild; return { full: t.scrollHeight <= t.clientHeight + 1, w: el.getBoundingClientRect().width }; });
  assert.ok(shown.full, `3일 보기에서 1시간 블록 제목(13자)이 잘리지 않고 여러 줄로 보임(블록 폭 ${shown.w}px)`);
  await blk.scrollIntoViewIfNeeded();
  await m.screenshot({ path: `${SHOTS}/v14-38-mobile-3day.png` });
  // ㊱ 왼쪽으로 밀기 → 다음 3일, 오른쪽 → 되돌아옴
  const cdp = await mc.newCDPSession(m);
  await m.locator('.fc-timegrid-slot-lane[data-time="08:00:00"]').first().evaluate((el) => el.scrollIntoView({ block: 'center' })); // 첫 위치는 시각마다 다름(10/19)
  const lane = await m.locator('.fc-timegrid-slot-lane[data-time="08:00:00"]').first().boundingBox();
  const swipe = async (from, to) => {
    const y = lane.y + lane.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y, id: 1 }] });
    for (let i = 1; i <= 6; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + ((to - from) * i) / 6, y, id: 1 }] }); await m.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await m.waitForTimeout(700);
  };
  const first = () => m.locator('[data-day-head]').first().getAttribute('data-day-head');
  assert.equal(await first(), d);
  await swipe(330, 70);
  assert.equal(await first(), addDays(d, 3), '왼쪽으로 밀면 다음 3일');
  assert.ok(m.url().includes(`date=${addDays(d, 3)}`), '이동한 날짜가 주소에');
  assert.equal(await m.getByTestId('quick-create').count() + await m.getByRole('dialog', { name: '업무 등록' }).count(), 0, '밀기는 빠른 등록을 열지 않음');
  await swipe(70, 330);
  assert.equal(await first(), d, '오른쪽으로 밀면 이전');
  await swipe(200, 170); // 짧게 밀면 제자리
  assert.equal(await first(), d);
  // ㊴ 다른 화면에 갔다가 뒤로 오면 보기·날짜·스크롤 그대로
  // 대표 지적(10/19): 시간 보기는 높이 고정·달력 안에서 스크롤 → 그 칸의 위치를 복원
  const sc = () => m.evaluate(() => document.querySelector('.fc-timegrid-body')?.closest('.fc-scroller')?.scrollTop ?? 0);
  await m.evaluate(() => { const el = document.querySelector('.fc-timegrid-body')?.closest('.fc-scroller'); if (el) el.scrollTop = 300; });
  await m.waitForTimeout(700);
  const before = await sc();
  assert.ok(before > 200, `달력 칸 안 스크롤 (${before})`);
  await m.goto(BASE + '/tasks');
  await m.goBack();
  await m.waitForFunction(() => (document.querySelector('.fc-timegrid-body')?.closest('.fc-scroller')?.scrollTop ?? 0) > 200, null, { timeout: 8000 });
  assert.equal(await first(), d, '돌아와도 같은 날짜');
  await mc.close();
}
