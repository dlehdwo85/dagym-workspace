// 295차 #835(대표 10/31 '레퍼런스를 안 한 느낌 · 배경 단색에 글자 하나 툭'): 자동 제작 화면 › 레퍼런스 대조표 [대조표 열기]
// → 단색 표지 글 줄의 '표지 사진·화면·도표' 칸 ✗ + 까닭 · 항목별 미통과 칩 · 휴대폰 폭에서 화면 넘침 없음(표는 칸 안에서 옆으로 밀림)
import assert from 'node:assert/strict';

export async function refCheck295({ owner, ctx, sql, BASE }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 대조 브랜드' })).id;
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, kind, scheduled_at, status, current_version, created_by, auto, quality)
    values ('default', ${brand}, 'E2E 단색 표지 글', 'instagram', 'feed', now() + interval '5 days', 'changes', 1, ${ctx.ownerId}, true,
      ${sql.json({ passed: false, issues: ['표지가 단색 바탕 + 글자뿐'], visual: { by: 'server', fileId: null, photoId: null, template: 'title', plain: true, rv: 8 } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${'E2E 단색 표지 글\n본문 한 줄'}, array[gen_random_uuid()], '시안', ${ctx.ownerId})`;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/marketing/automation`);
    await owner.getByTestId('refcheck').waitFor();
    await owner.getByTestId('refcheck-load').click();
    const row = owner.locator(`[data-testid=refcheck-row][data-id="${c.id}"]`);
    await row.waitFor();
    const cover = row.getByTestId('refcheck-cover');
    assert.equal(await cover.getAttribute('data-ok'), 'false');
    assert.match(await cover.innerText(), /단색 바탕 \+ 글자/);
    await owner.getByTestId('refcheck-summary').getByText(/표지 사진·화면·도표 미통과/).waitFor();
    await owner.setViewportSize({ width: 390, height: 800 });
    await owner.waitForTimeout(200);
    const over = await owner.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 1, `휴대폰 폭 화면 넘침 ${over}px`);
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await sql`delete from mkt_versions where content_id = ${c.id}`; await sql`delete from mkt_contents where id = ${c.id}`;
  }
}
