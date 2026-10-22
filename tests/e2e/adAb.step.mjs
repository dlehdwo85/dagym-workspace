// 광고 최적화 1차 ① 3안 소액 테스트 + ④ 절감액: 광고 운영 화면 — 판정 상자(이긴 안·진 안 배지·서버 판정 문구) → [이긴 안에 집중](확인 창 → 진 안 2개 + 하루 예산)
// · 소재 끄기 단추 · 변경 기록 '소재 끄기 안 B, 안 C (3안 테스트 결과)' · 새 세팅안 '3안 소액 테스트' 칸 · 절감액 수수료율 바꾸기 · 휴대폰 폭 넘침 없음
// 시험 서버에는 가짜 네이버가 없다 → 세팅안·성과는 DB 에 만들고, 네이버로 가는 [이긴 안에 집중]·소재 끄기는 화면이 보내는 요청 내용만 확인(실제 쓰기 경로는 tests/api/ad-ab.test.mjs)
import assert from 'node:assert/strict';

export async function adAb({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const ids = ['nad-e2e-a', 'nad-e2e-b', 'nad-e2e-c'];
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'naver', '7654321', 'E2E 네이버', ${ctx.ownerId})
    on conflict (tenant, provider, external_id) do update set label = excluded.label returning id`;
  const ad = (headline) => ({ headline, description: '첫 상담 무료, 가까운 헬스장에서 시작하세요', url: 'https://example.com' });
  const [p] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, name, plan, status, external, created_by, approved_by, approved_at)
    values ('default', ${acc.id}, 'naver', 'E2E 3안 테스트', ${sql.json({ dailyBudget: 5000, bidAmt: 300, channelId: 'bsn-1', keywords: ['동네 헬스장'], ads: [ad('가을 PT 상담'), ad('첫 달 반값 PT'), ad('동네 헬스장 PT')],
      test: { on: true, days: 7, minImpressions: 300, afterBudget: 20000 } })}, 'active', ${sql.json({ campaignId: 'cmp-e2e', adgroupId: 'grp-e2e', keywordIds: ['kw-e2e'], adIds: ids })}, ${ctx.ownerId}, ${ctx.ownerId}, now()) returning id`;
  // 8일 전에 켬 + 소재별 누적 성과(A 6% · B 3% · C 2.8%) → 이긴 안 A
  await sql`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, created_at) values ('default', ${p.id}, 'enable', ${sql.json({ userLock: true })}, ${sql.json({ userLock: false })}, true, ${ctx.ownerId}, now() - interval '8 days')`;
  await sql`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, money_up, actor_id, created_at) values ('default', ${p.id}, 'ad_pause', ${sql.json({ adIds: ids.slice(1), userLock: false })}, ${sql.json({ adIds: ids.slice(1), userLock: true, ab: true })}, false, ${ctx.ownerId}, now() - interval '1 hour')`;
  for (const [id, impressions, clicks] of [[ids[0], 1000, 60], [ids[1], 1000, 30], [ids[2], 1000, 28]]) {
    await sql`insert into mkt_ad_items (account_id, day, kind, item_id, item_name, impressions, clicks, cost_krw) values (${acc.id}, ${today}, 'ad', ${id}, '소재', ${impressions}, ${clicks}, ${clicks * 300})`;
  }
  await sql`insert into mkt_ad_stats (account_id, day, campaign_id, campaign_name, cost_krw) values (${acc.id}, ${today}, 'cmp-e2e', 'E2E 3안 테스트', 120000) on conflict do nothing`;

  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  const card = owner.getByTestId('ad-plan').filter({ hasText: 'E2E 3안 테스트' });
  const box = card.getByTestId('ad-ab');
  await box.waitFor();
  assert.equal(await box.getAttribute('data-status'), 'winner');
  assert.equal(await box.getByTestId('ad-ab-status').innerText(), '이긴 안 나옴');
  const rows = box.getByTestId('ad-ab-row');
  assert.equal(await rows.count(), 3);
  await rows.nth(0).getByTestId('ad-ab-win').waitFor();
  assert.equal(await box.getByTestId('ad-ab-lose').count(), 2);
  assert.equal(await rows.nth(0).getByTestId('ad-ab-lose').count(), 0);
  assert.match(await box.getByTestId('ad-ab-message').innerText(), /안 A 클릭률 6% — 나머지 안\(안 B 3%, 안 C 2\.8%\)보다 확실히 높습니다/);
  assert.match(await box.getByTestId('ad-ab-apply').innerText(), /진 안 2개 끄기 \+ 하루 예산 5,000원 → 20,000원/);
  // 변경 기록: 소재 끄기(3안 테스트 결과) + 되돌리기 단추
  const chg = owner.getByTestId('ad-change').filter({ hasText: '소재 끄기' });
  await chg.getByText('안 B, 안 C (3안 테스트 결과)').waitFor();
  await chg.getByTestId('ad-change-revert').waitFor();
  // 절감액(추정) = 이번 달 광고비 × 기본 15%
  const sav = owner.getByTestId('ad-savings');
  const money = async () => { const t = await sav.innerText(); const m = t.match(/절감액\(추정\) ([\d,]+)원 — 광고비 ([\d,]+)원 × 대행 수수료율 (\d+)%/); assert.ok(m, t); return m.slice(1).map((x) => Number(x.replace(/,/g, ''))); };
  let [amount, spend, pct] = await money();
  assert.equal(pct, 15); assert.ok(spend >= 120000); assert.ok(Math.abs(amount - spend * 0.15) <= 1, `${amount} ≠ ${spend} × 15%`);
  await owner.screenshot({ path: `${SHOTS}/202-ad-ab.png`, fullPage: true });

  // [이긴 안에 집중]: 확인 창 → 진 안 B·C 끄기 + 하루 예산 20,000원 (네이버로 가는 요청은 가로채서 내용만 확인)
  const sent = [];
  await owner.route('**/api/marketing/ad-ops/plans/*/action', async (route) => { sent.push(route.request().postDataJSON()); await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }); });
  let asked = '';
  owner.once('dialog', (d) => { asked = d.message(); d.accept(); });
  await box.getByTestId('ad-ab-apply').click();
  await owner.getByText('진 안을 끄고 이긴 안에 모았습니다').waitFor();
  assert.match(asked, /진 안 2개를 끄고 하루 예산을 5,000원 → 20,000원\(으\)로 바꿀까요\? 예산을 올리면 광고비가 더 나갑니다/);
  assert.deepEqual(sent[0], { action: 'ab_apply', adIds: ids.slice(1), dailyBudget: 20000 });
  // 소재 하나 끄기
  await rows.nth(1).getByTestId('ad-ab-toggle').click();
  await owner.getByText('안 B를 껐습니다').waitFor();
  assert.deepEqual(sent[1], { action: 'ad_pause', adIds: [ids[1]] });
  await owner.unroute('**/api/marketing/ad-ops/plans/*/action');

  // 대행 수수료율 20%(회사 설정) → 절감액 다시 계산
  owner.once('dialog', (d) => d.accept('20'));
  await sav.getByTestId('ad-fee-edit').click();
  await owner.getByText('대행 수수료율을 저장했습니다').waitFor();
  await sav.getByText(/20%\(회사 설정\)/).waitFor();
  [amount, spend, pct] = await money();
  assert.equal(pct, 20); assert.ok(Math.abs(amount - spend * 0.2) <= 1, `${amount} ≠ ${spend} × 20%`);

  // 새 세팅안: '3안 소액 테스트'를 켜면 비교 기간·최소 노출·이긴 뒤 예산 칸 (비즈채널 목록은 네이버로 가므로 빈 목록으로 가로챔)
  await owner.route('**/api/marketing/ad-ops/channels*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [] }) }));
  await owner.getByTestId('ad-plan-new').click();
  const dlg = owner.getByRole('dialog', { name: '네이버 파워링크 세팅안' });
  await dlg.getByTestId('ad-plan-ab').check();
  assert.equal(await dlg.getByTestId('ad-plan-ab-days').inputValue(), '7');
  assert.equal(await dlg.getByTestId('ad-plan-ab-min').inputValue(), '300');
  await dlg.getByTestId('ad-plan-ab-after').waitFor();
  await dlg.getByRole('button', { name: '취소' }).click();
  await owner.unroute('**/api/marketing/ad-ops/channels*');

  // 휴대폰 폭: 소재 표는 상자 안에서만 옆으로(화면 넘침 없음)
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  await owner.getByTestId('ad-ab').first().waitFor();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 가로 넘침 ${over}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 직원은 판정은 보되 단추 없음
  const staffView = await ctx.staffA.client.req('GET', '/api/marketing/ad-ops');
  if (staffView.status === 200) assert.equal(staffView.body.canEdit, false);
  // 정리: 시험 계정(세팅안·기록·성과 함께 지움) · 수수료율 기본값
  await sql`delete from mkt_ad_accounts where id = ${acc.id}`;
  await sql`update mkt_settings set agency_fee_pct = null where tenant = 'default'`;
}
