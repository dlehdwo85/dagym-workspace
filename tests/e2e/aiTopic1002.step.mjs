// 381차 #1002(대표 11/07 "AI 비서가 '업무와 관련된 요청만 도와드려요'·'할 수 없다'고 하는 것을 최소화"): 관리 › AI 사용 내역 —
// '업무 밖으로 걸린 질문'(최근 30일·이름 없이) 목록 · [보관·한도 설정]의 '거름 없이 통과시킬 낱말' 저장 (가짜 AI 서버 — 실제 분류기 판정은 로컬 확인)
import assert from 'node:assert/strict';

export async function aiTopic1002({ owner, ctx, BASE, FAKE, SHOTS }) {
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, classifyQueue: [false] }) });
  const r = await ctx.staffA.client.ok('POST', '/api/ai/chat', { text: 'E2E1002 이번 주 로또 번호 다섯 개 뽑아줘' });
  assert.equal(r.blocked, true, '확실한 잡담은 막힘');
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(BASE + '/admin/ai-logs');
  const box = owner.getByTestId('ai-topic-blocked'); await box.waitFor();
  await box.locator('summary').click();
  assert.match(await box.innerText(), /업무 밖으로 걸린 질문[\s\S]*E2E1002 이번 주 로또 번호 다섯 개 뽑아줘/);
  await box.screenshot({ path: `${SHOTS}/1002-topic-blocked.png` });
  await owner.getByTestId('ai-settings-open').click();
  const allow = owner.getByTestId('ai-topic-allow'); await allow.waitFor();
  await allow.fill('로또, 경품 행사');
  await owner.screenshot({ path: `${SHOTS}/1002-topic-allow.png` });
  await owner.getByRole('button', { name: '저장', exact: true }).click();
  await allow.waitFor({ state: 'detached' });
  const logs = await ctx.owner.ok('GET', '/api/ai/logs');
  assert.deepEqual(logs.settings.topic_allow, ['로또', '경품 행사'], '허용 낱말 저장');
  await ctx.owner.ok('PUT', '/api/ai/settings', { topicAllow: [] }); // 다른 단계에 영향 없게 되돌림
}
