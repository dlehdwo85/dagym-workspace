// V14 41 측정용: 412px 휴대폰 주·3일 보기 캡처 + 종일 칩·블록 글자 크기 측정 (node tests/e2e/_cal41.mjs <이름>)
import { chromium, devices } from 'playwright';
import { bootstrap, resetDb, startServer, BASE, addDays, seoulToday } from '../helpers.mjs';
const tag = process.argv[2] ?? 'now';
await resetDb(); const srv = await startServer(); const ctx = await bootstrap();
const today = seoulToday();
const cals = (await ctx.owner.ok('GET', '/api/calendars')).calendars;
const mine = cals.find((c) => c.type === 'personal').id, comp = cals.find((c) => c.type === 'company' || c.type === 'org_unit').id;
await ctx.owner.ok('POST', '/api/events', { calendarId: mine, title: '음성 아이파크 미팅', allDay: true, start: `${today}T00:00:00+09:00`, end: `${addDays(today, 1)}T00:00:00+09:00` });
await ctx.owner.ok('POST', '/api/events', { calendarId: comp, title: '분기 워크숍', allDay: true, start: `${today}T00:00:00+09:00`, end: `${addDays(today, 3)}T00:00:00+09:00` });
const sMine = (await ctx.staffA.client.ok('GET', '/api/calendars')).calendars.find((c) => c.type === 'personal').id;
await ctx.staffA.client.ok('POST', '/api/events', { calendarId: sMine, title: '고천 대방 현장 미팅', start: `${today}T13:00:00+09:00`, end: `${today}T14:00:00+09:00` });
await ctx.owner.ok('POST', '/api/events', { calendarId: mine, title: '판교 하이링크 운영 점검 회의', start: `${addDays(today, 1)}T10:00:00+09:00`, end: `${addDays(today, 1)}T12:00:00+09:00` });
await ctx.owner.ok('POST', '/api/events', { calendarId: mine, title: '짧은 통화', start: `${today}T09:00:00+09:00`, end: `${today}T09:30:00+09:00` });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const c = await b.newContext({ ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
const p = await c.newPage();
await p.goto(BASE + '/login'); await p.getByLabel('이메일', { exact: true }).fill('ceo@dagym.test'); await p.getByLabel('비밀번호').fill('owner-pass-1234'); await p.getByRole('button', { name: '로그인' }).click(); await p.waitForURL(BASE + '/');
for (const v of ['timeGridWeek', 'timeGrid3']) {
  await p.goto(`${BASE}/calendar?view=${v}&date=${today}`); await p.waitForSelector('.fc-timegrid-slot'); await p.getByTestId('people-filter').getByRole('button', { name: '전체' }).click(); await p.waitForTimeout(1000);
  await p.evaluate(() => window.scrollTo(0, 0));
  const m = await p.evaluate(() => {
    const chip = [...document.querySelectorAll('.fc-daygrid-event')].find((e) => e.textContent.includes('아이파크'));
    const blk = [...document.querySelectorAll('.fc-timegrid-event')].find((e) => e.textContent.includes('고천'));
    const r = (e) => e && { w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height), text: e.innerText.replace(/\n/g, '⏎'), sw: e.scrollWidth, font: getComputedStyle(e.querySelector('span') ?? e).fontSize };
    return { chip: r(chip), block: r(blk), slot: document.querySelector('.fc-timegrid-slot')?.getBoundingClientRect().height, axis: document.querySelector('.fc-timegrid-slot-label-cushion')?.textContent };
  });
  console.log(tag, v, JSON.stringify(m));
  await p.locator('[data-testid=calendar]').screenshot({ path: `test-results/cal41-${tag}-${v}.png` });
}
await b.close(); srv.proc.kill(); process.exit(0);
