// 메신저 대화방 이름 바꾸기: 머리줄 ✎ → 입력 → Enter → 머리줄·목록·상대에게 새 이름, Esc 는 취소, 1:1 은 ✎ 없음
import assert from 'node:assert/strict';
export async function chatRename({ owner, ctx, BASE }) {
  const g = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: '이름바꾸기 화면 시험', userIds: [ctx.staffA.id] })).id;
  await owner.goto(BASE + '/messages');
  await owner.getByTestId('chat-rooms').getByText('이름바꾸기 화면 시험').click();
  await owner.getByTestId('chat-room-name').getByText('이름바꾸기 화면 시험').waitFor();
  await owner.getByTestId('chat-room-rename').click();
  const input = owner.getByTestId('chat-room-name-input');
  await input.fill('취소될 이름');
  await input.press('Escape');
  await owner.getByTestId('chat-room-name').getByText('이름바꾸기 화면 시험').waitFor();
  await owner.getByTestId('chat-room-rename').click();
  await owner.getByTestId('chat-room-name-input').fill('강남점 오픈 TF');
  await owner.getByTestId('chat-room-name-input').press('Enter');
  await owner.getByTestId('chat-room-name').getByText('강남점 오픈 TF').waitFor();
  await owner.getByTestId('chat-rooms').getByText('강남점 오픈 TF').waitFor();
  assert.equal((await ctx.staffA.client.ok('GET', `/api/chat/rooms/${g}`)).room.name, '강남점 오픈 TF', '상대에게도 새 이름');
  // 1:1 은 바꾸기 버튼 없음
  await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.managerA.id });
  await owner.goto(BASE + '/messages');
  await owner.getByTestId('chat-rooms').getByText('최매니저').first().click();
  await owner.getByTestId('chat-room-name').getByText('최매니저').waitFor();
  assert.equal(await owner.getByTestId('chat-room-rename').count(), 0);
}
