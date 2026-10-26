import assert from 'node:assert/strict';

/**
 * #480(대표 10/23): 월 보기 빈 칸에서 만들 때 — 기본은 종일, [시간 지정]을 누르면 시작·끝 시각 칸이 나오고
 * 저장하면 시각 있는 일정 + (업무 리스트에도 추가) 마감 시각이 같은 연결 업무. [종일로]로 되돌리면 시각 칸이 사라짐.
 */
export async function cal480({ owner, sql, BASE, SHOTS, addDays, today }) {
  const d = addDays(today, 6);
  await owner.goto(`${BASE}/calendar?view=dayGridMonth&date=${d}`);
  await owner.locator('.fc-dayGridMonth-view').waitFor();
  await owner.waitForLoadState('networkidle');
  const cell = owner.locator(`.fc-dayGridMonth-view .fc-daygrid-day[data-date="${d}"]`);
  const qc = owner.getByTestId('quick-create');
  // 179차: 칸 왼쪽 위 빈 곳(날짜 숫자는 오른쪽 위, 일정 칩은 그 아래)을 누른다 — 처음 잰 아래쪽 좌표를 다시 쓰면 방금 만든 칩에 닿아
  // 미리보기가 열리고 빠른 입력이 안 뜸(CI 174·176 main 실패 화면). 미리보기·팝오버가 열렸으면 Esc 로 닫고 2번 더.
  const clickEmpty = async () => {
    for (let k = 0; k < 3; k++) {
      await cell.click({ position: { x: 14, y: 10 } });
      if (await qc.waitFor({ timeout: 5000 }).then(() => true, () => false)) return;
      await owner.keyboard.press('Escape');
    }
    await qc.waitFor();
  };
  await clickEmpty();
  await qc.getByTestId('quick-save').waitFor();
  await qc.getByText(/종일$/).first().waitFor();
  assert.equal(await qc.getByTestId('quick-times').count(), 0, '월 칸 = 기본 종일(시각 칸 없음)');
  assert.equal(await qc.getByTestId('quick-remind').count(), 0, '종일이면 알림 고르기 없음');
  // [시간 지정] → 시각 칸 + 알림 칸, [종일로] → 다시 종일
  await qc.getByTestId('quick-set-time').click();
  await qc.getByTestId('quick-times').waitFor();
  await qc.getByTestId('quick-remind').waitFor();
  await qc.getByTestId('quick-all-day').click();
  await qc.getByTestId('quick-times').waitFor({ state: 'detached' });
  await qc.getByTestId('quick-set-time').click();
  await qc.getByLabel('시작 시각').selectOption('14:00');
  assert.equal(await qc.getByLabel('종료 시각').inputValue(), '15:00', '시작을 바꾸면 길이(1시간) 유지');
  await qc.getByLabel('빠른 입력 제목').fill('월 칸 시각 업무');
  await qc.getByTestId('quick-also-task').check({ force: true });
  await owner.screenshot({ path: `${SHOTS}/480-month-quick-time.png` });
  await qc.getByTestId('quick-save').click();
  await qc.waitFor({ state: 'detached' });
  const [ev] = await sql`select all_day, to_char(start_at at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') s, to_char(end_at at time zone 'Asia/Seoul', 'HH24:MI') e
    from events where title = '월 칸 시각 업무' and deleted_at is null`;
  assert.equal(ev.all_day, false, '시간 지정 뒤 저장 = 종일 아님');
  assert.equal(ev.s, `${d} 14:00`); assert.equal(ev.e, '15:00');
  const [t] = await sql`select to_char(due_date, 'YYYY-MM-DD') due, to_char(due_time, 'HH24:MI') tm from tasks where title = '월 칸 시각 업무' and deleted_at is null`;
  assert.equal(t.due, d); assert.equal(t.tm, '14:00', '연결 업무 마감 시각 = 고른 시작 시각');
  // 그대로 저장하면 종일(기본값 유지) — 방금 만든 칩이 칸에 그려진 뒤(칸 높이가 바뀜) 빈 곳을 다시 누른다
  await cell.getByText('월 칸 시각 업무').first().waitFor();
  await clickEmpty();
  await qc.getByLabel('빠른 입력 제목').fill('월 칸 종일 일정');
  await qc.getByTestId('quick-save').click();
  await qc.waitFor({ state: 'detached' });
  const [ev2] = await sql`select all_day from events where title = '월 칸 종일 일정' and deleted_at is null`;
  assert.equal(ev2.all_day, true, '시간 지정을 안 누르면 종일');
}
