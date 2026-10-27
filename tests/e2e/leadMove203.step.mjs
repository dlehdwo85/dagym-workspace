// 203차(#461 ⑥, SALES_LEADS_REVAMP 2-3·2-4): PC 칸반 끌어 놓기 → 묻는 창(진행 단계 = 다음 연락일 + 할 일 · 보류 = 사유 필수·다시 볼 날) · [취소] = 그대로 · 카드 select 도 같은 창 ·
// 휴대폰 카드 밀기: → 연락함 기록(종류·내용 + 다음 연락일, 마지막 접촉 오늘) · ← 다음 연락일 바꾸기 · 종결 카드는 밀리지 않음 · 390 넘침 없음
import assert from 'node:assert/strict';

export async function leadMove203({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const plusMonths = (m) => { const d = new Date(`${ymd(0)}T12:00:00+09:00`); d.setUTCMonth(d.getUTCMonth() + m); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d); };
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const made = [];
  const mk = async (body) => { const r = await ctx.owner.ok('POST', '/api/sales/leads', { force: true, ...body }); made.push(r.id); return r.id; };
  const row = async (id) => (await sql`select status, next_contact_date::text as next, next_action, revisit_date::text as revisit from sales_leads where id = ${id}`)[0];
  try {
    const A = await mk({ name: 'E2E203 끌기 A', status: '1차연락완료' });
    const B = await mk({ name: 'E2E203 끌기 B', status: '미팅예정', nextContactDate: ymd(3) });
    const C = await mk({ name: 'E2E203 밀기 C', status: '1차연락완료' });
    // ── PC 1366 칸반 ──
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/s/sales/pipeline`);
    const col = (st) => owner.locator(`[data-testid="pipeline-col"][data-status="${st}"]`);
    const card = (name) => owner.getByTestId('pipeline-card').filter({ hasText: name });
    const dlg = owner.getByTestId('lead-move');
    await card('E2E203 끌기 A').waitFor();
    await card('E2E203 끌기 A').dragTo(col('미팅예정'));
    await dlg.waitFor();
    assert.match(await dlg.innerText(), /E2E203 끌기 A을\(를\) ‘미팅예정’\(으\)로 옮깁니다\. 놓치지 않게 다음 연락일을 정해 주세요/);
    assert.equal(await owner.getByTestId('lead-move-save').isDisabled(), true, '다음 연락일을 골라야 옮김');
    await dlg.getByTestId('lead-q-chip').filter({ hasText: '1주 뒤' }).click();
    await dlg.getByTestId('lead-q-action').fill('현장 미팅 준비');
    await owner.screenshot({ path: `${SHOTS}/545-pipeline-drag-move.png` });
    await owner.getByTestId('lead-move-save').click(); await dlg.waitFor({ state: 'detached' });
    assert.deepEqual([(await row(A)).status, (await row(A)).next, (await row(A)).next_action], ['미팅예정', ymd(7), '현장 미팅 준비']);
    await col('미팅예정').getByText('E2E203 끌기 A').waitFor();
    // 끄는 동안 아래에 뜨는 종결 칸(보류는 오른쪽 끝 열이라 화면 밖) → [취소] = 그대로 → 다시 → 사유 필수 · 다시 볼 날
    const dragToBar = async (name, st) => {
      const b = await card(name).boundingBox(); await owner.mouse.move(b.x + b.width / 2, b.y + 12); await owner.mouse.down(); await owner.mouse.move(b.x + b.width / 2 + 30, b.y + 40, { steps: 5 });
      const bar = owner.locator(`[data-testid="pipeline-drop"][data-status="${st}"]`); await bar.waitFor();
      const t = await bar.boundingBox(); await owner.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 10 }); await owner.mouse.up();
    };
    await dragToBar('E2E203 끌기 B', '보류'); await dlg.waitFor();
    assert.equal(await owner.getByTestId('pipeline-drop-bar').count(), 0, '놓으면 종결 칸은 사라짐');
    await owner.getByTestId('lead-move-cancel').click(); await dlg.waitFor({ state: 'detached' });
    assert.equal((await row(B)).status, '미팅예정', '취소 = 옮기지 않음');
    await dragToBar('E2E203 끌기 B', '보류'); await dlg.waitFor();
    assert.equal(await owner.getByTestId('lead-move-save').isDisabled(), true, '보류는 사유 필수');
    await dlg.getByTestId('lead-move-reason-chip').filter({ hasText: '시기 안 맞음' }).click();
    await dlg.getByTestId('lead-move-revisit-chip').filter({ hasText: '3개월 뒤' }).click();
    await owner.getByTestId('lead-move-save').click(); await dlg.waitFor({ state: 'detached' });
    assert.deepEqual([(await row(B)).status, (await row(B)).revisit], ['보류', plusMonths(3)]);
    assert.equal((await sql`select reason from sales_status_log where lead_id = ${B} order by changed_at desc limit 1`)[0].reason, '시기 안 맞음');
    // 카드 select 도 같은 창(바로 옮기지 않음)
    await card('E2E203 밀기 C').getByTestId('pipeline-move').selectOption('견적협의');
    await dlg.waitFor(); await owner.getByTestId('lead-move-cancel').click(); await dlg.waitFor({ state: 'detached' });
    assert.equal((await row(C)).status, '1차연락완료');
    // ── 휴대폰 390 카드 밀기 ──
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/sales/leads?q=${encodeURIComponent('E2E203 밀기 C')}`);
    const lc = owner.getByTestId('sales-lead-card').filter({ hasText: 'E2E203 밀기 C' }); await lc.waitFor();
    await owner.getByTestId('lead-swipe-hint').waitFor();
    const swipe = async (loc, dx) => { const b = await loc.boundingBox(); const y = b.y + b.height / 2, x0 = b.x + (dx > 0 ? 60 : b.width - 60);
      await owner.mouse.move(x0, y); await owner.mouse.down(); await owner.mouse.move(x0 + dx, y + 4, { steps: 10 }); await owner.mouse.up(); };
    await swipe(lc, 130);
    const log = owner.getByTestId('lead-quick-log'); await log.waitFor();
    assert.equal(await owner.getByTestId('sales-lead-detail').count(), 0, '밀기는 상세를 열지 않음');
    await log.getByTestId('lead-log-chip').filter({ hasText: '통화함' }).click();
    await log.getByTestId('lead-q-chip').filter({ hasText: '3일 뒤' }).click();
    await owner.screenshot({ path: `${SHOTS}/546-lead-swipe-log-390.png` });
    await owner.getByTestId('lead-quick-save').click(); await log.waitFor({ state: 'detached' });
    const [act] = await sql`select data from sales_lead_records where lead_id = ${C} and kind = 'sales_activities' order by created_at desc limit 1`;
    assert.deepEqual([act.data.activity_type, act.data.content], ['전화', '통화함']);
    assert.equal((await row(C)).next, ymd(3));
    await lc.getByText('오늘 · 전화').waitFor(); // 마지막 접촉
    await swipe(lc, -130);
    const nx = owner.getByTestId('lead-quick-next'); await nx.waitFor();
    await nx.getByTestId('lead-q-chip').filter({ hasText: '2주 뒤' }).click();
    await owner.getByTestId('lead-quick-save').click(); await nx.waitFor({ state: 'detached' });
    assert.equal((await row(C)).next, ymd(14));
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '390px 가로 넘침 없음');
    // 종결 카드는 밀리지 않음
    await owner.goto(`${BASE}/s/sales/leads?lv=closed&q=${encodeURIComponent('E2E203 끌기 B')}`);
    const lb = owner.getByTestId('sales-lead-card').filter({ hasText: 'E2E203 끌기 B' }); await lb.waitFor();
    await swipe(lb, 130); await owner.waitForTimeout(300);
    assert.equal(await owner.getByTestId('lead-quick-log').count(), 0, '종결 거래처는 밀기 없음');
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    for (const id of made) await ctx.owner.ok('DELETE', `/api/sales/leads/${id}`, { reason: 'E2E 정리' }).catch(() => {});
  }
}
