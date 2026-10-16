// V37 8 미팅 일정: 업무 상세 [📍 미팅 일정 만들기] → 장소·시각 → 목록 행에 📍장소·시간 칩, 캘린더 일정에 장소
// + 등록 창 제목에 "방문" → "미팅 일정도 만들까요?" 장소 넣고 저장 → 업무와 연결된 일정
import assert from 'node:assert/strict';
export async function meeting({ owner, ctx, sql, BASE }) {
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 고객사 미팅', assigneeId: ctx.ownerId, approvalRequired: false })).id;
  await owner.goto(`${BASE}/tasks/${id}`);
  await owner.getByTestId('meeting-open').click();
  const dlg = owner.getByTestId('meeting-dialog');
  await dlg.getByTestId('meeting-location').fill('강남역 3번 출구 카페');
  await dlg.getByTestId('meeting-start').fill('15:00');
  await dlg.getByTestId('meeting-save').click();
  await owner.getByText('미팅 일정을 만들었습니다').first().waitFor();
  await owner.getByTestId('linked-events').waitFor();
  const [e] = await sql`select e.location from event_tasks et join events e on e.id = et.event_id where et.task_id = ${id}`;
  assert.equal(e.location, '강남역 3번 출구 카페');
  await owner.goto(`${BASE}/tasks?view=my`);
  const chip = owner.locator(`[data-row="${id}"]`).getByTestId('meeting-chip').filter({ visible: true });
  await chip.waitFor();
  assert.match(await chip.textContent(), /강남역 3번 출구 카페.*15:00/);
  // 등록 창: 제목에 "방문" → 미팅 일정 제안
  await owner.getByTestId('add-task-top').click();
  await owner.getByPlaceholder('무엇을 해야 하나요?').fill('E2E 판교 현장 방문');
  const q = owner.getByTestId('quick-meeting');
  await q.waitFor();
  await q.getByTestId('quick-meeting-location').fill('판교 테크노밸리');
  await owner.getByRole('dialog', { name: '업무 등록' }).getByRole('button', { name: /^(저장|등록|만들기)/ }).first().click();
  await owner.getByText(/업무를 등록했습니다/).first().waitFor();
  for (let i = 0; i < 30; i++) { if ((await sql`select 1 from tasks t join event_tasks et on et.task_id = t.id join events e on e.id = et.event_id where t.title = 'E2E 판교 현장 방문' and e.location = '판교 테크노밸리'`).length) return; await new Promise((r) => setTimeout(r, 200)); }
  assert.fail('등록 창 미팅 일정이 연결되지 않음');
}
