// 197차(#461 영업 진행 목록 개편 1단계 · #460 업무 완료 때 다음 행동): PC 1366 — '오늘 볼 것' 띠(숫자 = 보기 건수) → '다음 행동 없음' 칸 경고 → 열 머리 정렬(두 번 = 거꾸로)
// · 열 고르기(서버 저장) · 보기 저장(새로 고침에도) · 업무 상세 [완료] → 다음 행동 창(1주 뒤 + 할 일) → 그날 업무 / 종결(보류·사유·다시 볼 날) → 종결 보기 · 휴대폰 카드 넘침 없음
import assert from 'node:assert/strict';

export async function leadList197({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const made = [];
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    const mk = async (body) => { const r = await ctx.owner.ok('POST', '/api/sales/leads', { force: true, ...body }); made.push(r.id); return r.id; };
    const A = await mk({ name: 'E2E197 오늘 거래처', status: '1차연락완료', nextContactDate: ymd(0) });
    const B = await mk({ name: 'E2E197 지난 거래처', status: '미팅예정', nextContactDate: ymd(-3) });
    await mk({ name: 'E2E197 새 거래처', status: '신규리드' }); // 다음 연락일 없음 = 다음 행동 없음
    const D = await mk({ name: 'E2E197 닫은 거래처', status: '1차연락완료' });
    await ctx.owner.ok('PATCH', `/api/sales/leads/${D}`, { status: '실패', reason: '경쟁사 선정' });
    await owner.goto(`${BASE}/s/sales/leads?q=E2E197`);
    const leads = owner.getByTestId('sales-leads');
    await leads.getByTestId('leads-strip').waitFor();
    const n = async (k) => Number(await leads.getByTestId(`leads-strip-${k}-n`).innerText());
    await owner.waitForFunction(() => document.querySelector('[data-testid="leads-strip-today-n"]')?.textContent === '1');
    assert.deepEqual([await n('today'), await n('overdue'), await n('none'), await n('new')], [1, 1, 1, 1], '띠: 오늘 연락·기한 지남·다음 행동 없음·새 리드');
    assert.match(await leads.getByTestId('leads-tab-open').innerText(), /전체 진행 중 3/); assert.match(await leads.getByTestId('leads-tab-closed').innerText(), /종결 1/);
    const rows = leads.getByTestId('sales-lead-row');
    await leads.getByRole('group', { name: '보기' }).getByRole('button', { name: '표' }).click();
    await rows.first().waitFor(); assert.equal(await rows.count(), 3, '기본 = 전체 진행 중(종결 빠짐)');
    // 띠 '다음 행동 없음' → 그 1건만, 칸에 경고
    await leads.getByTestId('leads-strip-none').click();
    await owner.waitForURL(/focus=none/);
    await owner.waitForFunction(() => document.querySelectorAll('[data-testid="sales-lead-row"]').length === 1);
    await rows.first().getByTestId('lead-no-next').waitFor();
    await leads.getByTestId('leads-focus').waitFor();
    await leads.getByTestId('leads-strip-none').click();
    await owner.waitForFunction(() => document.querySelectorAll('[data-testid="sales-lead-row"]').length === 3);
    // 열 머리 정렬: 이름 → 거꾸로
    await leads.getByTestId('leads-th-name').click(); await owner.waitForURL(/sort=name/);
    const names = async () => owner.$$eval('[data-testid="sales-lead-row"] [data-testid="cell-name"]', (els) => els.map((e) => e.value));
    const asc = await names(); assert.deepEqual(asc, [...asc].sort((a, b) => a.localeCompare(b, 'ko')));
    await leads.getByTestId('leads-th-name').click(); await owner.waitForURL(/rev=1/);
    assert.deepEqual(await names(), [...asc].reverse(), '두 번 누르면 거꾸로');
    // 열 고르기(서버 저장) — 출처 열 끄기/켜기
    await leads.getByTestId('leads-cols').locator('summary').click();
    await leads.getByTestId('leads-col-source').uncheck();
    await owner.waitForFunction(() => !document.querySelector('[data-testid="sales-lead-row"] [data-testid="lead-source"]'));
    for (let i = 0; i < 20 && ((await ctx.owner.ok('GET', '/api/sales/leads/views')).cols ?? []).includes('source'); i++) await new Promise((r) => setTimeout(r, 200));
    assert.ok(!(await ctx.owner.ok('GET', '/api/sales/leads/views')).cols.includes('source'), '열 설정이 서버에');
    await leads.getByTestId('leads-col-source').check(); await rows.first().getByTestId('lead-source').waitFor();
    await leads.getByTestId('leads-cols').locator('summary').click();
    await owner.screenshot({ path: `${SHOTS}/538-leads-strip-tabs.png` });
    // 보기 저장: 종결 → '내 보기' 탭 → 새로 고침에도 → 지우기
    await leads.getByTestId('leads-tab-closed').click(); await owner.waitForURL(/lv=closed/);
    await rows.filter({ hasText: '경쟁사 선정' }).waitFor();
    await leads.getByTestId('leads-view-save').click(); await leads.getByTestId('leads-view-name').fill('E2E 종결 보기'); await leads.getByTestId('leads-view-save-go').click();
    const uv = leads.getByTestId('leads-uview').filter({ hasText: 'E2E 종결 보기' }); await uv.waitFor();
    assert.equal(await uv.getAttribute('aria-selected'), 'true', '지금 조건과 같은 내 보기가 켜짐');
    await owner.reload(); await uv.waitFor(); assert.equal(await uv.getAttribute('aria-selected'), 'true', '새로 고침에도(서버 저장)');
    await leads.getByTestId('leads-tab-open').click(); await owner.waitForFunction(() => document.querySelector('[data-testid="leads-uview"]')?.getAttribute('aria-selected') === 'false');
    await uv.click(); await owner.waitForURL(/lv=closed/);
    owner.once('dialog', (d) => d.accept()); await leads.getByTestId('leads-uview-del').click(); await uv.waitFor({ state: 'detached' });
    // #460 업무 [완료] → 다음 행동 창: 1주 뒤 + 할 일 → 그날 업무
    const [ta] = await sql`select id from tasks where lead_id = ${A} and deleted_at is null and status <> 'done' order by created_at limit 1`;
    await owner.goto(`${BASE}/tasks/${ta.id}`);
    await owner.getByTestId('next-action').click();
    const dlg = owner.getByTestId('lead-fu'); await dlg.waitFor();
    assert.equal(await dlg.getByTestId('lead-fu-save').isDisabled(), true, '고르기 전에는 [완료] 못 누름');
    await dlg.getByTestId('lead-fu-chip').filter({ hasText: '1주 뒤' }).click();
    await dlg.getByTestId('lead-fu-action').fill('견적서 보내기');
    await owner.screenshot({ path: `${SHOTS}/539-lead-followup.png` });
    await dlg.getByTestId('lead-fu-save').click();
    await owner.getByText(/다음 연락 .* · 견적서 보내기 — 담당자 업무를 만들었습니다/).first().waitFor();
    const [la] = await sql`select next_contact_date::text as next, next_action from sales_leads where id = ${A}`;
    assert.deepEqual([la.next, la.next_action], [ymd(7), '견적서 보내기']);
    assert.equal((await sql`select count(*)::int c from tasks where lead_id = ${A} and deleted_at is null and status <> 'done' and title like '%견적서 보내기' and due_date = ${ymd(7)}::date`)[0].c, 1);
    // 종결: 보류 + 사유 칩 + 다시 볼 날 6개월 → 종결 보기에 사유
    const [tb] = await sql`select id from tasks where lead_id = ${B} and deleted_at is null and status <> 'done' order by created_at limit 1`;
    await owner.goto(`${BASE}/tasks/${tb.id}`);
    await owner.getByTestId('next-action').click(); await dlg.waitFor();
    await dlg.getByTestId('lead-fu-mode-close').click(); await dlg.getByTestId('lead-fu-close-보류').click();
    assert.equal(await dlg.getByTestId('lead-fu-save').isDisabled(), true, '보류는 사유 전에는 못 누름');
    await dlg.getByTestId('lead-fu-reason-chip').filter({ hasText: '연락 두절' }).click();
    await dlg.getByTestId('lead-fu-revisit-chip').filter({ hasText: '6개월 뒤' }).click();
    await dlg.getByTestId('lead-fu-save').click();
    await owner.getByText(/거래처를 '보류'\(으\)로 닫았습니다 — 다시 볼 날/).first().waitFor();
    const [lb] = await sql`select status, revisit_date from sales_leads where id = ${B}`; assert.equal(lb.status, '보류'); assert.ok(lb.revisit_date, '다시 볼 날');
    await owner.goto(`${BASE}/s/sales/leads?q=E2E197&lv=closed`);
    await rows.filter({ hasText: '연락 두절' }).waitFor();
    // 휴대폰 390: 카드(다음 행동·마지막 접촉) · 띠·탭 가로 밀기 · 넘침 없음
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/s/sales/leads?q=E2E197`);
    await leads.getByTestId('sales-lead-card').first().waitFor(); await leads.getByTestId('leads-strip').waitFor();
    assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '390 가로 넘침 없음');
    await owner.screenshot({ path: `${SHOTS}/540-leads-390.png` });
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    for (const id of made) await ctx.owner.ok('DELETE', `/api/sales/leads/${id}`, { reason: 'E2E 정리' }).catch(() => {});
  }
}
