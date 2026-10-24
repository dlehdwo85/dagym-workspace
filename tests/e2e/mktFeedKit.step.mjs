// #544 브랜드 키트 '피드 틀'(대표 10/24 '브랜드별 레퍼런스와 비교해 개선한 뒤 승인 다시'): 성격 고르기(신뢰형 = 틀 4개 켜짐) → 색·머리줄·연락처 줄·머리말
// → [고른 틀 미리보기](틀마다 한 장·사진 없으면 회색 자리 안내) → [피드 틀 저장] → 바탕 색 출처 '피드 틀' → 승인함 초안 보관 글 [새 틀로 다시 그리기](보관 그대로) · 휴대폰 폭
// (구조 시험 — 그림 모양은 미리보기 화면 사진으로 사람이 확인)
import assert from 'node:assert/strict';

export async function mktFeedKit({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 피드 브랜드' })).id;
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${brand}`, { intro: '아파트 커뮤니티 운영 대행', products: '운영 대행' });
  const [{ tenant }] = await sql`select tenant from mkt_brands where id = ${brand}`;
  await owner.setViewportSize({ width: 1366, height: 1000 });
  await owner.goto(`${BASE}/s/marketing/automation`);
  const kit = owner.getByTestId('brand-feed-E2E 피드 브랜드'); await kit.waitFor();
  assert.match(await kit.getByTestId('brand-feed-summary').innerText(), /아직 안 정함 · 정기 자동 시안은 초안 보관/);
  await kit.getByTestId('brand-feed-summary').click();
  assert.match(await kit.getByTestId('brand-feed-draw').innerText(), /바탕 색/);
  await kit.getByTestId('brand-feed-style').selectOption('trust');
  for (const t of ['title', 'list', 'photo_fade', 'grid4']) assert.equal(await kit.getByTestId(`brand-feed-t-${t}`).isChecked(), true, `${t} 켜짐`);
  assert.equal(await kit.getByTestId('brand-feed-t-poster').isChecked(), false);
  await kit.getByTestId('brand-feed-bg').fill('#152037');
  await kit.getByTestId('brand-feed-accent').fill('#f0b038');
  await kit.getByTestId('brand-feed-header').fill('E2E 머리줄');
  await kit.getByTestId('brand-feed-contact').fill('상담 1234-5678 · example.co.kr');
  await kit.getByTestId('brand-feed-kicker').fill('운영 기록');
  await kit.getByTestId('brand-feed-preview').click();
  await kit.getByTestId('brand-feed-shots').waitFor({ timeout: 60000 });
  const shots = kit.getByTestId('brand-feed-shot');
  assert.equal(await shots.count(), 4);
  assert.deepEqual(await shots.locator('p.font-medium').allInnerTexts(), ['제목형', '번호 목록형', '사진 + 아래 그러데이션', '사진 4분할']);
  assert.match(await shots.nth(2).innerText(), /회색 = 사진 자리/, '시안 바탕 사진이 없으면 안내');
  for (let i = 0; i < 4; i++) assert.ok(await shots.nth(i).locator('img').evaluate((el) => el.complete && el.naturalWidth === 540), `미리보기 ${i + 1} 그림`);
  await kit.scrollIntoViewIfNeeded();
  await kit.screenshot({ path: `${SHOTS}/246-brand-feed-kit.png`, style: 'header.sticky { visibility: hidden !important; }' });
  await kit.getByTestId('brand-feed-save').click();
  await owner.getByText('피드 틀 4종을 저장했습니다 — 이제 E2E 피드 브랜드 자동 시안은 이 틀로 그려 승인함으로 갑니다').waitFor();
  const [b] = await sql`select feed from mkt_brands where id = ${brand}`;
  assert.deepEqual([b.feed.style, b.feed.templates, b.feed.palette.bg, b.feed.palette.accent, b.feed.header, b.feed.kicker], ['trust', ['title', 'list', 'photo_fade', 'grid4'], '#152037', '#F0B038', 'E2E 머리줄', '운영 기록']);
  await kit.getByTestId('brand-feed-summary').filter({ hasText: '4종 사용 중' }).waitFor();
  // 승인함 초안 보관 글 → [새 틀로 다시 그리기]: 보관 그대로, 틀 이름 안내
  const [hc] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, brand_id, quality)
    values (${tenant}, 'E2E 피드 보관 글', 'instagram', 'feed', now() + interval '4 days', 'draft', 1, ${ctx.ownerId}, true, now(), ${brand}, ${sql.json({ passed: true, issues: [], held: { at: new Date().toISOString(), reason: 'template' } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${hc.id}, 1, ${'관리사무소가 꼭 확인할 5가지\n1. 출입 기록\n2. 시설 예약\n3. 공지 확인'}, ${[]}, 'AI 자동 제작', ${ctx.ownerId})`;
  await ctx.owner.ok('POST', `/api/marketing/contents/${hc.id}/visual`, {}); // 예전에 그려 둔 보관 시안(v2)
  await owner.goto(`${BASE}/s/marketing/approvals`);
  await owner.getByTestId('mkt-approvable-count').waitFor();
  const tabs = owner.getByTestId('mkt-brand-tabs');
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^E2E 피드 브랜드/ }).click();
  const held = owner.getByTestId('mkt-held'); await held.waitFor();
  await held.locator(':scope > summary').click();
  const row = held.getByTestId('mkt-held-row').filter({ hasText: 'E2E 피드 보관 글' });
  await row.getByTestId('mkt-held-redraw').click();
  await owner.getByText(/^새 틀로 다시 그렸습니다\(v3\) — 틀: /).waitFor({ timeout: 30000 });
  const [after] = await sql`select status, current_version, quality from mkt_contents where id = ${hc.id}`;
  assert.deepEqual([after.status, after.current_version, !!after.quality.held], ['draft', 3, true], '보관 그대로');
  assert.ok(['title', 'list'].includes(after.quality.visual.template), `사진이 없으면 사진 틀은 빼고: ${after.quality.visual.template}`);
  // 휴대폰 폭: 키트 칸 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/automation`);
  const k2 = owner.getByTestId('brand-feed-E2E 피드 브랜드'); await k2.waitFor();
  await k2.getByTestId('brand-feed-summary').click();
  await k2.getByTestId('brand-feed-templates').waitFor();
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 넘침 없음');
  await owner.setViewportSize({ width: 1366, height: 900 });
}
