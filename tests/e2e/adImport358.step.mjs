// 358차(로컬 11/04): 네이버 광고 화면에서 직접 만든 캠페인 가져오기 — 카드(가져온 캠페인 표시 · 광고 그룹 입찰가·켜짐 · 그룹 끄기/켜기 · 모든 그룹 입찰가 · 다시 읽기)
// · 세팅안 칸(키워드·소재·광고 설정·동네 키워드·광고 지역·반영 값 다시 읽기) 없음 · [기존 캠페인 가져오기] 창(목록 · 이미 연결됨 · 가져오기 보내는 값) · 휴대폰 폭.
// 시험 서버에는 가짜 네이버가 없다 → 가져온 캠페인은 DB 에 넣고, 목록·가져오기·바꾸기 요청은 가로채 보내는 값만 확인(실제 경로는 tests/api/ad-ops-import-358.test.mjs)
import assert from 'node:assert/strict';

export async function adImport358({ owner, ctx, sql, BASE, SHOTS }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await ctx.owner.ok('PUT', '/api/marketing/ad-ops/cap', { monthlyCap: 500000 });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const [acc] = await sql`insert into mkt_ad_accounts (tenant, provider, external_id, label, created_by) values ('default', 'naver', '7654358', 'E2E 가져오기 네이버', ${ctx.ownerId})
    on conflict (tenant, provider, external_id) do update set label = excluded.label returning id`;
  const groups = [{ id: 'grp-i1', name: '전자결재시스템', bidAmt: 800, paused: false }, { id: 'grp-i2', name: '마케팅 대행 검색어', bidAmt: 650, paused: false }, { id: 'grp-i3', name: '입찰정보', bidAmt: 700, paused: true }];
  const [p] = await sql`insert into mkt_ad_plans (tenant, account_id, provider, kind, name, plan, status, external, created_by, approved_by, approved_at) values ('default', ${acc.id}, 'naver', 'imported', 'E2E 워크인 검색광고',
    ${sql.json({ dailyBudget: 5000, bidAmt: 0, channelId: '', keywords: [], ads: [] })}, 'active', ${sql.json({ imported: true, campaignId: 'cmp-e2e-i', campaignName: 'E2E 워크인 검색광고', adgroups: groups })}, ${ctx.ownerId}, ${ctx.ownerId}, now()) returning id`;
  const sent = []; const answers = [];
  // 입찰가 창(prompt) = 문자열, 확인 창(confirm) = true/false — 처리 실패가 전체 시험을 멈추지 않게 catch
  const onDialog = (d) => { const a = answers.shift(); (a === false ? d.dismiss() : typeof a === 'string' ? d.accept(a) : d.accept()).catch(() => {}); };
  owner.on('dialog', onDialog);
  const until = async (n) => { for (let k = 0; k < 50 && sent.length < n; k++) await owner.waitForTimeout(100); assert.equal(sent.length, n, JSON.stringify(sent)); };
  await owner.route(`**/api/marketing/ad-ops/plans/${p.id}/action`, async (r) => { sent.push(JSON.parse(r.request().postData() || '{}')); await r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  try {
    await owner.goto(`${BASE}/s/marketing/ad-ops?tab=all`);
    const card = owner.getByTestId('ad-plan').filter({ hasText: 'E2E 워크인 검색광고' });
    await card.getByTestId('ad-plan-imported').waitFor();
    assert.match(await card.innerText(), /하루 5,000원 · 광고 그룹 3개/);
    for (const t of ['ad-plan-kw-line', 'ad-plan-setup', 'ad-plan-manual', 'ad-local-kw', 'ad-local-region', 'ad-plan-readback-btn', 'ad-plan-sync']) assert.equal(await card.getByTestId(t).count(), 0, `가져온 캠페인엔 ${t} 없음`);
    assert.match(await card.getByTestId('ad-plan-ids').innerText(), /캠페인 cmp-e2e-i/);
    const rows = card.getByTestId('ad-import-group');
    assert.equal(await rows.count(), 3);
    assert.match(await rows.nth(0).innerText(), /전자결재시스템[\s\S]*입찰 800원[\s\S]*켜짐/);
    assert.match(await rows.nth(2).innerText(), /입찰정보[\s\S]*꺼짐/);
    await owner.screenshot({ path: `${SHOTS}/302-ad-import-card.png` });
    // 모든 그룹 입찰가 500원(내리는 쪽 — 확인 창 없이 입찰가 창만)
    answers.push('500');
    await card.getByTestId('ad-import-bid-all').click();
    await until(1);
    assert.deepEqual(sent[0], { action: 'group_bid', adgroupIds: ['grp-i1', 'grp-i2', 'grp-i3'], bidAmt: 500 });
    // '마케팅 대행 검색어' 그룹 끄기
    await rows.nth(1).getByTestId('ad-import-group-pause').click();
    await until(2);
    assert.deepEqual(sent[1], { action: 'group_pause', adgroupIds: ['grp-i2'] });
    // 꺼진 그룹 켜기 = 돈이 나가는 변경 → 확인 창(취소하면 안 보냄, 확인하면 보냄)
    answers.push(false);
    await rows.nth(2).getByTestId('ad-import-group-resume').click();
    await owner.waitForTimeout(400); assert.equal(sent.length, 2, '취소하면 안 보냄');
    answers.push(true);
    await rows.nth(2).getByTestId('ad-import-group-resume').click();
    await until(3);
    assert.deepEqual(sent[2], { action: 'group_resume', adgroupIds: ['grp-i3'] });
    // 입찰가 올리기 = 확인 창 한 번 더
    answers.push('900', true);
    await rows.nth(0).getByTestId('ad-import-group-bid-btn').click();
    await until(4);
    assert.deepEqual(sent[3], { action: 'group_bid', adgroupIds: ['grp-i1'], bidAmt: 900 });
    await card.getByTestId('ad-import-refresh').click();
    await until(5);
    assert.deepEqual(sent[4], { action: 'refresh' });

    // [기존 캠페인 가져오기] 창: 목록(읽기만) · 이미 연결된 것은 단추 없음 · [가져오기] 보내는 값
    const imported = [];
    await owner.route('**/api/marketing/ad-ops/import**', async (r) => {
      if (r.request().method() === 'POST') { imported.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"x","status":"paused","adgroups":[]}' }); }
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ campaigns: [{ id: 'cmp-x', name: 'E2E 다른 캠페인', type: 'WEB_SITE', dailyBudget: null, on: false, linked: false },
        { id: 'cmp-e2e-i', name: 'E2E 워크인 검색광고', type: 'WEB_SITE', dailyBudget: 5000, on: true, linked: true }] }) });
    });
    await owner.getByTestId('ad-import-open').click();
    const modal = owner.getByTestId('ad-import-modal');
    await modal.waitFor();
    if (await modal.getByTestId('ad-import-account').count()) await modal.getByTestId('ad-import-account').selectOption(acc.id);
    const cands = modal.getByTestId('ad-import-cand');
    await cands.first().waitFor();
    assert.match(await cands.nth(0).innerText(), /E2E 다른 캠페인[\s\S]*하루 제한 없음 · 꺼짐[\s\S]*가져오기/);
    assert.match(await cands.nth(1).innerText(), /이미 연결됨/); assert.equal(await cands.nth(1).getByTestId('ad-import-go').count(), 0);
    await owner.screenshot({ path: `${SHOTS}/303-ad-import-modal.png` });
    await cands.nth(0).getByTestId('ad-import-go').click();
    for (let k = 0; k < 50 && !imported.length; k++) await owner.waitForTimeout(100);
    assert.deepEqual(imported[0], { accountId: acc.id, campaignId: 'cmp-x', brandId: null });
    await modal.waitFor({ state: 'detached' });
    await owner.unroute('**/api/marketing/ad-ops/import**');
    // 휴대폰 폭: 그룹 줄이 넘치지 않음
    await owner.setViewportSize({ width: 390, height: 844 });
    await card.getByTestId('ad-import-groups').scrollIntoViewIfNeeded();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 가로 넘침 없음');
    await owner.screenshot({ path: `${SHOTS}/304-ad-import-phone.png` });
  } finally {
    owner.off('dialog', onDialog);
    await owner.unroute(`**/api/marketing/ad-ops/plans/${p.id}/action`);
    await owner.setViewportSize({ width: 1366, height: 900 });
    await sql`update mkt_ad_plans set status = 'archived' where id = ${p.id}`; // 뒤 단계(월 상한 자동 중지·예산 집행)가 가짜 캠페인을 건드리지 않게
  }
}
