// 광고 최적화 1차 ② 동네 타깃: 새 세팅안 '동네 타깃' 칸(중심·반경 → [AI로 동네 추천] → 서비스 단어 → [검색량 확인] → 고른 것 [키워드에 넣기] · 광고 지역 충남) → 저장 → 카드 '동네 타깃' 줄
// · 켠 세팅안 [광고 지역](확인 창 → 보내는 값) · [동네 키워드 추가](중심·동네 미리 채움 → 보내는 값) · 변경 기록 '광고 지역 변경'·'키워드 추가' · 휴대폰 폭 넘침 없음
// 시험 서버에는 가짜 네이버가 없다 → 검색량·켠 세팅안 변경은 화면이 보내는 요청을 가로채 내용만 확인(실제 경로는 tests/api/ad-local.test.mjs). AI 추천은 가짜 AI 응답 줄.
import assert from 'node:assert/strict';
import { FAKE } from '../helpers.mjs';

const ROWS = { rows: [{ keyword: '두정동 헬스장', area: '두정동', service: '헬스장', pc: 300, mobile: 2100, total: 2400, low: false },
  { keyword: '두정역 헬스장', area: '두정역', service: '헬스장', pc: 120, mobile: 880, total: 1000, low: false },
  { keyword: '성정동 헬스장', area: '성정동', service: '헬스장', pc: 5, mobile: 5, total: 10, low: true }], related: [{ keyword: '두정동헬스장추천', total: 2400 }] };

