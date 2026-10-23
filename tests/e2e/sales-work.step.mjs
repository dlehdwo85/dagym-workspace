// S1-2(로컬 10/20 최우선) 진행 기록 쓰기 화면(390): 전환 뒤 입찰 상세에 원본 상태 버튼(미검토~대상아님)·메모·다음 연락일 → [연락중] 누르면 카드 칩 → 메모 저장 → [진행영업으로 넘기기] → 리드 상세 열림·'진행영업 전환됨'
import assert from 'node:assert/strict';

export async function salesWorkFlow({ browser, desk, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const id = 'E2E-WORK-N1';
  await sql`delete from sales_src_rows where src_id = ${id}`;
  await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, title: 'E2E 진행 기록 공고', complex_name: 'E2E 단지', issuer: '수원시청', region: '경기', related: true, first_seen_at: ymd(0), deadline_at: `${ymd(4)}T10:00:00`, current_status: '공고중' })})`;
  const id2 = 'E2E-WORK-N2'; // 대표 10/21 12:00 영업 재편 1): [영업 진행으로 넘기기]
  await sql`delete from sales_src_rows where src_id = ${id2}`;
  await sql`insert into sales_src_rows (scope, tbl, src_id, row) values ('global', 'procurement_notices', ${id2}, ${sql.json({ id: id2, title: 'E2E 넘기기 공고', complex_name: 'E2E 넘기기 단지', issuer: '성남시청', region: '경기', related: true, first_seen_at: ymd(0), deadline_at: `${ymd(6)}T10:00`, site_briefing_at: `${ymd(2)}T14:00` })})`;
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  const m = await browser.newContext({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  try {
    const p = await m.newPage();
    await p.goto(`${BASE}/s/sales/bids`);
    const bid = p.getByTestId('sales-bid').filter({ hasText: 'E2E 진행 기록 공고' }); await bid.waitFor();
    await bid.getByTestId('bid-open').tap();
    const panel = p.getByTestId('work-panel'); await panel.waitFor();
    assert.deepEqual(await panel.getByRole('group', { name: '진행 상태' }).getByRole('button').allInnerTexts(), ['미검토', '검토중', '연락중', '보류', '미참여', '대상아님'], '원본 상태 버튼 그대로');
    await panel.getByTestId('work-status-연락중').tap();
    await p.getByText('저장했습니다').first().waitFor();
    let w = null;
    for (let k = 0; k < 40 && w?.status !== '연락중'; k++) { [w] = await sql`select status from sales_work_records where tenant = 'default' and ref_id = ${id}`; if (w?.status !== '연락중') await p.waitForTimeout(250); }
    assert.equal(w?.status, '연락중');
    await panel.getByTestId('work-memo').fill('현장 설명회 10/25 참석');
    await panel.getByTestId('work-next').fill(ymd(3));
    await panel.getByTestId('work-save').tap();
    await p.getByText('저장했습니다').nth(1).waitFor().catch(() => {});
    for (let k = 0; k < 40; k++) { [w] = await sql`select data from sales_work_records where tenant = 'default' and ref_id = ${id}`; if (w?.data?.memo === '현장 설명회 10/25 참석') break; await p.waitForTimeout(250); }
    assert.equal(w?.data?.memo, '현장 설명회 10/25 참석'); assert.equal(w?.data?.next_date, ymd(3));
    await p.screenshot({ path: `${SHOTS}/143-sales-work-panel.png` });
    await p.getByRole('dialog').getByLabel('닫기').tap();
    await bid.getByText('연락중').waitFor(); // 카드 상태 칩
    // 대표 10/21 12:00 영업 재편 1): 행 [넘기기] → 담당자 선택 창 → 리드·'영업 중'·업무·일정(현장설명회·입찰 마감)·알림
    const bid2 = p.getByTestId('sales-bid').filter({ hasText: 'E2E 넘기기 공고' }); await bid2.waitFor();
    await bid2.getByTestId('sales-handoff').tap();
    const hd = p.getByTestId('sales-handoff-dialog'); await hd.waitFor();
    await hd.getByTestId('sales-handoff-people').getByRole('checkbox').first().waitFor({ state: 'attached' });
    await p.screenshot({ path: `${SHOTS}/175-sales-handoff.png` });
    await hd.getByTestId('sales-handoff-go').tap();
    await p.getByText('영업 진행으로 넘겼습니다').first().waitFor();
    await bid2.getByTestId('sales-handoff-lead').waitFor();
    const [h] = await sql`select w.status, l.name, l.status as ls, (select count(*)::int from tasks t where t.lead_id = l.id) as tasks, (select count(*)::int from events e where e.title like '[영업] %E2E 넘기기%') as events from sales_work_records w join sales_leads l on l.id = w.lead_id where w.ref_id = ${id2}`;
    assert.deepEqual([h.status, h.name, h.ls, h.tasks >= 1, h.events], ['영업 중', 'E2E 넘기기 단지 E2E 넘기기 공고', '신규리드', true, 2], '리드·영업 중·업무·일정(현장설명회·입찰 마감)');
    // 진행영업으로 넘기기 → 리드 생성·상세 열림
    await bid.getByTestId('bid-open').tap();
    await p.getByTestId('work-convert').tap();
    await p.waitForURL(/\/s\/sales\/leads\?id=/);
    await p.getByTestId('sales-lead-detail').waitFor();
    assert.match(await p.getByRole('dialog').innerText(), /E2E 단지/);
    const [l] = await sql`select l.name, w.status from sales_work_records w join sales_leads l on l.id = w.lead_id where w.ref_id = ${id}`;
    assert.deepEqual([l.name, l.status], ['E2E 단지', '진행영업 전환']);
    // #507 공고 첨부: 공고에서 넘어온 업무 상세 — 자동 첨부가 없으면 [공고 파일 붙이기](공고에 파일이 없으면 안내) · 자동 첨부가 있으면 '공고 첨부(자동)' 표시·버튼 숨김
    const [tk] = await sql`select t.id from tasks t join sales_work_records w on w.lead_id = t.lead_id where w.ref_id = ${id2} and t.deleted_at is null order by t.created_at limit 1`;
    await p.evaluate(() => { try { localStorage.removeItem('wos_td_fold'); } catch {} });
    await p.goto(`${BASE}/tasks/${tk.id}`);
    const sf = p.getByTestId('task-source-files'); await sf.waitFor();
    assert.equal(await sf.innerText(), '공고 파일 붙이기');
    await sf.tap(); await p.getByText('공고에 첨부 파일이 없습니다').first().waitFor();
    await sql`insert into attachments (task_id, kind, storage_key, file_name, mime_type, size_bytes, upload_status, doc_title, source, created_by)
      values (${tk.id}, 'file', 'e2e/sales-auto.hwp', '입찰공고문.hwp', 'application/x-hwp', 11, 'ready', '입찰공고문', 'sales_auto', ${ctx.ownerId})`;
    await p.reload();
    await p.getByTestId('attach-section').getByText('공고 첨부(자동)').first().waitFor();
    assert.equal(await p.getByTestId('task-source-files').count(), 0, '자동 첨부가 있으면 버튼 숨김');
  } finally {
    await m.close().catch(() => {});
    await sql`update sales_cutover set writes_open = false where tenant = 'default'`.catch(() => {});
    await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: false }).catch(() => {});
    await sql`delete from sales_work_records where tenant = 'default' and ref_id = ${id}`.catch(() => {});
    await sql`delete from sales_leads where tenant = 'default' and name = 'E2E 단지'`.catch(() => {});
    await sql`delete from sales_src_rows where src_id = ${id}`.catch(() => {});
    await sql`delete from tasks where lead_id in (select id from sales_leads where tenant = 'default' and name like 'E2E 넘기기%')`.catch(() => {});
    await sql`delete from events where title like '[영업] %E2E 넘기기%'`.catch(() => {});
    await sql`delete from sales_work_records where tenant = 'default' and ref_id = ${id2}`.catch(() => {});
    await sql`delete from sales_leads where tenant = 'default' and name like 'E2E 넘기기%'`.catch(() => {});
    await sql`delete from sales_src_rows where src_id = ${id2}`.catch(() => {});
  }
}
