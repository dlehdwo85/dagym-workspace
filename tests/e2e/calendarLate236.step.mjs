// 236차(대표 10/28 '일정생성불가함' — 로컬 재현: /api/calendars 가 늦으면 일정 등록 창의 캘린더가 빈 채로 남아 저장 본문에 calendarId 가 없고 '캘린더: 필수 항목입니다'):
// ① 목록 전에 창을 열고 목록이 온 뒤 [완료] → 고르기 칸·저장 본문 모두 내 개인 일정 ② 목록이 오기 전에 [완료] → 빈 선택지('캘린더 불러오는 중…')·본문에 캘린더 없음 → 서버가 내 개인 일정으로 저장
import assert from 'node:assert/strict';

export async function calendarLate236({ owner, ctx, BASE }) {
  const mine = (await ctx.owner.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
  let delay = 2500;
  const slow = async (route) => { await new Promise((r) => setTimeout(r, delay)); await route.continue().catch(() => {}); };
  const posted = () => owner.waitForRequest((r) => new URL(r.url()).pathname === '/api/events' && r.method() === 'POST');
  await owner.route('**/api/calendars', slow);
  try {
    await owner.goto(BASE + '/calendar');
    await owner.getByRole('button', { name: '일정 등록' }).click();
    let dlg = owner.getByRole('dialog', { name: '일정 등록' });
    await dlg.getByLabel('제목').fill('236 늦은 캘린더 목록');
    await owner.waitForFunction((id) => [...document.querySelectorAll('[role=dialog] select')].some((s) => s.value === id), mine, { timeout: 15_000 });
    assert.equal(await dlg.getByLabel('캘린더').inputValue(), mine, '목록이 오면 내 개인 일정으로 채움(예전엔 빈 채로 첫 캘린더만 보임)');
    let req = posted();
    await dlg.getByTestId('editor-close').click();
    assert.equal(JSON.parse((await req).postData() ?? '{}').calendarId, mine, '저장 본문에 캘린더');
    await owner.getByText('저장했습니다').first().waitFor();
    // ② 목록이 아주 늦으면 — 빈 선택지가 보이고, 그대로 [완료]해도 서버가 내 개인 일정으로 저장
    delay = 8000;
    await owner.goto(BASE + '/calendar');
    await owner.getByRole('button', { name: '일정 등록' }).click();
    dlg = owner.getByRole('dialog', { name: '일정 등록' });
    assert.deepEqual([await dlg.getByLabel('캘린더').inputValue(), (await dlg.getByLabel('캘린더').locator('option:checked').textContent())?.trim()], ['', '캘린더 불러오는 중…']);
    await dlg.getByLabel('제목').fill('236 목록 전 저장');
    req = posted();
    const res = owner.waitForResponse((r) => new URL(r.url()).pathname === '/api/events' && r.request().method() === 'POST');
    await dlg.getByTestId('editor-close').click();
    assert.equal(JSON.parse((await req).postData() ?? '{}').calendarId, undefined, '빈 값은 보내지 않음');
    const out = await (await res).json();
    assert.equal(out.calendarId, mine, '서버가 내 개인 일정으로');
    await owner.getByText('저장했습니다').first().waitFor();
  } finally { await owner.unroute('**/api/calendars', slow); }
}
