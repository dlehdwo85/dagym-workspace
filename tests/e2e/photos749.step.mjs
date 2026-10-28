// #749(로컬 10/28 17:25 · 김민수 본부장 아이폰 '사진 147장 고른 뒤 보내기가 안 됨, 2장은 됨'): 휴대폰 화면 흉내(아이폰 13 크기·터치)로 실제 크기에 가까운 사진 147장
// → 업무 첨부 [사진·영상]·메신저 [+ › 사진·영상] 모두 끝까지 올라가는지 · 그동안 화면이 멈추지 않는지(긴 작업) · 버튼이 잠긴 채 남지 않는지
// (구조 시험 — 아이폰 사진 고르기 창의 '준비' 단계(애플 쪽)는 흉내 못 함. 실제 아이폰 확인은 로컬)
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

async function login(context, BASE, email, password) {
  const page = await context.newPage();
  await page.goto(BASE + '/login');
  await page.getByLabel('이메일', { exact: true }).fill(email);
  await page.getByLabel('비밀번호').fill(password);
  await page.getByRole('button', { name: '로그인' }).click();
  await page.waitForURL(BASE + '/');
  return page;
}
const N = 147;
// 1800×1350 사진(약 0.5MB — 줄이기 400KB·1600px 기준을 넘어 실제처럼 줄이고 올림)
const photo = () => sharp({ create: { width: 1800, height: 1350, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 40 } } }).jpeg({ quality: 70 }).toBuffer();
const longTasks = (page) => page.evaluate(() => { const w = window; w.__lt = { n: 0, max: 0, sum: 0 }; new PerformanceObserver((l) => { for (const e of l.getEntries()) { w.__lt.n++; w.__lt.sum += e.duration; w.__lt.max = Math.max(w.__lt.max, e.duration); } }).observe({ type: 'longtask', buffered: false }); });

export async function photos749({ browser, devices, ctx, sql, BASE }) {
  const buf = await photo();
  // Playwright 는 한 번에 50MB 넘는 내용을 바로 넘기지 못해 파일로 써서 경로를 넘김(test-results 는 저장소에 안 올라감)
  const dir = 'test-results/e2e749'; mkdirSync(dir, { recursive: true });
  const files = Array.from({ length: N }, (_, k) => { const f = `${dir}/IMG_${String(7490 + k)}.JPG`; writeFileSync(f, buf); return f; });
  const mob = await browser.newContext({ ...devices['iPhone 13'], locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const m = await login(mob, BASE, 'ceo@dagym.test', 'owner-pass-1234');
    // ① 업무 첨부
    const t = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 749 사진 147장', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false });
    await m.goto(`${BASE}/tasks/${t.id}`);
    await m.getByTestId('attachments').waitFor();
    assert.match(await m.getByTestId('ios-pick-hint').first().innerText(), /50장씩 나눠 고르면/, '아이폰이면 고르기 전에 한 줄 안내');
    await longTasks(m);
    const chooser = m.waitForEvent('filechooser');
    await m.getByTestId('att-album').click();
    const fc = await chooser;
    await m.getByTestId('pick-wait').waitFor();
    const t0 = Date.now();
    await fc.setFiles(files);
    await m.getByTestId('pick-wait').waitFor({ state: 'detached', timeout: 10_000 });
    await m.getByText(`${N}개 첨부 완료`).first().waitFor({ timeout: 600_000 });
    const attMs = Date.now() - t0;
    assert.equal((await sql`select count(*)::int n from attachments where task_id = ${t.id} and deleted_at is null and upload_status = 'ready'`)[0].n, N);
    const shrunk = (await sql`select count(*)::int n from attachments where task_id = ${t.id} and deleted_at is null and size_bytes < ${buf.length}`)[0].n;
    const lt1 = await m.evaluate(() => window.__lt);
    assert.ok(await m.getByTestId('att-album').isEnabled(), '끝나면 [사진·영상] 다시 누를 수 있음');
    // ② 메신저 [+ › 사진·영상]
    const room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'group', name: 'E2E 749 사진방', userIds: [ctx.staffA.id] })).id;
    await m.goto(`${BASE}/messages?room=${room}`);
    await m.getByTestId('chat-messages').waitFor();
    await m.getByRole('button', { name: /더 보내기/ }).click();
    assert.match(await m.getByTestId('chat-plus-panel').getByTestId('ios-pick-hint').innerText(), /50장씩 나눠 고르면/, '메신저 [+] 에도');
    await m.getByRole('button', { name: /더 보내기/ }).click();
    await longTasks(m);
    const t1 = Date.now();
    await m.getByTestId('chat-gallery-input').setInputFiles(files);
    await m.getByTestId('chat-messages').locator(`[data-testid="chat-album"][data-count="${N}"]`).waitFor({ timeout: 600_000 });
    const chatMs = Date.now() - t1;
    const rows = await sql`select count(*)::int n, count(distinct batch_id)::int b from chat_messages where room_id = ${room} and file_name is not null`;
    assert.deepEqual([rows[0].n, rows[0].b], [N, 1], '147장 한 묶음');
    const lt2 = await m.evaluate(() => window.__lt);
    console.log(`    업무 첨부 ${N}장 ${Math.round(attMs / 1000)}초(줄인 사진 ${shrunk}장 · 긴 작업 ${lt1.n}개 최대 ${Math.round(lt1.max)}ms) · 메신저 ${N}장 ${Math.round(chatMs / 1000)}초(긴 작업 ${lt2.n}개 최대 ${Math.round(lt2.max)}ms) · 사진 1장 ${Math.round(buf.length / 1024)}KB`);
  } finally { await mob.close(); }
}
