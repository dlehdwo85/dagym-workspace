// #235 ⓑ 블로그 네이버 형식 화면: 자동 제작 '글 모델' 블로그 줄(비용) · 사실 카드 '블로그 검색 키워드' 저장(두 글자 미만 빼고) · 사진 판정 '쓰지 않음' 선택지(로컬 10/25)
// → 승인한 블로그 글 상세: 글 품질 '블로그 형식' 줄(글자·사진·인용구·소제목) · 게시 도우미 '표지·사진 n' 순서 + '[사진 n] 자리' 안내 · 휴대폰 넘침 없음
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

const V = (o) => ({ v: 1, at: new Date().toISOString(), caption: '실내 사진', scene: '실내 모습입니다.', tags: ['실내'], kind: 'photo', text: 'none', promo: false, seen: '', people: 0, faces: false, quality: 'good', ...o });

export async function mktBlog({ owner, ctx, BASE, SHOTS, sql }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  const b = await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E블로그짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b.id}`, { intro: '송도 동네 헬스장', products: '1개월 회원권' });
  const ids = [];
  for (const [k, cap] of [[1, '매장 입구 모습'], [2, '러닝머신이 줄지어 선 매장 안'], [3, '스트레칭 공간']]) {
    const name = `E2E블로그짐 사진 ${k}.jpg`;
    const data = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 40 * k, g: 140, b: 120 } } }).jpeg().toBuffer();
    const [f] = await sql`insert into library_files (tenant, space, folder, title, file_name, mime_type, size_bytes, created_by, upload_status, source, tags, vision)
      values (${tenant}, 'marketing', '마케팅/사진', ${name}, ${name}, 'image/jpeg', ${data.length}, ${ctx.ownerId}, 'ready', 'upload', ${[]}, ${sql.json(V({ caption: cap }))}) returning id`;
    const key = `lib/${tenant}/${f.id}/${name}`;
    await mkdir(path.dirname(path.join(tmpdir(), 'workos-test', 'uploads', key)), { recursive: true });
    await writeFile(path.join(tmpdir(), 'workos-test', 'uploads', key), data);
    await sql`update library_files set storage_key = ${key} where id = ${f.id}`;
    ids.push(f.id);
  }
  // 자동 제작: 글 모델 블로그 줄 · 사실 카드 블로그 검색 키워드 · 사진 판정 '쓰지 않음'
  await owner.goto(`${BASE}/s/marketing/automation`);
  assert.match(await owner.getByTestId('auto-write-model-blog').innerText(), /네이버 블로그\(1,800~2,500자·사진 8~15장 형식\): .+ · 1건 약 [\d,]+원/);
  const kit = owner.getByTestId('brand-facts-E2E블로그짐'); await kit.waitFor();
  await kit.locator('summary').click();
  await kit.getByTestId('facts-keywords').fill('송도 헬스장, 송도 PT, 송');
  await kit.getByTestId('facts-save').click();
  await owner.getByText('사실 카드·주제 풀을 저장했습니다').first().waitFor();
  assert.deepEqual((await sql`select facts->'keywords' as k from mkt_brands where id = ${b.id}`)[0].k, ['송도 헬스장', '송도 PT'], '두 글자 미만은 빼고 저장');
  const photos = owner.getByTestId('auto-photos');
  await photos.getByTestId('photos-list').locator('summary').click();
  const item = photos.locator(`[data-testid="photo-item"]:has(img[src*="${ids[2]}"])`);
  assert.deepEqual(await item.getByTestId('photo-mark').locator('option').allInnerTexts(), ['AI 판정대로', '글자 없음 — 바탕으로 씀', '글자 있음 — 바탕에만 안 씀', '쓰지 않음 — 바탕·본문 모두']);
  await item.getByTestId('photo-mark').selectOption('skip');
  await owner.getByText('쓰지 않는 사진으로 표시했습니다').first().waitFor();
  await item.getByTestId('photo-skip').waitFor();
  await item.getByTestId('photo-mark').selectOption('auto');
  await owner.getByText('AI 판정대로 씁니다').first().waitFor();
  // 승인한 블로그 글(사진 줄·인용구·소제목) → 상세: 블로그 형식 줄 · 게시 도우미 표지·사진 순서·[사진 n] 안내
  const body = ['송도 헬스장을 처음 알아보는 분께 드리는 글입니다.', '결론부터 말하면 첫 주는 시간대만 정해도 충분합니다.'].join('\n')
    + '\n\n[사진 1] 매장 입구 모습\n\n■ 송도 헬스장 가격 확인하는 법\n\n회원권은 기간이 길수록 한 달 값이 내려갑니다.\n처음에는 한 달로 시작해도 괜찮습니다.\n\n“처음 한 달은 시간대만 정해도 충분합니다.”\n\n[사진 2] 러닝머신이 줄지어 선 매장 안\n\n문의 032-111-2222';
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, approved_version, created_by, auto, produced_at, quality)
    values (${tenant}, ${b.id}, 'E2E 송도 헬스장 블로그', 'blog', 'blog', now() + interval '2 days', 'approved', 1, 1, ${ctx.ownerId}, true, now(), ${sql.json({ passed: true, issues: [] })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${body}, ${[ids[2], ids[0], ids[1]]}, 'AI 자동 제작', ${ctx.ownerId})`;
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  const q = owner.getByTestId('quality-blog'); await q.waitFor();
  assert.match(await q.innerText(), /블로그 형식 · 본문 [\d,]+자 · 사진 2장 · 인용구 1개 · 소제목 1개/);
  const helper = owner.getByTestId('publish-helper'); await helper.waitFor();
  const media = await helper.getByTestId('ph-media').allInnerTexts();
  assert.deepEqual(media.map((t) => t.split(' E2E')[0]), ['표지', '사진 1', '사진 2'], media.join(' / '));
  assert.match(await helper.getByTestId('ph-photo-guide').innerText(), /\[사진 n\]’ 자리마다 n번 사진을 넣고.*사진 2장/);
  await helper.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/279-blog-format.png` });
  await owner.keyboard.press('Escape');
  // 휴대폰: 상세(블로그 형식 줄·게시 도우미) 가로 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  await owner.getByTestId('publish-helper').waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
}
