// 246차(로컬 10/28 21:10 대표 7건): #770 같은 날 같은 건으로 묶인 입찰 업무 — 일정 줄에 '업무 담당', 일정을 누르면 미리보기에 업무 줄([업무 열기]·[완료]) ·
// #773 [대상 아님] 탭 — 마감 달마다 묶음 머리 · 마감 지난 것은 접어 둠 · 사유 칩으로 거르기 · #774 공간 배지 = 공간 색 네모(알림 빨간 동그라미와 다름) + 공간 첫 화면 맨 위 '오늘 새 공고 n건'
import assert from 'node:assert/strict';

export async function bid246({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const today = ymd(0);
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  const N1 = '00000000-0000-4000-8000-000000246001', N2 = '00000000-0000-4000-8000-000000246002';
  const put = (id, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row, origin) values ('global', 'procurement_notices', ${id}, ${sql.json({ id, ...row })}, 'workin') on conflict do nothing`;
  const [dg0] = await sql`select counts from sales_digests where tenant = 'default' and day = ${today}`;
  const clean = async () => { await sql`delete from sales_src_rows where src_id = any(${[N1, N2]})`; await sql`delete from sales_work_records where ref_id = any(${[N1, N2]})`; };
  await clean();
  let ev = null, tk = null;
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    // #770 — 13~19시가 빈 날(겹친 일정이 위에 그려지지 않게)
    let d = ymd(4);
    for (let n = 4; n < 40; n++) { d = ymd(n); const [x] = await sql`select count(*)::int c from events where deleted_at is null and start_at < ${`${d}T19:00:00+09:00`} and end_at > ${`${d}T13:00:00+09:00`}`; if (!x.c) break; }
    const cals = (await ctx.owner.ok('GET', '/api/calendars')).calendars;
    const cal = (cals.find((c) => c.type === 'personal' && c.owner_user_id === ctx.ownerId) ?? cals.find((c) => c.type === 'personal')).id;
    ev = (await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '[입찰] 입찰 마감 · E2E246 묶음 단지', start: `${d}T17:00:00+09:00`, end: `${d}T18:00:00+09:00` })).id;
    tk = (await ctx.owner.ok('POST', '/api/tasks', { title: '[입찰] E2E246 묶음 단지', assigneeId: ctx.ownerId, dueDate: d, dueTime: '17:00', approvalRequired: false })).id;
    await owner.goto(`${BASE}/calendar?date=${d}`);
    await owner.getByTestId('calendar').waitFor();
    const block = owner.locator('.fc-timegrid-event', { hasText: 'E2E246 묶음 단지' });
    await block.first().waitFor();
    assert.equal(await block.count(), 1, '업무는 일정 줄에 묶여 한 줄');
    assert.match(await block.first().innerText(), /업무/, '묶인 업무가 있다는 표시');
    await block.first().click();
    const pv = owner.getByTestId('event-preview'); await pv.waitFor();
    const row = pv.getByTestId('preview-folded-task'); await row.waitFor();
    assert.match(await row.innerText(), /E2E246 묶음 단지[\s\S]*마감 17:00[\s\S]*업무 열기/);
    await owner.waitForTimeout(400);
    await owner.screenshot({ path: `${SHOTS}/592-cal-folded-task.png` });
    await row.getByTestId('preview-folded-done').click();
    await owner.getByText('업무를 완료했습니다').first().waitFor();
    assert.equal((await sql`select status from tasks where id = ${tk}`)[0].status, 'done');
    await owner.keyboard.press('Escape');

    // #773 [대상 아님] 탭 — 달마다 묶음 · 마감 지난 것 접힘 · 사유 칩
    await put(N1, { source_type: 'kapt_bid', source_external_id: 'E2E246-1', title: '[경기] E2E246 앞으로 단지 주민운동시설 위탁운영', issuer: 'E2E246 앞으로 단지', related: true, fit_business: '다짐', classification: '검토',
      current_status: '진행중', notice_kind: 'new', posted_date: today, deadline_at: `${ymd(45)}T17:00:00+09:00`, first_seen_at: new Date().toISOString() });
    await put(N2, { source_type: 'kapt_bid', source_external_id: 'E2E246-2', title: '[경기] E2E246 지난 단지 주민운동시설 위탁운영', issuer: 'E2E246 지난 단지', related: true, fit_business: '다짐', classification: '검토',
      current_status: '진행중', notice_kind: 'new', posted_date: ymd(-30), deadline_at: `${ymd(-20)}T17:00:00+09:00`, first_seen_at: new Date(Date.now() - 30 * 864e5).toISOString() });
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: N1, status: '대상아님', reason: '지역 밖' });
    await ctx.owner.ok('POST', '/api/sales/work', { kind: 'bid', id: N2, status: '대상아님', reason: '취소 공고' });
    await owner.goto(`${BASE}/s/sales/hub?tab=bids&bt=skip&bq=E2E246`);
    const g = owner.getByTestId('skip-groups'); await g.waitFor();
    const m = Number(ymd(45).slice(5, 7)), y = Number(ymd(45).slice(0, 4));
    assert.match(await g.getByTestId('skip-month').first().innerText(), new RegExp(`^${y}년 ${m}월 마감 1건[\\s\\S]*E2E246 앞으로 단지`));
    const past = g.getByTestId('skip-past');
    assert.equal(await past.getAttribute('open'), null, '마감 지난 것은 접어 둠');
    assert.match(await past.locator('summary').innerText(), /마감 지난 공고 1건/);
    assert.equal(await past.getByText('E2E246 지난 단지').first().isVisible(), false);
    await past.locator('summary').click();
    await past.getByText('E2E246 지난 단지').first().waitFor();
    await g.getByTestId('skip-reason-chip').filter({ hasText: '취소 공고 1' }).click();
    await g.getByTestId('skip-live-empty').waitFor();
    assert.equal(await g.getByText('E2E246 앞으로 단지').count(), 0, '사유 칩으로 거름');
    await owner.screenshot({ path: `${SHOTS}/593-bids-skip-groups.png` });

    // #774 공간 배지 — 오늘 새 공고(당일 공고 메일과 같은 수)
    await sql`insert into sales_digests (tenant, day, counts) values ('default', ${today}, ${sql.json({ total: 7 })}) on conflict (tenant, day) do update set counts = sales_digests.counts || ${sql.json({ total: 7 })}`;
    await owner.goto(`${BASE}/`);
    const badge = owner.getByTestId('space-tab-sales').getByTestId('space-badge-sales'); await badge.waitFor();
    assert.equal(await badge.innerText(), '7');
    assert.equal(await badge.getAttribute('title'), '오늘 새 공고 7건');
    const st = await badge.evaluate((el) => { const c = getComputedStyle(el); return [c.borderTopLeftRadius, c.backgroundColor]; });
    assert.deepEqual(st, ['5px', 'rgb(37, 99, 235)'], '알림(빨간 동그라미)과 다른 모양 — 영업 색 네모');
    await owner.goto(`${BASE}/s/sales`);
    const line = owner.getByTestId('space-badge-line'); await line.waitFor();
    assert.match(await line.innerText(), /오늘 새 공고 7건 — 공간 전환 칸의 영업 숫자는 이 숫자입니다/);
    assert.equal(await line.getAttribute('href'), '/s/sales/hub?tab=bids&bt=today');
    await owner.screenshot({ path: `${SHOTS}/594-space-badge-line.png`, clip: { x: 0, y: 0, width: 1366, height: 260 } });
  } finally {
    if (dg0) await sql`update sales_digests set counts = ${sql.json(dg0.counts)} where tenant = 'default' and day = ${today}`; else await sql`delete from sales_digests where tenant = 'default' and day = ${today}`;
    if (ev) await sql`update events set deleted_at = now() where id = ${ev}`;
    if (tk) await sql`update tasks set deleted_at = now() where id = ${tk}`;
    await clean();
  }
}
