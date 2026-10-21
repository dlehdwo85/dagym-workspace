// S2 1차(대표 10/20 14:15 + 감사 S2-5·6): 영업 홈 '오늘 할 일' 7묶음·요약 타일·진행 현황표 → 허브 일괄 [영업 진행으로] → 업무 화면 '영업' 원천 배지 → 계약만료·재입찰 화면
import assert from 'node:assert/strict';

export async function salesTodo({ owner, ctx, sql, BASE, SHOTS }) {
  const ymd = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() + n * 864e5));
  const put = (scope, tbl, row) => sql`insert into sales_src_rows (scope, tbl, src_id, row) values (${scope}, ${tbl}, ${String(row.id)}, ${sql.json(row)})`;
  const ids = ['E2E-TODO-B1', 'E2E-TODO-B2', 'E2E-TODO-N1'];
  await sql`delete from sales_src_rows where src_id = any(${ids})`;
  await put('global', 'building_sales_pipeline', { id: ids[0], name: 'E2E 할일 단지 A', household_count: 500, region: '경기', first_seen_at: ymd(0) });
  await put('global', 'building_sales_pipeline', { id: ids[1], name: 'E2E 할일 단지 B', household_count: 600, region: '경기', first_seen_at: ymd(0) });
  await put('global', 'procurement_notices', { id: ids[2], title: 'E2E 계약 종료 예정 운영', issuer: '용인시', region: '경기', related: true, first_seen_at: ymd(-10), status: '낙찰', winner_name: 'E2E 타사', contract_end_date: ymd(45) });
  await sql`insert into app_settings (key, value) values ('sales_migrate_applied', ${sql.json({ tenant: 'default', at: new Date().toISOString(), daily: true })}) on conflict (key) do nothing`;
  await sql`insert into sales_cutover (tenant, writes_open, ok) values ('default', true, true) on conflict (tenant) do update set writes_open = true, ok = true`;
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // 허브 일괄: 단지 2건 체크 → [영업 진행으로] → 업무 2건
  await owner.goto(`${BASE}/s/sales/hub?tab=buildings`);
  await owner.getByLabel('E2E 할일 단지 A 선택').check();
  await owner.getByLabel('E2E 할일 단지 B 선택').check();
  await owner.getByTestId('sales-bulk').getByText('2건 선택').waitFor();
  await owner.getByTestId('sales-bulk').locator('input[type=date]').fill(ymd(-1));
  await owner.getByTestId('sales-bulk-go').click();
  await owner.getByText(/업무 2건 만들었습니다/).waitFor();
  const tasks = await sql`select id, title, due_date::text as due from tasks where sales_ref->>'kind' = 'building' and sales_ref->>'id' = any(${ids}) and deleted_at is null`;
  assert.equal(tasks.length, 2); assert.ok(tasks.every((t) => t.title.startsWith('[영업] E2E 할일 단지')));
  // 홈: 오늘 할 일 묶음(지난 영업 업무·입찰·신규단지 후속에 들어감) + 타일 + 진행표
  await owner.goto(`${BASE}/s/sales`);
  const todo = owner.getByTestId('sales-todo'); await todo.waitFor();
  await todo.getByTestId('sales-todo-pastTasks').locator('button').click(); // 칸이 그리드 행 높이만큼 늘어나 칸 가운데는 빈 공간
  await todo.getByText('[영업] E2E 할일 단지 A').first().waitFor();
  await todo.getByTestId('sales-todo-followUp').locator('button').click();
  await todo.getByTestId('sales-todo-followUp').getByText('E2E 할일 단지 A').waitFor();
  await owner.getByTestId('sales-tiles').getByText('계약만료·재입찰').waitFor();
  await owner.getByTestId('sales-progress').getByText('신규단지').waitFor();
  await owner.screenshot({ path: `${SHOTS}/157-sales-home-todo.png`, fullPage: true });
  // 업무 화면 '영업' 공간 필터 + 원천 배지
  await owner.goto(`${BASE}/tasks?space=sales`);
  const row = owner.getByTestId('row-title').filter({ hasText: 'E2E 할일 단지 A' }).first();
  await row.waitFor();
  assert.equal(await row.getByTestId('row-sales-ref').innerText(), '신규단지');
  // 계약만료·재입찰
  await owner.goto(`${BASE}/s/sales/contracts`);
  await owner.getByTestId('contracts-item').filter({ hasText: 'E2E 계약 종료 예정 운영' }).waitFor();
  assert.match(await owner.getByTestId('contracts-item').filter({ hasText: 'E2E 계약 종료' }).innerText(), /재입찰|제안/);
  await owner.screenshot({ path: `${SHOTS}/158-sales-contracts.png` });
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/sales`);
  await owner.getByTestId('sales-todo').waitFor();
  await owner.screenshot({ path: `${SHOTS}/157-sales-home-todo-390.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
  // #408 업종 템플릿(대표 10/21 영업 재편 6): 데이터 설정에서 템플릿 → 허브 탭·업무 원천 배지 용어가 바뀜 → 되돌림
  await owner.goto(`${BASE}/s/sales/sources`);
  const tpl = owner.getByTestId('sales-template'); await tpl.waitFor();
  assert.match(await tpl.getByTestId('sales-template-state').innerText(), /시설 운영·위탁/);
  // 저장 뒤 600ms 에 화면이 새로고침(세션 용어 갱신) → 그 이동이 끝난 뒤에 다음으로(아니면 goto 가 ERR_ABORTED)
  await Promise.all([owner.waitForNavigation({ waitUntil: 'load' }), tpl.getByTestId('sales-template-it').click()]);
  await owner.getByTestId('sales-template').getByTestId('sales-template-state').filter({ hasText: 'IT·소프트웨어' }).waitFor();
  await owner.screenshot({ path: `${SHOTS}/180-sales-template.png` });
  await owner.goto(`${BASE}/s/sales/hub`);
  await owner.getByTestId('sales-hub-buildings').filter({ hasText: '신규 프로젝트' }).waitFor();
  await owner.goto(`${BASE}/tasks?space=sales`);
  assert.equal(await owner.getByTestId('row-title').filter({ hasText: 'E2E 할일 단지 A' }).first().getByTestId('row-sales-ref').innerText(), '신규 프로젝트');
  await owner.goto(`${BASE}/s/sales/sources`);
  await Promise.all([owner.waitForNavigation({ waitUntil: 'load' }), owner.getByTestId('sales-template-facility').click()]);
  await owner.getByTestId('sales-template').getByTestId('sales-template-state').filter({ hasText: '시설 운영·위탁' }).waitFor();
}
