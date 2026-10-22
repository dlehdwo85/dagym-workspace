// #426 글 품질 엔진: 승인함 카드 '다듬기 필요'·'훅 약함' → 상세 [글 품질] 패널(사람다움·훅 후보 3개·'더 보기' 전 미리보기·자동 수정 기록) → [AI로 다듬기] = 새 버전(v2)
// → 패널 갱신 · 휴대폰 폭 넘침 없음 · 브랜드 키트 [말투 프로필] 저장 · 플랫폼 운영 [글 품질 규칙] 저장·기본값 되돌리기
import assert from 'node:assert/strict';

const BAD = '다양한 혜택을 놓치지 마세요! 지금 바로 특별한 경험을 시작해 보세요!! 혁신적인 서비스로 여러분의 일상을 한 단계 업그레이드하세요! ✨✨✨';
const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });

export async function mktQuality({ owner, ctx, BASE, FAKE, SHOTS, sql }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  // AI 자동 시안 하나(제작 때 보고서 저장된 상태) — 검사 API 로 보고서를 만들어 그대로 넣음
  const { cleaned: _c, thresholds: _t, ad: _a, ...rep } = await ctx.owner.ok('POST', '/api/marketing/quality/check', { channel: 'instagram', kind: 'feed', body: BAD, hooks: ['다양한 혜택을 놓치지 마세요', '천안 직장인이라면 이 3가지만', '퇴근 후 20분이면 충분한 이유'] });
  const [c] = await sql`insert into mkt_contents (tenant, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produced_at, quality)
    values (${tenant}, 'E2E 품질 시안', 'instagram', now() + interval '3 days', 'pending', 1, ${ctx.ownerId}, 'feed', true, now(), ${sql.json({ passed: true, issues: [], brief: '실사', report: { ...rep, v: 1, notes: ['해시태그 2개 뺌(최대 5개)'] } })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${BAD}, ${[]}, 'AI 자동 제작', ${ctx.ownerId})`;
  await owner.goto(`${BASE}/s/marketing/approvals`);
  const card = owner.getByTestId('approval-card').filter({ hasText: 'E2E 품질 시안' }); await card.waitFor();
  assert.match(await card.getByTestId('approval-polish-badge').innerText(), /다듬기 필요 · \d+점/);
  assert.match(await card.getByTestId('approval-weak-hook').innerText(), /훅 약함 \d+점/);
  await card.getByTestId('mkt-row').click();
  const panel = owner.getByTestId('quality-panel'); await panel.waitFor();
  await panel.getByTestId('quality-needs-polish').waitFor();
  assert.equal(await panel.getByTestId('quality-hook-row').count(), 3);
  assert.equal(await panel.getByTestId('quality-hook-pick').count(), 2, '통과한 후보 2개에만 [이 훅으로]');
  assert.match(await panel.getByTestId('quality-human-issues').innerText(), /상투어 '놓치지 마세요'/);
  await panel.getByTestId('quality-preview').waitFor();
  assert.match(await panel.getByTestId('quality-notes').innerText(), /해시태그 2개 뺌/);
  await panel.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/198-quality-panel.png` });
  // [AI로 다듬기] → 가짜 AI 가 고친 원고 → 수정본 v2 · 패널은 v2 보고서(다듬기 필요 없음)
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [say({ title: 'E2E 품질 시안', body: '퇴근 후 20분이면 충분한 이유\n천안 두정동에서 같이 해요.\n상담은 댓글로 남겨 주세요.', brief: '', why: '', hooks: [], keyword: '' })] }) });
  await panel.getByTestId('quality-polish').click();
  await owner.getByText('다듬은 수정본(v2)을 만들었습니다').first().waitFor();
  await owner.getByTestId('quality-panel').getByTestId('quality-human').filter({ hasText: '사람다움 100점' }).waitFor();
  assert.equal(await owner.getByTestId('quality-needs-polish').count(), 0);
  assert.equal((await sql`select current_version from mkt_contents where id = ${c.id}`)[0].current_version, 2);
  // 휴대폰: 상세 패널이 옆으로 넘치지 않음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  await owner.getByTestId('quality-panel').waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.keyboard.press('Escape');
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 브랜드 키트 [말투 프로필]
  const b = await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 말투 브랜드' });
  await owner.goto(`${BASE}/s/marketing/automation`);
  const vb = owner.getByTestId('brand-voice-E2E 말투 브랜드'); await vb.waitFor();
  await vb.locator('summary').click();
  await vb.getByTestId('voice-audience').fill('퇴근 후 운동하는 직장인');
  await vb.getByTestId('voice-avoid').fill('역대급, 최저가');
  await vb.getByTestId('voice-formality').selectOption('mixed');
  await vb.getByTestId('voice-example').first().fill('퇴근길 20분, 같이 해요.');
  await vb.getByTestId('voice-save').click();
  await owner.getByText('말투 프로필을 저장했습니다').first().waitFor();
  const [bv] = await sql`select voice from mkt_brands where id = ${b.id}`;
  assert.deepEqual([bv.voice.audience, bv.voice.avoid, bv.voice.formality, bv.voice.examples], ['퇴근 후 운동하는 직장인', ['역대급', '최저가'], 'mixed', ['퇴근길 20분, 같이 해요.']]);
  // 플랫폼 운영 [글 품질 규칙]: 인스타 해시태그 4 저장 → '기본 5' 표시 → 5 로 되돌리면 저장값 비움
  await owner.goto(`${BASE}/platform`);
  const pr = owner.getByTestId('platform-quality-rules'); await pr.waitFor();
  await pr.getByTestId('qr-instagram-hashtags').fill('4');
  await pr.getByTestId('qr-save').click();
  await owner.getByText('글 품질 규칙을 저장했습니다').first().waitFor();
  assert.deepEqual((await sql`select value from app_settings where key = 'mkt_quality_rules'`)[0].value, { instagram: { hashtags: 4 } });
  await pr.getByText('기본 5', { exact: true }).waitFor();
  await pr.screenshot({ path: `${SHOTS}/199-quality-rules.png` });
  await pr.getByTestId('qr-instagram-hashtags').fill('5');
  await pr.getByTestId('qr-save').click();
  for (let k = 0; k < 40 && Object.keys((await sql`select value from app_settings where key = 'mkt_quality_rules'`)[0].value).length; k++) await owner.waitForTimeout(250);
  assert.deepEqual((await sql`select value from app_settings where key = 'mkt_quality_rules'`)[0].value, {});
}
