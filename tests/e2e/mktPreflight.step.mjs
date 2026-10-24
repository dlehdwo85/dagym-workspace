// 로컬 QA 10/24 ②~⑥: 브랜드 키트 [사실 카드·주제 풀](연락처·운영 시간·섞으면 안 되는 이름 · 주제 한 줄에 하나 · [AI로 주제 20개 제안] → 고쳐서 저장)
// → 자동 제작 릴스 상세: 글 품질 칸 '올리기 전 검사 n건'(걸린 줄 목록) · 위 노란 칸에는 그 밖의 문제만 · 대본(컷) 칸(게시 글에는 안 들어감) · '왜 이 글인가'에 주제를 고른 곳(주제 풀)
import assert from 'node:assert/strict';

const reply = (o) => ({ content: [{ type: 'text', text: JSON.stringify(o) }], stop_reason: 'end_turn' });

export async function mktPreflight({ owner, ctx, BASE, FAKE, SHOTS, sql }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [{ tenant }] = await sql`select tenant from users where id = ${ctx.ownerId}`;
  const b = await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E사실짐' });
  await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E누리링크' });
  await ctx.owner.ok('PATCH', `/api/marketing/auto/brands/${b.id}`, { intro: '동네 헬스장', products: '1개월 회원권', topicPool: ['처음 오는 날 준비물', '샤워실 이용 시간'] });
  // 브랜드 키트: 사실 카드 + 주제 풀(AI 제안 2개 더함 — 이미 있는 주제·다른 브랜드 이름이 든 주제는 서버가 뺌)
  await owner.goto(`${BASE}/s/marketing/automation`);
  const kit = owner.getByTestId('brand-facts-E2E사실짐'); await kit.waitFor();
  assert.match(await kit.locator('summary').innerText(), /연락처 없음 · 주제 2개/);
  await kit.locator('summary').click();
  await kit.getByTestId('facts-phone').fill('02-555-0101');
  await kit.getByTestId('facts-hours').fill('평일 06~23시');
  await kit.getByTestId('facts-avoid').fill('옛이름짐');
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [reply({ topics: ['처음 오는 날 준비물', 'E2E누리링크와 함께 운동', '퇴근 뒤 20분 운동 순서', '비 오는 날 실내 운동'] })] }) });
  await kit.getByTestId('facts-topic-draft').click();
  await owner.getByText('주제 2개를 아래에 더했습니다').first().waitFor();
  assert.equal(await kit.getByTestId('facts-topics').inputValue(), '처음 오는 날 준비물\n샤워실 이용 시간\n퇴근 뒤 20분 운동 순서\n비 오는 날 실내 운동');
  assert.match(await kit.getByTestId('facts-topic-count').innerText(), /^4개/);
  await kit.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/254-brand-facts.png` });
  await kit.getByTestId('facts-save').click();
  await owner.getByText('사실 카드·주제 풀을 저장했습니다').first().waitFor();
  const [saved] = await sql`select facts, topic_pool from mkt_brands where id = ${b.id}`;
  assert.deepEqual(saved.facts, { phone: '02-555-0101', hours: '평일 06~23시', avoidNames: ['옛이름짐'] }, '빈 칸은 저장 안 함');
  assert.equal(saved.topic_pool.length, 4);
  await owner.getByTestId('brand-facts-E2E사실짐').locator('summary').filter({ hasText: '연락처 있음 · 주제 4개' }).waitFor();
  // 자동 제작 릴스(올리기 전 검사에 걸려 '수정 요청') — 검사 API 보고서를 그대로 넣어 만든 상태
  const body = '운동 기록을 남기는 가장 쉬운 방법입니다. 오늘 바로 써 볼 수 있습니다.\n[컷1] 앱을 여는 손\n[컷2] 기록 버튼을 누름';
  const { cleaned: _c, thresholds: _t, ad: _a, ...rep } = await ctx.owner.ok('POST', '/api/marketing/quality/check', { channel: 'instagram', kind: 'reels', title: '운동 기록', body, brandId: b.id });
  assert.ok(rep.preflight.length >= 2, JSON.stringify(rep.preflight));
  const visual = '영상 시안 제작 중 — 영상이 붙으면 승인 대기로 올라갑니다';
  const [c] = await sql`insert into mkt_contents (tenant, brand_id, title, channel, scheduled_at, status, current_version, created_by, kind, auto, produced_at, quality, rationale)
    values (${tenant}, ${b.id}, 'E2E 릴스 검사', 'instagram', now() + interval '3 days', 'changes', 1, ${ctx.ownerId}, 'reels', true, now(),
      ${sql.json({ passed: false, issues: [...rep.preflight, visual], preflight: rep.preflight, script: ['앱을 여는 손', '기록 버튼을 누름', '그래프가 쌓임'], brief: '실사', report: { ...rep, v: 1 } })},
      ${sql.json({ why: '주제 풀에서 고른 이번 주 글', topic: '운동 기록 앱 쓰는 법', topicFrom: 'pool', source: 'ai' })}) returning id`;
  await sql`insert into mkt_versions (content_id, version, body, media_ids, note, created_by) values (${c.id}, 1, ${body}, ${[]}, 'AI 자동 제작', ${ctx.ownerId})`;
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  const panel = owner.getByTestId('quality-panel'); await panel.waitFor();
  assert.equal(await panel.getByTestId('quality-preflight-chip').innerText(), `올리기 전 검사 ${rep.preflight.length}건`);
  const pf = await panel.getByTestId('quality-preflight').innerText();
  assert.match(pf, /캡션에 컷 대본이 섞임/); assert.match(pf, /연락처 없음 — 사실 카드의 전화/);
  const detail = owner.getByTestId('mkt-detail');
  assert.equal(await detail.getByTestId('mkt-quality').innerText(), `품질 검사: ${visual}`, '노란 칸 = 올리기 전 검사 밖의 문제만');
  const script = detail.getByTestId('mkt-script');
  assert.match(await script.innerText(), /대본\(컷\) 영상 제작용 — 게시 글에는 안 들어감/);
  assert.equal(await script.locator('li').count(), 3);
  assert.equal(await detail.getByTestId('mkt-why-topic-from').innerText(), '주제 풀');
  await panel.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/255-preflight-detail.png` });
  // 사람이 고친 수정본 = 승인 대기 · 이전 검사 결과는 지우고, 새 본문을 다시 검사해 보여 주기만
  await owner.getByTestId('mkt-version-open').click();
  await owner.getByLabel('수정본 본문').fill('운동 기록을 남기는 가장 쉬운 방법입니다. 오늘 바로 써 볼 수 있습니다.\n문의 02-555-0101');
  await owner.getByTestId('mkt-version-save').click();
  await owner.getByTestId('mkt-status').filter({ hasText: '승인 대기' }).waitFor();
  await owner.getByTestId('quality-panel').getByTestId('quality-preflight-chip').filter({ hasText: '올리기 전 검사 통과' }).waitFor();
  assert.equal(await owner.getByTestId('mkt-detail').getByTestId('mkt-quality').innerText(), `품질 검사: ${visual}`, '영상이 아직 없다는 줄은 그대로');
  // 휴대폰: 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/approvals?c=${c.id}`);
  await owner.getByTestId('quality-panel').waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.keyboard.press('Escape');
  await owner.setViewportSize({ width: 1366, height: 900 });
}
