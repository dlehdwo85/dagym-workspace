// #499-2 후속(운영 10/24 실계정 시험): 카드에 네이버 캠페인·광고그룹 id · '네이버에서 보기' 링크 · 실패 뒤 같은 캠페인 이어 씀 표시
// · [네이버 반영 값 다시 읽기] 결과 상자(다른 값 강조·읽지 못한 칸·소재 검수·이어 씀·연결 안 된 빈 캠페인) · 끊긴 '만드는 중' → [이어서 만들기]
// · 새 세팅안 이름 30자 안내 · 소재 가운뎃점 → 쉼표(칸을 떠날 때) · 휴대폰 폭.
// 시험 서버에는 가짜 네이버가 없다 → 세팅안은 DB 에 넣고 [다시 읽기]는 가로채 보내는 값만 확인(실제 경로는 tests/api/ad-readback.test.mjs)
import assert from 'node:assert/strict';

export async function adReadback({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'naver', '7654324', 'E2E 반영 네이버', ${ctx.ownerId})
    on conflict (tenant, provider, external_id) do update set label = excluded.label returning id`;
  const plan = { dailyBudget: 3000, bidAmt: 300, channelId: 'bsn-e2e', keywords: ['아파트 커뮤니티 운영'], ads: [{ headline: '커뮤니티 운영 고민?', description: '관리소장님, 무료 운영 진단', url: 'https://example.com/c' }] };
  const long = '[시험] 하이링크 커뮤니티 B2B — 광고 설정 확인';
  const readBack = { at: new Date().toISOString(), items: [
    { key: 'campaignName', label: '캠페인 이름', plan: '[시험] 하이링크 B2B 설정확인', naver: long, ok: false, note: '세팅안 이름과 다릅니다(첫 시도 때 이름이거나 네이버에서 바꿈) — 광고에는 영향 없음' },
    { key: 'budget', label: '하루 예산', plan: '3,000원', naver: '3,000원', ok: true },
    { key: 'rolling', label: '소재 노출 방식', plan: '성과 기반', naver: null, ok: null }],
    ads: [{ id: 'nad-e2e-1', label: '안 A', headline: '커뮤니티 운영 고민?', inspect: '검수 중' }],
    history: '실패한 시도 1번 — 다시 눌렀을 때 실패한 시도에서 만든 캠페인(cmp-e2e-1)을 이어 썼습니다(새로 만들지 않음)', orphans: [] };
  const [made] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, kind, name, plan, status, external, created_by) values ('default', ${acc.id}, 'naver', 'powerlink', '[시험] 하이링크 B2B 설정확인',
    ${sql.json(plan)}, 'created', ${sql.json({ campaignId: 'cmp-e2e-1', adgroupId: 'grp-e2e-1', keywordIds: ['kw-e2e-1'], adIds: ['nad-e2e-1'], campaignName: long, resumed: 1, readBack })}, ${ctx.ownerId}) returning id`;
  const [failed] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, kind, name, plan, status, external, error, created_by) values ('default', ${acc.id}, 'naver', 'powerlink', 'E2E 그룹에서 멈춤',
    ${sql.json(plan)}, 'failed', ${sql.json({ campaignId: 'cmp-e2e-2', campaignFrom: 'new', campaignName: 'E2E 그룹에서 멈춤' })}, '네이버 검색광고 API 오류 400 POST /ncc/adgroups Invalid ad group name length [code 3711]', ${ctx.ownerId}) returning id`;
  const [stuck] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, kind, name, plan, status, external, created_by, updated_at) values ('default', ${acc.id}, 'naver', 'powerlink', 'E2E 끊긴 세팅안',
    ${sql.json(plan)}, 'creating', '{}'::jsonb, ${ctx.ownerId}, now() - interval '10 minutes') returning id`;

  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  // 만든 세팅안: id · 네이버 이름(첫 시도 이름) · 링크(광고그룹) · 이어 씀
  const card = owner.getByTestId('ad-plan').filter({ hasText: '[시험] 하이링크 B2B 설정확인' });
  const ids = card.getByTestId('ad-plan-ids');
  assert.match(await ids.innerText(), /^네이버: 캠페인 cmp-e2e-1 · 광고그룹 grp-e2e-1 · 네이버 이름 ‘\[시험\] 하이링크 커뮤니티 B2B — 광고 설정 확인’ · 네이버에서 보기/);
  assert.equal(await ids.getByTestId('ad-plan-naver-link').getAttribute('href'), 'https://manage.searchad.naver.com/customers/7654324/adgroups/grp-e2e-1');
  assert.equal(await ids.getByTestId('ad-plan-naver-link').getAttribute('target'), '_blank');
  assert.equal(await ids.getByTestId('ad-plan-resumed').innerText(), '실패 뒤 다시 눌러, 앞 시도에서 만든 캠페인을 이어 썼습니다(새로 만들지 않음)');
  // 반영 값 상자: 다른 값이 있으면 펼친 채 · 다름은 세팅안 값과 함께 · 읽지 못한 칸
  const rb = card.getByTestId('ad-plan-readback');
  assert.equal(await rb.evaluate((e) => e.open), true, '다른 값이 있으면 펼침');
  assert.equal(await rb.getByTestId('ad-readback-diff').innerText(), '세팅안과 다른 값 1개');
  assert.match(await rb.locator('summary').innerText(), /읽음 — 세팅안과 다른 값 1개 · 읽지 못한 칸 1개$/);
  const items = rb.getByTestId('ad-readback-item');
  assert.deepEqual(await items.evaluateAll((els) => els.map((e) => e.dataset.ok)), ['false', 'true', 'unknown']);
  assert.match(await items.nth(0).innerText(), /캠페인 이름\s+\[시험\] 하이링크 커뮤니티 B2B — 광고 설정 확인\s+다름 · 세팅안 \[시험\] 하이링크 B2B 설정확인\s+세팅안 이름과 다릅니다/);
  assert.match(await items.nth(1).innerText(), /하루 예산\s+3,000원/);
  assert.equal(await items.nth(1).getByLabel('세팅안과 같음').count(), 1, '같으면 확인 표시');
  assert.match(await items.nth(2).innerText(), /소재 노출 방식\s+읽지 못함/);
  assert.equal(await rb.getByTestId('ad-readback-ads').innerText(), '소재 검수: 안 A 검수 중');
  assert.match(await rb.getByTestId('ad-readback-history').innerText(), /이어 썼습니다\(새로 만들지 않음\)$/);
  assert.equal(await rb.getByTestId('ad-readback-orphans').innerText(), '세팅안과 연결 안 된 빈 캠페인 없음(최근 캠페인 10개 확인)');
  await card.scrollIntoViewIfNeeded();
  await owner.screenshot({ path: `${SHOTS}/223-ad-readback.png` });
  // [네이버 반영 값 다시 읽기] → 보내는 값 { action: 'readback' }
  let sent = null;
  await owner.route(`**/api/marketing/ad-ops/plans/${made.id}/action`, async (r) => { sent = r.request().postDataJSON(); await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, readBack }) }); });
  await card.getByTestId('ad-plan-readback-btn').click();
  await owner.getByText('네이버에서 반영 값을 다시 읽었습니다').waitFor();
  assert.deepEqual(sent, { action: 'readback' });
  await owner.unroute(`**/api/marketing/ad-ops/plans/${made.id}/action`);

  // 그룹에서 멈춘 세팅안: 캠페인 링크 · 다시 읽기(남은 캠페인 확인) · [수정]·[승인하고 시작]
  const fc = owner.getByTestId('ad-plan').filter({ hasText: 'E2E 그룹에서 멈춤' });
  assert.equal(await fc.getByTestId('ad-plan-naver-link').getAttribute('href'), 'https://manage.searchad.naver.com/customers/7654324/campaigns/cmp-e2e-2');
  assert.equal(await fc.getByTestId('ad-plan-readback-btn').count(), 1, '실패한 세팅안도 만든 캠페인이 있으면 읽기');
  assert.equal(await fc.getByTestId('ad-plan-resumed').count(), 0);
  assert.equal(await fc.getByTestId('ad-plan-approve').innerText(), '승인하고 시작');
  // 끊긴 '만드는 중': 안내 + [이어서 만들기]
  const sc = owner.getByTestId('ad-plan').filter({ hasText: 'E2E 끊긴 세팅안' });
  assert.match(await sc.getByTestId('ad-plan-stale').innerText(), /^만드는 중에 끊겼습니다\(5분 넘게 진행 없음\)/);
  assert.equal(await sc.getByTestId('ad-plan-approve').innerText(), '이어서 만들기');
  assert.equal(await sc.getByTestId('ad-plan-readback-btn').count(), 0, '캠페인 없으면 읽기 단추 없음');

  // 새 세팅안: 이름 30자 안내 · 소재 가운뎃점은 칸을 떠나면 쉼표로
  await owner.route('**/api/marketing/ad-ops/channels*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ channels: [] }) }));
  await owner.getByTestId('ad-plan-new').click();
  const dlg = owner.getByRole('dialog', { name: '네이버 파워링크 세팅안' });
  const nl = dlg.getByTestId('ad-plan-name-len');
  await dlg.getByTestId('ad-plan-name').fill('하이링크 B2B');
  assert.equal(await nl.innerText(), "8/30자 · 광고그룹 이름은 뒤에 ' 그룹'을 붙여 만듭니다");
  await dlg.getByTestId('ad-plan-name').fill(long);
  assert.equal(await nl.innerText(), "29자 — 네이버 이름은 30자까지라 광고그룹 '[시험] 하이링크 커뮤니티 B2B — 광고 설정 그룹'(으)로 줄여 만듭니다");
  assert.match(await nl.getAttribute('class'), /text-amber-800/);
  const hl = dlg.getByTestId('ad-plan-headline');
  await hl.fill('운영·위탁 고민?');
  assert.match(await dlg.getByTestId('ad-plan-len').innerText(), /쓸 수 없는 문자 ·/, '쓰는 동안은 경고');
  await hl.press('Tab');
  assert.equal(await hl.inputValue(), '운영,위탁 고민?');
  assert.doesNotMatch(await dlg.getByTestId('ad-plan-len').innerText(), /쓸 수 없는 문자/);
  await dlg.getByRole('button', { name: '취소' }).click();
  await owner.unroute('**/api/marketing/ad-ops/channels*');

  // 휴대폰 폭: 반영 값 상자·id 줄이 가로로 넘치지 않음
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing/ad-ops`);
  await card.getByTestId('ad-plan-readback').scrollIntoViewIfNeeded();
  const over = await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 1, `휴대폰 광고 운영 가로 넘침 ${over}px`);
  await owner.screenshot({ path: `${SHOTS}/223-ad-readback-mobile.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  await sql`delete from mkt_ad_plans where id in ${sql([made.id, failed.id, stuck.id])}`;
  await sql`delete from mkt_ad_accounts where id = ${acc.id}`;
}
