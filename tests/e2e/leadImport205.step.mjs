// 205차(#461 ⑦ 가져오기·중복, SALES_LEADS_REVAMP 4·5절): CSV 가져오기 = 미리보기(겹침 표시) → 줄마다 합치기·새로·건너뛰기 → 반영.
// 이미 있음(같은 이름) = 기본 합치기(빈 칸만) · 같은 연락처(사업자번호) = 기본 새로 → 합치기로 바꿈 · 파일 안 겹침 = 기본 건너뛰기 · 상세에 사업자번호
import assert from 'node:assert/strict';

export async function leadImport205({ owner, ctx, sql, BASE, SHOTS }) {
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const made = [];
  try {
    const A = (await ctx.owner.ok('POST', '/api/sales/leads', { name: '한빛센터 E2E205', status: '미팅예정', phone: '031-777-0001', force: true })).id; made.push(A);
    const B = (await ctx.owner.ok('POST', '/api/sales/leads', { name: '푸른숲 E2E205', bizNo: '111-22-33333', force: true })).id; made.push(B);
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/leads?q=E2E205`);
    await owner.getByTestId('sales-leads').getByTestId('sales-lead-card').or(owner.getByTestId('sales-lead-row')).first().waitFor();
    // 머리줄 + 4줄: 이미 있음(이름·전화) · 같은 연락처(사업자번호, 이름 다름) · 새로 · 파일 안 겹침(앞 줄과 같은 이름)
    const csv = '﻿거래처명,연락처,이메일,사업자번호,메모\r\n한빛센터 E2E205,031-777-0001,hanbit205@example.com,,\r\n다른 본사 E2E205,031-777-0002,,1112233333,\r\n새벽별 E2E205,010-0000-0205,,,\r\n새벽별 E2E205,,,,중복 줄\r\n';
    await owner.getByTestId('leads-csv-file').setInputFiles({ name: 'leads205.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    const dlg = owner.getByTestId('leads-import'); await dlg.getByTestId('leads-import-counts').waitFor();
    const counts = await dlg.getByTestId('leads-import-counts').innerText();
    for (const t of ['새로 1', '이미 있음 1', '파일 안 겹침 1', '같은 연락처 1']) assert.ok(counts.includes(t), counts);
    assert.equal(await dlg.getByTestId('leads-import-row').count(), 3, '겹치는 줄만 고르게 함');
    const kind = (k) => dlg.locator(`[data-testid="leads-import-row"][data-kind="${k}"]`);
    assert.equal(await kind('same').getByTestId('leads-import-act').inputValue(), `m:${A}`, '이미 있음 = 기본 합치기');
    assert.match(await kind('same').innerText(), /같은 이름·전화[\s\S]*채움: 이메일/);
    assert.equal(await kind('contact').getByTestId('leads-import-act').inputValue(), 'new', '같은 연락처 = 기본 새로(본사 번호를 같이 쓰는 곳일 수 있어)');
    assert.match(await kind('contact').innerText(), /같은 사업자번호/);
    await kind('contact').getByTestId('leads-import-act').selectOption(`m:${B}`);
    assert.equal(await kind('file').getByTestId('leads-import-act').inputValue(), 'skip', '파일 안 겹침 = 기본 건너뛰기');
    assert.match(await dlg.getByTestId('leads-import-go').innerText(), /새로 1 · 합치기 2 · 건너뛰기 1/);
    await owner.screenshot({ path: `${SHOTS}/548-leads-import-preview.png` });
    await dlg.getByTestId('leads-import-go').click();
    await dlg.getByTestId('leads-import-done').waitFor();
    assert.match(await dlg.getByTestId('leads-import-done').innerText(), /새로 1건 · 합침 2건 · 건너뜀 1건/);
    const [a] = await sql`select email, phone from sales_leads where id = ${A}`;
    const [b] = await sql`select phone, biz_no from sales_leads where id = ${B}`;
    assert.deepEqual([a.email, a.phone, b.phone, b.biz_no], ['hanbit205@example.com', '031-777-0001', '031-777-0002', '111-22-33333'], '빈 칸만 채움');
    const fresh = await sql`select id from sales_leads where tenant = 'default' and name = '새벽별 E2E205' and deleted_at is null`;
    made.push(...fresh.map((x) => x.id));
    assert.equal(fresh.length, 1, '파일 안 같은 이름은 한 번만');
    assert.equal((await sql`select count(*)::int n from sales_leads where tenant = 'default' and name = '다른 본사 E2E205'`)[0].n, 0, '합친 줄은 새로 만들지 않음');
    await dlg.getByRole('button', { name: '닫기' }).click();
    // 상세 › 정보: 사업자번호
    await owner.goto(`${BASE}/s/sales/leads?id=${B}`);
    const det = owner.getByTestId('sales-lead-detail'); await det.waitFor();
    await det.getByTestId('lead-tab-info').click();
    assert.match(await det.getByTestId('lead-info').innerText(), /사업자번호\s*111-22-33333/);
  } finally {
    for (const id of made) await ctx.owner.ok('DELETE', `/api/sales/leads/${id}`, { reason: 'E2E 정리' }).catch(() => {});
  }
}
