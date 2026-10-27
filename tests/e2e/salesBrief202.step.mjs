// 202차(#461 ⑤ 놓침 방지, SALES_LEADS_REVAMP 4절): 본사 주간 보고 '영업 진행' — 진행 중 거래처의 연락일 지남·다음 행동 없음·오래 쉼(14일 넘게 연락 없음)·담당 없음
// + 오래 쉼 목록(단계·담당·마지막 접촉, 리드로 가는 링크) · 1366·390 넘침 없음. 아침 브리핑 한 줄·개인 주간 보고 칸은 API 시험(sales-brief-202)
import assert from 'node:assert/strict';

export async function salesBrief202({ owner, ctx, sql, BASE, SHOTS }) {
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const WEEK = '2026-01-05'; // 다른 단계의 지난주 보고와 겹치지 않는 주
  const [r] = await sql`insert into sales_leads (tenant, name, status, owner_id, next_contact_date, created_at)
    values ('default', 'E2E 오래 쉼 거래처', '1차연락완료', ${ctx.ownerId}, null, now() - interval '400 days') returning id`;
  try {
    await sql`delete from weekly_reports where week_start = ${WEEK}`;
    const { id } = await ctx.owner.ok('POST', '/api/reports', { weekStart: WEEK });
    for (const [w, h] of [[1366, 900], [390, 844]]) {
      await owner.setViewportSize({ width: w, height: h });
      await owner.goto(`${BASE}/reports/${id}`);
      const sec = owner.getByTestId('weekly-report-sales'); await sec.waitFor();
      const t = await sec.innerText();
      assert.match(t, /영업 진행/); assert.match(t, /연락일 지남/); assert.match(t, /다음 행동 없음/); assert.match(t, /오래 쉼\(14일 넘게 연락 없음\)/); assert.match(t, /담당 없음/);
      assert.match(t, /E2E 오래 쉼 거래처\s+1차연락완료 · 김대표\s+연락 기록 없음 · 등록/);
      assert.equal(await sec.getByRole('link', { name: 'E2E 오래 쉼 거래처' }).getAttribute('href'), `/s/sales/leads?id=${r.id}`);
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${w}px 가로 넘침 없음`);
      if (w === 1366) await sec.screenshot({ path: `${SHOTS}/544-weekly-report-sales.png` });
    }
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await sql`delete from weekly_reports where week_start = ${WEEK}`;
    await sql`delete from sales_leads where id = ${r.id}`;
  }
}
