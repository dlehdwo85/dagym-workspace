// #235 ⓒ(대표 #563) 사진 AI 설명 화면: 자동 제작 › 사진 AI 설명 — 숫자(아직 n장) → [설명 없는 사진 설명하기] → 설명·판정 숫자 → 사진별 목록(설명·종류·글자·홍보물·쓰임)
// → 판정 고치기(얼굴 보이는 사진을 '글자 없음 — 바탕으로 씀') → 되돌리기 · 자료실 목록 'AI 사진 설명' 줄 · 휴대폰 넘침 없음
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const V = (o) => ({ caption: '실내 사진', scene: '실내 모습입니다.', tags: ['실내'], kind: 'photo', text: 'little', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });

export async function mktPhotos({ owner, ctx, BASE, FAKE, SHOTS, sql }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  // 앞 단계에서 올린 사진은 설명된 것으로(이 단계 숫자만 보게 — 188차부터 자료실 전체 사진이 대상이라 공간 무관) — 새 사진 3장은 가장 최근, 설명하는 순서 = 마케팅 공간·최근 것부터
  await sql`update library_files set vision = coalesce(vision, ${sql.json({ v: 1, at: new Date().toISOString(), error: 'E2E 앞 단계 사진', tries: 3 })}) where tenant = ${tenant} and mime_type like 'image/%'`;
  const ids = {};
  for (const [k, name, color, sec] of [['face', 'E2E 수업 장면.jpg', { r: 200, g: 120, b: 80 }, 30], ['promo', 'E2E 사진 2.jpg', { r: 40, g: 40, b: 160 }, 20], ['clean', 'E2E 매장 안.jpg', { r: 60, g: 160, b: 120 }, 10]]) {
    const data = await sharp({ create: { width: 640, height: 480, channels: 3, background: color } }).jpeg().toBuffer();
    const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, created_at)
      values (${tenant}, 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${[]}, now() + ${`${60 - sec} seconds`}::interval) returning id`;
    const key = `lib/${tenant}/${f.id}/${name}`;
    await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
    await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
    await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
    ids[k] = f.id;
  }
  // 설명 순서 = 최근 것부터: 매장 안(글자 없는 실사) → 이벤트 포스터(홍보물) → 수업 장면(얼굴 보임)
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, visionQueue: [
    V({ caption: '러닝머신이 줄지어 선 매장 안', scene: '아침 매장 안쪽 모습입니다.', tags: ['러닝머신', '매장'], text: 'none' }),
    V({ caption: '10월 이벤트 안내 포스터', kind: 'graphic', text: 'much', promo: true, seen: '10월 이벤트' }),
    V({ caption: '트레이너가 회원에게 자세를 알려 주는 모습', tags: ['수업', '트레이너'], faces: true, people: 2 }),
  ] }) });
  await owner.goto(`${BASE}/s/marketing/automation`);
  const box = owner.getByTestId('auto-photos'); await box.waitFor();
  assert.match(await box.getByTestId('photos-summary').innerText(), /아직 3장/);
  await box.getByTestId('photos-describe').click();
  await owner.getByText('사진 3장을 설명했습니다').first().waitFor();
  await box.getByTestId('photos-summary').filter({ hasText: '아직 0장' }).waitFor();
  const v = Object.fromEntries((await sql`select id, vision from library_files where id = any(${Object.values(ids)}::uuid[])`).map((r) => [r.id, r.vision]));
  assert.deepEqual([v[ids.clean].caption, v[ids.promo].promo, v[ids.face].faces], ['러닝머신이 줄지어 선 매장 안', true, true]);
  // 사진별 목록: 설명·쓰임 배지
  await box.getByTestId('photos-list').locator('summary').click();
  const item = (id) => box.locator(`[data-testid="photo-item"]:has(img[src*="${id}"])`);
  await item(ids.clean).getByTestId('photo-cover').waitFor();
  assert.match(await item(ids.clean).innerText(), /러닝머신이 줄지어 선 매장 안[\s\S]*실사[\s\S]*글자 없음[\s\S]*시안 바탕 가능/);
  assert.match(await item(ids.promo).innerText(), /홍보물[\s\S]*쓰지 않음/);
  assert.match(await item(ids.face).innerText(), /얼굴 보임[\s\S]*블로그 본문 가능/);
  // 판정 고치기: 얼굴 보이는 사진 → 글자 없음(바탕으로 씀)
  await item(ids.face).getByTestId('photo-mark').selectOption('none');
  await owner.getByText('글자 없는 사진으로 고쳤습니다').first().waitFor();
  await item(ids.face).getByTestId('photo-cover').waitFor();
  assert.deepEqual((await sql`select tags from library_files where id = ${ids.face}`)[0].tags, ['글자없음']);
  await box.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/278-photo-vision.png` });
  await item(ids.face).getByTestId('photo-mark').selectOption('auto');
  await owner.getByText('AI 판정대로 씁니다').first().waitFor();
  await item(ids.face).locator('[data-testid="photo-cover"]').waitFor({ state: 'detached' });
  // 자료실 목록에도 'AI 사진 설명' 줄
  await owner.goto(`${BASE}/library?space=marketing&folder=${encodeURIComponent('마케팅/사진')}`);
  await owner.getByTestId('photo-vision').filter({ hasText: '러닝머신이 줄지어 선 매장 안' }).first().waitFor();
  // 휴대폰: 사진 목록을 펼쳐도 가로 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/automation`);
  const box2 = owner.getByTestId('auto-photos'); await box2.waitFor();
  await box2.getByTestId('photos-list').locator('summary').click();
  await box2.getByTestId('photo-item').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
}
