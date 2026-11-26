// 대표 11/26 홈 구성 ① 웹(1880px 캡처 "웹 화면 구성이 좀 별로"): 데스크톱 세 줄(오늘 처리할 것·회사 현황·이번 주+오른쪽 묶음) 오른쪽 끝이 같은 선 · 머리 [새로 만들기] 없음
// ② 앱(갤럭시 412폭 캡처 "앱에서도 빈 칸"): 오늘 처리할 것은 줄마다 고르게(휴대폰 최대 3칸·데스크톱 6칸, 4 → [2,2], 5 → [3,2], 7 → [3,2,2]) — 빈 자리 없음
//    회사 현황은 휴대폰에서 카드 하나 안의 목록 줄 · 출근 문구는 어디서나 '출근 전 · 시각만 기록'
// 칸 수 1~7 개는 /api/home 응답을 시험 안에서만 바꿔 만든다(실제 자료는 그대로)
import assert from 'node:assert/strict';

const TODO_KEYS = ['overdue', 'review', 'approvals', 'today', 'marketing', 'bids', 'unread'];
/** n 칸이 나오도록 홈 응답을 바꿈(회사 현황은 3칸: 영업·지점 보고·점검) */
async function mockHome(page, n) {
  await page.unroute('**/api/home').catch(() => {});
  await page.route('**/api/home', async (route) => {
    const res = await route.fetch(); const j = await res.json();
    const on = (k) => TODO_KEYS.indexOf(k) < n;
    j.todo = { ...j.todo, overdue: on('overdue') ? 2 : 0, overdueOldestDays: 3, approvals: on('approvals') ? 1 : 0, dueToday: on('today') ? 4 : 0,
      marketing: on('marketing') ? 5 : 0, marketingSplit: null, bids: on('bids') ? 6 : 0, unread: on('unread') ? 7 : 0 };
    j.review = on('review') ? { count: 1, items: [] } : null;
    j.company = { sales: { dueThisWeek: 2, earliestDays: 3 }, branch: { submitted: 1, total: 3, day: '2026-11-27' }, check: { acting: 1, waiting: 0 }, agreement: null, ads: null };
    await route.fulfill({ response: res, json: j });
  });
}
/** 칸 묶음의 줄별 [칸 수, 왼쪽 끝 차이, 오른쪽 끝 차이] — 빈 자리가 없으면 줄마다 왼쪽·오른쪽 끝이 묶음 끝과 같음 */
const rowsOf = (page, id) => page.evaluate((id) => {
  const box = document.querySelector(`[data-testid="${id}"]`); if (!box) return null;
  const b = box.getBoundingClientRect(); const rows = new Map();
  for (const el of box.children) { const r = el.getBoundingClientRect(); if (!r.width) continue; const k = Math.round(r.top); rows.set(k, [...(rows.get(k) ?? []), r]); }
  return [...rows.values()].map((rs) => [rs.length, Math.min(...rs.map((r) => r.left)) - b.left, b.right - Math.max(...rs.map((r) => r.right))]);
}, id);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const introGone = (page) => page.locator('#wos-intro').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});

