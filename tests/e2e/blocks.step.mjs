// 대표 지시(2026-10-15): 완료·삭제된 업무는 캘린더에서 안 보이게 — 업무 시간 블록 포함, 휴지통 복원 시 다시 보임
import assert from 'node:assert/strict';
export async function blocksStep({ owner, ctx, BASE, SHOTS, addDays, today }) {
  const d = addDays(today, 9);
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'personal').id;
  const mk = async (title, hh) => {
    const id = (await ctx.owner.ok('POST', '/api/tasks', { title, assigneeId: ctx.ownerId, approvalRequired: false })).id; // 마감 없음 → 블록만 캘린더에
    await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title, start: `${d}T${hh}:00:00+09:00`, end: `${d}T${hh}:59:00+09:00`, taskId: id, kind: 'task_block' });
    return id;
  };
  const done = await mk('블록 완료 시험', '09'), del = await mk('블록 삭제 시험', '13');
  const block = (t) => owner.locator('[data-ev-block]', { hasText: t });
  await owner.goto(`${BASE}/calendar?date=${d}&view=timeGridWeek`);
  await block('블록 완료 시험').first().waitFor();
  await block('블록 삭제 시험').first().waitFor();
  // 완료 → 사라짐, "완료 보기" 켜면 흐리게 보임
  await ctx.owner.ok('PATCH', `/api/tasks/${done}`, { status: 'done' });
  await owner.reload();
  await block('블록 삭제 시험').first().waitFor();
  assert.equal(await block('블록 완료 시험').count(), 0, '완료된 업무의 시간 블록은 숨김');
  await owner.getByText('완료 보기', { exact: true }).first().click();
  await block('블록 완료 시험').first().waitFor();
  assert.equal(await block('블록 완료 시험').first().getAttribute('data-done'), '1', '완료 보기 켜면 완료 모양');
  await owner.getByText('완료 보기', { exact: true }).first().click();
  await block('블록 완료 시험').first().waitFor({ state: 'detached' });
  // 삭제 → 블록도 사라짐(완료 보기와 무관), 휴지통 복원 → 다시 보임
  await ctx.owner.ok('DELETE', `/api/tasks/${del}`);
  await owner.reload();
  await owner.locator('.fc-toolbar-title').waitFor();
  await owner.waitForLoadState('networkidle');
  assert.equal(await block('블록 삭제 시험').count(), 0, '삭제된 업무의 시간 블록은 사라짐');
  await ctx.owner.ok('POST', `/api/tasks/${del}/restore`);
  await owner.reload();
  await block('블록 삭제 시험').first().waitFor();
  await owner.screenshot({ path: `${SHOTS}/calendar-blocks-done-deleted.png` });
}
