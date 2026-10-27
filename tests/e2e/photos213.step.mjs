// 213차 대표 10/27 18:35(아이폰에서 사진 147장 '아직 안 보내짐'): 아이폰은 사진을 많이 고르면 [추가] 뒤 휴대폰이 사진을 준비하는 몇 분 동안 아무 표시가 없음
// → 고르기 창을 열면 '고른 사진을 휴대폰이 준비하는 중' 띠(취소하면 걷힘, 파일이 들어오면 진행 표시로) · 메신저는 30장이 넘으면 말없이 버리던 것을 200장까지, 고른 순서대로 한 묶음
import assert from 'node:assert/strict';
import sharp from 'sharp';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

export async function photos213({ owner, ctx, sql, BASE, SHOTS }) {
  // 업무 첨부(휴대폰 폭): [사진·영상] → '준비 중' 띠 → 취소하면 걷힘
  await owner.setViewportSize({ width: 390, height: 844 });
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 213 사진 준비 안내', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false });
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('attachments').waitFor();
  let chooser = owner.waitForEvent('filechooser');
  await owner.getByTestId('att-album').click();
  await chooser;
  const wait = owner.getByTestId('pick-wait'); await wait.waitFor();
  assert.match(await wait.innerText(), /고른 사진을 휴대폰이 준비하는 중입니다/);
  assert.match(await wait.getByTestId('pick-wait-time').innerText(), /^\d+:\d{2}$/, '지난 시간');
  await wait.scrollIntoViewIfNeeded();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, '휴대폰 폭 넘침 없음');
  await owner.screenshot({ path: `${SHOTS}/563-pick-wait.png` });
  await owner.getByTestId('album-input').dispatchEvent('cancel');
  await wait.waitFor({ state: 'detached' });
  // 다시 열어 8장 고르기 → 띠가 걷히고 진행 → 완료
  chooser = owner.waitForEvent('filechooser');
  await owner.getByTestId('att-album').click();
  const fc = await chooser;
  await wait.waitFor();
  const files = await Promise.all(Array.from({ length: 8 }, async (_, k) => ({ name: `E2E213-${k + 1}.png`, mimeType: 'image/png',
    buffer: await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: k * 30, g: 120, b: 200 - k * 20 } } }).png().toBuffer() })));
  await fc.setFiles(files);
  await wait.waitFor({ state: 'detached' });
  await owner.getByText('8개 첨부 완료').first().waitFor({ timeout: 60_000 });
  assert.equal((await sql`select count(*)::int n from attachments where task_id = ${t.id} and deleted_at is null and upload_status = 'ready'`)[0].n, 8);

  // 메신저: 35장 = 한 묶음(예전엔 30장에서 말없이 잘림) · 고른 순서 그대로
  await owner.setViewportSize({ width: 1280, height: 860 });
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: 'E2E 213 사진방', userIds: [ctx.staffA.id] })).id;
  await owner.goto(`${BASE}/messages?room=${room}`);
  const list = owner.getByTestId('chat-messages'); await list.waitFor();
  const names = Array.from({ length: 35 }, (_, k) => `현장사진${String(k + 1).padStart(2, '0')}.png`);
  await owner.getByTestId('chat-gallery-input').setInputFiles(names.map((name) => ({ name, mimeType: 'image/png', buffer: PNG })));
  await list.locator('[data-testid="chat-album"][data-count="35"]').waitFor({ timeout: 90_000 });
  const rows = await sql`select file_name, batch_id from chat_messages where room_id = ${room} and file_name is not null order by id`;
  assert.equal(rows.length, 35);
  assert.equal(new Set(rows.map((r) => r.batch_id)).size, 1, '한 묶음');
  assert.deepEqual(rows.map((r) => r.file_name), names, '고른 순서대로');
}
