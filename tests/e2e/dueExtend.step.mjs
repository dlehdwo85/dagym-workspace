// V32 4 마감 연장(대표 10/16: "연장 신청이 안 보이고 마감 조정은 상세에 들어가야 해서 찾기 어려움")
// → 378차(대표 11/06: "담당자 승인을 기다리다 딜레이 … 승인 없이도 · 사유를 지시자와 담당자가 업무에서 확인 · D-day 옆 시간 · 연장할 때 시간 선택"):
// 휴대폰 담당자 — 목록 마감 칩(날짜·시간·D-n) → [마감 연장] → +3일·시각·사유 → 바로 바뀜, 날짜를 뒤로 고르면 바로 안 바뀌고 연장 창(사유)
// PC 요청자 — 업무 상세 '마감 연장 기록'에 사유·누가 · 예전에 남은 '연장 요청'은 칩·[승인] 그대로
import assert from 'node:assert/strict';
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
export async function dueExtend({ staff, owner, ctx, sql, BASE }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const due = addDays(today, 2);
  const id = (await ctx.owner.ok('POST', '/api/tasks', { title: '연장 시험 업무', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, dueDate: due, approvalRequired: false })).id;
  await staff.goto(`${BASE}/tasks?view=my`);
  const row = staff.locator(`[data-row="${id}"]`);
  await row.waitFor();
  // 날짜를 뒤로 고르면 바로 바뀌지 않고 요청 창
  await row.getByTestId('due-picker').tap();
  await staff.getByLabel('연장 시험 업무 마감일 날짜 선택').fill(addDays(today, 9));
  const dlg = staff.getByTestId('extend-dialog');
  await dlg.waitFor();
  assert.equal(await dlg.getByTestId('extend-to').textContent(), md(addDays(today, 9)));
  await staff.keyboard.press('Escape');
  await dlg.waitFor({ state: 'detached' });
  assert.equal((await sql`select to_char(due_date, 'YYYY-MM-DD') d from tasks where id = ${id}`)[0].d, due, '바로 안 바뀜');
  // 마감 칩 → [마감 연장] → +3일 · 시각 · 사유 → 승인 없이 바로
  await row.getByTestId('due-picker').tap();
  await staff.getByTestId('due-extend-open').tap();
  await dlg.getByText('승인 없이 바로 바뀝니다').waitFor();
  await dlg.getByRole('button', { name: '+3일' }).tap();
  // 379차 #1011(대표 PC '날짜 칸이 좁은 빈 네모'): 날짜 칸이 날짜를 다 보일 만큼 넓은지
  assert.ok((await dlg.getByTestId('extend-date').boundingBox()).width >= 140, `날짜 칸 폭 ${(await dlg.getByTestId('extend-date').boundingBox()).width}`);
  await dlg.getByTestId('extend-time').selectOption('14:00');
  assert.equal(await dlg.getByTestId('extend-to').textContent(), `${md(addDays(due, 3))} 14:00`);
  await dlg.getByTestId('extend-submit').tap();
  await staff.getByText('연장 사유를 적어 주세요').first().waitFor();
  await dlg.getByTestId('extend-reason').fill('현장 자재 입고 지연');
  await dlg.getByTestId('extend-submit').tap();
  await dlg.waitFor({ state: 'detached' });
  await staff.getByText(/마감을 .+ 14:00로 연장했습니다 — 요청자·담당자에게 사유와 함께 알림/).first().waitFor();
  assert.deepEqual({ ...(await sql`select to_char(due_date, 'YYYY-MM-DD') d, to_char(due_time, 'HH24:MI') t from tasks where id = ${id}`)[0] }, { d: addDays(due, 3), t: '14:00' }, '승인 없이 바로·시각까지');
  // D-day 옆 시간: 목록 마감 칩 = '11/9 14:00 D-5'
  await row.getByTestId('due-picker').getByText(`${md(addDays(due, 3))} 14:00`).waitFor();
  assert.equal(await row.getByTestId('due-picker').getByTestId('due-dday').textContent(), 'D-5');
  // 요청자(PC): 업무 상세 '마감 연장 기록' — 사유·누가·앞뒤 날짜시각
  await owner.goto(`${BASE}/tasks/${id}`);
  const hist = owner.getByTestId('ext-history');
  await hist.getByText('마감 연장 기록').waitFor();
  const last = (await hist.getByTestId('ext-history-last').innerText()).replace(/\s+/g, ' ');
  for (const w of [`${md(due)} → ${md(addDays(due, 3))} 14:00`, '이직원', '현장 자재 입고 지연']) assert.ok(last.includes(w), `기록 줄에 '${w}' — ${last}`);
  await owner.getByTestId('sum-ext-count').getByText('연장 1회').waitFor();
  // 예전에 남은 '대기' 요청(378차 전 요청)은 칩·[승인] 그대로 — 휴대폰 칩 자리(로컬 검수 10/17 390폭)도 함께
  await sql`insert into task_due_extensions (task_id, requested_by, from_date, from_time, to_date, to_time, reason) values (${id}, ${ctx.staffA.id}, ${addDays(due, 3)}, '14:00', ${addDays(due, 6)}, '14:00', '예전 연장 요청')`;
  await staff.reload();
  await row.getByTestId('ext-chip').waitFor();
  const ec = await row.getByTestId('ext-chip').boundingBox(), dc = await row.getByTestId('due-picker').boundingBox();
  assert.ok(ec.x + ec.width <= dc.x + 1, `연장 칩 ${ec.x}+${ec.width} / 마감 칩 ${dc.x}`);
  const clip = await row.getByTestId('ext-chip').evaluate((el) => { const a = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(); return p.right - a.right; });
  const over = await row.getByTestId('due-cell').evaluate((el) => el.getBoundingClientRect().left - el.querySelector('[data-testid="due-picker"]').getBoundingClientRect().left);
  assert.ok(over <= 1, `마감 칩이 칸 왼쪽으로 ${over}px 넘침`);
  assert.ok(clip >= -1, `연장 칩이 둘째 줄 밖으로 ${-clip}px 잘림`);
  assert.equal((await row.getByTestId('ext-chip').innerText()).trim(), `연장 → ${md(addDays(due, 6))}`);
  await owner.goto(`${BASE}/tasks`);
  const chip = owner.getByTestId('view-chips').locator('[data-count="extend"]');
  await chip.waitFor();
  assert.equal((await chip.textContent()).trim(), '1');
  await owner.getByTestId('view-chips').getByRole('button', { name: /연장 요청/ }).click();
  const orow = owner.locator(`[data-row="${id}"]`);
  await orow.getByText(`연장 요청 → ${md(addDays(due, 6))}`).waitFor();
  await orow.locator('a[data-open-task]').click();
  const banner = owner.getByTestId('ext-pending');
  await banner.getByText('예전 연장 요청').waitFor();
  await banner.getByTestId('ext-approve').click();
  await owner.getByTestId('sum-ext-count').getByText('연장 2회').waitFor();
  assert.equal((await sql`select to_char(due_date, 'YYYY-MM-DD') d from tasks where id = ${id}`)[0].d, addDays(due, 6));
  // 365차 #988: 대표는 요청자가 아니어도(최매니저가 요청한 업무) 머리 [마감 연장] → 사유 → 바로 반영(승인 없음)·요청자·담당자 알림
  const id2 = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '대표 바로 연장 시험', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, dueDate: due, approvalRequired: false })).id;
  await owner.goto(`${BASE}/tasks/${id2}`);
  await owner.getByTestId('sum-extend').click();
  const dlg2 = owner.getByTestId('extend-dialog');
  await dlg2.getByText('승인 없이 바로 바뀝니다').waitFor();
  const dw = (await dlg2.getByTestId('extend-date').boundingBox()).width, tw = (await dlg2.getByTestId('extend-time').boundingBox()).width;
  assert.ok(dw >= 160 && tw >= 100 && dw > tw, `PC 날짜 칸 ${dw} · 시각 칸 ${tw}`);
  await dlg2.getByRole('button', { name: '+1주' }).click();
  await dlg2.getByTestId('extend-reason').fill('발주처 일정 변경');
  await dlg2.getByTestId('extend-submit').click();
  await owner.getByText(/마감을 .+로 연장했습니다 — 요청자·담당자에게 사유와 함께 알림/).first().waitFor();
  assert.equal((await sql`select to_char(due_date, 'YYYY-MM-DD') d from tasks where id = ${id2}`)[0].d, addDays(due, 7), '대표 = 바로 반영');
  assert.equal((await sql`select count(*)::int n from notifications where entity_id = ${id2} and title like '마감 연장:%'`)[0].n, 2, '요청자·담당자 알림');
}
