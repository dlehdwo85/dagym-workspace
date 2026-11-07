// 382차 #1004(대표 11/07 "지원사업·공고 긁어오는 AI 는 AI 크레딧에 넣지 말고 매일 기본으로"): 영업 자동 수집 AI 는 회사 AI 한도 밖 '시스템 몫' —
// 플랫폼 운영 › AI·제작 도구 '자동 수집(회사 한도 밖)' 이번 달 사용·월 안전 상한 저장 · 관리 › 사용량·요금제 '자동 수집(회사 한도 밖)' 줄(회사 사용량에 안 셈)
import assert from 'node:assert/strict';

export async function aiSystem1004({ owner, ctx, BASE, SHOTS, sql }) {
  const [u] = await sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, purpose)
    values ('default', null, gen_random_uuid(), 'anthropic', 'e2e', 0, 0, 0.002, 'sales_support_auto') returning id`;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(BASE + '/platform?tab=ai');
    const box = owner.getByTestId('platform-ai-system'); await box.waitFor();
    assert.match(await box.innerText(), /자동 수집\(회사 한도 밖\)[\s\S]*이번 달 \d+번[\s\S]*상한 20,000원/);
    await owner.getByTestId('ai-system-cap').fill('30000');
    await owner.getByTestId('ai-system-save').click();
    await owner.getByText('상한 30,000원', { exact: false }).waitFor();
    await box.screenshot({ path: `${SHOTS}/1004-platform-ai-system.png` });
    assert.equal((await ctx.owner.ok('GET', '/api/platform/ai-system')).capKrw, 30000);
    await owner.goto(BASE + '/admin/usage');
    const line = owner.getByTestId('ai-usage-system'); await line.waitFor();
    assert.match(await line.innerText(), /자동 수집\(회사 한도 밖\) 이번 달 \d+번[\s\S]*회사 AI 사용량·한도에 넣지 않습니다/);
    await owner.getByTestId('ai-usage').screenshot({ path: `${SHOTS}/1004-usage-system-line.png` });
  } finally {
    await sql`delete from ai_usage where id = ${u.id}`;
    await ctx.owner.ok('PUT', '/api/platform/ai-system', { capKrw: 20000 });
  }
}
