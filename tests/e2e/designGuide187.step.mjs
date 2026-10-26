// 187차 ④(대표 '디자인 담당 기억 — 브랜드별+공통 · 긴 지침 칸'): AI 마케팅팀 › 디자인 담당 카드 [디자인 지침] → 회사 전체 3줄 저장 → 브랜드 고르고 2줄 저장
// → 요약 '회사 전체 3줄 · 브랜드 2줄' · 글자 수 표시 · 기억 칸 1,000자(예전 200자) · ⑤ 브랜드 키트 머리말 칸 안내('비우면 AI 가 글마다') · 휴대폰 폭 넘침 없음
// (구조 시험 — 지침이 실제 시안 품질을 얼마나 바꾸는지는 운영 화면에서)
import assert from 'node:assert/strict';

export async function designGuide187({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 지침 브랜드' })).id;
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/team`);
  const card = owner.locator('[data-testid=team-role][data-role=designer]');
  await card.waitFor();
  const box = card.getByTestId('team-design-guide');
  assert.match(await box.locator('summary').innerText(), /^디자인 지침 없음$/);
  await box.locator('summary').click();
  await box.getByTestId('team-guide-input').fill('표지 첫 줄은 질문으로 시작\n브랜드 색은 포인트에만\n사람 얼굴은 손·뒷모습으로');
  assert.match(await box.getByTestId('team-guide-count').innerText(), /^3줄 · \d+\/4,000자$/);
  await box.getByTestId('team-guide-save').click();
  await owner.getByText('회사 전체 디자인 지침을 저장했습니다(3줄)').waitFor();
  await box.getByTestId('team-guide-scope').selectOption(brand);
  assert.equal(await box.getByTestId('team-guide-input').inputValue(), '', '브랜드를 고르면 그 브랜드 지침(아직 없음)');
  await box.getByTestId('team-guide-input').fill('숫자는 크게\n마지막 장은 상담 안내');
  await box.getByTestId('team-guide-save').click();
  await owner.getByText('E2E 지침 브랜드 디자인 지침을 저장했습니다(2줄)').waitFor();
  await box.locator('summary').filter({ hasText: 'E2E 지침 브랜드 2줄' }).waitFor();
  assert.match(await box.locator('summary').innerText(), /회사 전체 3줄 · .*E2E 지침 브랜드 2줄/);
  const [r] = await sql`select settings->'guides' as g from mkt_team_roles where role = 'designer' and tenant = (select tenant from mkt_brands where id = ${brand})`;
  assert.deepEqual([r.g.common.split('\n').length, r.g[brand]], [3, '숫자는 크게\n마지막 장은 상담 안내']);
  // 기억 칸 1,000자
  await card.getByTestId('team-role-memory').locator('summary').click();
  await card.getByTestId('team-memory-input').fill('ㄱ'.repeat(1200));
  assert.equal((await card.getByTestId('team-memory-input').inputValue()).length, 1000, '기억은 1,000자까지 받음');
  await card.getByTestId('team-memory-input').fill('');
  await card.screenshot({ path: `${SHOTS}/187-team-design-guide.png` });
  // 휴대폰 폭
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/team`);
  const mcard = owner.locator('[data-testid=team-role][data-role=designer]');
  await mcard.waitFor();
  await mcard.getByTestId('team-design-guide').locator('summary').click();
  await mcard.getByTestId('team-guide-input').waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await mcard.screenshot({ path: `${SHOTS}/187-team-design-guide-390.png` });
  // ⑤ 브랜드 키트 머리말 칸: 채우면 고정 · 비우면 AI 가 글마다
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/automation`);
  const kit = owner.getByTestId('brand-feed-E2E 지침 브랜드'); await kit.waitFor();
  await kit.getByTestId('brand-feed-summary').click();
  assert.equal(await kit.getByTestId('brand-feed-kicker').getAttribute('placeholder'), '표지 머리말 — 비우면 AI 가 글마다');
  assert.match(await kit.getByTestId('brand-feed-kicker').getAttribute('title'), /채우면 모든 표지에 이 머리말로 고정 · 비우면 AI 가 글마다 다르게/);
  // 정리(뒤 단계 지시문에 섞이지 않게)
  await sql`update mkt_team_roles set settings = settings - 'guides' where role = 'designer' and tenant = (select tenant from mkt_brands where id = ${brand})`;
}
