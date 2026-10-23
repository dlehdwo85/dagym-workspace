// #499-4 상황 매트릭스: 운영실 '광고 컨셉' 상자 [새 상황 매트릭스] → [AI로 채우기](역할·상황 초안) → 역할 직접 추가 → [컨셉 만들기] → 카드(역할 × 상황 칸·광고형 점수)
// → 승인함 '광고 컨셉' 탭(건수) → 2개 고르기(선택 2/4) → [채택하고 제작 의뢰] → 승인함에서 빠짐 · 운영실 카드 '채택함'·제작 의뢰 링크·[새 각도] · 휴대폰 폭
// 가짜 AI 응답(구조 시험) — 실제 컨셉 품질은 확인 못함. 실제 경로·브랜드 기억·반려 → 고친 안은 tests/api/mkt-concepts.test.mjs
import assert from 'node:assert/strict';
import { FAKE } from '../helpers.mjs';

const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const S1 = { name: '신축 입주 3~6개월 전', pain: '운영사·인력이 아직 미정', offer: '입주 준비 체크리스트' };
const S2 = { name: '재계약 시점', pain: '업체 교체를 고민', offer: '위탁 vs 직영 비교표' };
const C = (role, s, hook, format) => ({ role, situation: s.name, pain: s.pain, offer: s.offer, hook, headline: s.offer, primary: `${hook}\n${s.offer}를 드립니다.\n양식에 단지명만 남겨 주세요.`, angle: `${role}의 '${s.name}' 고민 지목`, format });

