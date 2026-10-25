// 대표 10/24 ② 요금제별 회사 월 AI 예산(원): 관리 › 사용량 '이번 달 AI 예산' 게이지(80% 넘으면 주황, 다시 채워지는 날·영상 제작 따로 안내)
// → AI 비서 화면 '회사 이번 달 AI 사용량 84%' 한 줄(관리자 머리줄엔 금액) → 100% 넘으면 빨간 안내(다음 달 1일 다시 채워짐)·입력 막힘
// → 플랫폼 운영 요금제 표 'AI 예산(원)' 칸(체험 5,000 · 베이직 1인 500)·회사 목록 예산 %. 우리 회사에 운영사 조정 값(5,000원)을 잠깐 넣고 끝나면 되돌림. 서버 규칙은 API 시험 ai-company-budget
import assert from 'node:assert/strict';

export async function aiBudget({ owner, sql, BASE, SHOTS }) {
  const used = async () => (await sql`select coalesce(sum(coalesce(cost_krw, cost_usd * 1400)), 0)::float8 krw from ai_usage where tenant = 'default'
    and created_at >= (date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') and coalesce(purpose, '') not like 'marketing_video%'`)[0].krw;
  const spend = (krw) => sql`insert into ai_usage (tenant, user_id, request_id, provider, model, input_tokens, output_tokens, cost_usd, cost_krw, purpose)
    values ('default', null, gen_random_uuid(), 'anthropic', 'claude-sonnet-5-5', 1, 1, ${krw / 1400}, ${krw}, 'e2e_budget')`;
  const before = await used();
  const limit = Math.max(5000, Math.ceil(before / 0.84 / 100) * 100); // 앞 단계에서 쓴 AI 가 있어도 84%가 되게
  await sql`update tenant_subscriptions set limit_overrides = coalesce(limit_overrides, '{}'::jsonb) || ${sql.json({ aiBudgetKrw: limit })} where tenant = 'default'`;
  try {
    await spend(Math.round(limit * 0.84) - before);
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(BASE + '/admin/usage');
    const meter = owner.getByTestId('meter-ai');
    await meter.getByText('이번 달 AI 예산').waitFor();
    assert.match(await meter.innerText(), /84%[\s\S]*원 \/ [\d,]+원/);
    assert.match(await owner.getByTestId('meter-ai-note').innerText(), /^\d{1,2}월 1일에 다시 채워짐 · 운영사가 정한 값 · 영상 제작은 마케팅 크레딧으로 따로$/);
    assert.match(await owner.getByTestId('ai-usage-pct').innerText(), /회사 월 AI 예산 [\d,]+원 중 84%/);
    await meter.screenshot({ path: `${SHOTS}/250-ai-budget-meter.png` });
    // AI 비서: 80% 넘으면 한 줄 미리 알림, 관리자 머리줄엔 예산 금액
    await owner.goto(BASE + '/assistant');
    await owner.getByTestId('ai-company-near').getByText(/회사 이번 달 AI 사용량 84% — 100%가 되면 \d{1,2}월 1일까지 AI 기능이 멈춥니다/).waitFor();
    assert.match(await owner.getByTestId('ai-company-line').innerText(), /회사 이번 달 AI [\d,]+원 \/ 예산 [\d,]+원 \(84%\) · \d{1,2}월 1일 초기화/);
    // 100% 넘음 → 빨간 안내 · 입력 막힘
    await spend(Math.round(limit * 0.2));
    await owner.reload();
    await owner.getByTestId('ai-company-banner').getByText(/회사 AI 사용량을 모두 써서 AI 기능을 멈췄습니다 — \d{1,2}월 1일에 다시 채워집니다/).waitFor();
    assert.ok(await owner.getByLabel('AI 에게 요청', { exact: true }).isDisabled(), '다 쓰면 입력 막힘');
    await owner.screenshot({ path: `${SHOTS}/251-ai-budget-over.png` });
    // 플랫폼 운영: 요금제 표 '회사·1인' 원 칸 + 회사 목록 예산 %
    await owner.goto(BASE + '/platform?tab=billing'); // #565(10/24 저녁) 탭 재편 뒤 요금제 표는 '요금·결제' 탭
    assert.equal(await owner.getByTestId('plan-ai-krw-trial').inputValue(), '5000');
    assert.equal(await owner.getByTestId('plan-ai-krw-pu-w_basic').inputValue(), '500');
    assert.equal(await owner.getByTestId('plan-ai-krw-pu-w_pro').inputValue(), '3000');
    await owner.goto(BASE + '/platform?tab=company'); // 회사 목록(예산 %)은 '회사·가입' 탭
    assert.match(await owner.getByTestId('company-ai-budget-default').innerText(), /월 AI 예산 [\d,]+원 중 10\d% · 멈춤/);
  } finally {
    await sql`delete from ai_usage where tenant = 'default' and purpose = 'e2e_budget'`;
    await sql`update tenant_subscriptions set limit_overrides = limit_overrides - 'aiBudgetKrw' where tenant = 'default'`;
  }
}
