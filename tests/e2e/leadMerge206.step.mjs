// 206차(#461 ⑦ 기존 거래처끼리 합치기, SALES_LEADS_REVAMP 4절): 리드 상세 › 정보 › [중복 합치기] → 겹쳐 보이는 거래처(같은 전화) → 두 거래처 나란히(남길 쪽 제안 = 딸린 것 많은 쪽)
// → [합치기] → 남긴 거래처 상세로 · 합친 거래처는 목록에서 빠지고 예전 링크(?id=)는 남긴 쪽으로
import assert from 'node:assert/strict';

export async function leadMerge206({ owner, ctx, sql, BASE, SHOTS }) {
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const made = [];
  try {
    const X = (await ctx.owner.ok('POST', '/api/sales/leads', { name: '바다마을 E2E206', status: '미팅예정', phone: '051-777-0206', force: true })).id; made.push(X);
    await ctx.owner.ok('POST', `/api/sales/leads/${X}/activities`, { type: '전화', content: '관리소장 통화' });
    const Y = (await ctx.owner.ok('POST', '/api/sales/leads', { name: '바다마을E2E206 관리소', phone: '051 777 0206', email: 'y206@example.com', force: true })).id; made.push(Y);
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/leads?id=${Y}`);
    const det = owner.getByTestId('sales-lead-detail'); await det.waitFor();
    await det.getByTestId('lead-tab-info').click();
    await det.getByTestId('lead-merge').click();
    const box = det.getByTestId('lead-merge-box'); await box.waitFor();
    const cand = box.getByTestId('lead-merge-cand').filter({ hasText: '바다마을 E2E206' });
    await cand.waitFor();
    assert.match(await cand.innerText(), /같은 전화/);
    await cand.click();
    const pv = box.getByTestId('lead-merge-preview'); await pv.getByTestId('lead-merge-side').first().waitFor();
    const keep = pv.locator('[data-testid="lead-merge-side"][data-keep="1"]');
    assert.match(await keep.innerText(), /바다마을 E2E206[\s\S]*상담 1/, '남길 쪽 제안 = 상담이 있는 쪽');
    assert.match(await pv.getByTestId('lead-merge-summary').innerText(), /빈 칸 채움: 이메일/);
    await pv.getByTestId('lead-merge-summary').scrollIntoViewIfNeeded();
    await owner.screenshot({ path: `${SHOTS}/549-lead-merge-preview.png` });
    await pv.getByTestId('lead-merge-go').click();
    await owner.getByRole('dialog', { name: '바다마을 E2E206', exact: true }).getByTestId('sales-lead-detail').waitFor(); // 남긴 거래처 상세로
    const [x] = await sql`select email from sales_leads where id = ${X}`; const [y] = await sql`select deleted_at, merged_into from sales_leads where id = ${Y}`;
    assert.deepEqual([x.email, !!y.deleted_at, y.merged_into], ['y206@example.com', true, X]);
    // 예전 링크 → 남긴 거래처
    await owner.goto(`${BASE}/s/sales/leads?id=${Y}`);
    await owner.getByRole('dialog', { name: '바다마을 E2E206', exact: true }).getByTestId('sales-lead-detail').waitFor();
    await owner.goto(`${BASE}/s/sales/leads?q=E2E206`);
    const leads = owner.getByTestId('sales-leads');
    await leads.getByRole('group', { name: '보기' }).getByRole('button', { name: '표' }).click();
    const rows = leads.getByTestId('sales-lead-row'); await rows.first().waitFor();
    assert.equal(await rows.count(), 1, '합친 거래처는 목록에서 빠짐');
  } finally {
    for (const id of made) await ctx.owner.ok('DELETE', `/api/sales/leads/${id}`, { reason: 'E2E 정리' }).catch(() => {});
  }
}
