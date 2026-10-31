// 대표 #799(10/29 19:10) → 280차 #824·#826(10/31 '공동 업무'로 이름 · 접지 않음 · 같이 받은 사람 아래 줄 없이 한 줄 이름표): 이직원(휴대폰) 내 업무 맨 위 '공동 업무' 칸 —
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
  assert.ok(n >= 2, `공동 업무 ${n}`);
  assert.match(await box.locator('h2').innerText(), /^공동 업무/);
  const rowOf = (title) => box.getByTestId('collab-row').filter({ hasText: title });
  assert.equal(await rowOf('E2E 협업 입찰 서류').getByTestId('collab-person').innerText(), '✓ 박직원', '끝낸 사람은 ✓');
  assert.equal(await rowOf('E2E 각자 협업 점검').getByTestId('collab-person').getAttribute('data-state'), '진행 중');
  // 함께하는 사람은 줄 오른쪽 한 줄 이름표 — 아래 줄을 더 만들지 않아 개인 업무 줄과 높이가 같음
  const soloH = (await staff.locator('[data-testid="my-groups"] > section:not([data-group="collab"]) [data-row]').filter({ hasText: 'E2E 개인 업무 799' }).boundingBox()).height;
  for (const t of ['E2E 협업 입찰 서류', 'E2E 각자 협업 점검']) { const h = (await rowOf(t).boundingBox()).height; assert.ok(h <= soloH + 4, `${t} 줄 높이 ${h} (개인 업무 ${soloH})`); }
  // 아래 개인 업무 묶음에는 협업 업무가 다시 안 나오고, 개인 업무는 그대로
  const personal = await staff.locator('[data-testid="my-groups"] > section:not([data-group="collab"])').allInnerTexts();
  assert.ok(personal.join('\n').includes('E2E 개인 업무 799'), '개인 업무는 아래 묶음에');
  assert.ok(!personal.join('\n').includes('E2E 협업 입찰 서류') && !personal.join('\n').includes('E2E 각자 협업 점검'), '협업 업무가 개인 칸에 또 나오지 않음');
  assert.ok(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '가로 넘침 없음');
  await box.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await staff.screenshot({ path: `${SHOTS}/268-collab-my.png` });
  // 접지 않음 — 접기 단추 없이 전부
  assert.equal(await staff.getByTestId('my-collab-toggle').count(), 0);
  assert.equal(await box.getByTestId('collab-row').count(), n, '전부 보임');
  // 281차(로컬 11:28): 사람별 묶음(전체 탭 기본·관리자)·팀별에서도 내가 들어간 공동 업무가 맨 위에 — 전체 탭은 사람 묶음에도 그대로
  for (const q of ['view=all&group=assignee', 'view=my&group=assignee', 'view=all&group=team']) {
    await staff.goto(`${BASE}/tasks?${q}`);
    await staff.getByTestId('task-groups').waitFor();
    const top2 = staff.getByTestId('my-collab');
    await top2.waitFor();
    assert.ok((await top2.getByTestId('collab-row').filter({ hasText: 'E2E 협업 입찰 서류' }).count()) === 1 && (await top2.getByTestId('collab-row').filter({ hasText: 'E2E 각자 협업 점검' }).count()) === 1, `${q} 공동 업무 칸`);
    const y = async (sel) => (await staff.locator(sel).first().boundingBox()).y;
    assert.ok(await y('[data-testid="my-collab"]') < await y('[data-testid="task-groups"] section[data-group]:not([data-group="collab"])'), `${q} 공동 업무가 묶음보다 위`);
  }
  // 홈 맨 위 공동 업무 카드
  await staff.goto(`${BASE}/`);
  const home = staff.getByTestId('home-collab');
  await home.waitFor();
  assert.equal(await home.getByTestId('home-collab-row').count(), n);
  assert.match(await home.innerText(), /^공동 업무/); assert.match(await home.innerText(), /✓ 박직원/);
  await home.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await staff.screenshot({ path: `${SHOTS}/268-collab-home.png` });
  for (const id of [co, bA, bB, solo]) await o.ok('DELETE', `/api/tasks/${id}`);
}
