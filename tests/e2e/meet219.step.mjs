// 219차 워크인 화상회의 화면(결정 15-37 · 가짜 엔진 — 구조 시험 통과, 실제 연동 미확인): 일정 창 [워크인 화상회의] 켜기 → 회의 주소 칸(직접 붙여 넣는 칸 숨김) →
// 손님(로그인 없는 휴대폰 폭 브라우저) /meet/<code> 이름 → [참가 요청] → 대기 → 주최자 [참가] → 대기실 띠에서 [들여보내기] → 손님 회의 화면(시험 연결) · 주최자 화면에 손님 칸 →
// (대표 11/19 보강) 아래 도구줄 7개 · 채팅 주고받기 · 휴대폰 공유 창(화면 전체 공유 미지원 안내 + 사진·PDF 보여 주기) · 참가자 관리 · 더보기(반응·손들기·대기실 설명) →
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
  await dlg.getByTestId('editor-autosave').getByText('저장됨', { exact: true }).waitFor();
  await dlg.getByTestId('editor-close').click(); await dlg.waitFor({ state: 'hidden' });
  assert.equal((await sql`select meeting_url from events where id = ${ev}`)[0].meeting_url, url, '일정 회의 주소 칸 = 워크인 회의 주소(자동 저장이 덮어쓰지 않음)');
  const code = url.split('/').pop();

  // 손님: 로그인 없는 휴대폰 폭 브라우저(시험 브라우저는 카메라가 없어 '없이 들어갈 수 있음' 안내)
  const gctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await gctx.addInitScript(() => { try { Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined, configurable: true }); } catch {} }); // 휴대폰 브라우저처럼: 화면 전체 공유 기능 없음
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
    // 대표 11/19 "대기실이 뭔지 모르겠다": 주최자 설정은 펼쳐 두지 않는다 — 기다리는 사람이 있을 때만 화면 위에 띠가 뜨고 거기서 바로 들여보냄
    assert.equal(await owner.getByTestId('meet-host').count(), 0, '주최자 설정은 [더보기] 안(항상 펼쳐 두지 않음)');
    const banner = owner.getByTestId('meet-wait-banner');
    await banner.filter({ hasText: '김손님(손님) 님이 들어오려고 기다립니다' }).waitFor({ timeout: 10_000 });
    assert.equal((await owner.getByTestId('meet-people-badge').innerText()).trim(), '1', '참가자 단추에 기다리는 사람 수');
    await owner.getByTestId('meet-people').click();
    const pp = owner.getByTestId('meet-people-panel');
    await pp.getByTestId('meet-wait-row').filter({ hasText: '김손님(손님)' }).waitFor();
    await owner.screenshot({ path: `${SHOTS}/569-meet-host-lobby.png` });
    await owner.getByTestId('meet-panel-close').click();
    await banner.getByTestId('meet-admit').click();
    await banner.waitFor({ state: 'hidden' });
    // 손님: 들여보내면 회의 화면(시험 연결) · 주최자 화면에 손님 칸
    await g.getByTestId('meet-room').waitFor({ timeout: 15_000 });
    await g.getByTestId('meet-engine').filter({ hasText: '시험 연결' }).waitFor();
    assert.ok(await g.evaluate(() => document.documentElement.scrollWidth <= 390), '휴대폰 폭 넘침 없음(회의 중)');
    // 아래 도구줄: 휴대폰에서도 7개가 한 줄에 다 보임(마이크·카메라·공유·참가자·채팅·더보기·나가기)
    const bar = await g.getByTestId('meet-toolbar').boundingBox();
    assert.ok(bar && bar.y + bar.height <= 844 && bar.x >= 0 && bar.x + bar.width <= 390, '도구줄이 화면 안');
    for (const t of ['meet-mic', 'meet-cam', 'meet-share', 'meet-people', 'meet-chat', 'meet-more', 'meet-leave']) { const bb = await g.getByTestId(t).boundingBox(); assert.ok(bb && bb.x >= 0 && bb.x + bb.width <= 390, `${t} 가 화면 안`); }
    assert.equal(await g.getByTestId('meet-host').count(), 0, '손님에게는 주최자 설정 없음');
    await g.screenshot({ path: `${SHOTS}/570-meet-guest-room-390.png` });
    await owner.getByTestId('meet-tile').filter({ hasText: '김손님(손님)' }).waitFor({ timeout: 10_000 });
    assert.equal(await owner.getByTestId('meet-tile').filter({ hasText: '김대표' }).count(), 0, '주최자 본인은 내 칸(나)에만 — 참가자 칸에 한 번 더 나오지 않음');
    // 채팅: 손님이 보내면 주최자 채팅 단추에 숫자 → 열면 글 → 답하면 손님에게도
    await g.getByTestId('meet-chat').click();
    await g.getByTestId('meet-chat-input').fill('안녕하세요, 김손님입니다');
    await g.getByTestId('meet-chat-send').click();
    await g.getByTestId('meet-chat-msg').filter({ hasText: '안녕하세요, 김손님입니다' }).waitFor();
    await owner.getByTestId('meet-chat-badge').waitFor({ timeout: 10_000 });
    await owner.getByTestId('meet-chat').click();
    await owner.getByTestId('meet-chat-msg').filter({ hasText: '안녕하세요, 김손님입니다' }).waitFor();
    assert.match(await owner.getByTestId('meet-chat-msg').first().innerText(), /김손님\(손님\)/, '보낸 사람 이름');
    await owner.getByTestId('meet-chat-input').fill('반갑습니다. 자료 보여 드릴게요');
    await owner.getByTestId('meet-chat-input').press('Enter');
    await g.getByTestId('meet-chat-msg').filter({ hasText: '반갑습니다. 자료 보여 드릴게요' }).waitFor({ timeout: 10_000 });
    await g.screenshot({ path: `${SHOTS}/572-meet-chat-390.png` });
    await g.getByTestId('meet-panel-close').click();
    await owner.getByTestId('meet-panel-close').click();
    // 공유(휴대폰 브라우저 = 화면 전체 공유 미지원): 까닭을 알려 주고, 사진·PDF 는 바로 보여 줄 수 있음
    await g.getByTestId('meet-share').click();
    const sp = g.getByTestId('meet-share-panel');
    await sp.getByTestId('meet-share-unsupported').waitFor();
    assert.equal(await sp.getByTestId('meet-share-screen').count(), 0, '화면 전체 공유를 못 하는 기기에는 그 단추 없음');
    await g.screenshot({ path: `${SHOTS}/573-meet-share-390.png` });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFElEQVR4nGP8z4AdMOEQH5QSAGkPAQ+CcV/9AAAAAElFTkSuQmCC', 'base64');
    await g.getByTestId('meet-share-file').setInputFiles({ name: '견적서.png', mimeType: 'image/png', buffer: png });
    const ss = g.getByTestId('meet-screen-share'); await ss.waitFor();
    assert.equal(await ss.getAttribute('data-mine'), '1'); assert.match(await ss.innerText(), /내가 공유 중 · 견적서\.png/);
    assert.match((await g.getByTestId('meet-share').innerText()).trim(), /공유 중/);
    await g.screenshot({ path: `${SHOTS}/574-meet-doc-share-390.png` });
    await g.getByTestId('meet-zoom-in').click(); assert.equal((await g.getByTestId('meet-zoom').innerText()).trim(), '150%');
    await g.getByTestId('meet-share-stop-inline').click(); await ss.waitFor({ state: 'hidden' });
    // 컴퓨터(주최자): 공유 창에 [화면 공유]·[사진·PDF] 둘 다
    await owner.getByTestId('meet-share').click();
    await owner.getByTestId('meet-share-panel').getByTestId('meet-share-screen').waitFor();
    await owner.getByTestId('meet-share-panel').getByTestId('meet-share-doc').waitFor();
    assert.equal(await owner.getByTestId('meet-share-unsupported').count(), 0);
    await owner.getByTestId('meet-panel-close').click();
    // 참가자 창: 두 사람 · 손님 관리(마이크 끄기·내보내기 — 손님은 공동 주최자 못 됨)
    await owner.getByTestId('meet-people').click();
    await owner.getByTestId('meet-person').nth(1).waitFor();
    assert.equal(await owner.getByTestId('meet-person').count(), 2);
    await owner.getByTestId('meet-person-more').click();
    await owner.getByTestId('meet-person-remove').waitFor();
    assert.equal(await owner.getByTestId('meet-person-cohost').count(), 0);
    await owner.getByTestId('meet-person-mute').click();
    await owner.getByText('김손님(손님) 님의 마이크를 껐습니다').waitFor();
    await owner.getByTestId('meet-panel-close').click();
    // 더보기: 반응·손들기 · 보기 · 초대 주소 · 주최자 설정(대기실 설명)
    await owner.getByTestId('meet-more').click();
    const more = owner.getByTestId('meet-more-panel');
    assert.equal((await more.getByTestId('meet-invite-url').innerText()).trim(), url);
    const host = more.getByTestId('meet-host'); await host.waitFor();
    assert.match(await host.getByTestId('meet-lobby-help').innerText(), /대기실은 회의에 들어오기 전에 잠깐 기다리는 곳입니다.*\[들여보내기\]를 눌러야 들어옵니다/);
    assert.deepEqual(await host.getByTestId('meet-lobby-policy').locator('option').allInnerTexts(), ['회사 밖 손님만 기다림(직원은 바로 들어옴)', '모두 기다림(주최자가 들여보냄)', '초대받지 않은 사람만 기다림', '대기실 끔(누구나 바로 들어옴)']);
    await owner.screenshot({ path: `${SHOTS}/575-meet-more-host.png` });
    await more.getByTestId('meet-react').first().click();
    await owner.getByTestId('meet-self').getByTestId('meet-tile-react').waitFor();
    await owner.getByTestId('meet-more').click();
    await owner.getByTestId('meet-hand').click();
    await owner.getByTestId('meet-hands').filter({ hasText: '나' }).waitFor();
    await owner.getByTestId('meet-self').getByTestId('meet-tile-hand').waitFor();
    // 주최자 [나가기] = 나만 나가기 / 회의 끝내기 고르기
    await owner.getByTestId('meet-leave').click();
    await owner.getByTestId('meet-leave-panel').getByTestId('meet-leave-only').waitFor();
    await owner.getByTestId('meet-leave-panel').getByText('취소').click();
    // 잠금 → 새 손님 요청 막힘
    await owner.getByTestId('meet-more').click();
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
