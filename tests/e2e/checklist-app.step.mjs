// 대표 검수 10/20(체크리스트, 휴대폰 360): 항목별 '미팅 일정 만들기' 버튼 없음 · 담당 1명이면 항목 담당 칩 숨김 + 새 항목은 그 담당자 몫 · 담당 여럿(함께 하는 사람)이면 항목 담당 선택 노출 · (?) 안내 탭으로 열림·화면 안 · 긴 항목 글자 잘림 없음(가로 넘침 0)
import assert from 'node:assert/strict';

export async function checklistAppFlow({ browser, desk, ctx, sql, BASE, SHOTS }) {
  const one = (await ctx.owner.ok('POST', '/api/tasks', { title: '체크리스트 담당 1명', orgUnitId: ctx.siteA, assigneeId: ctx.ownerId, approvalRequired: false })).id;
  await ctx.owner.ok('POST', `/api/tasks/${one}/checklist`, { text: '현장 미팅 전에 견적서·제안서·비교표를 모두 출력해서 가져가기 (관리사무소 소장님께 드릴 사본 포함)' });
  const many = (await ctx.owner.ok('POST', '/api/tasks', { title: '체크리스트 담당 여럿', orgUnitId: ctx.siteA, assigneeId: ctx.ownerId, collaboratorIds: [ctx.staffA.id], approvalRequired: false })).id;
  await ctx.owner.ok('POST', `/api/tasks/${many}/checklist`, { text: '자료 모으기', assigneeId: ctx.staffA.id });
  const m = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  try {
    const p = await m.newPage();
    await p.goto(`${BASE}/tasks/${one}`);
    const list = p.getByTestId('checklist'); await list.waitFor();
    assert.equal(await p.getByTestId('checklist-meeting').count(), 0, '항목별 미팅 일정 버튼 없음');
    assert.equal(await list.getByRole('combobox').count(), 0, '담당 1명 → 항목 담당 선택 없음');
    assert.equal(await p.getByLabel('새 항목 담당').count(), 0);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, '360 가로 넘침 없음');
    // 새 항목 → 업무 담당자 몫으로 자동
    await p.getByLabel('체크리스트 항목 추가').fill('계약서 초안');
    await p.getByLabel('체크리스트 항목 추가').press('Enter');
    await list.getByRole('checkbox', { name: '계약서 초안' }).waitFor();
    const [row] = await sql`select assignee_id from task_checklist_items where task_id = ${one} and text = '계약서 초안'`;
    assert.equal(row.assignee_id, ctx.ownerId, '담당 1명이면 새 항목은 그 담당자');
    // (?) 안내: 탭으로 열림, 화면 안
    await p.getByTestId('help-checklist').tap();
    const note = p.getByRole('note').filter({ hasText: '따라갈 단계' }); await note.waitFor();
    const nb = await note.boundingBox();
    assert.ok(nb.x >= 0 && nb.x + nb.width <= 360, `안내가 화면 안 (${nb.x}~${nb.x + nb.width})`);
    await p.screenshot({ path: `${SHOTS}/141-checklist-360.png`, fullPage: true });
    // 담당 여럿 → 항목 담당 선택·새 항목 담당 노출
    await p.goto(`${BASE}/tasks/${many}`);
    await p.getByTestId('checklist').waitFor();
    await p.getByLabel('자료 모으기 담당').waitFor();
    assert.equal(await p.getByLabel('새 항목 담당').count(), 1);
    assert.equal(await p.getByTestId('checklist-meeting').count(), 0);
  } finally {
    await m.close().catch(() => {});
  }
}
