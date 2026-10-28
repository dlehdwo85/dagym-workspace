// #535 대표 10/24 08:05 '승인 대기 상세를 보고 뒤로가기 → 마케팅 홈': 상세를 열면 ?c=<id> 가 방문 기록에 남고 뒤로가기는 상세만 닫음(승인함 그대로)
// · 닫기 단추 = 남긴 기록을 되돌림(뒤로가기 두 번 필요 없음) · 링크로 바로 연 상세의 닫기 = ?c 만 지움 · 콘텐츠 캘린더(주 보기) 상세도 같음 — 휴대폰 390폭
import assert from 'node:assert/strict';

export async function backClose({ owner, ctx, BASE }) {
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  const brandId = (await ctx.owner.ok('POST', '/api/marketing/brands', { name: 'E2E 뒤로가기 브랜드' })).id;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const a = await ctx.owner.ok('POST', '/api/marketing/contents', { title: 'E2E 뒤로가기 승인 글', channel: 'facebook', brandId, body: '뒤로가기 시험 본문', mediaIds: [], scheduledAt: new Date(Date.now() + 26 * 3600e3).toISOString() });
  const b = await ctx.owner.ok('POST', '/api/marketing/contents', { title: 'E2E 뒤로가기 캘린더 글', channel: 'facebook', brandId, body: '캘린더 시험 본문', mediaIds: [], scheduledAt: `${today}T12:00:00+09:00` });
  const path = () => new URL(owner.url()).pathname;
  const param = () => new URL(owner.url()).searchParams.get('c');
  const detail = owner.getByTestId('mkt-detail');

  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/s/marketing`); // 대표 순서: 마케팅 홈 → 승인함 → 상세 → 뒤로가기
  await owner.goto(`${BASE}/s/marketing/approvals`);
  const row = () => owner.getByTestId('approval-card').filter({ hasText: 'E2E 뒤로가기 승인 글' }).getByTestId('mkt-row');
  await row().click();
  await detail.waitFor();
  assert.equal(param(), a.id, '열면 ?c=<id> 기록');
  await owner.goBack();
  await detail.waitFor({ state: 'hidden' });
  assert.deepEqual([path(), param()], ['/s/marketing/approvals', null], '뒤로가기 = 상세만 닫힘(승인함 그대로)');
  await owner.getByTestId('mkt-approvals').waitFor();
  // 닫기 단추: 남긴 기록을 되돌림 → 다음 뒤로가기는 바로 마케팅 홈
  await row().click();
  await detail.waitFor();
  await owner.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
  await detail.waitFor({ state: 'hidden' });
  await owner.waitForFunction(() => !new URL(location.href).searchParams.has('c'));
  assert.equal(path(), '/s/marketing/approvals');
  await owner.goBack();
  await owner.waitForURL((u) => u.pathname === '/s/marketing');
  // 링크로 바로 연 상세(알림 등): 닫기 = ?c 만 지우고 승인함에 남음
  await owner.goto(`${BASE}/s/marketing/approvals?c=${a.id}`);
  await detail.waitFor();
  await owner.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
  await detail.waitFor({ state: 'hidden' });
  await owner.waitForFunction(() => !new URL(location.href).searchParams.has('c'));
  assert.equal(path(), '/s/marketing/approvals');
  // 콘텐츠 캘린더(주 보기) 상세도 같음
  await owner.goto(`${BASE}/s/marketing/calendar`);
  await owner.getByTestId('mkt-week-card').filter({ hasText: 'E2E 뒤로가기 캘린더 글' }).first().locator('button').first().click();
  await detail.waitFor();
  assert.equal(param(), b.id);
  await owner.goBack();
  await detail.waitFor({ state: 'hidden' });
  assert.deepEqual([path(), param()], ['/s/marketing/calendar', null], '캘린더도 뒤로가기 = 상세만 닫힘');
  // 로컬 08:23: 목록을 내린 뒤 상세를 열고 닫으면(뒤로가기·닫기 단추) 승인함이 맨 위로 돌아가던 것 → 연 자리 그대로
  for (let i = 1; i <= 6; i++) await ctx.owner.ok('POST', '/api/marketing/contents', { title: `E2E 뒤로가기 스크롤 글 ${i}`, channel: 'facebook', brandId, body: '스크롤 시험 본문', mediaIds: [], scheduledAt: new Date(Date.now() + (30 + i) * 3600e3).toISOString() });
  await owner.goto(`${BASE}/s/marketing`); // 대표 순서: 마케팅 홈 → 아래 탭 '승인 대기'(화면 안 이동)
  await owner.locator('a[href="/s/marketing/approvals"]:visible').first().click();
  await owner.waitForURL((u) => u.pathname === '/s/marketing/approvals');
  const far = () => owner.getByTestId('approval-card').filter({ hasText: 'E2E 뒤로가기 스크롤 글' }).last().getByTestId('mkt-row');
  await far().scrollIntoViewIfNeeded();
  const y0 = await owner.evaluate(() => Math.round(window.scrollY));
  assert.ok(y0 > 300, `목록을 충분히 내림(${y0})`);
  // 233차(CI 1603): 스크롤 값이 아니라 누른 카드가 화면에서 같은 자리인지 — 위쪽 묶음(수정 요청·지난 기록)이 늦게 늘면 브라우저가 화면을 지키려 스크롤 값을 늘림(4574 → 4670)
  const top = async () => Math.round((await far().boundingBox()).y);
  const top0 = await top();
  for (const how of ['back', 'button']) {
    await far().click();
    await detail.waitFor();
    if (how === 'back') await owner.goBack(); else await owner.getByRole('dialog').getByRole('button', { name: '닫기' }).click();
    await detail.waitFor({ state: 'hidden' });
    await owner.waitForTimeout(400);
    const t = await top(); const y = await owner.evaluate(() => Math.round(window.scrollY));
    assert.ok(Math.abs(t - top0) <= 4 && y > 300, `${how === 'back' ? '뒤로가기' : '닫기 단추'} 뒤 연 카드가 화면 같은 자리(화면 위에서 ${top0} → ${t} · 스크롤 ${y0} → ${y})`);
  }
  // 업무 목록(휴대폰은 상세가 목록을 덮음)도 같음: 아래 업무를 열고 뒤로가기 → 연 자리
  for (let i = 1; i <= 16; i++) await ctx.owner.ok('POST', '/api/tasks', { title: `E2E 뒤로가기 업무 ${String(i).padStart(2, '0')}`, assigneeId: ctx.ownerId, approvalRequired: false });
  await owner.goto(`${BASE}/tasks`);
  const lastTask = () => owner.locator('[data-task-id]:visible').filter({ hasText: 'E2E 뒤로가기 업무' }).last();
  await lastTask().scrollIntoViewIfNeeded();
  const t0 = await owner.evaluate(() => Math.round(window.scrollY));
  assert.ok(t0 > 300, `업무 목록을 충분히 내림(${t0})`);
  await lastTask().getByText(/^E2E 뒤로가기 업무 \d+$/).first().click(); // 줄 가운데는 마감일·팀 칩일 수 있어 제목을 누름
  await owner.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  await owner.goBack();
  await owner.waitForURL((u) => u.pathname === '/tasks');
  await owner.waitForTimeout(400);
  const t1 = await owner.evaluate(() => Math.round(window.scrollY));
  assert.ok(Math.abs(t1 - t0) <= 4, `업무 상세 뒤로가기 뒤 목록 위치 그대로(${t0} → ${t1})`);
  await owner.setViewportSize({ width: 1366, height: 900 });
}
