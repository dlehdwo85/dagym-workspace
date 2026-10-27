// 210차 #619 자료실 자동 분류 고도화 — 영상을 올리면 브라우저가 장면 사진 2장(처음 쪽·가운데)을 뽑아 AI 정리에 보냄(영상 자체는 안 보냄)
// · '정리 필요'(확신 70% 미만) 보기: 안내 줄 · [보이는 n개 모두 선택] → [정리 맞음] 묶어서 확인 → 다 확인하면 보기에서 나옴 · 휴대폰 폭 넘침 없음
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

export async function library210({ owner, sql, BASE, FAKE, SHOTS }) {
  const ctl = (b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  const organized = (folder, confidence) => ({ content: [{ type: 'text', text: JSON.stringify({ folder, tags: ['시험'], title: '', summary: '시험', confidence, security: 'internal' }) }], stop_reason: 'end_turn' });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // ① 영상: 브라우저가 풀 수 있는 VP8 webm 4초
  const dir = path.join(tmpdir(), 'workos-test', 'e2e-210'); await mkdir(dir, { recursive: true });
  const webm = path.join(dir, 'clip.webm');
  execFileSync(path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=4:size=320x180:rate=10', '-c:v', 'libvpx', '-b:v', '200k', webm]);
  await ctl({ anthropicReset: true, anthropicQueue: [organized('현장/영상', 0.9)] });
  const seen = (await (await fetch(FAKE + '/__state')).json()).anthropic.length;
  await owner.goto(BASE + '/library');
  await owner.locator('[data-testid="library-list"], [data-testid="library-empty"]').first().waitFor(); // 화면 준비(목록을 불러옴) 전에 고르면 받는 쪽이 아직 없어 무시됨
  await owner.getByTestId('library-file').setInputFiles([{ name: 'E2E 현장 영상 210.webm', mimeType: 'video/webm', buffer: await readFile(webm) }]);
  await owner.getByTestId('upload-note').filter({ hasText: '→ 현장/영상 으로 정리했어요' }).waitFor({ timeout: 60_000 });
  const ask = (await (await fetch(FAKE + '/__state')).json()).anthropic.slice(seen).map((r) => r.body).find((b) => JSON.stringify(b.messages).includes('E2E 현장 영상 210.webm'));
  assert.ok(ask, '자동 정리 요청');
  const imgs = ask.messages[0].content.filter((b) => b.type === 'image');
  assert.equal(imgs.length, 2, '장면 사진 2장');
  for (const b of imgs) { const m = await sharp(Buffer.from(b.source.data, 'base64')).metadata(); assert.deepEqual([m.format, m.width, m.height], ['jpeg', 320, 180]); }
  assert.notEqual(imgs[0].source.data, imgs[1].source.data, '처음 쪽·가운데는 다른 장면');
  assert.match(ask.messages[0].content.find((b) => b.type === 'text').text, /영상 장면 사진 2장/);

  // ② 정리 필요: 0.65·0.5 는 확인 대기, 0.75 는 바로 정리
  await ctl({ anthropicReset: true, anthropicQueue: [organized('운영/보고', 0.65), organized('운영/보고', 0.5), organized('운영/보고', 0.75)] });
  await owner.getByTestId('library-file').setInputFiles([
    { name: 'E2E 주간보고 초안.txt', mimeType: 'text/plain', buffer: Buffer.from('초안') },
    { name: 'E2E 주간보고 메모.txt', mimeType: 'text/plain', buffer: Buffer.from('메모') },
    { name: 'E2E 주간보고 최종.txt', mimeType: 'text/plain', buffer: Buffer.from('최종') }]);
  await owner.getByText(/3개 정리: 보고 3/).first().waitFor();
  const flags = async () => Object.fromEntries((await sql`select file_name, needs_review from library_files where file_name like 'E2E 주간보고%' and deleted_at is null`).map((r) => [r.file_name, r.needs_review]));
  assert.deepEqual(await flags(), { 'E2E 주간보고 초안.txt': true, 'E2E 주간보고 메모.txt': true, 'E2E 주간보고 최종.txt': false });
  await owner.getByTestId('library-review').click();
  const bar = owner.getByTestId('library-review-bar'); await bar.waitFor();
  assert.match(await bar.innerText(), /70% 아래/);
  const all = bar.getByTestId('library-review-all');
  const n = Number(/보이는 (\d+)개/.exec(await all.innerText())[1]);
  assert.ok(n >= 2, `정리 필요 ${n}개`);
  await all.click();
  const bulk = owner.getByTestId('library-bulk'); await bulk.waitFor();
  assert.match(await bulk.innerText(), new RegExp(`${n}개 선택`));
  await owner.screenshot({ path: `${SHOTS}/556-library-review-bulk.png` });
  // 휴대폰 폭: 안내 줄·묶음 줄 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await bulk.getByTestId('library-bulk-approve').waitFor();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 1, '휴대폰 폭 넘침 없음');
  await owner.setViewportSize({ width: 1366, height: 900 });
  await bulk.getByTestId('library-bulk-approve').click();
  await owner.getByText(new RegExp(`${n}개 정리를 확인했습니다`)).first().waitFor();
  await owner.getByTestId('library-review').waitFor({ state: 'detached' }); // 다 확인 → '정리 필요' 보기에서 나옴
  assert.deepEqual(await flags(), { 'E2E 주간보고 초안.txt': false, 'E2E 주간보고 메모.txt': false, 'E2E 주간보고 최종.txt': false });
  assert.equal((await sql`select folder from library_files where file_name = 'E2E 주간보고 초안.txt'`)[0].folder, '운영/보고', '폴더는 그대로');
}
