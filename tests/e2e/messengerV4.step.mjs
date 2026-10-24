// 메신저 2차(대표 10/20 카톡 수준 B8~B11·C13): '여기까지 읽었습니다' 선 → 긴 글 [전체 보기] → [+] 투표(투표·실시간·누가·마감) → [+] 일정 잡기(카드)
// → 스티커 → 사진 3장 한 묶음·좌우 넘기기 뷰어 → @전체 → 메시지에서 일정(글의 날짜·시각 미리 채움)·자주 쓰는 반응 → 답장 원문 이동(지난 구간·[최신 메시지로])
// → 휴대폰 [+] 패널(넘침 없음)·방 목록 왼쪽 밀기 → [알림 끄기]
import assert from 'node:assert/strict';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));

export async function messengerV4({ owner, ctx, sql, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1280, height: 860 });
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '2차 화면 시험방', userIds: [ctx.staffA.id, ctx.staffB.id] })).id;
  await ctx.owner.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '대표가 먼저 한마디' }); // 여기까지 읽음
  for (const t of ['읽기 전 1', '읽기 전 2']) await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: t });
  await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: Array.from({ length: 30 }, (_, i) => `${i + 1}. 긴 글 줄 — 현장 점검 항목`).join('\n') });
  await owner.goto(`${BASE}/messages?room=${room}`);
  const list = owner.getByTestId('chat-messages');
  // B11 '여기까지 읽었습니다' = 내가 읽은 곳 다음
  await list.getByTestId('chat-read-line').waitFor();
  const at = await list.evaluate((el) => { const t = el.innerText; return [t.indexOf('대표가 먼저 한마디'), t.indexOf('여기까지 읽었습니다'), t.indexOf('읽기 전 1')]; });
  assert.ok(at[0] >= 0 && at[0] < at[1] && at[1] < at[2], `선 위치 ${at}`);
  await owner.screenshot({ path: `${SHOTS}/258-chat-read-line.png` });
  // B8 긴 글 → [전체 보기]
  await list.getByTestId('chat-message').filter({ hasText: '1. 긴 글 줄' }).getByTestId('msg-long-more').click();
  const lm = owner.getByTestId('msg-long-modal'); await lm.waitFor();
  assert.match(await lm.innerText(), /30\. 긴 글 줄/);
  await owner.keyboard.press('Escape'); await lm.waitFor({ state: 'detached' });

  // C13 [+] → B9 투표
  await owner.getByTestId('chat-plus').click();
  await owner.getByTestId('chat-plus-panel').getByTestId('plus-poll').click();
  const pm = owner.getByTestId('poll-modal');
  await pm.getByTestId('poll-q').fill('E2E 회식 날짜');
  await pm.getByTestId('poll-opt').nth(0).fill('금요일'); await pm.getByTestId('poll-opt').nth(1).fill('토요일');
  await pm.getByTestId('poll-add-opt').click(); await pm.getByTestId('poll-opt').nth(2).fill('다음 주 월요일');
  await pm.getByTestId('poll-go').click();
  const pc = list.getByTestId('chat-poll').filter({ hasText: 'E2E 회식 날짜' }); await pc.waitFor();
  await pc.getByTestId('poll-option').nth(1).click();
  await pc.getByTestId('poll-count').nth(1).filter({ hasText: /^1$/ }).waitFor();
  const [{ id: pollId }] = await sql`select id::text from chat_messages where room_id = ${room} and kind = 'poll'`;
  for (let k = 0; k < 40 && !(await sql`select 1 from chat_poll_votes where message_id = ${pollId}::bigint and user_id = ${ctx.ownerId}`).length; k++) await owner.waitForTimeout(250);
  await ctx.staffA.client.ok('POST', `/api/chat/messages/${pollId}/poll`, { vote: [0] });
  await pc.getByTestId('poll-count').nth(0).filter({ hasText: /^1$/ }).waitFor({ timeout: 20000 }); // 다른 사람 투표가 실시간으로
  await pc.getByTestId('poll-names').click();
  await pc.getByTestId('poll-names-line').filter({ hasText: '이직원' }).waitFor();
  owner.once('dialog', (d) => d.accept());
  await pc.getByTestId('poll-close').click();
  await pc.getByTestId('poll-closed').waitFor();
  await list.getByTestId('chat-system').filter({ hasText: '김대표님이 투표를 마감했습니다: E2E 회식 날짜' }).waitFor({ timeout: 20000 });

  // [+] → B9 일정 잡기(참석자 = 방 사람)
  await owner.getByTestId('chat-plus').click();
  await owner.getByTestId('plus-event').click();
  const em = owner.getByTestId('event-modal');
  await em.getByTestId('event-title-input').fill('E2E 주간 회의');
  await em.getByTestId('event-start').fill('10:00'); await em.getByTestId('event-end').fill('11:00');
  await em.getByTestId('event-loc').fill('3층 회의실');
  await em.getByTestId('event-go').click();
  const ec = list.getByTestId('chat-event').filter({ hasText: 'E2E 주간 회의' }); await ec.waitFor();
  assert.equal(await ec.getByTestId('event-going').innerText(), '참석 1명 · 초대 3명');
  const [ev] = await sql`select e.id, (select count(*)::int from event_attendees a where a.event_id = e.id) n from events e where e.title = 'E2E 주간 회의'`;
  assert.equal(ev.n, 3, '캘린더 일정 참석자 = 방 사람 3명');

  // B10 스티커
  await owner.getByTestId('chat-emoji-open').click();
  await owner.getByTestId('sticker-tab').click();
  await owner.getByTestId('sticker-ok').click();
  await list.locator('[data-testid="chat-sticker"][data-sticker="ok"]').waitFor();

  // B8 사진 3장 = 한 묶음 → 좌우 넘기기 뷰어
  await owner.getByTestId('chat-gallery-input').setInputFiles([1, 2, 3].map((n) => ({ name: `현장${n}.png`, mimeType: 'image/png', buffer: PNG })));
  const album = list.locator('[data-testid="chat-album"][data-count="3"]'); await album.waitFor({ timeout: 20000 });
  assert.equal((await sql`select count(distinct batch_id)::int n, count(*)::int c from chat_messages where room_id = ${room} and batch_id is not null`)[0].c, 3);
  await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await owner.screenshot({ path: `${SHOTS}/259-chat-v4-cards.png` });
  await album.getByTestId('album-item').nth(1).click();
  const viewer = owner.getByTestId('chat-viewer'); await viewer.waitFor();
  assert.equal(await viewer.getByTestId('viewer-count').innerText(), '2 / 3');
  await viewer.getByTestId('viewer-next').click();
  assert.equal(await viewer.getByTestId('viewer-count').innerText(), '3 / 3');
  await owner.keyboard.press('ArrowLeft');
  assert.equal(await viewer.getByTestId('viewer-count').innerText(), '2 / 3');
  await owner.screenshot({ path: `${SHOTS}/260-chat-viewer.png` });
  await owner.keyboard.press('Escape'); await viewer.waitFor({ state: 'detached' });

  // B11 @전체
  const input = owner.getByTestId('chat-input');
  await input.fill('@전');
  await owner.getByTestId('mention-all').click();
  assert.equal(await input.inputValue(), '@전체 ');
  await input.fill('@전체 내일 아침 9시 회의 꼭 오세요');
  await input.press('Enter');
  await list.getByTestId('chat-message').filter({ hasText: '내일 아침 9시 회의 꼭 오세요' }).waitFor();
  let mm = null;
  for (let k = 0; k < 40 && !mm; k++) { [mm] = await sql`select cardinality(mentions) n from chat_messages where room_id = ${room} and body like '%내일 아침 9시 회의%'`; if (!mm) await owner.waitForTimeout(250); }
  assert.equal(mm.n, 2, '@전체 = 방 사람 모두(나 빼고)');

  // B9 메시지 → 일정으로 만들기(글의 날짜·시각) · B10 자주 쓰는 반응
  await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '내일 오후 3시 현장 점검' });
  const src = list.getByTestId('chat-message').filter({ hasText: '내일 오후 3시 현장 점검' }); await src.waitFor({ timeout: 20000 });
  await src.hover(); await src.getByTestId('msg-more').click(); await src.getByTestId('msg-to-event').click();
  const em2 = owner.getByTestId('event-modal'); await em2.waitFor();
  assert.deepEqual([await em2.getByTestId('event-date').inputValue(), await em2.getByTestId('event-start').inputValue()], [ymd(1), '15:00']);
  assert.match(await em2.getByTestId('event-title-input').inputValue(), /현장 점검/);
  await owner.keyboard.press('Escape'); await em2.waitFor({ state: 'detached' });
  await src.hover(); await src.getByTestId('msg-react-more').click();
  const rp = src.getByTestId('msg-react-panel'); await rp.waitFor();
  assert.equal(await rp.getByTestId('react-quick').count(), 6);
  await rp.getByRole('button', { name: '🔥 반응' }).click();
  await src.getByTestId('chat-reactions').getByText('🔥 1').waitFor();

  // B11 답장 원문 이동: 80개 위 원래 질문 → 그 자리로, [최신 메시지로]
  const room2 = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '답장 이동 시험방', userIds: [ctx.staffA.id] })).id;
  const orig = await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room2}/messages`, { body: '아주 오래된 원래 질문' });
  await sql`insert into chat_messages (room_id, author_id, body) select ${room2}, ${ctx.staffA.id}, '채우는 메시지 ' || g from generate_series(1, 80) g`;
  await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room2}/messages`, { body: '그 질문에 답합니다', replyTo: orig.id });
  await sql`update chat_members set last_read_id = (select max(id) from chat_messages where room_id = ${room2}) where room_id = ${room2} and user_id = ${ctx.ownerId}`;
  await owner.goto(`${BASE}/messages?room=${room2}`);
  const quote = list.getByTestId('chat-reply-quote').filter({ hasText: '아주 오래된 원래 질문' }); await quote.waitFor();
  assert.equal(await list.locator(`[data-msg-id="${orig.id}"]`).count(), 0, '처음엔 원래 질문이 화면에 없음');
  await quote.click();
  await list.locator(`[data-msg-id="${orig.id}"]`).waitFor();
  const below = owner.getByTestId('chat-new-below'); await below.waitFor();
  assert.equal(await below.innerText(), '최신 메시지로 ↓');
  await below.click();
  await list.locator(`[data-msg-id="${orig.id}"]`).waitFor({ state: 'detached' });
  await list.getByTestId('chat-message').filter({ hasText: '그 질문에 답합니다' }).waitFor();

  // C13 휴대폰: [+] 패널(넘침 없음) · 방 목록 왼쪽 밀기 → [알림 끄기]
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/messages?room=${room}`);
  await owner.getByTestId('chat-plus').click();
  await owner.getByTestId('chat-plus-panel').waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.screenshot({ path: `${SHOTS}/261-chat-plus-mobile.png` });
  await owner.goto(`${BASE}/messages`);
  const row = owner.getByTestId('room-row').filter({ hasText: '2차 화면 시험방' }); await row.waitFor();
  const box = await row.boundingBox();
  await owner.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
  await owner.mouse.down();
  await owner.mouse.move(box.x + box.width - 220, box.y + box.height / 2, { steps: 10 });
  await owner.mouse.up();
  await row.getByTestId('swipe-mute').waitFor();
  await owner.waitForTimeout(300);
  await owner.screenshot({ path: `${SHOTS}/262-chat-swipe.png` });
  await row.getByTestId('swipe-mute').click();
  await owner.getByText('알림을 껐습니다').first().waitFor();
  assert.equal((await sql`select muted from chat_members where room_id = ${room} and user_id = ${ctx.ownerId}`)[0].muted, true);
  await ctx.owner.ok('PATCH', `/api/chat/rooms/${room}`, { muted: false });
  await owner.setViewportSize({ width: 1280, height: 860 });
}
