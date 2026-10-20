// 로컬 10/20(대표) 알람처럼 울리기(웹): 설정 › 알림 '알람처럼 울리기' 기본값 3칸 · 업무 상세 알람 선택 · 알람 알림이 생기면 화면 맨 위 고정 띠(제목·[해제][10분 뒤][열기]) → [해제] 누르면 띠 사라지고 알림 '활동' 탭에 '알람 해제'
import assert from 'node:assert/strict';

export async function alarmFlow({ staff, ctx, sql, BASE, SHOTS }) {
  await staff.goto(`${BASE}/settings`);
  const d = staff.getByTestId('alarm-defaults'); await d.waitFor();
  assert.deepEqual([await d.getByTestId('alarm-events').isChecked(), await d.getByTestId('alarm-tasks').isChecked(), await d.getByTestId('alarm-important').isChecked()], [false, false, true], '기본값: 일정 끔·업무 끔·중요 켬');
  // 업무 상세: 알람 선택(중요 업무는 '기본(중요 → 켬)')
  const t = (await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 알람 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, approvalRequired: false, priority: 'high', dueDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()), dueTime: '23:00' })).id;
  await staff.goto(`${BASE}/tasks/${t}`);
  await staff.getByTestId('details-toggle').click(); // 휴대폰은 '세부 정보' 접힘
  const sel = staff.getByTestId('task-alarm'); await sel.waitFor();
  assert.match(await sel.locator('option[value="default"]').innerText(), /중요 → 켬/);
  await sel.selectOption('on');
  let saved = null;
  for (let k = 0; k < 40 && saved !== true; k++) { saved = (await sql`select alarm from tasks where id = ${t}`)[0].alarm; if (saved !== true) await staff.waitForTimeout(250); }
  assert.equal(saved, true, '업무별 알람 켬 저장');
  // 알람 알림 → 띠(정기 실행 대신 같은 모양의 알림을 바로 넣음)
  const [n] = await sql`insert into notifications (user_id, type, title, body, link, entity_type, entity_id, meta, dedupe_key) values (${ctx.staffA.id}, 'due_soon', '1시간 뒤 마감: E2E 알람 업무', '오늘 23:00까지', ${`/tasks/${t}`}, 'task', ${t}, '{"kind":"due","alarm":true}'::jsonb, ${`e2e-alarm:${t}`}) returning id`;
  await staff.goto(`${BASE}/`);
  const bar = staff.getByTestId('alarm-bar'); await bar.waitFor({ timeout: 15000 });
  assert.match(await bar.innerText(), /1시간 뒤 마감: E2E 알람 업무/);
  assert.deepEqual(await bar.getByTestId('alarm-item').first().getByRole('button').allInnerTexts(), ['해제', '10분 뒤']);
  await staff.screenshot({ path: `${SHOTS}/142-alarm-bar.png` });
  await bar.getByTestId('alarm-dismiss').click();
  await bar.waitFor({ state: 'detached' });
  assert.equal((await sql`select action_done from notifications where id = ${n.id}`)[0].action_done, '알람 해제');
  await staff.goto(`${BASE}/notifications`);
  await staff.getByTestId('notif-activity').click();
  await staff.getByTestId('activity-list').getByText(/알람 해제/).first().waitFor();
}
