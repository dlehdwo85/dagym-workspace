// 메신저 카톡 수준 1차(대표 10/20): 새 대화 다중 선택(검색·부서 묶음·칩·2명+=그룹 자동 이름) → 방 정보(참여자·방장·초대·내보내기) → 초대 시스템 메시지 → 전달 → 공지 바 → 안 읽은 수(누르면 이름)
import assert from 'node:assert/strict';

export async function messengerV3({ owner, ctx, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1280, height: 860 });
  await owner.goto(BASE + '/messages');
  await owner.getByTestId('chat-new').click();
  const modal = owner.getByTestId('chat-new-modal');
  await modal.getByTestId('chat-new-q').fill('직원');
  await modal.getByLabel('이직원 선택').first().check(); // '최근 대화' 묶음과 부서 묶음에 같이 나옴
  await modal.getByLabel('박직원 선택').first().check();
  await modal.getByTestId('chat-new-picked').getByText('이직원').waitFor();
  assert.match(await modal.innerText(), /그룹 대화 · 3명/);
  await owner.screenshot({ path: `${SHOTS}/149-chat-new-multi.png` });
  await modal.getByTestId('chat-group-create').click();
  await owner.getByTestId('chat-room-name').getByText('김대표, 박직원, 이직원').waitFor();
  await owner.getByTestId('chat-system').getByText(/김대표님이 .*초대했습니다/).waitFor();
  await owner.getByTestId('chat-input').fill('초대 전 이야기');
  await owner.getByTestId('chat-input').press('Enter');
  await owner.getByTestId('chat-message').filter({ hasText: '초대 전 이야기' }).getByTestId('msg-unread').getByText('2').waitFor();
  // 방 정보: 참여자 3 · 방장 · 초대 → 시스템 메시지, 안 읽은 수는 초대 전 메시지에 안 늘어남
  await owner.getByTestId('chat-info').click();
  const info = owner.getByTestId('chat-room-info');
  await info.getByTestId('info-members').getByText('방장').waitFor();
  assert.equal(await info.getByTestId('info-members').locator('li').count(), 3);
  await info.getByTestId('info-invite').click();
  await info.getByTestId('info-invite-box').getByLabel('최매니저 초대 선택').check();
  await info.getByTestId('info-invite-go').click();
  await info.getByTestId('info-members').getByText('최매니저').waitFor();
  await owner.screenshot({ path: `${SHOTS}/150-chat-room-info.png` });
  owner.once('dialog', (d) => d.accept()); // 내보내기 confirm
  await info.getByTestId(`info-remove-${ctx.staffB.id}`).click();
  await info.getByTestId('info-members').getByText('박직원').waitFor({ state: 'detached' });
  await owner.keyboard.press('Escape');
  await owner.getByTestId('chat-system').getByText(/최매니저님을 초대했습니다/).waitFor();
  await owner.getByTestId('chat-system').getByText(/박직원님을 내보냈습니다/).waitFor();
  const first = owner.getByTestId('chat-message').filter({ hasText: '초대 전 이야기' });
  await first.getByTestId('msg-unread').getByText('1').waitFor(); // 박직원 나감·최매니저는 초대 전이라 제외 → 이직원 1명
  await first.getByTestId('msg-unread').click();
  await first.getByTestId('msg-unread-names').getByText('안 읽음: 이직원').waitFor();
  // 공지 등록 → 상단 접힘 바 → 펼침
  await first.hover(); await first.getByTestId('msg-more').click(); await first.getByTestId('msg-notice').click();
  await owner.getByTestId('chat-pinned').getByText('공지').waitFor();
  await owner.getByTestId('chat-notice-toggle').click();
  assert.equal(await owner.getByTestId('chat-notice-toggle').getAttribute('aria-expanded'), 'true');
  // 전달: 1:1 방으로
  const dm = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
  await first.hover(); await first.getByTestId('msg-more').click(); await first.getByTestId('msg-forward').click();
  const fw = owner.getByTestId('chat-forward');
  await fw.getByLabel('이직원 선택').check();
  await fw.getByTestId('chat-forward-go').click();
  await owner.getByText('1개 방에 전달했습니다').waitFor();
  await owner.goto(`${BASE}/messages?room=${dm}`);
  await owner.getByTestId('chat-forwarded').waitFor();
  await owner.getByTestId('chat-messages').getByText('초대 전 이야기').waitFor();
  await owner.screenshot({ path: `${SHOTS}/151-chat-forward.png` });
}
