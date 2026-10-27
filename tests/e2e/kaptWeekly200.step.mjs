// 200차(대표 10/26 #699·#678): 준공·입주 시설 탭 '원본 기준일' 한 줄 — K-apt 자료실 추출일(주 1회) · 한국부동산원 파일 수정일(연 1회) · K-apt 자료실 단지 카드(관리사무소 전화·세대수·주민운동시설)
import assert from 'node:assert/strict';

export async function kaptWeekly200({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const id = 'E2E-KW-F1';
  const asof = (slug, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'collector_asof', ${slug}, ${sql.json(row)}, 'workin') on conflict (scope, tbl, src_id) do update set row = excluded.row`;
  const before = await sql`select src_id, row from sales_src_rows where scope = 'global' and tbl = 'collector_asof'`;
  await asof('kapt_weekly_complexes', { day: '2026-10-26', note: '추출(주 1회)' });
  await asof('reb_recent_complexes', { day: '2026-09-01', note: '파일(연 1회, 전년도 사용승인분)' });
  await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'operating_facility_prospects', ${id}, ${sql.json({ id, dedupe_key: '아파트|code:A19990001', name: 'E2E 자료실 새단지', facility_type: '아파트',
    region: '경기 구리시', address: '경기도 구리시 인창동 100 (경기도 구리시 인창로 1)', operating_status: '입주중', completion_date: ymd(-60), household_count: 752, office_phone: '031-555-1234', management_company: '(주)좋은관리',
    amenities: '관리사무소, 주민공동시설 · 주민운동시설: 헬스장', source_slug: 'kapt_weekly_complexes', source_name: 'K-apt 관리비공개의무단지 기본정보(자료실 주간 엑셀)', source_url: 'https://www.k-apt.go.kr/web/board/webReference/boardList.do', first_seen_at: new Date().toISOString() })})
    on conflict (scope, tbl, src_id) do update set row = excluded.row, gone = false`;
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  try {
    for (const [w, h] of [[1366, 900], [390, 844]]) {
      await owner.setViewportSize({ width: w, height: h });
      await owner.goto(`${BASE}/s/sales/hub?tab=facilities&q=${encodeURIComponent('E2E 자료실 새단지')}`);
      const line = owner.getByTestId('hub-source-asof'); await line.waitFor();
      assert.equal(await line.innerText(), '원본 기준일 · K-apt 자료실 10. 26.(월) 추출(주 1회) · 한국부동산원 9. 1.(화) 파일(연 1회, 전년도 사용승인분)');
      const card = owner.getByTestId('sales-hub-item').filter({ hasText: 'E2E 자료실 새단지' }); await card.waitFor();
      const t = await card.innerText();
      assert.match(t, /031-555-1234/); assert.match(t, /752/);
      if (w === 1366) assert.match(t, /부대시설: .*주민운동시설: 헬스장/, 'PC 카드에 부대시설·주민운동시설(휴대폰 카드는 핵심 칸만)');
      assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${w}px 가로 넘침 없음`);
      if (w === 1366) await owner.screenshot({ path: `${SHOTS}/542-facility-source-asof.png` });
    }
    // 원본 기준일이 하나도 없으면 줄을 그리지 않음
    await sql`delete from sales_src_rows where scope = 'global' and tbl = 'collector_asof'`;
    await owner.goto(`${BASE}/s/sales/hub?tab=facilities&q=${encodeURIComponent('E2E 자료실 새단지')}`);
    await owner.getByTestId('sales-hub-item').first().waitFor();
    assert.equal(await owner.getByTestId('hub-source-asof').count(), 0);
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await sql`delete from sales_src_rows where scope = 'global' and tbl = 'operating_facility_prospects' and src_id = ${id}`;
    await sql`delete from sales_src_rows where scope = 'global' and tbl = 'collector_asof'`;
    for (const r of before) await asof(r.src_id, r.row);
  }
}
