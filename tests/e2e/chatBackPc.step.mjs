// 132차 확인 후속(로컬 10/24 21:50 ⑧): PC 메시지 화면 — 대화방을 위로 올려 보다 사이드바로 다른 화면 → 뒤로가기 = 보던 자리(맨 아래로 가지 않음)
import assert from 'node:assert/strict';

export async function chatBackPc({ owner, ctx, BASE }) {
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: 'PC 위치 시험방', userIds: [ctx.staffA.id] })).id;
  for (let i = 1; i <= 60; i++) await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: `PC 지난 메시지 ${i}` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/messages?room=${room}`);
  const list = owner.getByTestId('chat-messages');
  await list.getByText('PC 지난 메시지 60').waitFor();
  await owner.waitForFunction(() => { const el = document.querySelector('[data-testid="chat-messages"]'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 5; });
  await list.evaluate((el) => { el.scrollTop = 300; el.dispatchEvent(new Event('scroll')); });
  await owner.waitForTimeout(300);
  const fromBottom = await list.evaluate((el) => el.scrollHeight - el.scrollTop);
  // 사이드바로 다른 화면(업무) → 뒤로가기
  await owner.getByRole('link', { name: '업무', exact: true }).first().click();
  await owner.waitForURL((u) => !u.pathname.startsWith('/messages'));
  await owner.waitForTimeout(500);
  await owner.goBack();
  await list.getByText('PC 지난 메시지 60').waitFor();
  await owner.waitForTimeout(800);
  const after = await list.evaluate((el) => el.scrollHeight - el.scrollTop);
  assert.ok(Math.abs(after - fromBottom) < 40, `보던 자리(아래에서 ${fromBottom}px) → 돌아온 자리(아래에서 ${after}px)`);
}

/** 실험: 주소를 새로 열어(전체 새로고침) 다른 화면 → 뒤로가기 */
export async function chatBackPcHard({ owner, ctx, BASE }) {
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: 'PC 위치 시험방 2', userIds: [ctx.staffA.id] })).id;
  for (let i = 1; i <= 60; i++) await ctx.staffA.client.ok('POST', `/api/chat/rooms/${room}/messages`, { body: `PC2 지난 메시지 ${i}` });
  await owner.goto(`${BASE}/messages?room=${room}`);
  const list = owner.getByTestId('chat-messages');
  await list.getByText('PC2 지난 메시지 60').waitFor();
  await owner.waitForFunction(() => { const el = document.querySelector('[data-testid="chat-messages"]'); return el && el.scrollHeight - el.scrollTop - el.clientHeight < 5; });
  await list.evaluate((el) => { el.scrollTop = 300; el.dispatchEvent(new Event('scroll')); });
  await owner.waitForTimeout(300);
  const fromBottom = await list.evaluate((el) => el.scrollHeight - el.scrollTop);
  await owner.goto(`${BASE}/tasks`);
  await owner.waitForTimeout(500);
  await owner.goBack();
  await list.getByText('PC2 지난 메시지 60').waitFor();
  await owner.waitForTimeout(800);
  const after = await list.evaluate((el) => el.scrollHeight - el.scrollTop);
  assert.ok(Math.abs(after - fromBottom) < 40, `새로고침 뒤로: 보던 자리(아래에서 ${fromBottom}px) → 돌아온 자리(아래에서 ${after}px)`);
}
