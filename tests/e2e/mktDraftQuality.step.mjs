// #235(로컬 10/24 저녁 6 — 마케팅 시안 품질) ⓐ·ⓔ 화면: 브랜드 키트 '이번 달 소식'(+ 소식 추가 → 기간 기본 30일 → 저장) · '잘 된 예시 글'(형식 고르고 붙여 넣기 → 목록·빼기)
// → 승인한 글 상세 [좋은 예시로 저장](좋은 점 메모) → '좋은 예시로 저장됨' → [예시에서 빼기] · 휴대폰 폭 넘침 없음
import assert from 'node:assert/strict';

const kstDay = (plus = 0) => new Date(Date.now() + 9 * 3600e3 + plus * 864e5).toISOString().slice(0, 10);

export async function mktDraftQuality({ owner, ctx, BASE, SHOTS, sql }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  const b = await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E소식짐' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b.id}`, { intro: '동네 헬스장', products: '1개월 회원권' });
  await owner.goto(`${BASE}/s/marketing/automation`);
  // ⓐ 이번 달 소식: [+ 소식 추가] = 오늘~30일 뒤 기본 → 내용 적고 저장
  const kit = owner.getByTestId('brand-facts-E2E소식짐'); await kit.waitFor();
  assert.match(await kit.locator('summary').innerText(), /이번 달 소식 0개/);
  await kit.locator('summary').click();
  await kit.getByTestId('facts-news-add').click();
  const row = kit.getByTestId('facts-news-row').first();
  assert.equal(await row.getByTestId('facts-news-from').inputValue(), kstDay(0));
  assert.equal(await row.getByTestId('facts-news-to').inputValue(), kstDay(30));
  await row.getByTestId('facts-news-text').fill('할로윈 주간 — 친구와 함께 오면 1일 무료');
  await row.getByTestId('facts-news-to').fill(kstDay(7));
  await kit.getByTestId('facts-save').click();
  await owner.getByText('사실 카드·주제 풀을 저장했습니다(이번 달 소식 포함)').first().waitFor();
  const [f] = await sql`select facts from mkt_brands where id = ${b.id}`;
  assert.deepEqual(f.facts.news, [{ text: '할로윈 주간 — 친구와 함께 오면 1일 무료', from: kstDay(0), to: kstDay(7) }]);
  await owner.getByTestId('brand-facts-E2E소식짐').locator('summary').filter({ hasText: '이번 달 소식 1개' }).waitFor();
  // ⓔ 잘 된 예시 글: 형식 고르고 붙여 넣기 → 목록(좋은 점) → 빼기
  const ex = owner.getByTestId('brand-examples-E2E소식짐');
  assert.match(await ex.locator('summary').innerText(), /피드·페이스북·스레드 0 · 블로그 0 · 릴스·쇼츠 0 · 스토리 0/);
  await ex.locator('summary').click();
  await ex.getByTestId('brand-example-kind').selectOption('feed');
  await ex.getByTestId('brand-example-note').fill('첫 줄이 장면으로 시작');
  await ex.getByTestId('brand-example-text').fill('퇴근길 7시, 러닝머신 앞 줄이 사라졌습니다. 기구 세 가지로 20분이면 끝나는 순서를 정리했습니다.');
  await ex.getByTestId('brand-example-add').click();
  await owner.getByText('예시 글을 넣었습니다').first().waitFor();
  await owner.getByTestId('brand-examples-E2E소식짐').getByTestId('brand-example').first().waitFor();
  assert.match(await owner.getByTestId('brand-examples-E2E소식짐').getByTestId('brand-example').first().innerText(), /좋은 점: 첫 줄이 장면으로 시작/);
  assert.equal((await sql`select examples from mkt_brands where id = ${b.id}`)[0].examples[0].kind, 'feed');
  await owner.getByTestId('brand-examples-E2E소식짐').scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/276-brand-news-examples.png` });
  await owner.getByTestId('brand-examples-E2E소식짐').getByTestId('brand-example-remove').first().click();
  await owner.getByText('예시에서 뺐습니다').first().waitFor();
  assert.equal((await sql`select examples from mkt_brands where id = ${b.id}`)[0].examples.length, 0);
  // 승인한 글 상세 → [좋은 예시로 저장] → 저장됨 → [예시에서 빼기]
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, approved_version, created_by, kind, auto, produced_at, quality)
    values (${tenant}, ${b.id}, 'E2E 승인 글', 'instagram', now() + interval '2 days', 'approved', 1, 1, ${ctx.ownerId}, 'feed', true, now(), ${sql.json({ passed: true, issues: [] })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, '점심 15분이면 굳은 어깨가 풀립니다. 사무실에서 바로 하는 동작 세 가지입니다.', ${[]}, 'AI 자동 제작', ${ctx.ownerId})`;
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  const box = owner.getByTestId('mkt-example'); await box.waitFor();
  await box.getByTestId('mkt-example-note').fill('어깨 장면으로 시작');
  await box.getByTestId('mkt-example-save').click();
  await owner.getByText('좋은 예시로 저장했습니다 — 같은 형식 예시 1개').first().waitFor();
  await owner.locator('[data-testid="mkt-example"][data-saved="1"]').waitFor();
  const [s] = (await sql`select examples from mkt_brands where id = ${b.id}`)[0].examples;
  assert.deepEqual([s.kind, s.contentId, s.note], ['feed', c.id, '어깨 장면으로 시작']);
  await owner.getByTestId('mkt-example').scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/277-example-save.png` });
  await owner.getByTestId('mkt-example-remove').click();
  await owner.getByTestId('mkt-example-save').waitFor();
  assert.equal((await sql`select examples from mkt_brands where id = ${b.id}`)[0].examples.length, 0);
  await owner.keyboard.press('Escape');
  // 휴대폰: 브랜드 키트(소식 줄·예시 칸) 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/automation`);
  const kit2 = owner.getByTestId('brand-facts-E2E소식짐'); await kit2.waitFor();
  await kit2.locator('summary').click();
  await kit2.getByTestId('facts-news-row').first().waitFor();
  await owner.getByTestId('brand-examples-E2E소식짐').locator('summary').click();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
}
