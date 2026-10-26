// 190차(대표 #689 '브랜드 키트를 AI 마케터가 자동 제작하는 버튼'): 자동 제작 › 브랜드 키트 [AI로 채우기] → 초안 패널(근거·재료에서 확인 못 해 뺀 것)
// → 칸마다 체크(비어 있던 칸만 처음에 켜짐 — 이미 적힌 말투·상품은 꺼짐) → 소개 고치기 · 머리말 후보 고르기 → [고른 칸 저장] → 칸들이 새 값으로 · 휴대폰 폭 넘침 없음
// 가짜 AI(FAKE /v1/messages)로만 — 실제 AI 품질은 운영에서
import assert from 'node:assert/strict';

const say = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });
const ctl = (FAKE, b) => fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
const ANSWER = {
  intro: 'E2E키트짐은 동네 헬스장입니다. 퇴근 뒤 짧게 운동하는 직장인을 돕습니다.', products: ['1개월 회원권 50,000원', '처음 오는 분 상담'], tone: '친근한 존댓말',
  voice: { topics: '퇴근 뒤 운동', audience: '근처 직장인', offer: '동네 헬스장', phrases: ['같이 해요'], avoid: ['역대급'], formality: 'polite', emoji: 'few', emojis: [] },
  bannedWords: ['역대급'], facts: { phone: '032-555-7777', link: 'https://example.invalid/book', website: '', address: '', hours: '', prices: '', numbers: '', aliases: [], keywords: [] },
  topics: ['퇴근 뒤 20분 루틴', '처음 오는 분 안내', '기구 순서 고르기'], style: 'event', color: '#1D4ED8', kickers: ['오늘의 운동 노트', '동네 헬스 Q&A'],
};

export async function kit190({ owner, ctx, BASE, FAKE, SHOTS, sql }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const b = await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E키트짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b.id}`, { tone: '차분한 존댓말', products: '1개월 회원권 50,000원' });
  const m = await ctx.owner.ok('POST', '/api/marketing/contents', { title: 'E2E키트짐 새 기구', channel: 'instagram', brandId: b.id, body: '새 기구가 들어왔어요. 같이 해요.\n상담 032-555-7777', mediaIds: [] });
  await sql`update mkt_contents set status = 'published', published_at = now() where id = ${m.id}`;
  await ctl(FAKE, { anthropicReset: true, anthropicQueue: [say(ANSWER)] });
  await owner.goto(`${BASE}/s/marketing/automation`);
  const wrap = owner.getByTestId('brand-kit-ai-E2E키트짐'); await wrap.waitFor();
  await wrap.getByTestId('brand-kit-ai').click();
  const panel = owner.getByTestId('brand-kit-ai-panel'); await panel.waitFor();
  assert.match(await panel.innerText(), /근거: .*이 브랜드 승인·게시 글 1개/);
  assert.match(await panel.getByTestId('kit-ai-dropped').innerText(), /상담·예약 링크 'https:\/\/example\.invalid\/book' — 재료에서 찾지 못해 뺐습니다/);
  const checked = async (k) => panel.getByTestId(`kit-ai-pick-${k}`).isChecked();
  assert.deepEqual([await checked('intro'), await checked('tone'), await checked('products'), await checked('fact:phone'), await checked('topics')], [true, false, false, true, true],
    '비어 있던 칸만 처음에 체크(이미 적힌 말투·상품은 그대로 둠)');
  await panel.getByTestId('kit-ai-intro').fill('E2E키트짐은 동네 헬스장입니다.');
  await panel.getByTestId('kit-ai-kicker').filter({ hasText: '오늘의 운동 노트' }).click();
  assert.equal(await panel.getByTestId('kit-ai-kicker-none').getAttribute('aria-pressed'), 'false');
  await panel.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/190-kit-ai.png` });
  await panel.getByTestId('kit-ai-save').click();
  await owner.getByText(/E2E키트짐 브랜드 키트 \d+칸을 저장했습니다/).first().waitFor();
  const [r] = await sql`select intro, tone, products, banned_words, facts, topic_pool, feed from mkt_brands where id = ${b.id}`;
  assert.deepEqual([r.intro, r.tone, r.products, r.facts.phone, r.facts.link ?? null], ['E2E키트짐은 동네 헬스장입니다.', '차분한 존댓말', '1개월 회원권 50,000원', '032-555-7777', null]);
  assert.deepEqual(r.topic_pool, ['퇴근 뒤 20분 루틴', '처음 오는 분 안내', '기구 순서 고르기']);
  assert.deepEqual([r.feed.style, r.feed.kicker], ['event', '오늘의 운동 노트']);
  assert.ok(r.banned_words.includes('역대급') && r.banned_words.includes('보장'), JSON.stringify(r.banned_words));
  const [a] = await sql`select detail from audit_logs where action = 'mkt.brand_kit_ai' and target_id = ${b.id} order by id desc limit 1`;
  assert.ok(a.detail.fields.includes('intro') && a.detail.fields.includes('kicker') && !a.detail.fields.includes('tone'));
  // 저장 뒤 패널이 닫히고 칸들이 새 값으로(소개 칸·사실 카드 요약)
  await owner.getByTestId('brand-kit-ai-E2E키트짐').getByTestId('brand-kit-ai').waitFor();
  assert.equal(await owner.getByLabel('E2E키트짐 소개', { exact: true }).inputValue(), 'E2E키트짐은 동네 헬스장입니다.');
  await owner.getByTestId('brand-facts-E2E키트짐').locator('summary').filter({ hasText: '연락처 있음' }).waitFor();
  // 휴대폰 폭: 다시 열어도 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await ctl(FAKE, { anthropicReset: true, anthropicQueue: [say(ANSWER)] });
  await owner.getByTestId('brand-kit-ai-E2E키트짐').getByTestId('brand-kit-ai').click();
  const p2 = owner.getByTestId('brand-kit-ai-panel'); await p2.waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 폭 넘침 ${over}px`);
  await p2.screenshot({ path: `${SHOTS}/190-kit-ai-390.png` });
  await p2.getByTestId('kit-ai-close').click();
  await owner.setViewportSize({ width: 1366, height: 900 });
}
