// #499-2 파워링크 세팅안 보강: 새 세팅안 '광고 설정' 칸(추천값 요약 · 가중치 단추·입찰 환산 · 3안 테스트면 동일 비중 잠김 · 제외 키워드 단추 · 확장 검색 끄면 숨김)
// · 키워드 조합기(그룹 곱·빼도 됨 → 검색량 확인 → 낮음도 함께 → 넣기) · 하루 예산 권장 → 저장(보내는 setup 값) → 카드 '광고 설정' 줄·권고(시작은 안 막음) · 고치기 · 휴대폰 폭
// 시험 서버에는 가짜 네이버가 없다 → 비즈채널·검색량은 가로채 내용만 확인(실제 경로는 tests/api/ad-setup.test.mjs). [승인하고 시작]은 누르지 않음.
import assert from 'node:assert/strict';

const COMB = { rows: [
  { keyword: '헬스장 운영', pc: 300, mobile: 2100, total: 2400, low: false },
  { keyword: '아파트 헬스장 운영', pc: 120, mobile: 880, total: 1000, low: false },
  { keyword: '단지 헬스장 운영', pc: 40, mobile: 160, total: 200, low: false },
  { keyword: '커뮤니티 운영', pc: 5, mobile: 10, total: 15, low: true },
  { keyword: '아파트 커뮤니티 운영', pc: 5, mobile: 5, total: 10, low: true },
  { keyword: '단지 커뮤니티 운영', pc: null, mobile: null, total: 0, low: true },
], truncated: false, failed: 0, related: [{ keyword: '아파트헬스장추천', total: 2400 }] };
const won = (n) => `${Math.round(n).toLocaleString('ko-KR')}원`;

