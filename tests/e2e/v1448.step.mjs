// V14 48: PC 업무 목록 — 맨 위 열 제목 줄은 스크롤해도 화면 위에 붙고, 둘째 묶음부터는 묶음마다 작은 열 제목
import assert from 'node:assert/strict';
export async function v1448({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 700 });
  await owner.goto(`${BASE}/tasks?mode=list`);
  const head = owner.getByTestId('list-header');
  await head.waitFor();
  const groups = owner.getByTestId('task-groups').locator('[data-group]');
  assert.ok((await groups.count()) >= 2, '묶음 2개 이상');
  assert.ok((await owner.getByTestId('group-col-header').count()) >= 1, '둘째 묶음부터 열 제목');
  const g = owner.getByTestId('group-col-header').first();
  for (const t of ['업무 이름', '우선순위', '상태', '마감일', '담당자']) assert.match(await g.innerText(), new RegExp(t));
  await owner.mouse.wheel(0, 900); await owner.waitForTimeout(300);
  const b = await head.boundingBox();
  assert.ok(b && b.y >= 50 && b.y <= 64, `스크롤해도 맨 위 열 제목이 머리 아래에 붙어 있음 (y=${b?.y})`);
  await owner.screenshot({ path: `${SHOTS}/v14-48-sticky-header.png` });
  await owner.setViewportSize({ width: 1366, height: 900 });
}
