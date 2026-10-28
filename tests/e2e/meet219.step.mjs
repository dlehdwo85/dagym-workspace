// 219차 워크인 화상회의 화면(결정 15-37 · 가짜 엔진 — 구조 시험 통과, 실제 연동 미확인): 일정 창 [워크인 화상회의] 켜기 → 회의 주소 칸(직접 붙여 넣는 칸 숨김) →
// 손님(로그인 없는 휴대폰 폭 브라우저) /meet/<code> 이름 → [참가 요청] → 대기 → 주최자 [참가] → 대기실 띠에서 허락 → 손님 회의 화면(시험 연결) · 주최자 화면에 손님 칸 →
// 잠금(다른 손님 요청 막힘) → 회의 끝내기 → 손님 '회의가 끝났습니다' → 일정 미리보기 [회의 참가] = 워크인 주소 · 회의 기록(직원 1 · 손님 1)
import assert from 'node:assert/strict';

export async function meet219({ owner, ctx, sql, BASE, SHOTS, browser }) {
  const day = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  let d = day(3); // 245차: 겹친 일정(구글식 겹쳐 놓기)이 위에 그려져 클릭을 가로채지 않게 13~16시가 빈 날을 고름
  for (let n = 3; n < 40; n++) { d = day(n); const [x] = await sql`select count(*)::int c from events where deleted_at is null and start_at < ${`${d}T16:00:00+09:00`} and end_at > ${`${d}T13:00:00+09:00`}`; if (!x.c) break; }
  const cals = (await ctx.owner.ok('GET', '/api/calendars')).calendars;
  const cal = (cals.find((c) => c.type === 'personal' && c.owner_user_id === ctx.ownerId) ?? cals.find((c) => c.type === 'personal')).id;
  const ev = (await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: 'E2E 219 고객사 화상 미팅', start: `${d}T14:00:00+09:00`, end: `${d}T15:00:00+09:00` })).id;
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/calendar?event=${ev}`);
  const dlg = owner.getByRole('dialog', { name: '일정 수정' });
  const box = dlg.getByTestId('ev-workin-meet'); await box.waitFor();
  await box.getByTestId('ev-workin-meet-toggle').click(); // 서버가 회의를 만든 뒤에 체크됨(check()는 바로 바뀌길 기대해서 click)
  const urlEl = box.getByTestId('ev-workin-meet-url'); await urlEl.waitFor();
  const url = (await urlEl.innerText()).trim();
  assert.match(url, new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/meet/[A-Za-z0-9_-]{22}$`), url);
  assert.equal(await dlg.getByTestId('ev-meeting-url').count(), 0, '워크인 회의면 직접 붙여 넣는 칸은 숨김');
  await box.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/567-meet-event-toggle.png`, clip: await dlg.boundingBox() });
  await dlg.getByTestId('editor-autosave').getByText('저장됨 ✓').waitFor();
  await dlg.getByTestId('editor-close').click(); await dlg.waitFor({ state: 'hidden' });
  assert.equal((await sql`select meeting_url from events where id = ${ev}`)[0].meeting_url, url, '일정 회의 주소 칸 = 워크인 회의 주소(자동 저장이 덮어쓰지 않음)');
  const code = url.split('/').pop();

  // 손님: 로그인 없는 휴대폰 폭 브라우저(시험 브라우저는 카메라가 없어 '없이 들어갈 수 있음' 안내)
  const gctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const g = await gctx.newPage();
  try {
    await g.goto(url);
    await g.getByTestId('meet-title').filter({ hasText: 'E2E 219 고객사 화상 미팅' }).waitFor();
    await g.getByTestId('meet-media-error').waitFor();
    assert.equal(await g.getByTestId('meet-join').isDisabled(), true, '이름을 적어야 참가 요청');
    await g.getByTestId('meet-name').fill('김손님');
    await g.screenshot({ path: `${SHOTS}/568-meet-guest-prejoin-390.png`, fullPage: true });
    assert.ok(await g.evaluate(() => document.documentElement.scrollWidth <= 390), '휴대폰 폭 넘침 없음(참가 전)');
    await g.getByTestId('meet-join').click();
    await g.getByTestId('meet-waiting').waitFor();
    // 주최자: 같은 주소 → 직원 [참가] → 회의 화면 · 대기실 띠에 손님 → 허락
    await owner.goto(url);
    await owner.getByTestId('meet-join').click();
    await owner.getByTestId('meet-room').waitFor();
    await owner.getByTestId('meet-engine').filter({ hasText: '시험 연결' }).waitFor();
    const host = owner.getByTestId('meet-host'); await host.waitFor();
    await host.getByTestId('meet-wait-row').filter({ hasText: '김손님(손님)' }).waitFor({ timeout: 10_000 });
    await owner.screenshot({ path: `${SHOTS}/569-meet-host-lobby.png` });
    await host.getByTestId('meet-admit').first().click();
    // 손님: 허락되면 회의 화면(시험 연결) · 주최자 화면에 손님 칸
    await g.getByTestId('meet-room').waitFor({ timeout: 15_000 });
    await g.getByTestId('meet-engine').filter({ hasText: '시험 연결' }).waitFor();
    assert.ok(await g.evaluate(() => document.documentElement.scrollWidth <= 390), '휴대폰 폭 넘침 없음(회의 중)');
    await g.screenshot({ path: `${SHOTS}/570-meet-guest-room-390.png` });
    await owner.getByTestId('meet-tile').filter({ hasText: '김손님(손님)' }).waitFor({ timeout: 10_000 });
    assert.equal(await owner.getByTestId('meet-tile').filter({ hasText: '김대표' }).count(), 0, '주최자 본인은 내 칸(나)에만 — 참가자 칸에 한 번 더 나오지 않음');
    // 잠금 → 새 손님 요청 막힘
    await host.getByTestId('meet-lock').click();
    await host.getByTestId('meet-lock').filter({ hasText: '회의 잠김' }).waitFor();
    const r = await fetch(`${BASE}/api/meet/${code}/guest`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ name: '늦은 손님' }) });
    assert.equal(r.status, 423, '잠긴 회의');
    // 끝내기 → 모두 끝 화면
    owner.once('dialog', (dl) => dl.accept());
    await host.getByTestId('meet-end').click();
    await owner.getByTestId('meet-ended').waitFor();
    await g.reload(); await g.getByTestId('meet-ended').waitFor();
  } finally { await gctx.close(); }
  // 일정 미리보기: [회의 참가] = 워크인 주소 · 회의 기록
  await owner.goto(`${BASE}/calendar?date=${d}`);
  await owner.getByTestId('calendar').waitFor();
  await owner.locator('.fc-timegrid-event', { hasText: 'E2E 219 고객사 화상 미팅' }).first().click();
  const pv = owner.getByTestId('event-preview');
  await pv.getByTestId('ev-join').waitFor();
  assert.equal(await pv.getByTestId('ev-join').getAttribute('href'), url);
  await pv.getByTestId('ev-meet-record').waitFor();
  assert.match(await pv.getByTestId('ev-meet-record').innerText(), /회의 기록: \d{2}:\d{2} 시작 · \d+분 · 직원 1 · 손님 1/);
  await owner.waitForTimeout(400); // 미리보기 창이 나타나는 움직임이 끝난 뒤 찍기
  await owner.screenshot({ path: `${SHOTS}/571-meet-record.png` });
  await owner.keyboard.press('Escape');
}
