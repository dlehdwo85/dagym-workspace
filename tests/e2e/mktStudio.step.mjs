// 대표 10/20 19:00 제작의뢰실: 자동 제작 탭 → 의뢰 폼 → 프롬프트 카드(기본 프롬프트) → [수정] → [제작 요청 카드로 보내기] → 제작 요청 카드에 '제작의뢰실' 표시
import assert from 'node:assert/strict';

export async function mktStudio({ owner, ctx, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/automation?tab=studio`);
  await owner.getByTestId('mkt-studio').waitFor();
  await owner.getByTestId('studio-purpose-launch').click();
  await owner.getByTestId('studio-kind').selectOption('story');
  await owner.getByTestId('studio-message').fill('E2E 겨울 시즌권 출시 안내');
  await owner.getByTestId('studio-submit').click();
  const card = owner.getByTestId('studio-brief').filter({ hasText: 'E2E 겨울 시즌권 출시 안내' }); await card.waitFor();
  await card.getByTestId('studio-prompt').waitFor();
  assert.match(await card.getByTestId('studio-prompt-en').innerText(), /E2E 겨울 시즌권 출시 안내/);
  assert.equal(await card.getByTestId('studio-status').innerText(), '프롬프트 준비');
  // #534 프롬프트 검사: 필수 칸 8개 ✓/✗ · 빠진 칸은 기본값으로 보강(가짜 AI = 기본 프롬프트) — 참고 사진은 자료실 사정에 따라
  const ck = card.getByTestId('studio-prompt-check');
  assert.match(await ck.getByTestId('studio-prompt-score').innerText(), /^프롬프트 검사 (88|100)점$/);
  assert.match(await ck.getByTestId('studio-prompt-fixed').innerText(), /^처음 \d+점 → 빠진 칸 .*구도.* (AI 가 쓴 칸으로|기본값으로) 보강$/);
  assert.equal(await ck.getByTestId('studio-prompt-item').count(), 8);
  assert.match(await card.getByTestId('studio-prompt-en').innerText(), /keep the bottom 24% of the frame clean/);
  await owner.screenshot({ path: `${SHOTS}/166-studio.png`, fullPage: true });
  await card.getByTestId('studio-edit-open').click();
  await card.getByTestId('studio-edit-prompt').fill('A photorealistic vertical photo, winter morning, community center entrance, soft daylight, copy space, 9:16');
  await card.getByTestId('studio-edit-save').click();
  await card.getByTestId('studio-prompt-en').filter({ hasText: 'winter morning' }).waitFor();
  await card.getByTestId('studio-generate').click();
  await card.getByTestId('studio-status').filter({ hasText: '생성 중' }).waitFor();
  await owner.goto(`${BASE}/s/marketing/automation`);
  const req = owner.getByTestId('auto-request').filter({ hasText: 'E2E 겨울 시즌권' }); await req.first().waitFor();
  await req.first().getByTestId('auto-req-brief').waitFor();
  assert.match(await req.first().innerText(), /\[제작의뢰실\] 스토리[\s\S]*winter morning/);
  await owner.screenshot({ path: `${SHOTS}/166-studio-card.png` });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/automation?tab=studio`); await owner.getByTestId('studio-brief').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/166-studio-390.png`, fullPage: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