export async function mktConcepts({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brand = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 컨셉 브랜드' })).id;
  const prompt = say({ promptEn: 'A photorealistic photo of a Korean apartment community lounge', negativeEn: 'text', summaryKo: '입주 준비 장면', caption: '입주 앞둔 단지 관리소장님, 체크리스트 무료', refMediaIds: [] });
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [
    say({ product: '아파트 커뮤니티 위탁 운영', roles: ['입주자대표회의', '관리사무소장'], situations: [S1, S2] }),
    say({ changes: '', concepts: [C('관리사무소장', S1, '입주 앞둔 단지 관리소장님, 입주 준비 체크리스트 무료로 드려요', 'image'), C('입주자대표회의', S2, '재계약 앞둔 입대의께 위탁 vs 직영 비교표 드려요', 'video'),
      C('위탁관리사', S1, '입주 3개월 전 위탁관리사님, 운영 제안서 무료 상담', 'image'), C('관리사무소장', S2, '재계약 앞둔 관리소장님, 운영비 비교표 받아 가세요', 'video')] }),
    prompt, prompt] }) });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/s/marketing/ops`);
  const box = owner.getByTestId('concepts'); await box.waitFor();
  await box.getByTestId('concept-new').click();
  const form = owner.getByTestId('concept-form'); await form.waitFor();
  await form.getByTestId('concept-brand').selectOption(brand);
  await form.getByTestId('concept-suggest').click();
  await owner.getByText('AI 가 초안을 채웠습니다 — 고친 뒤 [컨셉 만들기]').waitFor();
  assert.equal(await form.getByTestId('concept-product').inputValue(), '아파트 커뮤니티 위탁 운영');
  assert.deepEqual((await form.getByTestId('concept-role').allInnerTexts()).map((t) => t.replace(/\s*×$/, '')), ['입주자대표회의', '관리사무소장']);
  assert.deepEqual(await form.getByTestId('concept-sit-name').evaluateAll((els) => els.map((e) => e.value)), [S1.name, S2.name]);
  await form.getByTestId('concept-role-input').fill('위탁관리사');
  await form.getByTestId('concept-role-input').press('Enter');
  assert.equal(await form.getByTestId('concept-role').count(), 3);
  await form.getByTestId('concept-note').fill('이번 달은 신축 단지 위주');
  await owner.screenshot({ path: `${SHOTS}/225-concept-form.png` });
  const created = owner.waitForResponse((r) => r.url().endsWith('/api/marketing/concepts') && r.request().method() === 'POST');
  await form.getByTestId('concept-create').click();
  const body = (await created).request().postDataJSON();
  assert.deepEqual({ roles: body.roles, n: body.situations.length, note: body.note, count: body.count, brand: body.brandId }, { roles: ['입주자대표회의', '관리사무소장', '위탁관리사'], n: 2, note: '이번 달은 신축 단지 위주', count: 10, brand });
  await owner.getByText('AI 마케터가 컨셉 4개를 만들었습니다 — 1~4개를 채택해 주세요').waitFor();
  const card = box.getByTestId('concept-set').first(); await card.waitFor();
  assert.equal(await card.getAttribute('data-status'), 'pending');
  assert.equal(await card.getByTestId('concept-item').count(), 4);
  assert.deepEqual(await card.getByTestId('concept-cell').allInnerTexts(), ['·', '1', '1', '1', '1', '·'], '역할 3 × 상황 2 칸: 입대의·관리소장·위탁관리사');
  assert.match(await card.getByTestId('concept-score').first().innerText(), /^광고형 \d+점$/);
  // 승인함 '광고 컨셉' 탭: 건수 → 2개 고르기 → 채택
  await owner.goto(`${BASE}/s/marketing/approvals?tab=concepts`);
  await owner.getByTestId('mkt-inbox-count-concepts').filter({ hasText: '1' }).waitFor();
  const inbox = owner.getByTestId('mkt-inbox-concepts').getByTestId('concept-set'); await inbox.waitFor();
  await inbox.locator('[data-testid=concept-item][data-id=c1]').getByTestId('concept-pick').check();
  await inbox.locator('[data-testid=concept-item][data-id=c2]').getByTestId('concept-pick').check();
  assert.equal(await inbox.getByTestId('concept-picked').innerText(), '선택 2/4');
  await inbox.getByTestId('concept-note-decide').fill('관리소장 호명이 좋음');
  await owner.screenshot({ path: `${SHOTS}/226-concept-inbox.png` });
  await inbox.getByTestId('concept-adopt').click();
  await owner.getByText('2개 채택 — 제작 의뢰 2건(프롬프트는 곧 준비됩니다)').waitFor();
  await owner.getByTestId('mkt-inbox-empty').waitFor();
  // 운영실: 채택함 · 채택한 컨셉에 제작 의뢰 링크·[새 각도]
  await owner.goto(`${BASE}/s/marketing/ops`);
  const done = owner.getByTestId('concepts').locator('[data-testid=concept-set][data-status=decided]').first(); await done.waitFor();
  assert.equal(await done.locator('[data-testid=concept-item][data-decision=adopted]').count(), 2);
  assert.match(await done.getByTestId('concept-brief').first().innerText(), /^제작 의뢰 · .+ →$/);
  assert.equal(await done.getByTestId('concept-variant').count(), 2);
  assert.match(await done.getByTestId('concept-decided').innerText(), /채택 2개 → 제작 의뢰 2건/);
  const [set] = await sql`select id, executed from mkt_concept_sets where brand_id = ${brand} order by created_at desc limit 1`;
  const briefs = await sql`select kind, mode, purpose from mkt_briefs where refs->>'conceptSetId' = ${set.id} order by kind`;
  assert.deepEqual(briefs.map((b) => [b.kind, b.mode, b.purpose]), [['feed', 'ad', 'inquiry'], ['reels', 'ad', 'inquiry']]);
  // 휴대폰 폭: 칸 표·컨셉은 상자 안에서만
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/ops`);
  await owner.getByTestId('concepts').getByTestId('concept-set').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.getByTestId('concepts').screenshot({ path: `${SHOTS}/227-concept-mobile.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 정리(뒤 단계의 승인함 건수·제작의뢰실 목록에 섞이지 않게) — 프롬프트 작성이 끝난 뒤
  for (let i = 0; i < 50; i++) { const r = await sql`select count(*)::int n from mkt_briefs where refs->>'conceptSetId' = ${set.id} and status in ('queued', 'prompting')`; if (!r[0].n) break; await new Promise((ok) => setTimeout(ok, 200)); }
  await sql`delete from mkt_briefs where refs->>'conceptSetId' = ${set.id}`;
  await sql`delete from mkt_concept_sets where brand_id = ${brand}`;
}
