// 대기열 소형 3건: #76 설정 › 부재중 설정(기간·문구·대리인 → "부재 중" 안내 → 해제) · #111 일정 수정 화면 화상 회의 링크 → 미리보기 [회의 참여]
import assert from 'node:assert/strict';

export async function awayFlow({ owner, staff, ctx, BASE, SHOTS, today, addDays }) {
  // 직원(휴대폰 폭) 설정 › 부재중
  await staff.goto(BASE + '/settings');
  const sec = staff.getByTestId('away');
  await staff.locator('[data-testid="away"][data-loaded="1"]').waitFor(); // 설정을 불러온 뒤 입력
  await sec.getByTestId('away-from').fill(today);
  await sec.getByTestId('away-to').fill(addDays(today, 1));
  await sec.getByTestId('away-note').fill('연차 중입니다. 급한 건 박직원에게 부탁드려요.');
  await sec.getByTestId('away-save').click();
  await sec.getByTestId('away-active').waitFor();
  assert.match(await sec.getByTestId('away-active').innerText(), /부재중/);
  await staff.screenshot({ path: `${SHOTS}/189-settings-away.png` });
  const p = await ctx.owner.ok('GET', '/api/people/presence');
  assert.equal(p.people[ctx.staffA.id]?.s, 'leave'); assert.match(p.people[ctx.staffA.id].label, /^부재 ~/);
  await sec.getByTestId('away-clear').click();
  await sec.getByTestId('away-active').waitFor({ state: 'hidden' });
  const after = (await ctx.owner.ok('GET', '/api/people/presence')).people[ctx.staffA.id];
  assert.ok(!after?.label?.startsWith('부재'), '해제하면 직접 부재 표시는 사라짐 (앞 단계의 연차 일정은 그대로 "휴가 ~")');

  // 대표: 일정 수정 화면에 화상 회의 링크 → 미리보기에 [회의 참여]
  const cals = (await ctx.owner.ok('GET', '/api/calendars')).calendars;
  const cal = (cals.find((c) => c.type === 'personal' && c.owner_user_id === ctx.ownerId) ?? cals.find((c) => c.type === 'personal')).id;
  const d = addDays(today, 4);
  const ev = (await ctx.owner.ok('POST', '/api/events', { calendarId: cal, title: '투자사 화상 미팅', start: `${d}T15:00:00+09:00`, end: `${d}T16:00:00+09:00` })).id;
  await owner.goto(`${BASE}/calendar?event=${ev}`);
  const dlg = owner.getByRole('dialog', { name: '일정 수정' });
  await dlg.getByTestId('ev-meeting-url').fill('https://meet.google.com/abc-defg-hij');
  await dlg.getByTestId('editor-autosave').getByText('저장됨', { exact: true }).waitFor(); // 기존 일정은 칸을 바꾸면 자동 저장
  await dlg.getByTestId('editor-close').click();
  await dlg.waitFor({ state: 'hidden' });
  await owner.goto(`${BASE}/calendar?date=${d}`);
  await owner.getByTestId('calendar').waitFor();
  await owner.locator('.fc-timegrid-event', { hasText: '투자사 화상 미팅' }).first().click();
  const pv = owner.getByTestId('event-preview');
  await pv.getByTestId('ev-join').waitFor();
  assert.equal(await pv.getByTestId('ev-join').getAttribute('href'), 'https://meet.google.com/abc-defg-hij');
  await owner.screenshot({ path: `${SHOTS}/190-event-meeting-link.png` });
  await owner.keyboard.press('Escape');
}
