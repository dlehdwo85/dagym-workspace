// V14 47: 홈 "이번 주 일정" — 연결 안 된 같은 날·같은 제목 업무·일정은 한 줄 "업무 1 · 일정 1"(시각은 일정 기준)
import assert from 'node:assert/strict';
export async function v1447({ owner, BASE, SHOTS }) {
  await owner.setViewportSize({ width: 1366, height: 900 });
  await owner.goto(`${BASE}/`);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const d = new Date(Date.parse(today + 'T00:00:00Z') + 2 * 86400000).toISOString().slice(0, 10);
  const made = await owner.evaluate(async ([d]) => {
    const j = (p, b) => fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const cals = (await fetch('/api/calendars').then((r) => r.json())).calendars;
    const me = (await fetch('/api/auth/me').then((r) => r.json())).user.id;
    const cal = cals.find((c) => c.type === 'personal' && c.owner_user_id === me) ?? cals.find((c) => c.type === 'personal');
    const ev = await j('/api/events', { calendarId: cal.id, title: '중복 묶음 시험 회의', start: `${d}T13:00:00+09:00`, end: `${d}T14:00:00+09:00` });
    const t = await j('/api/tasks', { title: '중복 묶음 시험 회의', assigneeId: me, dueDate: d, dueTime: '11:00', approvalRequired: false });
    return { ev: ev.id, task: t.id };
  }, [d]);
  await owner.reload();
  const day = owner.getByTestId('home-week').locator(`[data-day="${d}"]`);
  await day.getByText('중복 묶음 시험 회의').first().waitFor();
  assert.equal(await day.getByText('중복 묶음 시험 회의').count(), 1, '한 줄');
  await day.getByText('업무 1 · 일정 1').waitFor();
  assert.match(await day.innerText(), /13:00/, '시각은 일정 기준');
  await owner.screenshot({ path: `${SHOTS}/v14-47-home-merge.png` });
  // 뒤 단계(업무 목록 순서 시험)에 영향이 없도록 지운다
  await owner.evaluate(async ([ev, task]) => {
    await fetch(`/api/tasks/${task}`, { method: 'DELETE' });
    await fetch(`/api/events/${ev}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scope: 'all' }) });
  }, [made.ev, made.task]);
}
