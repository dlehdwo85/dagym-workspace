// 394차(대표 11/13 "각 페이지별 알람이 보일 수 있도록"): 화면마다 그 화면 알림 — 왼쪽 메뉴·하단 탭 숫자 · 화면 위 '업무 새 알림 N건 [보기][모두 읽음]'
// [보기] = 알림 화면에서 그 화면 알림만 · [모두 읽음] = 그 화면 것만(캘린더 알림은 그대로)
import assert from 'node:assert/strict';

export async function pageAlarms394({ owner, ctx, sql, BASE }) {
  const uid = ctx.ownerId;
  const ins = (title, link) => sql`insert into notifications (user_id, type, title, body, link, dedupe_key) values (${uid}, 'comment', ${title}, '', ${link}, ${`e2e394:${title}`})`;
  await ins('E2E394 업무 알림 1', '/tasks/00000000-0000-4000-8000-000000000394'); await ins('E2E394 업무 알림 2', '/tasks/00000000-0000-4000-8000-000000000395?c=1');
  await ins('E2E394 일정 알림', '/calendar?event=00000000-0000-4000-8000-000000000396');
  const want = async (a) => ((await ctx.owner.ok('GET', '/api/notifications?unread=1')).areas[a] ?? 0);
  const fmt = (n) => (n > 99 ? '99+' : String(n));
  try {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await owner.goto(`${BASE}/tasks`);
    const line = owner.getByTestId('page-alarms'); await line.waitFor();
    assert.equal(await line.getAttribute('data-area'), '/tasks');
    const nTasks = await want('/tasks'); assert.ok(nTasks >= 2, `업무 알림 ${nTasks}`);
    assert.equal(await line.getByTestId('page-alarms-count').innerText(), fmt(nTasks), '화면 위 줄 = 업무 화면 안 읽은 알림 수');
    assert.match(await line.innerText(), /^업무 새 알림/);
    const side = owner.locator('nav[aria-label="주 메뉴"] a[href="/tasks"]');
    assert.match(await side.innerText(), new RegExp(`${fmt(nTasks).replace('+', '\\+')}$`), '왼쪽 메뉴 업무 숫자');
    // [보기] → 알림 화면에서 업무 화면 알림만
    await line.getByTestId('page-alarms-open').click();
    await owner.waitForURL(/\/notifications\?area=%2Ftasks/);
    await owner.getByTestId('notif-area-filter').waitFor();
    await owner.getByText('E2E394 업무 알림 1').first().waitFor();
    assert.equal(await owner.getByText('E2E394 일정 알림').count(), 0, '캘린더 알림은 안 보임');
    // 업무 화면으로 돌아가 [모두 읽음] → 업무 것만 읽음, 줄 사라짐 · 캘린더 알림은 그대로
    await owner.goto(`${BASE}/tasks`); await line.waitFor();
    await line.getByTestId('page-alarms-read').click();
    await line.waitFor({ state: 'detached' });
    assert.deepEqual([await want('/tasks'), await want('/calendar') >= 1], [0, true]);
    // 휴대폰 하단 탭: 캘린더 숫자
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto(`${BASE}/`);
    const tab = owner.locator('nav[aria-label="하단 메뉴"] a[href="/calendar"]'); await tab.waitFor();
    const nCal = await want('/calendar');
    await owner.waitForFunction(([n]) => [...document.querySelectorAll('nav[aria-label="하단 메뉴"] a[href="/calendar"] span')].some((x) => x.textContent === n), [fmt(nCal)], { timeout: 10000 })
      .catch(async (e) => { throw new Error(`하단 탭 캘린더 숫자 ${fmt(nCal)} 아님: ${JSON.stringify(await tab.innerText())} ${e.message}`); });
    // (캘린더 화면은 열면 '/calendar?…' 알림이 바로 읽음 처리돼(V32 0) 위 줄이 곧 사라짐 — 여기서는 보지 않음)
  } finally {
    await owner.setViewportSize({ width: 1366, height: 900 });
    await sql`update notifications set read_at = now() where user_id = ${uid} and dedupe_key like 'e2e394:%'`;
  }
}
