// 대표(10/16): 업무 등록 창의 AI 비서 — 편하게 적으면(또는 말하면) [AI로 채우기] → 업무명·담당·마감·설명·체크리스트가 채워지고 저장
import assert from 'node:assert/strict';
const addDays = (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export async function quickAi({ owner, ctx, sql, BASE, FAKE }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const [staff] = await sql`select name from users where id = ${ctx.staffA.id}`;
  await fetch(`${FAKE}/__ctl`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ anthropicReset: true, anthropicQueue: [{ content: [{ type: 'text', text: JSON.stringify({
    title: '푸르지오 주안 비교 파일 검수 후 보고', assignee: staff.name, dueDate: addDays(today, 7), dueTime: null, description: '보안 확인 뒤 본부장 검수를 받고 보고합니다.', checklist: ['비교 파일 정리', '검수 받기', '보고'] }) }], stop_reason: 'end_turn' }] }) });
  await owner.goto(BASE + '/tasks');
  await owner.getByTestId('create-menu').click();
  await owner.getByRole('menuitem', { name: /^업무/ }).click();
  const dlg = owner.getByRole('dialog', { name: '업무 등록' });
  const box = dlg.getByTestId('quick-ai');
  await box.getByLabel('AI 비서에게 업무 설명').fill('다음 주 금요일까지 푸르지오 주안 아파트 비교 파일 보안 확인하고 본부장 검수 받아서 보고하라고 해 줘');
  await box.getByTestId('quick-ai-fill').click();
  await owner.getByText('AI 비서가 채웠습니다').first().waitFor();
  assert.equal(await dlg.getByLabel('제목').inputValue(), '푸르지오 주안 비교 파일 검수 후 보고');
  assert.equal(await dlg.getByLabel('담당자', { exact: true }).inputValue(), ctx.staffA.id);
  assert.equal(await dlg.getByLabel('마감일').inputValue(), addDays(today, 7));
  await dlg.getByTestId('quick-filled').getByText('체크리스트 3개').waitFor();
  await dlg.getByRole('button', { name: /^(등록|저장|만들기)/ }).first().click();
  await dlg.waitFor({ state: 'detached' });
  const [t] = await sql`select id, assignee_id, to_char(due_date, 'YYYY-MM-DD') d, description from tasks where title = '푸르지오 주안 비교 파일 검수 후 보고'`;
  assert.equal(t.assignee_id, ctx.staffA.id); assert.equal(t.d, addDays(today, 7)); assert.match(t.description, /검수/);
  assert.equal((await sql`select count(*)::int n from task_checklist_items where task_id = ${t.id}`)[0].n, 3);
}

// 대표(10/16): 홈 "오늘의 일정" = 오늘 일정(시간순) + 오늘 업무
export async function homeTodayEvents({ owner, ctx, BASE }) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const cal = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
  await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '오늘 홈 일정 시험', start: `${today}T23:00:00+09:00`, end: `${today}T23:30:00+09:00` });
  await owner.goto(BASE + '/');
  await owner.getByTestId('home-week').locator(`[data-day="${today}"]`).getByText('오늘 홈 일정 시험').waitFor(); // 대표 확정(10/19): 이번 주 안 오늘 칸
}
