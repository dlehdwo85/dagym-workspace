// 207차(#461, SALES_LEADS_REVAMP 2-3 '단계 = 칩(회사 설정 단계명·색)'): 데이터 설정 › 리드 단계 이름 — 이름·색·숨김 저장 →
// 영업 진행 표(단계 고르는 칸·단계 요약)·상세 칩(회사 색)·진행 단계(칸반 칸 이름·카드 단계 칸)에 회사 이름 · 숨긴 단계는 고르는 칸에서 빠짐 · 저장 값은 그대로
import assert from 'node:assert/strict';

export async function stageNames207({ owner, ctx, sql, BASE, SHOTS }) {
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const made = [];
  try {
    const L1 = (await ctx.owner.ok('POST', '/api/sales/leads', { name: 'E2E207 단계', status: '미팅예정', force: true })).id; made.push(L1);
    await owner.setViewportSize({ width: 1366, height: 900 });
    // 데이터 설정 › 리드 단계 이름: 미팅예정 → 'E2E 첫 미팅'(보라) · 제안서작성중 숨김
    await owner.goto(`${BASE}/s/sales/sources`);
    const box = owner.getByTestId('sales-stage-names'); await box.waitFor();
    const row = (k) => box.locator(`[data-testid="sales-stage-row"][data-stage="${k}"]`);
    assert.equal(await row('계약완료').getByTestId('sales-stage-hide').count(), 0, '종결 단계는 숨김 없음');
    await row('미팅예정').getByTestId('sales-stage-label').fill('E2E 첫 미팅');
    await row('미팅예정').locator('input[type="color"]').fill('#7c3aed');
    await row('제안서작성중').getByTestId('sales-stage-hide').check();
    await box.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/550-sales-stage-names.png` });
    await Promise.all([owner.waitForEvent('load'), box.getByTestId('sales-stage-save').click()]); // 저장 뒤 새로 고침
    const [t] = await sql`select sales_stages from tenants where id = 'default'`;
    assert.deepEqual(t.sales_stages, { 미팅예정: { label: 'E2E 첫 미팅', color: '#7c3aed' }, 제안서작성중: { hidden: true } });
    // 영업 진행 표
    await owner.goto(`${BASE}/s/sales/leads?q=E2E207`);
    const leads = owner.getByTestId('sales-leads');
    await leads.getByRole('group', { name: '보기' }).getByRole('button', { name: '표' }).click();
    const r1 = leads.getByTestId('sales-lead-row').first(); await r1.waitFor();
    const sel = r1.getByTestId('cell-status');
    assert.equal(await sel.inputValue(), '미팅예정', '저장 값은 그대로');
    const opts = await sel.locator('option').allInnerTexts();
    assert.ok(opts.includes('E2E 첫 미팅') && !opts.includes('미팅예정') && !opts.includes('제안서작성중'), opts.join('|'));
    assert.match(await leads.getByTestId('leads-stage-summary').innerText(), /E2E 첫 미팅/);
    // 상세 칩 = 회사 이름·색
    await owner.goto(`${BASE}/s/sales/leads?id=${L1}`);
    const chip = owner.getByTestId('sales-lead-detail').locator('[data-stage="미팅예정"]').first(); await chip.waitFor();
    assert.equal(await chip.innerText(), 'E2E 첫 미팅');
    assert.match(await chip.getAttribute('style'), /124, 58, 237|#7c3aed/i);
    // 진행 단계(칸반) — 칸 이름 · 카드 단계 칸에 숨긴 단계 없음
    await owner.goto(`${BASE}/s/sales/pipeline`);
    const col = owner.locator('[data-testid="pipeline-col"][data-status="미팅예정"]'); await col.waitFor();
    assert.match(await col.locator('h2').innerText(), /^E2E 첫 미팅/);
    const mv = col.getByTestId('pipeline-card').filter({ hasText: 'E2E207 단계' }).getByTestId('pipeline-move');
    const mvOpts = await mv.locator('option').allInnerTexts();
    assert.ok(mvOpts.includes('E2E 첫 미팅') && !mvOpts.includes('제안서작성중'), mvOpts.join('|'));
  } finally {
    await ctx.owner.ok('PUT', '/api/sales/options', { stages: null }).catch(() => {});
    for (const id of made) await ctx.owner.ok('DELETE', `/api/sales/leads/${id}`, { reason: 'E2E 정리' }).catch(() => {});
  }
}
