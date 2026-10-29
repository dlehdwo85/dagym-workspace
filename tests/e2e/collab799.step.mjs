// 대표 #799(10/29 19:10 "담당자가 2명 이상 협업해야 할 업무는 개인 업무 위에 협업 업무로"): 이직원(휴대폰) 내 업무 맨 위 '협업 업무' 칸 —
// 함께 담당 1건(박직원 내 몫 완료)·같이 받은 묶음 1건(박직원 진행 중) · 줄마다 함께하는 사람·진행 · 아래 개인 업무 묶음에는 안 나옴 · 접으면 새로 고침에도 접힘 · 홈 맨 위 협업 업무 카드
import assert from 'node:assert/strict';

export async function collab799({ staff, ctx, sql, BASE, SHOTS }) {
  const o = ctx.owner; const b = ctx.staffB.client;
  const co = (await o.ok('POST', '/api/tasks', { title: 'E2E 협업 입찰 서류', orgUnitId: ctx.hq, assigneeId: ctx.staffA.id, coAssigneeIds: [ctx.staffB.id], approvalRequired: false })).id;
  const r = await o.ok('POST', '/api/tasks', { title: 'E2E 각자 협업 점검', orgUnitId: ctx.hq, assigneeIds: [ctx.staffA.id, ctx.staffB.id], approvalRequired: false });
  const rows = await sql`select id, assignee_id from tasks where id = any(${r.ids}::uuid[])`;
  const bA = rows.find((x) => x.assignee_id === ctx.staffA.id).id, bB = rows.find((x) => x.assignee_id === ctx.staffB.id).id;
  const solo = (await o.ok('POST', '/api/tasks', { title: 'E2E 개인 업무 799', orgUnitId: ctx.hq, assigneeId: ctx.staffA.id, approvalRequired: false })).id;
  await b.ok('PATCH', `/api/tasks/${co}`, { status: 'done' }); // 박직원 내 몫 완료(업무는 이직원 몫이 남아 그대로)
  await b.ok('PATCH', `/api/tasks/${bB}`, { status: 'in_progress' });
  await staff.goto(`${BASE}/tasks?view=my`);
  const box = staff.getByTestId('my-collab');
  await box.waitFor();
  const n = Number(await box.getByTestId('my-collab-count').innerText()); // 앞 단계가 만든 함께 담당 업무도 있을 수 있음
  assert.ok(n >= 2, `협업 업무 ${n}`);
  const txt = await box.innerText();
  assert.match(txt, /E2E 협업 입찰 서류[\s\S]*박직원\s*내 몫 완료/); assert.match(txt, /E2E 각자 협업 점검[\s\S]*박직원\s*진행 중/);
  // 아래 개인 업무 묶음에는 협업 업무가 다시 안 나오고, 개인 업무는 그대로
  const personal = await staff.locator('[data-testid="my-groups"] > section:not([data-group="collab"])').allInnerTexts();
  assert.ok(personal.join('\n').includes('E2E 개인 업무 799'), '개인 업무는 아래 묶음에');
  assert.ok(!personal.join('\n').includes('E2E 협업 입찰 서류') && !personal.join('\n').includes('E2E 각자 협업 점검'), '협업 업무가 개인 칸에 또 나오지 않음');
  assert.ok(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '가로 넘침 없음');
  await box.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await staff.screenshot({ path: `${SHOTS}/268-collab-my.png` });
  // 접기 → 새로 고침에도 접힘(사람별 기억) → 다시 펼침
  await staff.getByTestId('my-collab-toggle').click();
  assert.equal(await box.getByTestId('collab-row').count(), 0);
  await staff.reload(); await staff.getByTestId('my-collab').waitFor();
  assert.equal(await staff.getByTestId('collab-row').count(), 0, '접은 채');
  await staff.getByTestId('my-collab-toggle').click();
  assert.equal(await staff.getByTestId('collab-row').count(), Math.min(n, 5), '5건까지(넘으면 더 보기)');
  // 홈 맨 위 협업 업무 카드
  await staff.goto(`${BASE}/`);
  const home = staff.getByTestId('home-collab');
  await home.waitFor();
  assert.equal(await home.getByTestId('home-collab-row').count(), Math.min(n, 5));
  assert.match(await home.innerText(), /박직원\s*내 몫 완료/);
  await home.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await staff.screenshot({ path: `${SHOTS}/268-collab-home.png` });
  for (const id of [co, bA, bB, solo]) await o.ok('DELETE', `/api/tasks/${id}`);
}