export async function homeLayout1126({ browser, desk, BASE, SHOTS }) {
  const EXPECT = { 375: [[1], [2], [3], [2, 2], [3, 2], [3, 3], [3, 2, 2]], 1880: [[1], [2], [3], [4], [5], [6], [4, 3]] };
  // ① 휴대폰 375·412 — 칸 수 1~7, 줄마다 빈 자리 없음 · 회사 현황 목록 줄 · 짧은 출근 문구 · 가로 넘침 없음
  for (const w of [375, 412]) {
    const mc = await browser.newContext({ viewport: { width: w, height: 860 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
    try {
      const m = await mc.newPage();
      for (let n = 1; n <= 7; n++) {
        await mockHome(m, n);
        await m.goto(`${BASE}/`); await m.getByTestId('home-todo-grid').waitFor();
        await m.waitForFunction((n) => document.querySelectorAll('[data-testid="home-todo-grid"] > a').length === n, n);
        const rows = await rowsOf(m, 'home-todo-grid');
        assert.deepEqual(rows.map((r) => r[0]), EXPECT[375][n - 1], `${w}폭 ${n}칸 줄 나눔`);
        for (const [k, l, r] of rows) assert.ok(Math.abs(l) <= 2 && Math.abs(r) <= 2, `${w}폭 ${n}칸: ${k}칸 줄 끝이 묶음 끝과 다름(왼 ${l.toFixed(1)} · 오른 ${r.toFixed(1)})`);
        if (n === 4 || n === 7) {
          await introGone(m);
          await m.screenshot({ path: `${SHOTS}/1126-home-${w}-${n}.png` });
        }
      }
      // 회사 현황: 휴대폰은 목록 줄 3개(칸 묶음은 숨김) · 지점 보고 미제출은 주황 숫자
      assert.equal(await m.getByTestId('home-company-list').isVisible(), true, '휴대폰 회사 현황 = 목록');
      assert.equal(await m.getByTestId('home-company-grid').isVisible(), false, '휴대폰은 칸 묶음 숨김');
      assert.equal(await m.locator('[data-testid^="home-company-row-"]').count(), 3);
      assert.match(await m.getByTestId('home-company-row-branch').innerText(), /1\/3/);
      const listBox = await m.getByTestId('home-company-list').boundingBox(); const todoBox = await m.getByTestId('home-todo-grid').boundingBox();
      assert.ok(Math.abs(listBox.x + listBox.width - (todoBox.x + todoBox.width)) <= 2, '회사 현황 목록 오른쪽 끝 = 칸 묶음 오른쪽 끝');
      const short = m.getByTestId('home-clock-short');
      if (await short.count()) assert.match(await short.innerText(), /^출근 전/);
      assert.equal(await m.getByText(/아직 출근 전입니다/).count(), 0, '긴 출근 문구 없음');
      assert.ok(await noOverflow(m), `${w}폭 가로 넘침 없음`);
    } finally { await mc.close(); }
  }
  // ② 데스크톱 1880 — 칸 수 1~7 한 줄(7은 [4,3]) · 세 줄 오른쪽 끝 같은 선 · 머리 [새로 만들기] 없음
  const dc = await browser.newContext({ viewport: { width: 1880, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  try {
    const p = await dc.newPage();
    for (let n = 1; n <= 7; n++) {
      await mockHome(p, n);
      await p.goto(`${BASE}/`); await p.getByTestId('home-todo-grid').waitFor();
      await p.waitForFunction((n) => document.querySelectorAll('[data-testid="home-todo-grid"] > a').length === n, n);
      const rows = await rowsOf(p, 'home-todo-grid');
      assert.deepEqual(rows.map((r) => r[0]), EXPECT[1880][n - 1], `1880폭 ${n}칸 줄 나눔`);
      for (const [k, l, r] of rows) assert.ok(Math.abs(l) <= 2 && Math.abs(r) <= 2, `1880폭 ${n}칸: ${k}칸 줄 끝(왼 ${l.toFixed(1)} · 오른 ${r.toFixed(1)})`);
    }
    // 마지막(7칸) 화면: 오늘 처리할 것·회사 현황·아래 묶음 오른쪽 끝 같은 선
    const ends = await p.evaluate(() => {
      const right = (sel) => Math.max(...[...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.right));
      return { todo: right('[data-testid="home-todo-grid"] > *'), company: right('[data-testid="home-company-grid"] > *'), lower: right('[data-testid="home-lower"] > *') };
    });
    assert.ok(Math.abs(ends.todo - ends.lower) <= 2 && Math.abs(ends.company - ends.lower) <= 2, `세 줄 오른쪽 끝 ${JSON.stringify(ends)}`);
    assert.deepEqual((await rowsOf(p, 'home-company-grid')).map((r) => r[0]), [3], '데스크톱 회사 현황 3칸 한 줄');
    assert.equal(await p.getByTestId('home-company-list').isVisible(), false, '데스크톱은 회사 현황 목록 숨김');
    assert.equal(await p.getByTestId('home-new').isVisible(), false, '데스크톱 머리에 [새로 만들기] 없음');
    await p.getByTestId('home-quick').waitFor();
    assert.ok(await noOverflow(p));
    await introGone(p);
    await p.screenshot({ path: `${SHOTS}/1126-home-1880.png` });
  } finally { await dc.close(); }
}
