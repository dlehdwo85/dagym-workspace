// 244차 #764·#765(대표 10/28): 영업기회 허브 [전체] — 찾기 칸 하나로 입찰·신규 단지·준공·입주 시설을 한 번에(갈래마다 건수·앞 8건 → 그 갈래 상세) ·
// 입찰 카드 [대상 아님] 한 번 → 목록에서 빠지고 안내 [되돌리기]로 복귀 · 휴대폰은 탭 한 줄 가로 밀기(화면 넘침 없음)
import assert from 'node:assert/strict';

export async function hub764({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const B = '00000000-0000-4000-8000-000000764001', F = '00000000-0000-4000-8000-000000764002', N = '00000000-0000-4000-8000-000000764003';
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const put = (tbl, id, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', ${tbl}, ${id}, ${sql.json({ id, ...row })}, 'workin') on conflict do nothing`;
  const clean = async () => { await sql`delete from sales_src_rows where src_id = any(${[B, F, N]})`; await sql`delete from sales_work_records where ref_id = ${N} or src_id like ${'%' + N}`; };
  await clean();
  await put('building_sales_pipeline', B, { name: 'E2E764 칠육사아파트 신축', region: '경기', household_count: 900, move_in_date: `${ymd(200)}` });
  await put('operating_facility_prospects', F, { name: 'E2E764 칠육사아파트', region: '경기', household_count: 1200, completion_date: '2020-05-01' });
  await put('procurement_notices', N, { source_type: 'kapt_bid', source_external_id: 'E2E764-1', source_url: 'https://www.k-apt.go.kr/bid/bidDetail.do?bidNum=E2E764-1', title: '[경기] E2E764 칠육사아파트 주민운동시설 위탁운영',
    issuer: 'E2E764 칠육사아파트', related: true, fit_business: '다짐', classification: '즉시 검토', current_status: '진행중', notice_kind: 'new', posted_date: ymd(0), deadline_at: `${ymd(12)}T17:00:00+09:00`, first_seen_at: new Date().toISOString() });
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/hub?tab=all`);
    await owner.getByTestId('hub-all-empty').waitFor();
    await owner.getByLabel('찾기').fill('E2E764');
    const all = owner.getByTestId('hub-all');
    for (const k of ['bids', 'buildings', 'facilities']) await owner.waitForFunction((k) => /^1건/.test(document.querySelector(`[data-testid="hub-all-${k}"] [data-testid="hub-all-count"]`)?.textContent ?? ''), k);
    assert.match(await all.getByTestId('hub-all-bids').innerText(), /E2E764 칠육사아파트 주민운동시설 위탁운영/);
    await owner.screenshot({ path: `${SHOTS}/590-hub-all.png` });
    await all.getByTestId('hub-all-facilities').getByTestId('hub-all-row').click();
    await owner.waitForURL(/tab=facilities&q=E2E764&id=/);
    await owner.getByTestId('hub-detail').waitFor();
    await owner.keyboard.press('Escape');
    // #765 입찰 카드 [대상 아님] 한 번 → 빠지고 [되돌리기]로 돌아옴
    await owner.goto(`${BASE}/s/sales/hub?tab=bids&bt=open&bq=E2E764`);
    const card = owner.getByTestId('sales-bid').filter({ hasText: 'E2E764 칠육사아파트' }); await card.waitFor();
    await card.getByTestId('sales-skip').click();
    await card.waitFor({ state: 'detached' });
    const t = owner.getByTestId('toast').filter({ hasText: '대상 아님으로 옮겼습니다' }); await t.waitFor();
    assert.equal((await sql`select status from sales_work_records where ref_id = ${N}`)[0]?.status, '대상아님');
    await t.getByRole('button', { name: '되돌리기' }).click();
    await card.waitFor();
    // 휴대폰: 탭 한 줄(가로 밀기) · 화면 넘침 없음
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/sales/hub?tab=all`);
    const tabs = owner.getByTestId('sales-hub-tabs'); await tabs.waitFor();
    const box = await tabs.boundingBox(); assert.ok(box.height < 40, `탭 한 줄 높이 ${box.height}`);
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '휴대폰 폭 넘침 없음');
    await owner.screenshot({ path: `${SHOTS}/591-hub-tabs-390.png` });
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await clean();
  }
}