export async function adSetup({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'naver', '7654323', 'E2E 설정 네이버', ${ctx.ownerId})
    on conflict (tenant, provider, external_id) do update set label = excluded.label returning id`;
  // 하루 예산 권장의 '월' = 이번 달 승인된 광고 예산의 네이버 몫 — 앞 단계가 만든 예산이 있으면 그것으로 셈
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(new Date());
  const [had] = await sql`select id from mkt_ad_budgets where tenant = 'default' and month = ${month}`;
  const [mine] = had ? [null] : await sql`insert into mkt_ad_budgets (tenant, month, status, plan, total) values ('default', ${month}, 'approved', ${sql.json([{ provider: 'naver', monthly: 600000 }])}, 600000) returning id`;
  const [b] = await sql`select plan, status from mkt_ad_budgets where tenant = 'default' and month = ${month}`;
  const naver = b.status === 'approved' ? Number(b.plan.find((p) => p.provider === 'naver')?.monthly ?? 0) : 0;
  await owner.route('**/api/marketing/ad-ops/channels*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [] }) }));
  let combBody = null;
  await owner.route('**/api/marketing/ad-ops/keywords/combine', async (r) => { combBody = r.request().postDataJSON(); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(COMB) }); });

  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  await owner.getByTestId('ad-plan-new').click();
  const dlg = owner.getByRole('dialog', { name: '네이버 파워링크 세팅안' });
  // 하루 예산 권장(월 ÷ 30 × 1.5) → [넣기]
  const hint = dlg.getByTestId('ad-plan-budget-hint');
  if (naver > 0) {
    const daily = Math.max(100, Math.round(((naver / 30) * 1.5) / 100) * 100);
    assert.match(await hint.innerText(), new RegExp(`^권장 하루 예산 ${won(daily)} — 이번 달 승인된 네이버 예산 ${won(naver)} ÷ 30 × 1\\.5`));
    await hint.getByTestId('ad-plan-budget-apply').click();
    assert.equal(await dlg.getByTestId('ad-plan-budget-input').inputValue(), String(daily));
  } else assert.match(await hint.innerText(), /^권장 하루 예산 = 월 예산 ÷ 30 × 1\.5/);

  // 광고 설정: 새 세팅안은 추천값
  const st = dlg.getByTestId('ad-setup');
  const summary = () => st.getByTestId('ad-setup-summary').innerText();
  assert.equal(await summary(), '자동 추적 켬 · 네이버 매체만 · PC 60%·모바일 120% · 확장 검색 켬(예산 100%) · 소재 성과 기반');
  assert.equal(await st.getByTestId('setup-tracking').isChecked(), true);
  assert.equal(await st.getByTestId('setup-media').inputValue(), 'naver');
  await st.getByTestId('setup-weight-preset').filter({ hasText: '같게 100·100' }).click();
  assert.deepEqual([await st.getByTestId('setup-pc').inputValue(), await st.getByTestId('setup-mobile').inputValue()], ['100', '100']);
  await st.getByTestId('setup-weight-preset').filter({ hasText: '모바일 중심' }).click();
  assert.equal(await st.getByTestId('setup-weight-preset').filter({ hasText: '모바일 중심' }).getAttribute('aria-pressed'), 'true');
  assert.match(await st.getByTestId('setup-weight-bid').innerText(), /입찰 300원 → PC 약 180원 · 모바일 약 360원/);
  // 3안 소액 테스트를 켜면 소재 노출 = 동일 비중(잠김)
  await dlg.getByTestId('ad-plan-ab').check();
  assert.deepEqual([await st.getByTestId('setup-rolling').isDisabled(), await st.getByTestId('setup-rolling').inputValue()], [true, 'ROUND_ROBIN']);
  assert.match(await summary(), /소재 동일 비중\(3안 테스트\)$/);
  await dlg.getByTestId('ad-plan-ab').uncheck();
  // 확장 검색 제외 키워드 단추 · 확장 검색을 끄면 비율·ADVoost Max·제외 키워드 칸이 숨음(다시 켜면 그대로)
  await st.getByTestId('setup-neg-chip').filter({ hasText: '구인' }).click();
  await st.getByTestId('setup-neg-chip').filter({ hasText: '채용' }).click();
  assert.equal(await st.getByTestId('setup-negatives').inputValue(), '구인, 채용');
  assert.equal(await st.getByTestId('setup-neg-chip').filter({ hasText: '구인' }).count(), 0, '넣은 단어는 단추에서 빠짐');
  assert.match(await summary(), /확장 검색 켬\(예산 100% · 제외 키워드 2개\)/);
  await st.getByTestId('setup-exp').uncheck();
  assert.deepEqual([await st.getByTestId('setup-negatives').count(), await st.getByTestId('setup-exp-ratio').count(), await st.getByTestId('setup-aimax').count()], [0, 0, 0]);
  assert.match(await summary(), /확장 검색 끔/);
  await st.getByTestId('setup-exp').check();
  assert.equal(await st.getByTestId('setup-negatives').inputValue(), '구인, 채용');

  // 키워드 조합기: 그룹 곱 + 빼도 됨 → 검색량 확인 → 낮음도 함께 → 넣기
  const cs = dlg.getByTestId('kw-combiner-section');
  await cs.locator('summary').click();
  const kc = cs.getByTestId('kw-combiner');
  const g = kc.getByTestId('kw-group');
  assert.equal(await kc.getByTestId('kw-comb-check').isDisabled(), true, '그룹 2개 전에는 못 누름');
  await g.nth(0).fill('아파트, 단지');
  await g.nth(1).fill('커뮤니티, 헬스장');
  assert.match(await kc.getByTestId('kw-comb-count').innerText(), /^조합 4개/);
  await g.nth(2).fill('운영');
  await kc.getByTestId('kw-group-optional').nth(0).check();
  assert.match(await kc.getByTestId('kw-comb-count').innerText(), /^조합 6개 · 예: 아파트 커뮤니티 운영, 아파트 헬스장 운영, 단지 커뮤니티 운영/);
  await kc.getByTestId('kw-comb-check').click();
  const rows = kc.getByTestId('kw-comb-row');
  await rows.first().waitFor();
  assert.deepEqual(combBody.groups, [{ words: ['아파트', '단지'], optional: true }, { words: ['커뮤니티', '헬스장'], optional: false }, { words: ['운영'], optional: false }]);
  assert.equal(await rows.count(), 6);
  assert.match(await rows.nth(1).innerText(), /아파트 헬스장 운영\s+1,000 \(PC 120 · 모바일 880\)/);
  assert.match(await rows.nth(5).innerText(), /단지 커뮤니티 운영[\s\S]*검색 거의 없음[\s\S]*자료 없음/);
  assert.equal(await rows.nth(5).getByRole('checkbox').isChecked(), false, '검색 거의 없음은 기본으로 안 고름');
  assert.match(await kc.getByTestId('kw-comb-pick').innerText(), /3개 키워드에 넣기/);
  await kc.getByTestId('kw-comb-related').getByText('아파트헬스장추천 2,400').waitFor();
  await kc.getByTestId('kw-comb-low').check();
  assert.match(await kc.getByTestId('kw-comb-pick').innerText(), /6개 키워드에 넣기/);
  await kc.getByTestId('kw-comb-pick').scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/220-ad-kw-combiner.png` });
  await kc.getByTestId('kw-comb-pick').click();
  assert.equal(await dlg.getByTestId('ad-plan-keywords').inputValue(), '헬스장 운영, 아파트 헬스장 운영, 단지 헬스장 운영, 커뮤니티 운영, 아파트 커뮤니티 운영, 단지 커뮤니티 운영');
  await dlg.getByText('키워드(쉼표·줄바꿈으로 구분, 300개까지) — 지금 6개').waitFor();
  assert.equal(await kc.getByTestId('kw-comb-all').isDisabled(), true, '넣은 조합은 다시 안 넣음');
  await rows.nth(0).getByText('(이미 있음)').waitFor();

  // 나머지 칸 → 저장(보내는 setup 값) → 카드
  await dlg.getByTestId('ad-plan-name').fill('E2E 광고 설정 세팅안');
  await dlg.getByTestId('ad-plan-channel').fill('bsn-e2e');
  await dlg.getByTestId('ad-plan-headline').fill('커뮤니티 운영 고민?');
  await dlg.getByTestId('ad-plan-desc').fill('입주 앞둔 단지 관리소장님, 무료 운영 진단');
  await dlg.getByTestId('ad-plan-url').fill('https://example.com');
  await st.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/221-ad-setup-form.png` });
  const req = owner.waitForRequest((r) => r.url().endsWith('/api/marketing/ad-ops/plans') && r.method() === 'POST');
  await dlg.getByTestId('ad-plan-save').click();
  const SET = { tracking: true, media: 'naver', pcWeight: 60, mobileWeight: 120, rolling: 'PERFORMANCE', expSearch: true, expRatio: 100, aiMax: true, negatives: ['구인', '채용'] };
  assert.deepEqual((await req).postDataJSON().setup, SET);
  await owner.getByText('세팅안을 저장했습니다').waitFor();
  const card = owner.getByTestId('ad-plan').filter({ hasText: 'E2E 광고 설정 세팅안' });
  assert.equal(await card.getByTestId('ad-plan-setup').innerText(), '광고 설정: 자동 추적 켬 · 네이버 매체만 · PC 60%·모바일 120% · 확장 검색 켬(예산 100% · 제외 키워드 2개) · 소재 성과 기반');
  assert.match(await card.getByTestId('ad-plan-advice').innerText(), /권고: 소재 1 연결 주소가 홈페이지 첫 화면입니다 — 서비스별 페이지로/);
  assert.equal(await card.getByTestId('ad-plan-issues').count(), 0);
  assert.equal(await card.getByTestId('ad-plan-approve').isDisabled(), false, '권고는 시작을 막지 않음');
  const [sp] = await sql`select plan from mkt_ad_plans where name = 'E2E 광고 설정 세팅안'`;
  assert.deepEqual([sp.plan.setup, sp.plan.keywords.length], [SET, 6]);
  await card.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/222-ad-setup-card.png` });

  // 고치기 = 저장한 설정 그대로 · 휴대폰 폭: 광고 설정·조합기가 열린 창에서 가로 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await card.getByTestId('ad-plan-edit').click();
  const ed = owner.getByRole('dialog', { name: '세팅안 고치기' });
  assert.equal(await ed.getByTestId('setup-negatives').inputValue(), '구인, 채용');
  assert.equal(await ed.getByTestId('ad-setup-summary').innerText(), '자동 추적 켬 · 네이버 매체만 · PC 60%·모바일 120% · 확장 검색 켬(예산 100% · 제외 키워드 2개) · 소재 성과 기반');
  await ed.getByTestId('kw-combiner-section').locator('summary').click();
  await ed.getByTestId('kw-group').nth(0).fill('아파트, 신축아파트, 단지, 입주');
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 세팅안 창 가로 넘침 ${over}px`);
  await ed.getByTestId('ad-setup').scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/222-ad-setup-mobile.png` });
  await ed.getByRole('button', { name: '취소' }).click();
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.unroute('**/api/marketing/ad-ops/keywords/combine');
  await owner.unroute('**/api/marketing/ad-ops/channels*');
  await sql`delete from mkt_ad_accounts where id = ${acc.id}`; // 세팅안도 함께
  if (mine) await sql`delete from mkt_ad_budgets where id = ${mine.id}`;
}
