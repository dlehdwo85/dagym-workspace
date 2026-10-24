// #242 2단계 대표 10/24 '창 닫기·돌아가기를 누르면 다른 화면으로 넘어가지 않게' — 업무 목록 밖 화면들:
// 알림 탭(?tab)·방금 읽은 줄 · 홈 월 캘린더(보던 달 ?hm·펼친 날 ?hd) · 프로젝트 보관함(?archived) · 영업 리드 정렬·우선·칩 · 영업기회 허브 탭 ·
// 마케팅 콘텐츠 캘린더 보던 주(?w) · 다른 화면에 갔다 뒤로가기로 돌아오면 같은 탭·같은 값·같은 스크롤 위치
import assert from 'node:assert/strict';

export async function backKeep({ owner, ctx, sql, BASE }) {
  const q = (k) => new URL(owner.url()).searchParams.get(k);
  const back = async (path) => { await owner.goBack(); await owner.waitForURL((u) => u.pathname === path); };
  /** 앱 안 이동(사이드바 '업무')으로 다른 화면에 감 — 뒤로가기로 오면 화면을 다시 그림(새로 불러온 문서가 아님) */
  const leave = async () => { await owner.locator('a[href="/tasks"]:visible, a[href^="/tasks?"]:visible').first().click(); await owner.waitForURL((u) => u.pathname === '/tasks'); };
  await owner.setViewportSize({ width: 1366, height: 900 });

  // 1) 알림: '전체' 탭에서 알림을 눌러 업무로 갔다 뒤로 → '전체' 그대로 · 아래쪽에서 눌렀으면 그 위치
  // 업무 화면을 열면 그 업무로 가는 알림은 모두 읽음이 됨(V32 0) → '안 읽음' 탭에서 누를 02번만 다른 업무로
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 돌아오기 알림 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  const t2 = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 돌아오기 알림 업무 2', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  for (let i = 1; i <= 40; i++) { const tid = i === 2 ? t2 : t; await sql`insert into notifications (user_id, type, title, link, entity_type, entity_id, dedupe_key, created_at)
    values (${ctx.ownerId}, 'due_soon', ${`E2E 돌아오기 알림 ${String(i).padStart(2, '0')}`}, ${`/tasks/${tid}`}, 'task', ${tid}, ${`e2e-back:${i}:${t}`}, now() - make_interval(mins => ${i}))`; }
  await owner.goto(`${BASE}/notifications`);
  await owner.getByTestId('notif-all').click();
  await owner.waitForFunction(() => new URLSearchParams(location.search).get('tab') === 'all');
  const row = (n) => owner.getByTestId('notif-item').filter({ hasText: `E2E 돌아오기 알림 ${n}` }).locator('a[href^="/tasks/"]').first();
  await row('30').scrollIntoViewIfNeeded();
  const y0 = await owner.evaluate(() => Math.round(window.scrollY));
  assert.ok(y0 > 300, `알림 목록을 내림(${y0})`);
  await row('30').click();
  await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  await back('/notifications');
  assert.equal(q('tab'), 'all');
  assert.equal(await owner.getByTestId('notif-all').getAttribute('aria-selected'), 'true', "알림: '전체' 탭 그대로");
  await row('30').waitFor();
  await owner.waitForTimeout(1200);
  // 누른 알림이 읽음이 되며 목록이 조금 짧아질 수 있음 → 보던 위치, 안 되면 갈 수 있는 가장 가까운 위치(맨 아래)
  const [y1, max] = await owner.evaluate(() => [Math.round(window.scrollY), document.documentElement.scrollHeight - window.innerHeight]);
  assert.ok(Math.abs(y1 - Math.min(y0, max)) <= 4, `알림: 돌아오면 보던 위치(${y0} → ${y1}, 끝 ${max})`);
  // '안 읽음' 탭에서 누른 알림(읽음 처리됨)은 돌아와도 목록에 흐리게 남음
  await owner.getByTestId('notif-unread').click();
  await owner.waitForFunction(() => !new URLSearchParams(location.search).has('tab'));
  await owner.evaluate(() => window.scrollTo(0, 0));
  await row('02').click();
  await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  await back('/notifications');
  await owner.getByTestId('notif-item').filter({ hasText: 'E2E 돌아오기 알림 02' }).and(owner.locator('[data-read="1"]')).waitFor();

  // 2) 홈 월 캘린더: 다음 달 → 15일 → 그날 업무를 열었다 뒤로 → 같은 달·같은 날 목록
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const [y, m] = today.split('-').map(Number);
  const nm = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 돌아오기 홈 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false, dueDate: `${nm}-15` });
  await owner.goto(`${BASE}/`);
  const home = owner.getByTestId('home-month');
  await home.getByLabel('다음 달').click();
  await owner.waitForFunction((v) => new URLSearchParams(location.search).get('hm') === v, nm);
  await home.locator(`[data-day="${nm}-15"]`).click();
  await owner.waitForFunction((v) => new URLSearchParams(location.search).get('hd') === v, `${nm}-15`);
  await owner.getByTestId('home-month-list').getByText('E2E 돌아오기 홈 업무').click();
  await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  await back('/');
  await owner.getByTestId('home-month-list').getByText('E2E 돌아오기 홈 업무').waitFor();
  assert.match(await home.locator('h2').innerText(), new RegExp(`${Number(nm.slice(5))}월`), '홈: 보던 달 그대로');

  // 3) 프로젝트 보관함 → 다른 화면 → 뒤로 = 보관함
  await owner.goto(`${BASE}/projects`);
  await owner.getByRole('button', { name: '보관함' }).click();
  await owner.waitForFunction(() => new URLSearchParams(location.search).get('archived') === '1');
  await owner.getByText('보관된 프로젝트').first().waitFor();
  await leave();
  await back('/projects');
  await owner.getByText('보관된 프로젝트').first().waitFor();

  // 4) 영업 리드: 정렬·우선·칩 → 다른 화면 → 뒤로 = 그대로 / 영업기회 허브 탭
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  await owner.goto(`${BASE}/s/sales/leads`);
  await owner.getByTestId('leads-sort').selectOption('name');
  await owner.getByTestId('leads-f-priority').selectOption({ index: 1 });
  const pri = await owner.getByTestId('leads-f-priority').inputValue();
  const chip = owner.getByTestId('leads-toolbar').locator('button[aria-pressed]').first();
  await chip.click();
  await owner.waitForFunction(() => { const p = new URLSearchParams(location.search); return p.get('sort') === 'name' && !!p.get('pri') && !!p.get('chips'); });
  const chips = q('chips');
  await leave();
  await back('/s/sales/leads');
  assert.equal(await owner.getByTestId('leads-sort').inputValue(), 'name', '리드: 정렬 그대로');
  assert.equal(await owner.getByTestId('leads-f-priority').inputValue(), pri, '리드: 우선순위 필터 그대로');
  assert.equal(q('chips'), chips);
  assert.equal(await chip.getAttribute('aria-pressed'), 'true', '리드: 칩 그대로');
  await owner.goto(`${BASE}/s/sales/hub`);
  await owner.getByTestId('sales-hub-facilities').click();
  await owner.waitForFunction(() => new URLSearchParams(location.search).get('tab') === 'facilities');
  await leave();
  await back('/s/sales/hub');
  await owner.waitForFunction(() => document.querySelector('[data-testid="sales-hub-facilities"]')?.className.includes('text-white'));

  // 5) 마케팅 콘텐츠 캘린더: 다음 주(또는 다음 달) → 다른 화면 → 뒤로 = 그 주(달)
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  await owner.goto(`${BASE}/s/marketing/calendar`);
  const label = owner.getByTestId('mkt-cal-label');
  await label.waitFor();
  const l0 = await label.innerText();
  await owner.getByRole('button', { name: /^다음 (주|달)$/ }).click();
  await owner.waitForFunction((v) => document.querySelector('[data-testid="mkt-cal-label"]')?.textContent !== v, l0);
  await owner.waitForFunction(() => { const p = new URLSearchParams(location.search); return p.has('w') || p.has('m'); });
  const l1 = await label.innerText();
  await leave();
  await back('/s/marketing/calendar');
  await owner.waitForFunction((v) => document.querySelector('[data-testid="mkt-cal-label"]')?.textContent === v, l1);
}
