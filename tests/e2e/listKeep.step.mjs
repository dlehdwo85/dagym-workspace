// #242 대표 10/24 '내 업무에서 업무를 보고 있다가 업무 클릭 후 창을 끄면 전체 업무 시트로 돌아갑니다 — 창 닫기나 돌아가기를 눌렀을 때 다른 화면으로 넘어가지 않게':
// '내 업무'·검색어를 정하고 목록을 내린 뒤 업무를 열고(패널) 닫기 단추·Esc·뒤로가기 → 같은 거르기·검색어·위치(주소에 view·q) · 새로 고침에도 그대로
// · 패널의 [전체 화면] → 상세 [닫기] = 직전 화면(패널) → 패널 닫기 = 같은 목록 · 링크로 바로 연 상세의 [닫기] = 업무 목록 · 휴대폰 390폭(상세가 목록을 덮음)도 같음
import assert from 'node:assert/strict';

export async function listKeep({ owner, ctx, BASE, SHOTS }) {
  const ids = [];
  for (let i = 1; i <= 24; i++) ids.push((await ctx.owner.ok('POST', '/api/tasks', { title: `E2E 목록유지 ${String(i).padStart(2, '0')}`, assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, approvalRequired: false })).id);
  await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 목록유지 남의 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false });
  const Q = 'E2E 목록유지';
  const chip = () => owner.getByTestId('view-chips').getByRole('button', { name: '내 업무', exact: true });
  const search = () => owner.getByLabel('업무 검색');
  const panel = owner.getByTestId('task-panel');
  const last = () => owner.locator('[data-task-id]:visible').filter({ hasText: /^E2E 목록유지 \d+/ }).last();
  const openLast = async () => {
    await last().getByText(/^E2E 목록유지 \d+$/).first().click(); // 줄 가운데는 마감일·팀 칩일 수 있어 제목을 누름
    await panel.waitFor();
    await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  };
  const scrollY = () => owner.evaluate(() => Math.round(window.scrollY));
  /** 목록 주소·'내 업무'·검색어·남의 업무 숨김이 그대로인지 */
  const kept = async (how) => {
    await owner.waitForURL((u) => u.pathname === '/tasks');
    await owner.waitForFunction((q) => { const p = new URLSearchParams(location.search); return p.get('view') === 'my' && p.get('q') === q; }, Q);
    assert.equal(await chip().getAttribute('aria-pressed'), 'true', `${how}: '내 업무' 그대로`);
    assert.equal(await search().inputValue(), Q, `${how}: 검색어 그대로`);
    await owner.getByText('E2E 목록유지 24').first().waitFor();
    assert.ok((await owner.getByText('E2E 목록유지 남의 업무').count()) >= 1, `${how}: 348차 검색 중엔 보기와 상관없이 전체에서(남의 업무도)`);
  };

  // PC: 패널이 목록 옆에 열림
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/tasks?mode=list`);
  // 357차: 전체 실행(업무가 수백 건)에서는 목록이 뜨기 전(화면 준비 전)에 누른 칩이 먹지 않아 30초 기다리다 실패 — 목록이 뜬 뒤 누르고, 안 먹었으면 다시 누름(눌린 상태면 안 누름)
  await owner.locator('[data-task-id]').first().waitFor({ timeout: 60_000 });
  for (let k = 0; ; k++) {
    if ((await chip().getAttribute('aria-pressed')) !== 'true') await chip().click();
    const on = await owner.waitForFunction(() => new URLSearchParams(location.search).get('view') === 'my', null, { timeout: 8000 }).then(() => true, () => false);
    if (on) break;
    if (k >= 3) throw new Error("'내 업무' 칩을 눌러도 주소에 view=my 가 붙지 않음");
  }
  // CI 1924: 칩 누름과 검색어 입력의 주소 반영이 겹치면 한쪽이 덮여 30초 기다리다 실패 — 사람처럼 칩 반영을 보고 나서 입력
  await search().fill(Q);
  await owner.waitForFunction((q) => { const p = new URLSearchParams(location.search); return p.get('view') === 'my' && p.get('q') === q; }, Q);
  await owner.getByText('E2E 목록유지 24').first().waitFor();
  // 348차(대표 11/03 '아름베스트빌 검색해도 안 나옴'): 검색 중엔 '내 업무' 칩이 눌려 있어도 전체에서 찾음(주소의 view·q 는 그대로 남아 닫으면 같은 화면)
  await owner.getByText('E2E 목록유지 남의 업무').first().waitFor();
  await last().scrollIntoViewIfNeeded();
  const y0 = await scrollY();
  assert.ok(y0 > 100, `목록을 내림(${y0})`);
  for (const how of ['닫기 단추', 'Esc', '뒤로가기']) {
    await openLast();
    if (how === '닫기 단추') await panel.getByRole('button', { name: '패널 닫기' }).click();
    else if (how === 'Esc') await owner.keyboard.press('Escape');
    else await owner.goBack();
    await panel.waitFor({ state: 'detached' });
    await kept(how);
    await owner.waitForTimeout(400);
    const y = await scrollY();
    assert.ok(Math.abs(y - y0) <= 4, `${how} 뒤 스크롤 위치 그대로(${y0} → ${y})`);
  }
  await owner.screenshot({ path: `${SHOTS}/252-tasks-list-keep.png` });
  await owner.reload();
  await kept('새로 고침');
  // 300차 #850: 패널 [크게 보기(새 탭)] = 새 탭에 전체 화면 · 이 탭의 목록·패널은 그대로 → 패널 닫기 = 같은 목록
  await openLast();
  const [pop] = await Promise.all([owner.context().waitForEvent('page'), panel.getByTestId('task-open-tab').click()]);
  await pop.getByTestId('task-page').waitFor();
  await pop.screenshot({ path: `${SHOTS}/253-task-page-close.png` });
  await pop.close();
  await panel.getByRole('button', { name: '패널 닫기' }).click();
  await panel.waitFor({ state: 'detached' });
  await kept('크게 보기(새 탭) → 패널 닫기');
  // 패널에서 대화방으로 갔다 뒤로가기 → 그 업무(패널 또는 전체 화면) → 닫기 = 같은 목록
  await openLast();
  await panel.getByRole('button', { name: '대화방 열기' }).click();
  await owner.waitForURL((u) => u.pathname === '/messages');
  await owner.goBack();
  const page = owner.getByTestId('task-page');
  await panel.or(page).first().waitFor();
  const back = (await panel.isVisible()) ? '패널' : '전체 화면';
  console.log(`   (대화방 → 뒤로가기: 그 업무가 ${back}으로 다시 열림)`);
  if (back === '패널') {
    assert.equal(await chip().getAttribute('aria-pressed'), 'true', '패널 뒤 목록도 내 업무');
    await panel.getByRole('button', { name: '패널 닫기' }).click();
    await panel.waitFor({ state: 'detached' });
  } else await page.getByTestId('task-page-close').click();
  await kept('대화방 → 뒤로가기 → 닫기');
  // 링크(알림·새 탭)로 바로 연 상세의 [닫기] = 업무 목록(기본)
  await owner.goto(`${BASE}/tasks/${ids[0]}`);
  await owner.getByTestId('task-page').waitFor();
  await owner.getByTestId('task-page-close').click();
  await owner.waitForURL((u) => u.pathname === '/tasks');
  await owner.getByTestId('view-chips').waitFor();
  assert.equal(new URL(owner.url()).searchParams.get('view'), null, '바로 연 상세의 닫기는 기본 목록');

  // 휴대폰 390: 상세가 목록을 덮음 — 뒤로가기·닫기 단추 모두 같은 거르기·같은 위치
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/tasks?mode=list&view=my&q=${encodeURIComponent(Q)}`);
  await kept('휴대폰 주소로 열기');
  await last().scrollIntoViewIfNeeded();
  const m0 = await scrollY();
  assert.ok(m0 > 300, `휴대폰 목록을 충분히 내림(${m0})`);
  for (const how of ['뒤로가기', '닫기 단추']) {
    await openLast();
    if (how === '뒤로가기') await owner.goBack(); else await panel.getByRole('button', { name: '패널 닫기' }).click();
    await panel.waitFor({ state: 'detached' });
    await kept(`휴대폰 ${how}`);
    await owner.waitForTimeout(400);
    const y = await scrollY();
    assert.ok(Math.abs(y - m0) <= 4, `휴대폰 ${how} 뒤 스크롤 위치 그대로(${m0} → ${y})`);
  }
  await owner.setViewportSize({ width: 1366, height: 900 });
}
