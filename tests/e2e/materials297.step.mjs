// 297차 #836(대표 10/31 '사진이나 자료를 업로드하는 걸 요청하는 요청 페이지'): 마케팅 › 자료 요청
// 메뉴 → AI 마케터 요청 카드(브랜드·종류·기한·담당·막힌 글 수) → [자료 올리기]로 사진 → 받음(자료실 '마케팅/브랜드 자료/{브랜드}') · 관리자 [자료 요청 만들기] · 휴대폰 폭 넘침 없음
import assert from 'node:assert/strict';
import sharp from 'sharp';

export async function materials297({ owner, ctx, sql, BASE }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 자료 브랜드' })).id;
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, quality)
    values ('default', ${brand}, 'E2E 표지 사진 필요 글', 'instagram', 'feed', now() + interval '5 days', 'changes', 1, ${ctx.ownerId}, true,
      ${sql.json({ passed: false, issues: ['표지가 단색 바탕 + 글자뿐'], visual: { by: 'server', fileId: null, photoId: null, template: 'title', plain: true, rv: 8 } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${'E2E 표지 사진 필요 글\n본문 한 줄'}, array[gen_random_uuid()], '시안', ${ctx.ownerId})`;
  const [r] = await sql`insert into mkt_material_requests (tenant, brand_id, content_id, kind, title, detail, wanted, assignee_id, due_on, source)
    values ('default', ${brand}, ${c.id}, 'photo', 'E2E 자료 브랜드 실사 5장 — 시설·입구·이용 장면', ${'표지에 쓸 사진이 없어 단색 바탕 표지만 나옵니다\n· 시설 전경·입구'}, 5, ${ctx.ownerId}, current_date + 7, 'ai') returning id`;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/marketing/approvals`);
    await owner.getByRole('link', { name: '자료 요청' }).first().click();
    await owner.waitForURL(/\/s\/marketing\/materials/);
    const card = owner.locator(`[data-testid=material-card][data-material="${r.id}"]`);
    await card.waitFor();
    assert.equal(await card.getAttribute('data-status'), 'requested');
    const text = await card.innerText();
    assert.match(text, /E2E 자료 브랜드/); assert.match(text, /AI 마케터/); assert.match(text, /D-7/); assert.match(text, /요청한 글: E2E 표지 사진 필요 글/);
    await card.getByTestId('material-blocked').getByText('표지 사진이 필요한 글 1개').waitFor();
    // 올리기 → 받음
    const jpg = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 120, g: 150, b: 130 } } }).jpeg().toBuffer();
    await card.getByTestId('material-upload').setInputFiles({ name: 'E2E 입구.jpg', mimeType: 'image/jpeg', buffer: jpg });
    await owner.getByText(/1개 받았습니다/).waitFor({ timeout: 30000 });
    await owner.getByTestId('material-tab-all').click();
    const done = owner.locator(`[data-testid=material-card][data-material="${r.id}"]`);
    await done.getByTestId('material-files').getByText(/E2E 입구/).waitFor();
    assert.ok(['received', 'used'].includes(await done.getAttribute('data-status')));
    const [f] = await sql`select folder, tags, space from library_files where id = (select file_ids[1] from mkt_material_requests where id = ${r.id})`;
    assert.equal(f.folder, '마케팅/브랜드 자료/E2E 자료 브랜드'); assert.equal(f.space, 'marketing'); assert.ok(f.tags.includes('자료 요청'));
    // 관리자 [자료 요청 만들기]
    await owner.getByTestId('material-new').click();
    await owner.getByTestId('material-brand').selectOption(brand);
    await owner.getByTestId('material-title').fill('E2E 매장 영상 3개');
    await owner.getByTestId('material-save').click();
    await owner.getByText('자료 요청을 만들었습니다').waitFor();
    await owner.locator('[data-testid=material-card][data-status=requested]').getByText('E2E 매장 영상 3개').waitFor();
    await owner.setViewportSize({ width: 390, height: 800 });
    await owner.waitForTimeout(200);
    const over = await owner.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 1, `휴대폰 폭 화면 넘침 ${over}px`);
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await sql`delete from mkt_material_requests where brand_id = ${brand}`;
    await sql`delete from mkt_versions where content_id = ${c.id}`; await sql`delete from mkt_contents where id = ${c.id}`;
  }
}
