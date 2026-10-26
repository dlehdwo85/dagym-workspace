// 151차(대표 10/25 17:30 영업 허브 ①②④⑤⑥⑦⑨, 로컬 SALES_HUB_REQUESTS): PC 1366 — 허브 1열 · 정렬 주소 저장 · 시설 [대상 아님] → 보관함(사유·누가·언제) → [되돌리기]
// · 리드 실패(사유) → '보류·실패 n건' 보관함 → [되돌리기] · 신규리드 [영업 진행으로] · 넘긴 공고 카드 [되돌리기] · 사이드바 '입찰·공고' 없음 + 옛 주소 넘김
import assert from 'node:assert/strict';

export async function hubArchive({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)}) on conflict (scope, tbl, src_id) do update set row = excluded.row, gone = false`;
  const ids = ['E2E-HA-F1', 'E2E-HA-F2', 'E2E-HA-N1'];
  await sql`delete from sales_work_records where tenant = 'default' and ref_id = any(${ids})`;
  await sql`delete from sales_src_rows where src_id = any(${ids})`;
  await put('global', 'operating_facility_prospects', { id: ids[0], name: 'E2E 보관함 시설 A', address: '경기 수원시', household_count: 800, facility_type: '아파트', region: '경기', office_phone: '031-111-2222', completion_date: ymd(-200), move_in_date: ymd(-150), first_seen_at: ymd(-3) });
  await put('global', 'operating_facility_prospects', { id: ids[1], name: 'E2E 보관함 시설 B', address: '경기 용인시', household_count: 1200, facility_type: '아파트', region: '경기', completion_date: ymd(-30), move_in_date: ymd(-10), first_seen_at: ymd(-2) });
  await put('global', 'procurement_notices', { id: ids[2], title: 'E2E 보관함 공고 위탁운영', issuer: '시험구', region: '경기', related: true, first_seen_at: `${ymd(0)}T01:00:00+09:00`, posted_date: ymd(0), deadline_at: `${ymd(7)}T10:00:00`, current_status: '공고중', source_type: 'g2b_bid' });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const [{ name: ownerName }] = await sql`select name from users where id = ${ctx.ownerId}`;
  let leadId = null;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    // #611 사이드바에 '입찰·공고' 없음 · 옛 주소 /s/sales/bids → 허브 입찰 탭
    await owner.goto(`${BASE}/s/sales/bids?tab=open`);
    await owner.waitForURL(/\/s\/sales\/hub\?tab=bids&bt=open$/);
    await owner.getByTestId('sales-bids').waitFor();
    assert.equal(await owner.getByTestId('sidebar').getByRole('link', { name: '입찰·공고' }).count().catch(() => 0), 0, '#611 사이드바 입찰·공고 메뉴 없음');
    assert.equal(await owner.getByRole('link', { name: '입찰·공고', exact: true }).count(), 0);
    // #609 허브 시설 탭 1열(두 카드의 왼쪽 x 가 같음) · #606 정렬 메뉴 → 주소 ?sort= 에 남고 새로 고침해도 유지
    await owner.goto(`${BASE}/s/sales/hub?tab=facilities&q=${encodeURIComponent('E2E 보관함')}`);
    const hub = owner.getByTestId('sales-hub');
    await hub.getByTestId('sales-hub-item').nth(1).waitFor();
    const boxes = await hub.getByTestId('sales-hub-item').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.left), Math.round(r.width)]));
    assert.equal(boxes.length, 2); assert.equal(boxes[0][0], boxes[1][0], '1열(카드 왼쪽 x 같음)'); assert.ok(boxes[0][1] > 700, `카드 폭 ${boxes[0][1]} — 2열이 아님`);
    assert.deepEqual(await hub.getByTestId('sales-hub-item').locator('button.font-semibold').allInnerTexts(), ['E2E 보관함 시설 B', 'E2E 보관함 시설 A'], '기본 = 세대수 많은 순');
    await hub.getByTestId('hub-sort').selectOption('completion');
    await owner.waitForURL(/sort=completion/);
    await owner.waitForFunction(() => document.querySelectorAll('[data-testid="sales-hub-item"] button.font-semibold')[0]?.textContent === 'E2E 보관함 시설 A');
    await owner.reload();
    await hub.getByTestId('sales-hub-item').nth(1).waitFor();
    assert.equal(await hub.getByTestId('hub-sort').inputValue(), 'completion', '새로 고침해도 정렬 유지(?sort=)');
    assert.deepEqual(await hub.getByTestId('sales-hub-item').locator('button.font-semibold').allInnerTexts(), ['E2E 보관함 시설 A', 'E2E 보관함 시설 B'], '준공일순');
    await owner.screenshot({ path: `${SHOTS}/296-hub-one-column-sort.png` });
    // #605 시설 [대상 아님](사유) → 기본 목록에서 빠짐 → '대상 아님·완료 1건' 보관함: 누가·언제·사유 → [되돌리기] → 복귀
    const cardA = hub.getByTestId('sales-hub-item').filter({ hasText: 'E2E 보관함 시설 A' });
    await cardA.getByRole('button', { name: 'E2E 보관함 시설 A' }).click();
    const hd = owner.getByTestId('hub-detail'); await hd.waitFor();
    await hd.getByTestId('work-status-대상아님').click();
    await hd.getByTestId('work-skip-reason').fill('이미 위탁 운영 중');
    await hd.getByTestId('work-skip-go').click();
    await owner.getByText('완료 목록으로 옮깁니다').first().waitFor();
    await owner.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
    await cardA.waitFor({ state: 'detached' });
    await hub.getByTestId('hub-box-archive').filter({ hasText: '대상 아님·완료 1건' }).waitFor();
    await hub.getByTestId('hub-box-archive').click();
    await owner.waitForURL(/box=archive/);
    const arch = hub.getByTestId('sales-hub-item').filter({ hasText: 'E2E 보관함 시설 A' }); await arch.waitFor();
    const line = await arch.getByTestId('hub-archive').innerText();
    assert.ok(line.includes('대상아님') && line.includes(ownerName), line);
    assert.equal(await arch.getByTestId('hub-archive-reason').innerText(), '· 사유: 이미 위탁 운영 중');
    assert.equal(await hub.getByTestId('sales-hub-item').count(), 1, '보관함에는 넘긴 건만');
    await owner.screenshot({ path: `${SHOTS}/297-hub-archive.png` });
    // 보관함에서 현 위탁사·계약만료일 → 저장(계약만료·재입찰 탭으로)
    await arch.getByTestId('hub-archive-operator').fill('E2E 현위탁');
    await arch.getByTestId('hub-archive-end').fill(ymd(120));
    await arch.getByTestId('hub-archive-contract-save').click();
    await owner.getByText('계약만료·재입찰 탭에서 봅니다').first().waitFor();
    await arch.getByTestId('hub-archive-restore').click();
    await owner.getByText('되돌렸습니다 — 다시 기본 목록에 나옵니다').first().waitFor();
    await arch.waitFor({ state: 'detached' });
    await hub.getByTestId('hub-box-open').click();
    await hub.getByTestId('sales-hub-item').filter({ hasText: 'E2E 보관함 시설 A' }).waitFor();
    assert.match(await hub.getByTestId('hub-box-archive').innerText(), /대상 아님·완료 0건/);
    const [wrec] = await sql`select status, data from sales_work_records where tenant = 'default' and ref_id = ${ids[0]}`;
    assert.deepEqual([wrec.status, wrec.data.current_operator, wrec.data.contract_end_date], ['미연락', 'E2E 현위탁', ymd(120)], '되돌려도 현 위탁사·계약만료일은 남음');
    // #610 ⓐ 넘긴 공고 카드 [되돌리기] → 원천 카드 원복 (196차 결정 15-35: 입찰은 입찰 업무로 — 되돌리면 업무·일정 취소)
    const h = await ctx.owner.ok('POST', '/api/sales/work/handoff', { kind: 'bid', id: ids[2], assigneeIds: [ctx.ownerId] });
    await owner.goto(`${BASE}/s/sales/hub?tab=bids&bt=working&bq=${encodeURIComponent('E2E 보관함 공고')}`);
    const bid = owner.getByTestId('sales-bid').filter({ hasText: 'E2E 보관함 공고' }); await bid.waitFor();
    await bid.getByTestId('sales-bid-task').waitFor();
    await bid.getByTestId('sales-handoff-revert').click();
    await bid.getByTestId('sales-handoff-revert-reason').fill('담당 재검토');
    await bid.getByTestId('sales-handoff-revert-go').click();
    await owner.getByText('되돌렸습니다 — 입찰 업무').first().waitFor();
    await bid.waitFor({ state: 'detached' }); // 넘기기 전 진행 기록이 없던 공고라 '진행 기록 있음' 탭에서 빠짐
    await owner.goto(`${BASE}/s/sales/hub?tab=bids&bq=${encodeURIComponent('E2E 보관함 공고')}`); // 기본(진행 중) 탭
    await owner.getByTestId('sales-bid').filter({ hasText: 'E2E 보관함 공고' }).getByTestId('sales-handoff').waitFor(); // 다시 [넘기기]
    const [rt] = await sql`select deleted_at from tasks where id = ${h.taskId}`; assert.ok(rt.deleted_at, '입찰 업무 취소'); assert.equal(h.leadId, null, '입찰은 리드를 만들지 않음');
    // #610 ⓑⓒ·#614 리드: 신규리드 [영업 진행으로] → 1차연락완료 · 실패(사유) → 기본 목록에서 빠지고 '보류·실패 n건' → [되돌리기]
    const r = await ctx.owner.ok('POST', '/api/sales/leads', { name: 'E2E 보관함 거래처', status: '신규리드', force: true }); leadId = r.id;
    await owner.goto(`${BASE}/s/sales/leads?q=${encodeURIComponent('E2E 보관함')}`);
    const leads = owner.getByTestId('sales-leads');
    await leads.getByRole('group', { name: '보기' }).getByRole('button', { name: '표' }).click();
    // 표의 거래처명은 입력 칸(바로 고치기)이라 hasText 로 못 찾음 — 검색어로 좁힌 표에서 줄 수로
    const rows = leads.getByTestId('sales-lead-row'); await rows.first().waitFor();
    assert.equal(await rows.count(), 1, '검색어로 좁힌 기본 목록 = 신규리드 1건(되돌린 리드는 보관함)');
    await rows.first().getByTestId('lead-advance').click();
    const adv = owner.getByTestId('lead-advance-dialog'); await adv.waitFor();
    await adv.getByTestId('lead-advance-next').fill(ymd(2));
    await adv.getByTestId('lead-advance-go').click();
    await owner.getByText('영업 진행(1차연락완료)으로 올렸습니다').first().waitFor();
    await owner.waitForFunction(() => document.querySelector('[data-testid="sales-lead-row"] [data-testid="cell-status"]')?.value === '1차연락완료');
    assert.equal(await rows.first().getByTestId('lead-advance').count(), 0, '1차연락완료가 되면 [영업 진행으로] 없음');
    await ctx.owner.ok('PATCH', `/api/sales/leads/${leadId}`, { status: '실패', reason: '예산 없음' }); // 표의 단계 선택은 prompt() 라 API 로
    await owner.reload();
    await leads.getByTestId('leads-box-archive').filter({ hasText: /보류·실패 [1-9]\d*건/ }).waitFor();
    assert.equal(await rows.count(), 0, '실패는 기본 목록에서 빠짐');
    await leads.getByTestId('leads-box-archive').click();
    await owner.waitForURL(/box=archive/);
    const arow = rows.filter({ hasText: '예산 없음' }); await arow.waitFor();
    assert.equal(await arow.getByTestId('lead-archive-reason').innerText(), '사유: 예산 없음');
    assert.ok((await arow.getByTestId('lead-archive').innerText()).includes(ownerName), '누가');
    // 로컬 10/25 20:00 ①(152차): '단계별' 보기로 열어도 보관함은 표(PC)·카드(휴대폰)로 — 칸반에는 되돌리기 칸이 없어서
    await leads.getByRole('group', { name: '보기' }).getByRole('button', { name: '단계별' }).click();
    await arow.waitFor();
    assert.equal(await leads.getByTestId('sales-pipeline').count(), 0, '보관함에서는 칸반 대신 표');
    // 상세 단계 띠에도 [되돌리기 → 이전 단계]
    await arow.getByTestId('lead-archive-reason').click();
    const dres = owner.getByTestId('lead-detail-restore'); await dres.waitFor();
    assert.equal(await dres.innerText(), '되돌리기 → 1차연락완료');
    await owner.goBack(); await dres.waitFor({ state: 'detached' });
    await leads.getByRole('group', { name: '보기' }).getByRole('button', { name: '표' }).click();
    await arow.waitFor();
    await owner.screenshot({ path: `${SHOTS}/298-leads-archive.png` });
    await arow.getByTestId('lead-archive-restore').click();
    await owner.getByText('되돌렸습니다 — ').first().waitFor();
    await arow.waitFor({ state: 'detached' });
    await leads.getByTestId('leads-box-open').click();
    await rows.first().waitFor(); assert.equal(await rows.count(), 1, '되돌린 리드가 기본 목록에');
    const [lst] = await sql`select status from sales_leads where id = ${leadId}`; assert.equal(lst.status, '1차연락완료', '되돌리기 = 이전 단계');
  } finally {
    if (leadId) await ctx.owner.ok('DELETE', `/api/sales/leads/${leadId}`, { reason: 'E2E 정리' }).catch(() => {});
    await sql`update sales_leads set deleted_at = now() where tenant = 'default' and name like 'E2E 보관함%' and deleted_at is null`.catch(() => {});
    await sql`delete from sales_work_records where tenant = 'default' and ref_id = any(${ids})`.catch(() => {});
    await sql`delete from sales_src_rows where src_id = any(${ids})`.catch(() => {});
  }
}
