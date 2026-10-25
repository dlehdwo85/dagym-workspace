// V14 41번: 휴대폰 주·3일 보기 가독성 — 블록 제목만 줄바꿈·사람 머리글자 없음(일 보기·PC 는 있음), 축 "오전/오후", 색 버튼은 머리줄
// #592(대표 10/25 구글 대조)로 바뀐 값: 종일 칩 한 줄·11px, 블록 11px, 칸 높이 주 40/3일 48/일 64
import assert from 'node:assert/strict';
export async function v1441({ browser, desk, ctx, BASE, SHOTS, addDays, today }) {
  const d = addDays(today, 14);
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
  await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '음성 아이파크 미팅', allDay: true, start: `${d}T00:00:00+09:00`, end: `${addDays(d, 1)}T00:00:00+09:00` });
  await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '판교 하이링크 운영 점검 회의', start: `${d}T10:00:00+09:00`, end: `${d}T12:00:00+09:00` });
  const tid = (await ctx.owner.ok('POST', '/api/tasks', { title: '고천 대방 현장 점검', assigneeId: ctx.staffA.id, dueDate: d, dueTime: '15:00', approvalRequired: false })).id;
  const mc = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  await mc.addInitScript(() => { try { localStorage.setItem('wos_cal_allday', '1'); } catch {} }); // 10/22 종일 칸 기본 숨김 — 이 시험은 켠 상태의 칩 모양
  const m = await mc.newPage();
  try {
    await m.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    await m.locator('[data-allday-chip]').filter({ hasText: '아이파크' }).first().waitFor();
    const chip = await m.locator('[data-allday-chip]').filter({ hasText: '아이파크' }).first().evaluate((el) => ({ h: el.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(el).fontSize), ws: getComputedStyle(el).whiteSpace }));
    assert.ok(chip.h <= 18, `종일 칩 한 줄 ${chip.h}px`); assert.ok(chip.fs <= 11.5, `종일 칩 11px ${chip.fs}`); assert.equal(chip.ws, 'nowrap');
    const blk = m.locator(`[data-task-item="${tid}"]`).first();
    await blk.waitFor();
    assert.ok(!(await blk.innerText()).includes('·'), '휴대폰 주 보기: 사람 머리글자 없음');
    assert.equal(await m.locator('[data-narrow-block]').filter({ hasText: '판교' }).count(), 1, '블록은 제목만 줄바꿈');
    // V36 6: 2시간 블록만 아래에 시각, 1시간 업무 블록은 제목만(시각이 제목을 가리지 않음) · #592 블록 글씨 11px
    const nb = m.locator('[data-narrow-block]').filter({ hasText: '판교' }).first();
    assert.equal(await nb.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), 11, '블록 글씨 11px');
    assert.equal(await nb.locator('[data-block-time]').count(), 1, '긴 블록은 시각 표시');
    assert.equal(await m.locator('[data-narrow-block]').filter({ hasText: '고천' }).locator('[data-block-time]').count(), 0, '짧은 블록은 시각 생략');
    const slot = await m.locator('.fc-timegrid-slot').first().evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(Math.abs(slot - 40) <= 1, `주 칸 40px ${slot}`);
    assert.match(await m.locator('[data-axis-label]').first().innerText(), /오[전후]\s*\d+시/);
    assert.equal(await m.getByRole('button', { name: '캘린더 색 설정' }).filter({ visible: true }).count(), 1, '색 설정 단추 하나(#592 머리줄 → 아래 칩 줄)');
    await m.screenshot({ path: `${SHOTS}/v14-41-phone-week.png`, fullPage: false });
    await m.goto(`${BASE}/calendar?view=timeGrid3&date=${d}`);
    await m.locator('.fc-timegrid-slot').first().waitFor();
    assert.ok(Math.abs((await m.locator('.fc-timegrid-slot').first().evaluate((el) => el.getBoundingClientRect().height)) - 48) <= 1, '3일 칸 48px');
    await m.goto(`${BASE}/calendar?view=timeGridDay&date=${d}`);
    await m.locator(`[data-task-item="${tid}"]`).first().waitFor();
    assert.ok((await m.locator(`[data-task-item="${tid}"]`).first().innerText()).includes('·'), '일 보기는 사람 머리글자 유지');
    assert.ok(Math.abs((await m.locator('.fc-timegrid-slot').first().evaluate((el) => el.getBoundingClientRect().height)) - 64) <= 1, '일 칸 64px');
  } finally { await mc.close(); await ctx.owner.ok('DELETE', `/api/tasks/${tid}`).catch(() => {}); }
}
