// 137차(로컬 10/24 23:55 135차 ③ 화원): 사전규격 → 본 공고 = 같은 사업 — 본 공고를 [대상 아님]으로 넘기면 사전규격도 전체 탭에서 빠지고,
// [대상 아님] 탭은 본 공고 한 장 아래 '같은 사업이라 함께 숨김 · 나라장터 사전규격 …' → [되돌리기] 한 번에 둘 다 목록으로
import assert from 'node:assert/strict';

export async function prespecLink({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const ids = ['E2E-PRE-P1', 'E2E-PRE-B1'];
  await sql`delete from sales_src_rows where src_id = any(${ids})`;
  await sql`delete from sales_work_records where ref_id = any(${ids})`;
  const put = (id, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, related: true, fit_business: '다짐', notice_kind: 'new', current_status: '진행중', ...row })})`;
  const T = 'E2E 잇기 화원 복합커뮤니티센터 위탁운영 용역';
  await put(ids[0], { source_type: 'g2b_prespec', source_external_id: 'E2EPRE0001', notice_type: '사전규격', title: T, issuer: 'E2E군', demand_agency: 'E2E군', posted_date: ymd(-20), first_seen_at: `${ymd(-20)}T09:00:00+09:00`, deadline_at: `${ymd(-14)}T18:00:00+09:00` });
  await put(ids[1], { source_type: 'g2b_bid', source_external_id: 'E2EPRE0100-000', title: `[긴급] ${T}`, issuer: '조달청 E2E지방조달청', demand_agency: 'E2E군', posted_date: ymd(-3), first_seen_at: `${ymd(-3)}T09:00:00+09:00`, deadline_at: `${ymd(6)}T10:00:00+09:00` });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  const q = encodeURIComponent('E2E 잇기');
  await owner.goto(`${BASE}/s/sales/bids?tab=all&q=${q}`);
  const list = owner.getByTestId('sales-bids');
  await list.getByTestId('sales-bid').nth(1).waitFor();
  assert.equal(await list.getByTestId('sales-bid').count(), 2, '아무도 넘기지 않으면 사전규격·본 공고 따로');
  // 본 공고를 대상 아님으로(상세 상태 버튼과 같은 API) → 전체 탭에서 둘 다 빠짐
  await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: ids[1], status: '대상아님', reason: '우리 사업 아님' });
  await owner.reload();
  await owner.waitForFunction(() => /대상 아님 \d+건/.test(document.querySelector('[data-testid="sales-bids-tab-skip"]')?.textContent ?? ''));
  assert.equal(await list.getByTestId('sales-bid').count(), 0, '사전규격도 함께 빠짐');
  await list.getByTestId('sales-bids-tab-skip').click();
  const card = list.getByTestId('sales-bid').filter({ hasText: T }); await card.first().waitFor();
  assert.equal(await card.count(), 1, '[대상 아님] 탭은 한 장');
  const row = card.getByTestId('bid-skip-linked-row');
  assert.match(await row.innerText(), /^같은 사업이라 함께 숨김 · 나라장터 사전규격 · E2E 잇기 화원 복합커뮤니티센터 위탁운영 용역 · 공고 /);
  await owner.screenshot({ path: `${SHOTS}/263-bid-prespec-linked.png` });
  await card.getByTestId('bid-skip-restore').click();
  await owner.getByText('되돌렸습니다 — 같은 사업 1건과 함께 다시 목록에 나옵니다').first().waitFor();
  await card.waitFor({ state: 'detached' });
  await list.getByTestId('sales-bids-tab-all').click();
  await list.getByTestId('sales-bid').nth(1).waitFor();
  assert.equal(await list.getByTestId('sales-bid').count(), 2, '되돌리면 둘 다 목록에');
}
