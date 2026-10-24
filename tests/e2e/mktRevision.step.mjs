// #545(+#534) 수정 요청 → AI 수정본: 자동 제작 글(서버가 그린 시안) 카드 [수정 요청] '첫 줄을 더 짧게' → AI 가 글·시안을 함께 고친 수정본 v3 이 바로 승인함에
// → 같은 카드에 '수정본 v3 — 반영한 요청: …' 배지·'AI 수정 1/3 · 글·시안'·[수정본 v3 승인] → [이전 버전(v2)과 나란히 비교](시안·바뀐 줄) → 같은 카드에서 다시 [수정 요청] '사진을 다시 만들어 주세요' = v4(시안만)
// → 상세에서도 나란히 비교 · 휴대폰 폭(390) 넘침 없음 (가짜 AI 구조 시험 — 실제 글·그림 품질은 운영 화면에서)
import assert from 'node:assert/strict';

const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });

export async function mktRevision({ owner, ctx, sql, BASE, FAKE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 수정본 브랜드' })).id;
  await sql`update mkt_brands set color = '#1848D0' where id = ${brand}`;
  const [{ tenant }] = await sql`select tenant from mkt_brands where id = ${brand}`;
  const [c] = await sql`insert into mkt_contents (tenant, title, channel, kind, scheduled_at, status, current_version, created_by, auto, produced_at, brand_id, quality)
    values (${tenant}, 'E2E 수정본 자동 글', 'instagram', 'feed', now() + interval '3 days', 'pending', 1, ${ctx.ownerId}, true, now(), ${brand}, ${sql.json({ passed: true, issues: [] })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${'관리비 고지서, 아직 종이로 나눠 주세요?\n입주민 앱 하나로 끝납니다.\n상담은 프로필 링크에서.'}, ${[]}, 'AI 자동 제작', ${ctx.ownerId})`;
  assert.equal((await ctx.owner.ok('POST', `/api/marketing/contents/${c.id}/visual`, {})).version, 2, '서버가 그린 시안 = v2');

  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/approvals`);
  await owner.getByTestId('mkt-approvable-count').waitFor();
  const tabs = owner.getByTestId('mkt-brand-tabs');
  if (await tabs.isVisible()) await tabs.getByRole('button', { name: /^E2E 수정본 브랜드/ }).click();
  const card = () => owner.getByTestId('approval-card').filter({ hasText: 'E2E 수정본 자동 글' }).first();
  await card().getByTestId('card-approve').waitFor();
  // ① 글 수정 요청 → AI 가 글을 다시 쓰고 시안(첫 줄)도 다시 그림 = 한 버전
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [say({ title: 'E2E 수정본 자동 글', body: '종이 고지서, 이제 그만.\n입주민 앱 하나로 끝납니다.\n상담은 프로필 링크에서.', brief: '' })] }) });
  await card().getByTestId('card-changes').click();
  await card().getByTestId('card-changes-memo').fill('첫 줄을 더 짧게');
  await card().getByTestId('card-changes-send').click();
  await owner.getByText('AI 가 고쳐 다시 올렸습니다 — 수정본 v3(글·시안 · AI 수정 1/3)').waitFor({ timeout: 30000 });
  await card().getByTestId('mkt-reapprove').filter({ hasText: '수정본 v3' }).waitFor({ timeout: 15000 });
  assert.equal(await card().getByTestId('mkt-reapprove').innerText(), '수정본 v3 — 반영한 요청: 첫 줄을 더 짧게');
  assert.equal(await card().getByTestId('mkt-ai-revision').innerText(), 'AI 수정 1/3 · 글·시안');
  assert.equal(await card().getByTestId('card-approve').innerText(), '수정본 v3 승인', '같은 카드에 [승인]이 다시');
  // ② 이전 버전(v2)과 나란히 — 시안 두 장·바뀐 줄 표시·반영한 요청
  assert.equal(await card().getByTestId('approval-compare').innerText(), '이전 버전(v2)과 나란히 비교');
  await card().getByTestId('approval-compare').click();
  const cmp = card().getByTestId('version-compare');
  await cmp.waitFor();
  assert.match(await cmp.getByTestId('compare-old').innerText(), /^v2 수정 요청 전/);
  assert.match(await cmp.getByTestId('compare-new').innerText(), /^v3 수정본/);
  assert.equal(await cmp.getByTestId('compare-new').locator('[data-changed]', { hasText: '종이 고지서, 이제 그만.' }).count(), 1, '새 첫 줄 = 바뀐 줄');
  assert.equal(await cmp.getByTestId('compare-old').locator('[data-changed]', { hasText: '관리비 고지서, 아직 종이로 나눠 주세요?' }).count(), 1, '옛 첫 줄 = 지운 줄');
  assert.equal(await cmp.getByTestId('compare-new').locator('[data-changed]', { hasText: '입주민 앱 하나로 끝납니다.' }).count(), 0, '그대로인 줄은 표시 없음');
  assert.match(await cmp.getByTestId('compare-request').innerText(), /^반영한 요청: 첫 줄을 더 짧게 · 바뀐 것: 글·시안 · 바탕: \S.* · 확인: 첫 줄 \d+자 → \d+자$/, '로컬 10/24: 실제로 줄었는지 확인');
  for (const side of ['compare-old', 'compare-new']) {
    const img = cmp.getByTestId(side).locator('img').first();
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) { ok = await img.evaluate((el) => el.complete && el.naturalWidth > 0).catch(() => false); if (!ok) await owner.waitForTimeout(250); }
    assert.ok(ok, `${side} 시안이 보임`);
  }
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 넘침 없음');
  await card().scrollIntoViewIfNeeded();
  await card().screenshot({ path: `${SHOTS}/245-approval-revision-compare.png` });
  // ③ 같은 카드에서 다시 수정 요청(사진만) — AI 글 쓰기 없이 바탕을 바꿔 다시 그린 v4
  await card().getByTestId('card-changes').click();
  await card().getByTestId('card-changes-memo').fill('사진을 다시 만들어 주세요');
  await card().getByTestId('card-changes-send').click();
  await owner.getByText('AI 가 고쳐 다시 올렸습니다 — 수정본 v4(시안 · AI 수정 2/3)').waitFor({ timeout: 30000 });
  await card().getByTestId('mkt-ai-revision').filter({ hasText: 'AI 수정 2/3 · 시안' }).waitFor({ timeout: 15000 });
  // 로컬 10/24: 사진을 바꿨는지 확인 — 바꿀 바탕 사진이 없으면 '반영 안 됨'(빨강), 다른 틀로만 다시 그렸으면 '일부 반영'
  const v4 = await sql`select revision from mkt_versions where content_id = ${c.id} and version = 4`;
  const label = { applied: '반영한 요청', partial: '일부 반영', unmet: '반영 안 됨' }[v4[0].revision.check.status];
  assert.ok(label, JSON.stringify(v4[0].revision.check));
  assert.match(await card().getByTestId('mkt-reapprove').innerText(), new RegExp(`^수정본 v4 — ${label}: 사진을 다시 만들어 주세요`));
  const vs = await sql`select version, body, media_ids, revision from mkt_versions where content_id = ${c.id} order by version`;
  assert.deepEqual(vs.map((v) => v.version), [1, 2, 3, 4]);
  assert.deepEqual([vs[2].revision.n, vs[2].revision.from, vs[2].revision.parts], [1, 2, ['text', 'visual']]);
  assert.deepEqual([vs[3].revision.n, vs[3].revision.from, vs[3].revision.parts], [2, 3, ['visual']]);
  assert.equal(vs[3].body, vs[2].body, '사진만 바꾸면 글은 그대로');
  assert.ok(vs[3].media_ids[0] !== vs[2].media_ids[0] && vs[2].media_ids[0] !== vs[1].media_ids[0], '시안을 매번 다시 그림');
  assert.deepEqual(Object.values((await sql`select status, current_version from mkt_contents where id = ${c.id}`)[0]), ['pending', 4]);
  assert.deepEqual((await sql`select text from mkt_team_memory where role = 'designer' and kind = 'edit' and source_id = ${c.id} order by created_at`).map((m) => m.text), ['첫 줄을 더 짧게', '사진을 다시 만들어 주세요'], '수정 요청 사유 = 디자인 담당 기억');
  // ④ 상세에서도 나란히
  await card().getByTestId('mkt-row').click();
  const toggle = owner.getByTestId('mkt-detail').getByTestId('mkt-detail-compare-toggle');
  assert.equal(await toggle.innerText(), `이전 버전(v3)과 나란히 비교 — ${label}: 사진을 다시 만들어 주세요`);
  await toggle.click();
  await owner.getByTestId('mkt-detail').getByTestId('version-compare').waitFor();
  assert.match(await owner.getByTestId('mkt-detail').getByTestId('compare-request').innerText(), new RegExp(`^${label}: 사진을 다시 만들어 주세요 · 바뀐 것: 시안 · 바탕: \\S`));
  await owner.keyboard.press('Escape');
  await owner.setViewportSize({ width: 1366, height: 900 });
}