export async function adLocal({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'naver', '7654322', 'E2E 두정 네이버', ${ctx.ownerId})
    on conflict (tenant, provider, external_id) do update set label = excluded.label returning id`;
  const [live] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, name, plan, status, external, created_by, approved_by, approved_at)
    values ('default', ${acc.id}, 'naver', 'E2E 두정 켠 광고', ${sql.json({ dailyBudget: 5000, bidAmt: 300, channelId: 'bsn-1', keywords: ['동네 헬스장'], ads: [{ headline: '가을 PT 상담', description: '첫 상담 무료', url: 'https://example.com' }],
      local: { center: '천안 두정동 다짐', radiusKm: 3, areas: ['두정동'], region: ['15'], abroad: false } })}, 'active', ${sql.json({ campaignId: 'cmp-l', adgroupId: 'grp-l', keywordIds: ['kw-l'], adIds: ['nad-l'] })},
      ${ctx.ownerId}, ${ctx.ownerId}, now()) returning id`;
  await sql`insert into mkt_ad_changes (tenant, plan_id, kind, before, after, actor_id, created_at) values ('default', ${live.id}, 'region', ${sql.json({ KR: ['15'], OTHERS: [] })}, ${sql.json({ KR: ['15', '16'], OTHERS: [] })}, ${ctx.ownerId}, now() - interval '2 hours'),
    ('default', ${live.id}, 'keywords_add', ${sql.json({ count: 1 })}, ${sql.json({ keywords: ['두정동 헬스장', '두정역 PT'], keywordIds: ['kw-a', 'kw-b'], createdIds: ['kw-a', 'kw-b'] })}, ${ctx.ownerId}, now() - interval '1 hour')`;
  // 비즈채널·검색량은 네이버로 가므로 가로챔
  await owner.route('**/api/marketing/ad-ops/channels*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [] }) }));
  await owner.route('**/api/marketing/ad-ops/local/keywords', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROWS) }));

  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  const card = owner.getByTestId('ad-plan').filter({ hasText: 'E2E 두정 켠 광고' });
  assert.match(await card.getByTestId('ad-plan-local').innerText(), /동네 타깃: 천안 두정동 다짐 반경 3km · 동네 1곳\(두정동\) · 광고 지역 충남/);
  // 변경 기록: 광고 지역 변경(충남 → 충남·충북) · 키워드 추가 — 둘 다 되돌리기 단추
  const rc = owner.getByTestId('ad-change').filter({ hasText: '광고 지역 변경' });
  await rc.getByText('충남 → 충남·충북').waitFor(); await rc.getByTestId('ad-change-revert').waitFor();
  const kc = owner.getByTestId('ad-change').filter({ hasText: '키워드 추가' });
  await kc.getByText('두정동 헬스장, 두정역 PT').waitFor(); await kc.getByTestId('ad-change-revert').waitFor();

  // 새 세팅안: 동네 타깃 칸
  await owner.getByTestId('ad-plan-new').click();
  const dlg = owner.getByRole('dialog', { name: '네이버 파워링크 세팅안' });
  await dlg.getByTestId('ad-plan-local-section').locator('summary').click();
  const fd = dlg.getByTestId('local-finder');
  assert.equal(await fd.getByTestId('local-ai').isDisabled(), true, '중심 위치 없으면 AI 추천 못 누름');
  await fd.getByTestId('local-center').fill('천안 두정동 다짐');
  await fd.getByTestId('local-radius').selectOption('3');
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({ areas: [
    { name: '두정동', kind: '동', km: 0.4 }, { name: '두정역', kind: '역', km: 1.1 }, { name: '성정동', kind: '동', km: 2 }] }) }], stop_reason: 'end_turn' }] }) });
  await fd.getByTestId('local-ai').click();
  await fd.getByTestId('local-note').getByText(/AI 가 추정한 동네 이름/).waitFor();
  assert.deepEqual(await fd.getByTestId('local-area').allInnerTexts().then((t) => t.map((x) => x.replace('×', '').trim())), ['두정동', '두정역', '성정동']);
  // 직접 넣고 빼기
  await fd.getByTestId('local-area-input').fill('불당동'); await fd.getByTestId('local-area-input').press('Enter');
  await fd.getByRole('button', { name: '불당동 빼기' }).click();
  assert.equal(await fd.getByTestId('local-area').count(), 3);
  assert.equal(await fd.getByTestId('local-check').isDisabled(), true, '서비스 단어 없으면 검색량 확인 못 누름');
  await fd.getByTestId('local-services').fill('헬스장');
  await fd.getByTestId('local-check').click();
  const rows = fd.getByTestId('local-row');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 3);
  assert.match(await rows.nth(0).innerText(), /두정동 헬스장\s+2,400 \(PC 300 · 모바일 2,100\)/);
  assert.equal(await rows.nth(2).getAttribute('data-low'), '1');
  assert.equal(await rows.nth(2).getByRole('checkbox').isChecked(), false, '검색 거의 없음은 기본으로 안 고름');
  await fd.getByTestId('local-related').getByText('두정동헬스장추천 2,400').waitFor();
  assert.match(await fd.getByTestId('local-pick').innerText(), /2개 키워드에 넣기/);
  await fd.getByTestId('local-pick').scrollIntoViewIfNeeded(); // 창 안에서 내려 결과 표가 보이게
  await owner.screenshot({ path: `${SHOTS}/203-ad-local.png` });
  await fd.getByTestId('local-pick').click();
  assert.equal(await dlg.getByTestId('ad-plan-keywords').inputValue(), '두정동 헬스장, 두정역 헬스장');
  // 광고 지역 충남
  const chip = dlg.getByTestId('region-picker').locator('[data-code="15"]');
  await chip.click();
  assert.equal(await chip.getAttribute('aria-pressed'), 'true');
  await dlg.getByTestId('region-picker').getByText('지금: 충남').waitFor();
  // 휴대폰 폭: 동네 타깃 칸이 열린 세팅안 창에서도 가로 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  const over1 = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over1 <= 1, `휴대폰 세팅안 창 가로 넘침 ${over1}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 나머지 칸 채워 저장 → 카드에 동네 타깃 줄
  await dlg.getByTestId('ad-plan-name').fill('E2E 동네 세팅안');
  await dlg.getByTestId('ad-plan-channel').fill('bsn-e2e');
  await dlg.getByTestId('ad-plan-headline').fill('가을 PT 상담');
  await dlg.getByTestId('ad-plan-desc').fill('첫 상담 무료, 가까운 헬스장');
  await dlg.getByTestId('ad-plan-url').fill('https://example.com');
  await dlg.getByTestId('ad-plan-save').click();
  await owner.getByText('세팅안을 저장했습니다').waitFor();
  const saved = owner.getByTestId('ad-plan').filter({ hasText: 'E2E 동네 세팅안' });
  assert.match(await saved.getByTestId('ad-plan-local').innerText(), /천안 두정동 다짐 반경 3km · 동네 3곳\(두정동, 두정역, 성정동\) · 광고 지역 충남/);
  const [sp] = await sql`select plan from mkt_ad_plans where name = 'E2E 동네 세팅안'`;
  assert.deepEqual([sp.plan.keywords, sp.plan.local.region, sp.plan.local.abroad], [['두정동 헬스장', '두정역 헬스장'], ['15'], false]);

  // 켠 세팅안: [광고 지역] 충남 + 충북 → 확인 창 → 보내는 값 / [동네 키워드 추가] 중심·동네 미리 채움 → 보내는 값
  const sent = [];
  await owner.route('**/api/marketing/ad-ops/plans/*/action', async (r) => { sent.push(r.request().postDataJSON()); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }); });
  await card.getByTestId('ad-local-region').click();
  const rd = owner.getByRole('dialog', { name: '광고 지역' });
  await rd.locator('[data-testid="region-chip"][data-code="16"]').click();
  let asked = '';
  owner.once('dialog', (d) => { asked = d.message(); d.accept(); });
  await rd.getByTestId('region-save').click();
  await owner.getByText('광고 지역을 충남·충북(으)로 바꿨습니다').waitFor();
  assert.match(asked, /광고 지역을 충남·충북\(으\)로 바꿀까요\? \(하루 예산은 그대로\)/);
  assert.deepEqual(sent[0], { action: 'region', region: ['15', '16'], abroad: false });
  await card.getByTestId('ad-local-kw').click();
  const kd = owner.getByRole('dialog', { name: '동네 키워드 추가' });
  assert.equal(await kd.getByTestId('local-center').inputValue(), '천안 두정동 다짐');
  assert.deepEqual(await kd.getByTestId('local-area').allInnerTexts().then((t) => t.map((x) => x.replace('×', '').trim())), ['두정동']);
  await kd.getByTestId('local-services').fill('헬스장');
  await kd.getByTestId('local-check').click();
  await kd.getByTestId('local-row').first().waitFor();
  await kd.getByTestId('local-pick').click();
  await owner.getByText('키워드 2개를 광고에 넣었습니다(그룹 입찰가)').waitFor();
  assert.deepEqual(sent[1], { action: 'keywords_add', keywords: ['두정동 헬스장', '두정역 헬스장'], local: { center: '천안 두정동 다짐', radiusKm: 3, areas: ['두정동'] } });
  await owner.unroute('**/api/marketing/ad-ops/plans/*/action');
  await owner.unroute('**/api/marketing/ad-ops/local/keywords');
  await owner.unroute('**/api/marketing/ad-ops/channels*');
  // 휴대폰 폭: 동네 타깃 줄·단추가 있는 목록도 넘침 없음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  await owner.getByTestId('ad-plan-local').first().waitFor();
  const over2 = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over2 <= 1, `휴대폰 목록 가로 넘침 ${over2}px`);
  await owner.setViewportSize({ width: 1366, height: 900 });
  await sql`delete from mkt_ad_accounts where id = ${acc.id}`; // 세팅안·기록도 함께
}
