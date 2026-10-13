// 휴대폰 폭(360·375·390·430)에서 주요 화면 좌우 넘침 측정. 단독 실행: node tests/e2e/widths.mjs (사전: npm run build)
import { chromium } from 'playwright';
import { BASE } from '../helpers.mjs';

export const WIDTHS = [360, 375, 390, 430];
export const PAGES = ['/', '/tasks', '/tasks?view=my', '/calendar', '/projects', '/notifications', '/settings', '/revenue'];

/** 문서가 화면보다 넓으면 그 원인 요소(오른쪽 끝이 화면 밖) 목록을 돌려준다 */
export async function measure(page) {
  return page.evaluate(() => {
    // 안전장치(.app-shell overflow-x: clip)를 끄고 실제 넘침을 잰다
    if (!document.getElementById('no-clip')) { const st = document.createElement('style'); st.id = 'no-clip'; st.textContent = '.app-shell{overflow-x:visible!important}'; document.head.appendChild(st); }
    const de = document.documentElement;
    const over = [];
    if (de.scrollWidth > de.clientWidth) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > de.clientWidth + 0.5) {
          let p = el.parentElement, clipped = false;
          while (p && p !== document.body) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX) && p.getBoundingClientRect().right <= de.clientWidth + 0.5) { clipped = true; break; } p = p.parentElement; }
          if (!clipped) over.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} right=${Math.round(r.right)}`);
        }
      }
    }
    return { scroll: de.scrollWidth, client: de.clientWidth, over: over.slice(0, 6) };
  });
}

/** 로그인된 context 를 받아 모든 폭·화면 측정. 넘친 곳 목록을 돌려준다 */
export async function checkWidths(browser, storageState, pages = PAGES) {
  const bad = [];
  for (const w of WIDTHS) {
    const c = await browser.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState });
    const p = await c.newPage();
    for (const path of pages) {
      await p.goto(BASE + path);
      await p.waitForLoadState('networkidle').catch(() => {});
      await p.waitForTimeout(400);
      const m = await measure(p);
      if (m.scroll > m.client) bad.push(`${w}px ${path}: ${m.scroll} > ${m.client} ${m.over.join(' | ')}`);
    }
    await c.close();
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { bootstrap, resetDb, startServer } = await import('../helpers.mjs');
  await resetDb();
  const srv = await startServer();
  const ctx = await bootstrap();
  const { seoulToday, addDays } = await import('../helpers.mjs');
  const today = seoulToday();
  const cals = await ctx.owner.ok('GET', '/api/calendars');
  const calId = (cals.calendars ?? cals)[0].id;
  for (let i = 0; i < 3; i++) await ctx.owner.ok('POST', '/api/events', { calendarId: calId, title: `하이링크 판교 위탁현장 분기 운영 점검 회의 및 시설 안전 점검 결과 공유 ${i}`, location: '경기도 성남시 분당구 판교역로 235 에이치스퀘어 N동 8층 대회의실', start: `${addDays(today, i)}T10:00:00+09:00`, end: `${addDays(today, i)}T11:00:00+09:00` });
  for (let i = 0; i < 4; i++) await ctx.owner.ok('POST', '/api/tasks', { title: `다짐 강남점 GX 시간표 전면 개편안 작성 및 강사 일정 조율 ${i}`, orgUnitId: ctx.siteA, assigneeId: ctx.staffA.id, dueDate: addDays(today, i - 1) });
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const c = await browser.newContext();
  const p = await c.newPage();
  await p.goto(BASE + '/login');
  await p.getByLabel('회사 이메일').fill(process.env.WEMAIL ?? 'ceo@dagym.test');
  await p.getByLabel('비밀번호').fill(process.env.WPASS ?? 'owner-pass-1234');
  await p.getByRole('button', { name: '로그인' }).click();
  await p.waitForURL(BASE + '/');
  const bad = await checkWidths(browser, await c.storageState());
  console.log(bad.length ? bad.join('\n') : '넘침 없음');
  await browser.close(); srv.proc.kill();
  process.exit(bad.length ? 1 : 0);
}
