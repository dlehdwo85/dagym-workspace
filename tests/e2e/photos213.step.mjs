// 213차 대표 10/27 18:35(아이폰에서 사진 147장 '아직 안 보내짐'): 아이폰은 사진을 많이 고르면 [추가] 뒤 휴대폰이 사진을 준비하는 몇 분 동안 아무 표시가 없음
// → 고르기 창을 열면 '고른 사진을 휴대폰이 준비하는 중' 띠(취소하면 걷힘, 파일이 들어오면 진행 표시로) · 메신저는 30장이 넘으면 말없이 버리던 것을 200장까지, 고른 순서대로 한 묶음
import assert from 'node:assert/strict';
import sharp from 'sharp';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function login(context, BASE, email, password) {
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(BASE + '/');
  return page;
}

export async function photos213({ owner: pc, browser, devices, ctx, sql, BASE, SHOTS }) {
  const PHOTO = 'image/jpeg,image/heic,image/heif,image/png,image/webp,image/gif';
  const t = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 213 사진 준비 안내', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false });
  const diag0 = (await sql`select coalesce(max(id), 0)::int m from error_logs`)[0].m;
  const diagOf = async (ev, n = 1) => { for (let k = 0; k < 50; k++) { const r = await sql`select context from error_logs where id > ${diag0} and source = 'diag:pick' and context->>'event' = ${ev} order by id`; if (r.length >= n) return r.map((x) => x.context); await pc.waitForTimeout(200); } throw new Error(`진단 ${ev} 없음`); };
  // #805(대표 10/29 'PC 에서도 휴대폰 준비 중 띠가 뜸'): PC 는 고르기 창을 열어도 띠·아이폰 안내 없음(고르기 취소 기록은 그대로)
  await pc.goto(`${BASE}/tasks/${t.id}`);
  await pc.getByTestId('attachments').waitFor();
  let chooser = pc.waitForEvent('filechooser');
  await pc.getByTestId('att-album').click();
  await chooser;
  await pc.waitForTimeout(400);
  assert.equal(await pc.getByTestId('pick-wait').count(), 0, 'PC 는 준비 중 띠 없음');
  assert.equal(await pc.getByTestId('ios-pick-hint').count(), 0, 'PC 는 아이폰 안내 없음');
  await pc.getByTestId('album-input').dispatchEvent('cancel');
  const [pcx] = await diagOf('cancel');
  assert.deepEqual([pcx.where, pcx.kind, pcx.userId], ['task', 'photo', ctx.ownerId], 'PC 고르기 취소도 기록');

  // 업무 첨부(안드로이드 휴대폰): [사진·영상] → '준비 중' 띠 → 취소하면 걷힘 · 아이폰 안내는 아이폰만
  const mob = await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
  const owner = await login(mob, BASE, 'ceo@dagym.test', 'owner-pass-1234');
  await owner.goto(`${BASE}/tasks/${t.id}`);
  await owner.getByTestId('attachments').waitFor();
  assert.equal(await owner.getByTestId('ios-pick-hint').count(), 0, '안드로이드는 아이폰 안내 없음');
  // 248차 #780(김민수 본부장 아이폰 50장): 사진 고르기 칸은 HEIC 를 글자 그대로 넣은 명시 목록(와일드카드면 아이폰이 [추가] 뒤 한 장씩 변환) · 영상은 따로
  assert.equal(await owner.getByTestId('album-input').getAttribute('accept'), PHOTO);
  assert.equal(await owner.getByTestId('video-album-input').getAttribute('accept'), 'video/*');
  chooser = owner.waitForEvent('filechooser');
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
  const [, cx] = await diagOf('cancel', 2);
  assert.deepEqual([cx.where, cx.kind, typeof cx.sec, cx.userId], ['task', 'photo', 'number', ctx.ownerId], '고르기 취소 기록');
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
  const [rx] = await diagOf('received'); const [dx] = await diagOf('done');
  assert.deepEqual([rx.count, rx.kinds?.png, rx.kinds?.heic, rx.where, rx.kind, typeof rx.ua], [8, 8, 0, 'task', 'photo', 'string'], '받음 기록(장수·형식, 파일 이름 없음)');
  assert.ok(!JSON.stringify(rx).includes('E2E213-'), '파일 이름은 안 남김');
  assert.deepEqual([dx.ok, dx.fail], [8, 0], '끝 기록');
  } finally { await mob.close(); }
  const owner = pc;
  const ops = await ctx.owner.ok('GET', '/api/admin/ops');
  assert.ok(ops.pickDiag.some((x) => x.context?.event === 'received' && x.context?.count === 8), '관리 › 운영 최근 진단');
  assert.ok(!ops.errors.some((x) => x.source === 'diag:pick'), '오류 기록에는 안 섞임');

  // 메신저: 35장 = 한 묶음(예전엔 30장에서 말없이 잘림) · 고른 순서 그대로
  const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: 'E2E 213 사진방', userIds: [ctx.staffA.id] })).id;
  await owner.goto(`${BASE}/messages?room=${room}`);
  const list = owner.getByTestId('chat-messages'); await list.waitFor();
  assert.equal(await owner.getByTestId('chat-gallery-input').getAttribute('accept'), PHOTO, '메신저 사진 고르기도 명시 목록');
  assert.equal(await owner.getByTestId('chat-video-input').getAttribute('accept'), 'video/*');
  const names = Array.from({ length: 35 }, (_, k) => `현장사진${String(k + 1).padStart(2, '0')}.png`);
  await owner.getByTestId('chat-gallery-input').setInputFiles(names.map((name) => ({ name, mimeType: 'image/png', buffer: PNG })));
  await list.locator('[data-testid="chat-album"][data-count="35"]').waitFor({ timeout: 90_000 });
  const rows = await sql`select file_name, batch_id from chat_messages where room_id = ${room} and file_name is not null order by id`;
  assert.equal(rows.length, 35);
  assert.equal(new Set(rows.map((r) => r.batch_id)).size, 1, '한 묶음');
  assert.deepEqual(rows.map((r) => r.file_name), names, '고른 순서대로');
}
