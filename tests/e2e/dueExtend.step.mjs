// V32 4 마감 연장(대표 10/16: "연장 신청이 안 보이고 마감 조정은 상세에 들어가야 해서 찾기 어려움"):
// 휴대폰 담당자 — 목록 마감 칩 → [마감 연장 요청] → +3일·사유 → 보냄(마감은 그대로), 날짜를 뒤로 고르면 바로 안 바뀌고 요청 창
// PC 요청자 — "연장 요청" 칩에 1건·행에 "연장 요청 → m/d" → 업무 머리의 [승인] → 마감 변경·"연장 1회"
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
  // 마감 칩 → [마감 연장 요청] → +3일 · 사유
  await row.getByTestId('due-picker').tap();
  await staff.getByTestId('due-extend-open').tap();
  await dlg.getByRole('button', { name: '+3일' }).tap();
  await dlg.getByTestId('extend-submit').tap();
  await staff.getByText('연장 사유를 적어 주세요').first().waitFor();
  await dlg.getByTestId('extend-reason').fill('현장 자재 입고 지연');
  await dlg.getByTestId('extend-submit').tap();
  await dlg.waitFor({ state: 'detached' });
  await row.getByTestId('ext-chip').waitFor();
  // 로컬 검수 10/17(390폭): 연장 칩이 마감 칩 밑으로 잘리지 않음 — 칩 전체가 마감 칩 왼쪽에
  const ec = await row.getByTestId('ext-chip').boundingBox(), dc = await row.getByTestId('due-picker').boundingBox();
  assert.ok(ec.x + ec.width <= dc.x + 1, `연장 칩 ${ec.x}+${ec.width} / 마감 칩 ${dc.x}`);
  const clip = await row.getByTestId('ext-chip').evaluate((el) => { const a = el.getBoundingClientRect(), p = el.parentElement.getBoundingClientRect(); return p.right - a.right; });
  const over = await row.getByTestId('due-cell').evaluate((el) => el.getBoundingClientRect().left - el.querySelector('[data-testid="due-picker"]').getBoundingClientRect().left);
  assert.ok(over <= 1, `마감 칩이 칸 왼쪽으로 ${over}px 넘침`);
  assert.ok(clip >= -1, `연장 칩이 둘째 줄 밖으로 ${-clip}px 잘림`);
  assert.equal((await row.getByTestId('ext-chip').innerText()).trim(), `연장 → ${md(addDays(due, 3))}`);
  assert.equal((await sql`select to_char(due_date, 'YYYY-MM-DD') d from tasks where id = ${id}`)[0].d, due);
  // 요청자(PC): 연장 요청 칩 → 행 → 머리에서 승인
  await owner.goto(`${BASE}/tasks`);
  const chip = owner.getByTestId('view-chips').locator('[data-count="extend"]');
  await chip.waitFor();
  assert.equal((await chip.textContent()).trim(), '1');
  await owner.getByTestId('view-chips').getByRole('button', { name: /연장 요청/ }).click();
  const orow = owner.locator(`[data-row="${id}"]`);
  await orow.getByText(`연장 요청 → ${md(addDays(due, 3))}`).waitFor();
  await orow.locator('a[data-open-task]').click();
  const banner = owner.getByTestId('ext-pending');
  await banner.getByText('현장 자재 입고 지연').waitFor();
  await banner.getByTestId('ext-approve').click();
  await owner.getByTestId('sum-ext-count').getByText('연장 1회').waitFor();
  assert.equal((await sql`select to_char(due_date, 'YYYY-MM-DD') d from tasks where id = ${id}`)[0].d, addDays(due, 3));
  // 365차 #988: 대표는 요청자가 아니어도(최매니저가 요청한 업무) 머리 [마감 연장] → 사유 → 바로 반영(승인 없음)·요청자·담당자 알림
  const id2 = (await ctx.managerA.client.ok('POST', '/api/tasks', { title: '대표 바로 연장 시험', assigneeId: ctx.staffA.id, orgUnitId: ctx.siteA, dueDate: due, approvalRequired: false })).id;
  await owner.goto(`${BASE}/tasks/${id2}`);
  await owner.getByTestId('sum-extend').click();
  const dlg2 = owner.getByTestId('extend-dialog');
  await dlg2.getByText('승인 없이 바로 바뀝니다').waitFor();
  await dlg2.getByRole('button', { name: '+1주' }).click();
  await dlg2.getByTestId('extend-reason').fill('발주처 일정 변경');
  await dlg2.getByTestId('extend-submit').click();
  await owner.getByText(/마감을 .+로 연장했습니다 — 요청자·담당자에게 알림/).first().waitFor();
  assert.equal((await sql`select to_char(due_date, 'YYYY-MM-DD') d from tasks where id = ${id2}`)[0].d, addDays(due, 7), '대표 = 바로 반영');
  assert.equal((await sql`select count(*)::int n from notifications where entity_id = ${id2} and title like '마감 연장:%'`)[0].n, 2, '요청자·담당자 알림');
}
