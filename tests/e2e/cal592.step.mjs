// #592(대표 10/25 "구글 캘린더처럼 한눈에", docs/handoff/CAL_WEEK_GOOGLE_PARITY_2026-10-25.md §2·§3) 휴대폰 390px 주 보기:
// 시간 칸 40px(3일 48·일 64) · 블록 11px 중간 굵기 2줄 · 앞머리 대괄호 태그 떼고 내용부터(부재 종류 [연차] 등은 유지) ·
// 종일 줄 기본 켬(하루 2줄까지, 넘치면 '+n개' → 그날 목록) · 미팅 단추 둥근 48px(아래로 밀면 숨고 위로 올리면 다시) · 머리줄 한 줄(보기 전환 포함)
import assert from 'node:assert/strict';

export async function cal592({ browser, desk, ctx, BASE, SHOTS, addDays, today }) {
  const d = addDays(today, 21);
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
  const ev = (body) => ctx.owner.ok('POST', '/api/events', { calendarId: cal, ...body });
  const made = [];
  for (const t of ['E2E 종일 하나', 'E2E 종일 둘', 'E2E 종일 셋']) made.push((await ev({ title: t, allDay: true, start: `${d}T00:00:00+09:00`, end: `${addDays(d, 1)}T00:00:00+09:00` })).id);
  made.push((await ev({ title: '[영업] 판교 미팅', start: `${d}T10:00:00+09:00`, end: `${d}T11:00:00+09:00` })).id);
  made.push((await ev({ title: '본사 회의', start: `${d}T14:00:00+09:00`, end: `${d}T15:00:00+09:00` })).id);
  made.push((await ev({ title: '여름 쉼', kind: 'vacation', start: `${d}T18:00:00+09:00`, end: `${d}T19:00:00+09:00` })).id);
  const tid = (await ctx.owner.ok('POST', '/api/tasks', { title: '[다짐 문의] 서초네이처힐1단지 · 스포츠시설 운영 (서울)', assigneeId: ctx.ownerId, orgUnitId: ctx.hq, dueDate: d, dueTime: '17:00', approvalRequired: false })).id;
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  const m = await mc.newPage();
  const slotH = () => m.locator('.fc-timegrid-slot').first().evaluate((el) => el.getBoundingClientRect().height);
  try {
    await m.goto(`${BASE}/calendar?view=timeGridWeek&date=${d}`);
    await m.locator(`[data-task-item="${tid}"]`).first().waitFor();
    await m.locator('#wos-intro').waitFor({ state: 'detached' }).catch(() => {}); // 실행 애니메이션(세션 첫 화면 1초)이 걷힌 뒤
    console.log('    #592 세로 배치', JSON.stringify(await m.evaluate(() => { const r = (q) => { const e = document.querySelector(q); if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.height)]; };
      return { cal: r('[data-testid="calendar"]'), head: r('[data-testid="cal-mobile-head"]'), colHead: r('.fc-col-header'), allDay: r('.fc-timegrid .fc-daygrid-body'), scroller: r('.fc-timegrid-body')?.length ? r('.fc-timegrid-body') : null, sc: (() => { const sc = document.querySelector('.fc-timegrid-body')?.closest('.fc-scroller'); const b = sc?.getBoundingClientRect(); return b ? [Math.round(b.top), Math.round(b.height)] : null; })(), h1: r('h1'), vh: innerHeight }; })));
    await m.screenshot({ path: `${SHOTS}/280-cal-week-390.png` });
    // ① 시간 칸 40px → 한 화면 시간 수
    assert.ok(Math.abs((await slotH()) - 40) <= 1, `주 칸 40px ${await slotH()}`);
    const hours = await m.evaluate(() => { const sc = document.querySelector('.fc-timegrid-body')?.closest('.fc-scroller'); return sc ? sc.clientHeight / 40 : 0; });
    console.log('    #592 390×844 주 보기 한 화면 시간 수', hours.toFixed(1));
    assert.ok(hours >= 14, `한 화면 14시간 이상 ${hours.toFixed(1)}`);
    // ② 블록 글자 11px·중간 굵기, 1시간 블록 2줄
    const blk = m.locator('[data-narrow-block]').filter({ hasText: '본사 회의' }).first();
    const st = await blk.evaluate((el) => { const s = getComputedStyle(el), t = getComputedStyle(el.firstElementChild); return { fs: parseFloat(s.fontSize), fw: t.fontWeight, clamp: t.webkitLineClamp, h: el.getBoundingClientRect().height, lh: parseFloat(s.lineHeight) }; });
    assert.equal(st.fs, 11, `블록 11px ${st.fs}`); assert.equal(st.fw, '500', `중간 굵기 ${st.fw}`); assert.equal(st.clamp, '2', '1시간 블록 2줄');
    assert.ok(st.h >= st.lh * 2, `1시간 블록 높이에 2줄 ${st.h} / ${st.lh}`);
    // ③ 앞머리 태그는 떼고 내용부터(전체 제목은 title), 부재 종류는 유지
    const task = m.locator(`[data-task-item="${tid}"]`).first();
    assert.match(await task.innerText(), /^서초네이처힐/, '업무 [다짐 문의] 떼고 내용부터');
    assert.match(await task.getAttribute('title'), /^\[다짐 문의\] 서초네이처힐/, '전체 제목은 title');
    assert.match(await m.locator('[data-narrow-block]').filter({ hasText: '판교 미팅' }).first().innerText(), /^판교 미팅/, '[영업] 뗌');
    assert.match(await m.locator('[data-narrow-block]').filter({ hasText: '여름 쉼' }).first().innerText(), /^\[연차\] 여름 쉼/, '부재 종류 [연차] 유지');
    // ④ 종일 줄 기본 켬(설정 없이) · 하루 2줄(칩 1 + '+2개') → 그날 목록
    await m.locator('.fc-timegrid .fc-daygrid-body').first().waitFor();
    const dayCell = m.locator(`.fc-timegrid .fc-daygrid-day[data-date="${d}"]`);
    assert.equal(await dayCell.locator('[data-allday-chip]:visible').count(), 1, '종일 칩 1개 + 더 보기 = 2줄'); // FullCalendar 는 넘친 칩도 숨겨 둔 채 그려 둠
    const chipH = await dayCell.locator('[data-allday-chip]:visible').first().evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(chipH <= 18, `종일 칩 한 줄 ${chipH}`);
    const more = dayCell.locator('.fc-more-link'); assert.equal(await more.innerText(), '+2개');
    await more.click();
    const sheet = m.getByTestId('allday-sheet'); await sheet.getByText('E2E 종일 셋').waitFor();
    assert.equal(await sheet.locator('li').count(), 3, '그날 종일 3개 목록');
    await sheet.getByRole('button', { name: '닫기' }).click(); await sheet.waitFor({ state: 'detached' });
    // ⑤ 미팅 단추: 둥근 48px · 아래로 밀면 숨고 위로 올리면 다시
    const fab = m.getByTestId('cal-meeting-fab');
    const fb = await fab.evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, br: parseFloat(getComputedStyle(el).borderTopLeftRadius), label: el.getAttribute('aria-label'), text: el.innerText.trim() }; });
    assert.deepEqual([Math.round(fb.w), Math.round(fb.h)], [48, 48], `미팅 단추 48px ${fb.w}×${fb.h}`); assert.ok(fb.br >= 24, '둥근 단추'); assert.equal(fb.label, '미팅 일정'); assert.equal(fb.text, '', '글자 없이 아이콘만');
    const scroll = (y) => m.evaluate((y) => { const sc = document.querySelector('.fc-timegrid-body')?.closest('.fc-scroller'); sc.scrollTop = y; sc.dispatchEvent(new Event('scroll')); }, y);
    await scroll(0); await scroll(240);
    await m.waitForFunction(() => document.querySelector('[data-testid="cal-meeting-fab"]')?.getAttribute('data-hidden') === '1');
    assert.equal(await fab.evaluate((el) => getComputedStyle(el).pointerEvents), 'none', '숨으면 눌리지 않음');
    await scroll(120);
    await m.waitForFunction(() => document.querySelector('[data-testid="cal-meeting-fab"]')?.getAttribute('data-hidden') === '0');
    // ⑥ 3일 48px · 일 64px(일 보기는 태그 그대로)
    await m.goto(`${BASE}/calendar?view=timeGrid3&date=${d}`); await m.locator('.fc-timegrid-slot').first().waitFor();
    assert.ok(Math.abs((await slotH()) - 48) <= 1, `3일 칸 48px ${await slotH()}`);
    await m.goto(`${BASE}/calendar?view=timeGridDay&date=${d}`); await m.locator(`[data-task-item="${tid}"]`).first().waitFor();
    assert.ok(Math.abs((await slotH()) - 64) <= 1, `일 칸 64px ${await slotH()}`);
    assert.match(await m.locator(`[data-task-item="${tid}"]`).first().innerText(), /\[다짐 문의\]/, '일 보기는 제목 그대로');
  } finally {
    await mc.close();
    for (const id of made) await ctx.owner.req('DELETE', `/api/events/${id}`).catch(() => {});
    await ctx.owner.ok('DELETE', `/api/tasks/${tid}`).catch(() => {});
  }
}
