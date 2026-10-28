// 228차(로컬 10/28 13:00 '205차 CSV 다시 가져오기 실패'): 영업 진행 [CSV]로 내보낸 파일을 그대로 [CSV 가져오기]에 넣으면 미리보기 전에 막히던 것
// (207차 주석이 줄 가운데 들어가 우선순위 한글·예상매출 숫자 바꾸기가 꺼져 있었음) → 내보낸 파일 = 모두 '이미 있음' · 한글 우선순위·'1,000만원'·'5천만'·'3억 5,000만원'·빈칸 받기
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

export async function leadCsv228({ owner, ctx, sql, BASE, SHOTS }) {
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const made = [];
  try {
    made.push((await ctx.owner.ok('POST', '/api/sales/leads', { name: '가온센터 E2E228', priority: 'high', expectedRevenue: 12000000, nextContactDate: '2026-12-01', phone: '031-228-0001', force: true })).id);
    made.push((await ctx.owner.ok('POST', '/api/sales/leads', { name: '나래센터 E2E228', priority: 'urgent', region: '경기', force: true })).id);
    made.push((await ctx.owner.ok('POST', '/api/sales/leads', { name: '다솜센터 E2E228', force: true })).id);
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/leads?q=E2E228`);
    const list = owner.getByTestId('sales-leads');
    await list.getByTestId('sales-lead-card').or(list.getByTestId('sales-lead-row')).first().waitFor();
    // ① 내보낸 파일 그대로 다시 넣기 — 미리보기까지 가고, 세 줄 모두 '이미 있음'(바뀌는 칸이 없으니 기본 건너뛰기)
    const [dl] = await Promise.all([owner.waitForEvent('download'), owner.getByTestId('leads-csv-export').click()]);
    const text = await readFile(await dl.path(), 'utf8');
    assert.match(text.split(/\r?\n/)[0], /거래처명,단계,우선순위,.*예상매출,다음 연락일/);
    assert.ok(['높음', '긴급', '12000000'].every((w) => text.includes(w)), text);
    await owner.getByTestId('leads-csv-file').setInputFiles({ name: '거래처_내보낸파일.csv', mimeType: 'text/csv', buffer: Buffer.from(text, 'utf8') });
    const dlg = owner.getByTestId('leads-import'); await dlg.getByTestId('leads-import-counts').waitFor();
    assert.equal(await dlg.getByTestId('leads-import-error').count(), 0, '미리보기 전에 막히지 않음');
    const counts = await dlg.getByTestId('leads-import-counts').innerText();
    assert.ok(counts.includes('새로 0') && counts.includes('이미 있음 3'), counts);
    assert.match(await dlg.getByTestId('leads-import-go').innerText(), /새로 0 · 합치기 0 · 건너뛰기 3/, '바뀌는 칸이 없으면 건너뛰기');
    await owner.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished))); // 창이 다 뜬 뒤 찍음
    await owner.screenshot({ path: `${SHOTS}/581-leads-import-roundtrip.png` });
    await dlg.getByRole('button', { name: '취소' }).click(); await dlg.waitFor({ state: 'detached' });
    // ② 한글 우선순위·한글 금액 단위·빈칸
    const csv = '﻿거래처명,우선순위,예상매출,메모\r\n라온 E2E228,낮음,"1,000만원",\r\n마루 E2E228,긴급,5천만,\r\n바다 E2E228,,,빈칸 줄\r\n사랑 E2E228,보통,"3억 5,000만원",\r\n';
    await owner.getByTestId('leads-csv-file').setInputFiles({ name: 'units228.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
    await dlg.getByTestId('leads-import-counts').waitFor();
    assert.ok((await dlg.getByTestId('leads-import-counts').innerText()).includes('새로 4'));
    await dlg.getByTestId('leads-import-go').click();
    await dlg.getByTestId('leads-import-done').waitFor();
    assert.match(await dlg.getByTestId('leads-import-done').innerText(), /새로 4건/);
    const got = await sql`select name, priority, expected_revenue::float8 as rev, id from sales_leads where tenant = 'default' and deleted_at is null and name = any(${['라온 E2E228', '마루 E2E228', '바다 E2E228', '사랑 E2E228']}) order by name`;
    made.push(...got.map((x) => x.id));
    assert.deepEqual(got.map((x) => [x.name, x.priority, x.rev]), [['라온 E2E228', 'low', 10000000], ['마루 E2E228', 'urgent', 50000000], ['바다 E2E228', null, null], ['사랑 E2E228', 'medium', 350000000]]);
    await dlg.getByRole('button', { name: '닫기' }).click();
  } finally {
    for (const id of made) await ctx.owner.ok('DELETE', `/api/sales/leads/${id}`, { reason: 'E2E 정리' }).catch(() => {});
  }
}
