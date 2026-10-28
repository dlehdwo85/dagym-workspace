// 222차 #477(대표 10/23) 알림을 카톡 대화방처럼: [방] 보기 → 종류별 방 한 줄(아이콘·이름·건수·최근 알림·시각·안 읽은 수, 최근 순) →
// 방을 누르면 그 종류만(주소 ?room=, 바로 처리 버튼·읽음 그대로) → [이 방 읽음] → 뒤로 = 방 목록(안 읽은 수 사라짐) → 다시 열어도 '방' 기억 · 휴대폰 폭
import assert from 'node:assert/strict';

export async function notifRooms222({ owner, ctx, sql, BASE, SHOTS }) {
  // 이 단계만 보이게: 대표의 지난 알림은 보관(앞 단계와 겹치지 않게) → 종류 4개 · 7건
  await sql`update notifications set archived_at = now(), read_at = coalesce(read_at, now()) where user_id = ${ctx.ownerId} and archived_at is null`;
  const add = (type, title, mins, link = '/tasks') => sql`insert into notifications (user_id, type, title, body, link, dedupe_key, created_at)
    values (${ctx.ownerId}, ${type}, ${title}, '', ${link}, ${`e2e222:${type}:${title}`}, now() - make_interval(mins => ${mins}))`;
  await add('mention', 'E2E222 이직원님이 회의 메모에서 언급', 2);
  await add('task_assigned', 'E2E222 새 업무: 견적서 정리', 5); await add('task_assigned', 'E2E222 새 업무: 현장 사진 올리기', 60); await add('task_assigned', 'E2E222 새 업무: 계약서 검토', 90);
  await add('review_requested', 'E2E222 검토 요청: 주간 보고', 30);
  await add('due_soon', 'E2E222 오늘 마감: 월 마감 자료', 180); await add('due_soon', 'E2E222 내일 마감: 견적 회신', 240);
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.goto(`${BASE}/notifications`);
  await owner.getByTestId('notif-view-rooms').click();
  const rooms = owner.getByTestId('notif-rooms'); await rooms.waitFor();
  assert.deepEqual(await rooms.getByTestId('notif-room').evaluateAll((els) => els.map((e) => [e.dataset.type, e.dataset.unread])),
    [['mention', '1'], ['task_assigned', '3'], ['review_requested', '1'], ['due_soon', '2']], '최근 알림 순 · 방마다 안 읽은 수');
  const ta = rooms.getByTestId('notif-room').and(owner.locator('[data-type="task_assigned"]'));
  assert.equal(await ta.getByTestId('notif-room-last').innerText(), 'E2E222 새 업무: 견적서 정리', '방 줄 = 가장 최근 알림');
  assert.ok(await owner.evaluate(() => document.documentElement.scrollWidth <= 390), '휴대폰 폭 넘침 없음');
  assert.equal(await owner.getByTestId('notif-select').count(), 0, '방 목록에서는 [선택] 없음');
  await owner.screenshot({ path: `${SHOTS}/575-notif-rooms-390.png` });
  // 방 열기 → 그 종류만 · 주소 ?room=
  await ta.click();
  const view = owner.getByTestId('notif-room-view'); await view.waitFor();
  await owner.waitForURL(/room=task_assigned/);
  assert.equal(await view.getByTestId('notif-item').count(), 3);
  assert.ok((await view.getByTestId('notif-item').allInnerTexts()).every((t) => t.includes('새 업무')), '업무 배정 알림만');
  await owner.screenshot({ path: `${SHOTS}/576-notif-room-open-390.png` });
  await view.getByTestId('notif-room-read').click();
  await view.getByTestId('notif-room-read').waitFor({ state: 'detached' });
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and type = 'task_assigned' and archived_at is null and read_at is null`)[0].n, 0, '[이 방 읽음] = 그 종류만 읽음');
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and type = 'due_soon' and archived_at is null and read_at is null`)[0].n, 2, '다른 방은 그대로');
  // 뒤로 = 방 목록(안 읽은 수 사라짐 — 읽은 알림은 이 화면 동안 흐리게 남음)
  await view.getByTestId('notif-room-back').click();
  await rooms.waitFor(); await owner.waitForURL((u) => !u.search.includes('room='));
  assert.equal(await ta.getAttribute('data-unread'), '0');
  // 다시 열어도 '방' 보기 기억(이 기기) → [목록]으로 되돌림(다른 단계는 목록 기준)
  await owner.reload(); await rooms.waitFor();
  await owner.getByTestId('notif-view-list').click();
  await owner.getByTestId('notifications').waitFor();
  assert.equal(await owner.evaluate(() => localStorage.getItem('notif-view')), 'list');
  await owner.setViewportSize({ width: 1366, height: 900 });
}
