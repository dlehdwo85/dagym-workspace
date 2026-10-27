// 204차(#461 ⑦, SALES_LEADS_REVAMP 2-3·5절): PC 표 — 체크해서 여러 건 → 아래 막대(담당·단계·다음 연락일·고른 것 CSV) · 다음 연락일 일괄 · 단계 일괄(보류 = 사유 필수) ·
// 2차 정렬(열 머리 Shift+클릭, 주소 sort2) · 표의 단계 바꾸기도 묻는 창(예전 prompt) · 종결 보기엔 체크 칸 없음
import assert from 'node:assert/strict';

export async function leadBulk204({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const made = [];
  const row = async (id) => (await sql`select status, next_contact_date::text as next from sales_leads where id = ${id}`)[0];
  try {
    for (const n of ['다', '가', '나']) made.push((await ctx.owner.ok('POST', '/api/sales/leads', { name: `E2E204 ${n}`, status: '1차연락완료', force: true })).id);
    const [D, G] = made;
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/leads?q=E2E204`);
    const leads = owner.getByTestId('sales-leads');
    await leads.getByRole('group', { name: '보기' }).getByRole('button', { name: '표' }).click();
    const rows = leads.getByTestId('sales-lead-row'); await rows.first().waitFor();
    assert.equal(await rows.count(), 3);
    // 2차 정렬: '전체 진행 중' 기본 정렬은 단계(모두 같음) → Shift+클릭 거래처명 = 가·나·다 · 다시 Shift+클릭 = 거꾸로
    await leads.getByTestId('leads-th-name').click({ modifiers: ['Shift'] });
    await leads.getByTestId('leads-th-sort2').waitFor();
    assert.match(owner.url(), /sort2=name/); assert.doesNotMatch(owner.url(), /[?&]sort=/, '1차 정렬은 그대로');
    const names = async () => (await rows.evaluateAll((trs) => trs.map((tr) => tr.querySelector('[data-testid="cell-name"]')?.value ?? tr.textContent))).map((t) => t.trim());
    assert.deepEqual(await names(), ['E2E204 가', 'E2E204 나', 'E2E204 다'], '단계가 같으면 이름 순');
    await leads.getByTestId('leads-th-name').click({ modifiers: ['Shift'] });
    await owner.waitForURL(/rev2=1/);
    assert.deepEqual(await names(), ['E2E204 다', 'E2E204 나', 'E2E204 가'], '2차 정렬 거꾸로');
    await leads.getByTestId('leads-th-name').click({ modifiers: ['Shift'] });
    await owner.waitForURL((u) => !/rev2=1/.test(String(u)));
    // 표의 단계 바꾸기 → 묻는 창(prompt 아님)
    await rows.nth(0).getByTestId('cell-status').selectOption('미팅예정');
    const mv = owner.getByTestId('lead-move'); await mv.waitFor();
    await mv.getByTestId('lead-q-chip').filter({ hasText: '내일' }).click();
    await owner.getByTestId('lead-move-save').click(); await mv.waitFor({ state: 'detached' });
    assert.deepEqual(await row(G), { status: '미팅예정', next: ymd(1) });
    // 전체 고르기 → 다음 연락일 일괄
    await leads.getByTestId('leads-sel-all').check();
    const bar = owner.getByTestId('leads-bulk-bar'); await bar.waitFor();
    assert.match(await bar.innerText(), /3건 선택/);
    await owner.screenshot({ path: `${SHOTS}/547-leads-bulk-bar.png` });
    await bar.getByTestId('leads-bulk-next').click();
    const bn = owner.getByTestId('lead-bulk-next'); await bn.waitFor();
    await bn.getByTestId('lead-q-chip').filter({ hasText: '1주 뒤' }).click();
    await owner.getByTestId('lead-bulk-save').click(); await bn.waitFor({ state: 'detached' });
    await owner.getByText('3건 바꿨습니다').first().waitFor();
    for (const id of made) assert.equal((await row(id)).next, ymd(7));
    assert.equal(await owner.getByTestId('leads-bulk-bar').count(), 0, '다 바꾸면 선택 풀림');
    // 단계 일괄: 보류 = 사유 필수
    await leads.getByTestId('leads-sel-all').check();
    await owner.getByTestId('leads-bulk-stage').click();
    const bs = owner.getByTestId('lead-bulk-stage'); await bs.waitFor();
    await bs.getByTestId('lead-bulk-to').selectOption('보류');
    assert.equal(await owner.getByTestId('lead-bulk-save').isDisabled(), true, '보류는 사유 필수');
    await bs.getByTestId('lead-bulk-reason-chip').filter({ hasText: '예산 없음' }).click();
    await owner.getByTestId('lead-bulk-save').click(); await bs.waitFor({ state: 'detached' });
    for (const id of made) assert.equal((await row(id)).status, '보류');
    assert.equal((await sql`select reason from sales_status_log where lead_id = ${D} order by changed_at desc limit 1`)[0].reason, '예산 없음');
    // 종결 보기엔 체크 칸 없음
    await owner.goto(`${BASE}/s/sales/leads?lv=closed&q=E2E204`);
    await leads.getByTestId('sales-lead-row').first().waitFor();
    assert.equal(await leads.getByTestId('lead-sel').count(), 0); assert.equal(await leads.getByTestId('leads-sel-all').count(), 0);
  } finally {
    for (const id of made) await ctx.owner.ok('DELETE', `/api/sales/leads/${id}`, { reason: 'E2E 정리' }).catch(() => {});
  }
}
