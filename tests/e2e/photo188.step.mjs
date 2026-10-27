// 188차(대표 #685·#695·#621 — 실사 전면): ① 콘텐츠 상세 '사진 기록'(표지·장마다 어떤 사진·왜·보정, 업무 공간 사진 표시, 행동 장 = 글자만)
// ② 자동 제작 › 사진 AI 설명 '자료실 영상' 줄 → [영상 장면 뽑기] → 장면 사진 3장(영상 장면 칩) · 휴대폰 넘침 없음 (구조 시험 — 실제 영상·사진 품질은 운영에서)
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const V = (o) => ({ v: 1, at: new Date().toISOString(), caption: '실내 사진', scene: '실내 모습입니다.', tags: ['실내'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });

export async function photo188({ owner, ctx, BASE, FAKE, SHOTS, sql }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  const lib = async (name, data, { space = 'marketing', folder = '마케팅/사진', mime = 'image/jpeg', vision = null } = {}) => {
    const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision)
      values (${tenant}, ${space}, ${folder}, ${name}, ${name}, ${mime}, ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${[]}, ${vision ? sql.json(vision) : null}) returning id`;
    const key = `lib/${tenant}/${f.id}/${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}`;
    await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
    await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
    await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
    return f.id;
  };
  const jpg = (r, g, b) => sharp({ create: { width: 800, height: 1000, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  const b = await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E실사짐' });
  const cover = await lib('E2E실사짐 매장 전경.jpg', await jpg(90, 120, 140), { vision: V({ caption: '매장 전경' }) });
  const locker = await lib('E2E실사짐 탈의실.jpg', await jpg(40, 40, 50), { vision: V({ caption: '탈의실 사물함' }) });
  const store = await lib('창고 정리 현장.jpg', await jpg(110, 100, 90), { space: 'work', folder: '운영/현장', vision: V({ caption: '창고 선반' }) });
  const lobby = await lib('E2E실사짐 로비.jpg', await jpg(120, 130, 120), { vision: V({ caption: '로비 의자' }) });
  // 서버가 그린 시안의 기록(quality.visual·pages) — 고르는 규칙은 API 시험(mkt-photo-188)이 보고, 여기서는 상세 화면 표시만
  const quality = { passed: true, issues: [], visual: { by: 'server', fileId: cover, photoId: cover, rv: 3, tried: [cover] },
    pages: [{ role: 'problem', title: '탈의실 사물함 부족', body: '', photoId: locker, fix: ['밝기'], pool: 3 }, { role: 'proof', title: '창고 정리로 넓어진 공간', body: '', photoId: store, pool: 3 },
      { role: 'solution', title: '아침 시간이 한산해요', body: '', photoId: lobby, rel: 'weak', pool: 3 }, { role: 'cta', title: '궁금하면 물어보세요', body: '' }] };
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, quality)
    values (${tenant}, ${b.id}, 'E2E 실사 사진 기록', 'instagram', 'feed', now() + interval '3 days', 'pending', 1, ${ctx.ownerId}, true, now(), ${sql.json(quality)}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, '매장 둘러보기\n문의 032-111-2222', ${[cover]}, 'AI 자동 제작 · 카드 5장(실사 3장 · 후보 3장 · 관련 약함 1장 · 보정 1장)', ${ctx.ownerId})`;
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  const rec = owner.getByTestId('mkt-photo-record'); await rec.waitFor();
  assert.match(await rec.locator('summary').innerText(), /사진 기록 — 실사 4장 \/ 5칸/);
  await rec.locator('summary').click();
  const rows = await rec.getByTestId('mkt-photo-row').allInnerTexts();
  assert.equal(rows.length, 5, rows.join(' / '));
  assert.match(rows[0], /^표지\s*E2E실사짐 매장 전경\.jpg[\s\S]*표지 바탕/);
  assert.match(rows[1], /^2장\s*E2E실사짐 탈의실\.jpg[\s\S]*보정: 밝기[\s\S]*낱말이 맞는 사진/);
  assert.match(rows[2], /^3장\s*창고 정리 현장\.jpg\s*\(운영\/현장 · 업무 공간\)/);
  assert.match(rows[3], /^4장\s*E2E실사짐 로비\.jpg[\s\S]*관련 약함/);
  assert.match(rows[4], /^5장\s*색 바탕[\s\S]*행동 장 — 글자만/);
  await rec.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/188-photo-record.png` });
  await owner.keyboard.press('Escape');
  // 자료실 영상 → [영상 장면 뽑기]: 앞 단계 영상(가짜 파일 등)은 건너뛴 것으로 두고 이 단계 영상만
  await sql`update library_files set meta = coalesce(meta, '{}'::jsonb) || ${sql.json({ scenes: { v: 1, at: new Date().toISOString(), skipped: 'E2E 앞 단계 영상' } })} where tenant = ${tenant} and mime_type like 'video/%'`;
  const dir = path.join(tmpdir(), 'workos-test', 'e2e-scenes'); await mkdir(dir, { recursive: true });
  const mp4 = path.join(dir, 'clip.mp4');
  execFileSync(path.join(process.cwd(), 'node_modules', 'ffmpeg-static', 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=9:size=640x360:rate=10', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', mp4]);
  const vid = await lib('E2E실사짐 현장 영상.mp4', await readFile(mp4), { folder: '마케팅/영상', mime: 'video/mp4' });
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true }) });
  await owner.goto(`${BASE}/s/marketing/automation`);
  const box = owner.getByTestId('auto-photos'); await box.waitFor();
  assert.match(await box.getByTestId('photos-videos').innerText(), /장면 뽑음 0편\(장면 사진 0장\) · 아직 1편/);
  await box.getByTestId('photos-scenes').click();
  await owner.getByText(/영상 1편에서 장면 3장을 뽑았습니다/).first().waitFor({ timeout: 60_000 });
  await box.getByTestId('photos-videos').filter({ hasText: '장면 뽑음 1편(장면 사진 3장)' }).waitFor();
  const frames = await sql`select id from library_files where source = 'video_frame' and meta->'video'->>'id' = ${vid} and deleted_at is null`;
  assert.equal(frames.length, 3);
  await box.getByTestId('photos-list').locator('summary').click();
  await box.locator(`[data-testid="photo-item"]:has(img[src*="${frames[0].id}"])`).getByTestId('photo-scene').waitFor();
  await box.locator(`[data-testid="photo-item"]:has(img[src*="${store}"])`).getByTestId('photo-space').filter({ hasText: '업무 공간' }).waitFor();
  await box.scrollIntoViewIfNeeded();
  // 사진 칸은 loading=lazy — 화면에 보이는 썸네일이 다 그려진 뒤 찍음(빈 회색 칸 캡처 방지)
  await owner.waitForFunction(() => [...document.querySelectorAll('[data-testid="photo-item"] img')]
    .filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; })
    .every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 }).catch(() => {});
  await owner.screenshot({ path: `${SHOTS}/188-photo-scenes.png` });
  // 휴대폰: 상세 사진 기록 펼쳐도 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  const mrec = owner.getByTestId('mkt-photo-record'); await mrec.waitFor();
  await mrec.locator('summary').click();
  await mrec.getByTestId('mkt-photo-row').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.keyboard.press('Escape');
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 정리: 이 단계 글은 승인함 숫자에 섞이지 않게 취소 · 브랜드 이름 없는 업무 공간 사진(창고)은 지움 — 남겨 두면 뒤 단계의 다른 브랜드 시안·피드 틀 미리보기가
  //  자료실 전체 후보(188차)로 이 사진을 바탕에 써서 '사진 없음' 전제가 깨짐(CI 1491·1492·1494 #544 피드 틀 '회색 = 사진 자리')
  await sql`update mkt_contents set status = 'canceled' where id = ${c.id}`;
  await sql`update library_files set deleted_at = now() where id = ${store}`;
}
