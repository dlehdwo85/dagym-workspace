// 300차 #850(로컬 10/31 16:40 대표 요청 '업무는 어디서 눌러도 오른쪽 패널로'): 홈의 업무 링크 → 지금 화면 위 오른쪽 패널(주소 ?task=id)
// 뒤로가기·Esc·[패널 닫기] = 닫기(홈 그대로) · 패널 안 다른 업무 링크 = 내용만 바꿈 · [크게 보기(새 탭)] · 주소로 바로 들어와도 패널 · 휴대폰 = 전체 시트
import assert from 'node:assert/strict';

export async function taskPanel300({ owner, ctx, BASE }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const parent = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 패널 상위 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, dueDate: today, approvalRequired: false });
  const child = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 패널 하위 업무', assigneeId: ctx.ownerId, orgUnitId: ctx.siteA, parentId: parent.id, approvalRequired: false });
  const panel = owner.getByTestId('global-task-panel');
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    // 업무 전체 화면의 하위 업무 링크(Next 링크) → 그 화면 위 오른쪽 패널(주소 ?task=)
    await owner.goto(`${BASE}/tasks/${parent.id}`);
    await owner.getByTestId('task-page').waitFor();
    const link = owner.getByTestId('task-page').getByRole('link', { name: 'E2E 패널 하위 업무' });
    await link.click();
    await panel.waitFor();
    await panel.getByText('상위: E2E 패널 상위 업무').waitFor();
    let u = new URL(owner.url());
    assert.equal(u.pathname, `/tasks/${parent.id}`); assert.equal(u.searchParams.get('task'), child.id);
    // 뒤로가기 = 닫기(화면 그대로)
    await owner.goBack();
    await panel.waitFor({ state: 'detached' });
    u = new URL(owner.url()); assert.equal(u.pathname, `/tasks/${parent.id}`); assert.equal(u.searchParams.get('task'), null);
    await owner.getByTestId('task-page').waitFor();
    // Esc = 닫기
    await link.click(); await panel.waitFor();
    await owner.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    // 패널 안 '상위' 링크 = 내용만 바꿈(기록 한 칸) → 뒤로 한 번에 닫힘
    await link.click(); await panel.waitFor();
    await panel.getByRole('link', { name: '상위: E2E 패널 상위 업무' }).click();
    await owner.waitForURL((x) => new URL(x).searchParams.get('task') === parent.id);
    await panel.getByRole('link', { name: 'E2E 패널 하위 업무' }).waitFor();
    assert.equal(new URL(owner.url()).pathname, `/tasks/${parent.id}`);
    await owner.goBack();
    await panel.waitFor({ state: 'detached' });
    assert.equal(new URL(owner.url()).searchParams.get('task'), null, '내용을 바꿔도 뒤로 한 번에 닫힘');
    await link.click(); await panel.waitFor();
    // [크게 보기(새 탭)] = 새 탭에 전체 화면
    const [pop] = await Promise.all([owner.context().waitForEvent('page'), panel.getByTestId('task-open-tab').click()]);
    await pop.waitForLoadState();
    assert.equal(new URL(pop.url()).pathname, `/tasks/${child.id}`);
    await pop.getByTestId('task-page').waitFor();
    await pop.close();
    await panel.getByRole('button', { name: '패널 닫기' }).click();
    await panel.waitFor({ state: 'detached' });
    assert.equal(new URL(owner.url()).searchParams.get('task'), null);
    // 주소로 바로 들어와도 패널(알림 메일·새로 고침)
    await owner.goto(`${BASE}/calendar?task=${parent.id}`);
    await panel.waitFor();
    assert.equal(new URL(owner.url()).pathname, '/calendar');
    // 휴대폰 = 전체 시트(화면 폭 그대로)
    await owner.setViewportSize({ width: 390, height: 800 });
    await owner.waitForTimeout(200);
    const box = await panel.boundingBox();
    assert.ok(box && box.width >= 385 && box.x <= 1, `휴대폰 전체 시트 ${JSON.stringify(box)}`);
    assert.equal(await panel.getByTestId('task-open-tab').isVisible().catch(() => false), false, '휴대폰엔 크게 보기 없음');
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/`);
  }
}
