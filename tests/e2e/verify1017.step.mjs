// 로컬 검수(10/17) 고친 것: 홈 "최근 활동" 멘션은 @이름(내부 id 안 보임) · 캘린더 월 보기 요일 머리 글자 ·
// 휴대폰 일정 등록 시트 [완료/닫기] 화면 안 · 휴대폰 업무 목록 둘째 줄 한 줄(댓글 수·프로젝트 숨김)
import assert from 'node:assert/strict';
export async function verify1017({ owner, staff, ctx, sql, BASE }) {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '검수 10/17 멘션 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false })).id;
  await ctx.owner.ok('POST', `/api/tasks/${id}/comments`, { body: `다음주 월요일 연락주신다 함 @[이직원](${ctx.staffA.id})` });
  // 로컬 10/19(대표 확정): 홈 '최근 활동' 카드 → 알림 화면 '활동' 탭
  await owner.goto(`${BASE}/notifications`);
  await owner.getByTestId('notif-activity').click();
  const act = owner.getByTestId('activity-list');
  await act.getByText('다음주 월요일 연락주신다 함').first().waitFor();
  const text = await act.textContent();
  assert.ok(!/@\[/.test(text) && !text.includes(ctx.staffA.id), '멘션 원문·id 안 보임');
  // 월 보기 요일 머리
  await owner.goto(`${BASE}/calendar?view=dayGridMonth`);
  await owner.locator('.fc-dayGridMonth-view').waitFor();
  const heads = await owner.locator('.fc-col-header-cell').allTextContents();
  assert.equal(heads.map((h) => h.trim()).join(''), '일월화수목금토', `요일 머리: ${heads.join('|')}`);
  // 휴대폰 일정 등록 시트: [닫기] 버튼이 화면 안
  await staff.goto(`${BASE}/calendar?new=1`);
  const close = staff.getByTestId('editor-close');
  await close.waitFor();
  const b = await close.boundingBox(); const vh = staff.viewportSize().height;
  assert.ok(b && b.y + b.height <= vh, `닫기 버튼 화면 안 (y=${b?.y}, 화면 ${vh})`);
  await close.tap();
  // 휴대폰 업무 목록 둘째 줄 한 줄: 댓글 수 숨김
  await staff.goto(`${BASE}/tasks?view=my`);
  const row = staff.locator(`[data-row="${id}"]`);
  await row.waitFor();
  assert.equal(await row.locator('[title="댓글"]').filter({ visible: true }).count(), 0, '휴대폰은 댓글 수 숨김');
  const title = await row.getByTestId('row-title').boundingBox();
  const rb = await row.boundingBox();
  assert.ok(rb.height <= title.height * 2 + 40, `두 줄 (행 ${rb.height}px)`);
}
