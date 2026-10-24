// 메신저 3차(대표 10/20 카톡 수준 C12·D14·D15): 머리줄 알림 메뉴(전체·멘션만·끄기) → 목록 줄 표시 · 방 안 찾기(▲▼·강조, 처음 화면 밖 메시지도)
// · 전체 검색 결과 → 그 메시지로 이동 · 방 정보: 이 방 알림 3칸·방장만 관리(안내)·방장 넘기기 단추·방 사진(머리줄·목록에 사진)
import assert from 'node:assert/strict';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export async function messengerV5({ owner, ctx, sql, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1280, height: 860 });
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '3차 화면 시험방', userIds: [ctx.staffA.id, ctx.staffB.id] })).id;
  // '분기 결산' 3번 — 맨 처음 것은 사이 잡담 70개 앞이라 처음 열 때(최근 60개) 화면에 없음
  await ctx.owner.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '1분기 결산 자료 올립니다' });
  for (let i = 1; i <= 70; i++) await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: `잡담 ${i}` });
  await ctx.owner.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '2분기 결산 보고' });
  await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: '3분기 결산은 언제 하나요?' });
  await ctx.owner.ok('POST', `/api/chat/rooms/${room}/read`, {});
  await owner.goto(`${BASE}/messages?room=${room}`);
  const list = owner.getByTestId('chat-messages');
  await list.getByTestId('chat-message').filter({ hasText: '3분기 결산은 언제' }).waitFor();
  assert.equal(await list.getByTestId('chat-message').filter({ hasText: '1분기 결산 자료' }).count(), 0, '처음 화면 밖');

  // C12 머리줄 알림 메뉴 → 멘션만 → 목록 줄 @ 표시
  await owner.getByTestId('chat-mute').click();
  const menu = owner.getByTestId('chat-notify-menu'); await menu.waitFor();
  assert.match(await menu.innerText(), /전체 알림[\s\S]*멘션만[\s\S]*끄기/);
  await owner.screenshot({ path: `${SHOTS}/264-chat-notify-menu.png` });
  await menu.getByTestId('chat-notify-mention').click();
  await owner.getByText('이 방은 나를 부를 때(멘션)만 알립니다').first().waitFor();
  await owner.locator('[data-testid="chat-mute"][data-level="mention"]').waitFor();
  assert.equal((await sql`select notify from chat_members where room_id = ${room} and user_id = ${ctx.ownerId}`)[0].notify, 'mention');
  const row = owner.getByTestId('room-row').filter({ hasText: '3차 화면 시험방' });
  await row.getByTestId('room-level-mention').waitFor();

  // D15 방 안 찾기: Enter = 가장 최근 결과 → ▲ 더 오래된 것(처음 화면 밖도 불러와서) → ▼
  await owner.getByTestId('chat-find-open').click();
  await owner.getByTestId('chat-find-input').fill('결산');
  await owner.getByTestId('chat-find-input').press('Enter');
  const count = owner.getByTestId('chat-find-count');
  await count.filter({ hasText: '1/3' }).waitFor();
  const msg = (t) => list.getByTestId('chat-message').filter({ hasText: t });
  await msg('3분기 결산은 언제').getByTestId('chat-find-hit').waitFor();
  await owner.getByTestId('chat-find-up').click(); await count.filter({ hasText: '2/3' }).waitFor();
  await owner.getByTestId('chat-find-up').click(); await count.filter({ hasText: '3/3' }).waitFor();
  const first = msg('1분기 결산 자료'); await first.waitFor();
  const inView = async (loc) => { const [b, l] = [await loc.boundingBox(), await list.boundingBox()]; return !!b && !!l && b.y >= l.y - 1 && b.y + b.height <= l.y + l.height + 1; };
  for (let k = 0; k < 20 && !(await inView(first)); k++) await owner.waitForTimeout(100);
  assert.ok(await inView(first), '찾은 메시지가 화면 안에');
  assert.equal(await first.getByTestId('chat-find-hit').innerText(), '결산', '찾는 말 강조');
  assert.ok(await owner.getByTestId('chat-find-up').isDisabled(), '가장 오래된 결과에서 ▲ 끝');
  await owner.screenshot({ path: `${SHOTS}/265-chat-find.png` });
  await owner.getByTestId('chat-find-down').click(); await count.filter({ hasText: '2/3' }).waitFor();
  await owner.getByTestId('chat-find-close').click();
  await owner.getByTestId('chat-find').waitFor({ state: 'detached' });
  assert.equal(await list.getByTestId('chat-find-hit').count(), 0, '닫으면 강조도 없음');

  // D15 전체 검색 결과 → 그 방, 그 메시지로(주소에 msg)
  await owner.goto(`${BASE}/messages`);
  const q = owner.getByTestId('messages-frame').getByLabel('메시지 검색');
  await q.fill('1분기 결산'); await q.press('Enter');
  await owner.getByTestId('chat-search-results').getByTestId('chat-search-hit').first().click();
  await owner.waitForURL(/\/messages\?room=[0-9a-f-]{36}&msg=\d+/);
  const jumped = owner.getByTestId('chat-messages').getByTestId('chat-message').filter({ hasText: '1분기 결산 자료' });
  await jumped.waitFor();
  for (let k = 0; k < 20 && !(await inView(jumped)); k++) await owner.waitForTimeout(100);
  assert.ok(await inView(jumped), '검색 결과 메시지로 옮겨 감');

  // D14·C12 방 정보: 이 방 알림 3칸 → 끄기 · 방장만 관리 · 방장 넘기기 단추 · 방 사진
  await owner.getByTestId('chat-info').click();
  const info = owner.getByTestId('chat-room-info'); await info.waitFor();
  assert.equal(await info.getByTestId('info-notify-mention').getAttribute('aria-checked'), 'true');
  await info.getByTestId('info-notify-off').click();
  await info.locator('[data-testid="info-notify-off"][aria-checked="true"]').waitFor();
  assert.equal((await sql`select notify from chat_members where room_id = ${room} and user_id = ${ctx.ownerId}`)[0].notify, 'off');
  await info.getByTestId('info-owner-only').click();
  await info.getByTestId('info-owner-only-note').waitFor();
  assert.equal((await sql`select owner_only from chat_rooms where id = ${room}`)[0].owner_only, true);
  await info.getByTestId(`info-owner-${ctx.staffA.id}`).waitFor();
  await info.getByTestId('info-photo-input').setInputFiles({ name: '방사진.png', mimeType: 'image/png', buffer: PNG });
  await owner.getByText('방 사진을 바꿨습니다').first().waitFor();
  await info.getByTestId('room-photo').waitFor();
  assert.ok((await sql`select photo_key from chat_rooms where id = ${room}`)[0].photo_key);
  await owner.screenshot({ path: `${SHOTS}/266-chat-room-info-owner.png` });
  await owner.keyboard.press('Escape'); await info.waitFor({ state: 'detached' });
  await owner.getByTestId('chat-room').getByTestId('room-photo').waitFor();
  await owner.getByTestId('room-row').filter({ hasText: '3차 화면 시험방' }).getByTestId('room-photo').waitFor();
  await owner.getByTestId('chat-messages').getByTestId('chat-system').filter({ hasText: '김대표님이 방 사진을 바꿨습니다' }).waitFor();
  await ctx.owner.ok('PATCH', `/api/chat/rooms/${room}`, { notify: 'all', ownerOnly: false });
}
