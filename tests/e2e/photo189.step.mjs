// 189차(대표 #685 '실사가 모자라면 실사를 참고해 실사풍으로 생성' · #621 'AI 재생성'): ① 콘텐츠 상세 '빈 사진 칸 n칸' → [빈 칸 생성으로 채우기] → [지금 확인]
// → 그 칸만 생성 사진으로 다시 그린 새 버전 · 사진 기록 'AI 생성(실사 참고)' ② 사진 AI 설명 목록 'AI 생성' 칩 · [AI로 다시 만들기](확인 창·크레딧) → '다시 만드는 중'
// ③ 자동 제작 설정 '사진이 모자라면 실사 참고로 생성' 기본 꺼짐 · 휴대폰 폭 — 가짜 생성 서버(FAKE/hf)로만(실제 생성·과금 없음)
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const V = (o) => ({ v: 1, at: new Date().toISOString(), caption: '실내 사진', scene: '실내 모습입니다.', tags: ['실내'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });
const ctl = (FAKE, b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

export async function photo189({ owner, ctx, BASE, FAKE, SHOTS, sql }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  // 생성 연동(가짜 서버) — 이미지 모델 표 '참고 사진 칸' = image_url. 끝나면 꺼고 모델 표 되돌림(뒤 단계 영향 없게)
  const hf0 = await ctx.owner.ok('GET', '/api/platform/higgsfield');
  const auto0 = (await ctx.owner.ok('GET', '/api/marketing/auto')).settings;
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { apiKey: 'test-id:test-secret', base: `${FAKE}/hf`, models: hf0.models.map((m) => (m.id === 'higgsfield-ai/soul/v2/standard' ? { ...m, ref: 'image_url' } : m)) });
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: true });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { weeklyCredits: 1000, monthlyCredits: 1000 });
  const lib = async (name, data, { folder = '마케팅/사진', vision = null, source = 'upload' } = {}) => {
    const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision)
      values (${tenant}, 'marketing', ${folder}, ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', ${source}, ${[]}, ${vision ? sql.json(vision) : null}) returning id`;
    const key = `lib/${tenant}/${f.id}/${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}`;
    await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
    await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
    await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
    return f.id;
  };
  const jpg = (r, g, b, w = 800, h = 1000) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).jpeg().toBuffer();
  const b = await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E참고짐' });
  const ref = await lib('E2E참고짐 매장 전경.jpg', await jpg(90, 120, 140), { vision: V({ caption: '밝은 매장 전경' }) });
  // 서버가 그린 시안(표지 = 실사, 장 2개는 실사가 모자라 색 바탕, 행동 장) — 장 그림 파일 3장은 자리만
  const pageFiles = [];
  for (let k = 0; k < 3; k++) pageFiles.push(await lib(`E2E참고짐 시안 ${k + 2}.jpg`, await jpg(30, 60, 90, 540, 675), { folder: '마케팅/자동 시안', source: 'ai' }));
  const quality = { passed: true, issues: [], visual: { by: 'server', fileId: ref, photoId: ref, rv: 3, tried: [ref] },
    pages: [{ role: 'problem', title: '아침 운동 자리 걱정', body: '출근 전에도 기구가 비어 있어요', pool: 0 }, { role: 'proof', title: '넓어진 운동 공간', body: '기구 사이가 넓어졌어요', pool: 0 },
      { role: 'cta', title: '궁금하면 물어보세요', body: '문의 032-111-2222' }] };
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, quality)
    values (${tenant}, ${b.id}, 'E2E 실사 참고 생성', 'instagram', 'feed', now() + interval '3 days', 'pending', 1, ${ctx.ownerId}, true, now(), ${sql.json(quality)}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, '아침 운동 안내\n문의 032-111-2222', ${[ref, ...pageFiles]}, 'AI 자동 제작 · 카드 4장(실사 0장 · 후보 0장)', ${ctx.ownerId})`;
  await ctl(FAKE, { hfReset: true, hfPolls: 0, hfMode: null });
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  const box = owner.getByTestId('mkt-fill'); await box.waitFor();
  assert.match(await box.innerText(), /빈 사진 칸 2칸/);
  await box.getByTestId('mkt-fill-start').click();
  // 296차: 사진이 든 장이 전체의 절반이 될 만큼만 채움 — 4장(표지 실사 1) 중 빈 칸 2칸이어도 생성은 1장
  await owner.getByText(/실사 참고 생성을 시작했습니다\(1장\)/).first().waitFor();
  await owner.getByTestId('mkt-fill').filter({ hasText: '만드는 중' }).waitFor();
  await owner.getByTestId('mkt-fill-check').click();
  await owner.getByText(/생성 사진 1장으로 빈 칸을 채웠습니다/).first().waitFor({ timeout: 60_000 });
  await owner.getByTestId('mkt-fill').filter({ hasText: '채움 1장' }).waitFor();
  const [cv] = await sql`select current_version, quality from mkt_contents where id = ${c.id}`;
  assert.equal(cv.current_version, 2);
  assert.deepEqual(cv.quality.pages.map((p) => !!p.gen), [true, false, false]);
  const st = await fetch(`${FAKE}/__state`).then((r) => r.json());
  assert.deepEqual([st.hf.length, st.hfUploads.length], [1, 1], '참고 사진 1번 올리고 1장 생성');
  const rec = owner.getByTestId('mkt-photo-record'); await rec.waitFor();
  assert.match(await rec.locator('summary').innerText(), /사진 기록 — 실사 1장 · 생성 1장 \/ 4칸/);
  await rec.locator('summary').click();
  await rec.getByTestId('mkt-photo-gen').first().waitFor();
  assert.equal(await rec.getByTestId('mkt-photo-gen').count(), 1);
  const rows = await rec.getByTestId('mkt-photo-row').allInnerTexts();
  assert.match(rows[1], /^2장[\s\S]*AI 생성\(실사 참고\)[\s\S]*실사가 모자라 생성 — 참고 실사: E2E참고짐 매장 전경\.jpg/);
  await owner.getByTestId('mkt-fill').scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/189-photo-fill.png` });
  await owner.keyboard.press('Escape');
  // 사진 AI 설명: 생성 사진 'AI 생성' 칩 · 실사에 [AI로 다시 만들기](확인 창) → '다시 만드는 중' · 설정 기본 꺼짐
  await owner.goto(`${BASE}/s/marketing/automation`);
  assert.equal(await owner.getByTestId('auto-photo-gen').isChecked(), false, '사진 생성 회사 설정 기본 꺼짐');
  const photos = owner.getByTestId('auto-photos'); await photos.waitFor();
  assert.match(await photos.getByTestId('photos-summary').innerText(), /AI 생성\(실사 참고\) 1장/);
  await photos.getByTestId('photos-list').locator('summary').click();
  const gens = cv.quality.pages.filter((p) => p.gen).map((p) => p.photoId);
  await photos.locator(`[data-testid="photo-item"]:has(img[src*="${gens[0]}"])`).getByTestId('photo-gen').waitFor();
  const refItem = photos.locator(`[data-testid="photo-item"]:has(img[src*="${ref}"])`);
  assert.match(await refItem.getByTestId('photo-regen').innerText(), /AI로 다시 만들기 · 크레딧 6\.5/);
  owner.once('dialog', (d) => d.accept());
  await refItem.getByTestId('photo-regen').click();
  await owner.getByText(/다시 만들기를 시작했습니다/).first().waitFor();
  await refItem.getByTestId('photo-regen-state').filter({ hasText: '다시 만드는 중' }).waitFor();
  await refItem.scrollIntoViewIfNeeded();
  await owner.waitForFunction(() => [...document.querySelectorAll('[data-testid="photo-item"] img')]
    .filter((i) => { const r = i.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; })
    .every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15_000 }).catch(() => {});
  await owner.screenshot({ path: `${SHOTS}/189-photo-regen.png` });
  // 휴대폰: 상세 빈 칸 상자·사진 기록 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  await owner.getByTestId('mkt-fill').waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.keyboard.press('Escape');
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 정리: 글 취소 · 다시 만들기 진행 표시 지움 · 생성 연동 끄고 모델 표·크레딧 한도 되돌림
  await sql`update mkt_contents set status = 'canceled' where id = ${c.id}`;
  await sql`update library_files set meta = meta - 'regen' where id = ${ref}`;
  await ctx.owner.ok('PUT', '/api/platform/higgsfield', { enabled: false, models: hf0.models });
  await ctx.owner.ok('PUT', '/api/marketing/auto', { weeklyCredits: auto0.weekly_credits ?? null, monthlyCredits: auto0.monthly_credits ?? null });
}
