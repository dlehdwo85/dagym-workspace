// 대표 11/26(웹 홈 구성 "앱 화면은 괜찮은데 웹 화면 구성이 좀 별로", 1880px 캡처): 데스크톱 홈 세 줄(오늘 처리할 것·회사 현황·이번 주+오른쪽 묶음)의
// 오른쪽 끝이 같은 선(±2px) · 머리 [새로 만들기] 없음(상단 바 [+ 만들기]·빠른 만들기와 겹침) · 출근 전 문구 짧게 — 375 폭(앱·휴대폰)은 지금 그대로
import assert from 'node:assert/strict';

const rights = (page) => page.evaluate(() => {
  const maxRight = (sel) => { const xs = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.right); return xs.length ? Math.max(...xs) : null; };
  return { todo: maxRight('[data-testid="home-todo-grid"] > *'), company: maxRight('[data-testid="home-company-grid"] > *'), lower: maxRight('[data-testid="home-lower"] > *') };
});
const cols = (page, id) => page.evaluate((id) => { const g = document.querySelector(`[data-testid="${id}"]`); return g ? getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length : null; }, id);

export async function homeLayout1126({ browser, desk, ctx, BASE, SHOTS }) {
  // 오늘 처리할 것 칸이 하나는 있게 — 기한 지난 내 업무 1건(끝나면 지움)
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(Date.now() - 2 * 864e5));
  const made = await ctx.owner.ok('POST', '/api/tasks', { title: 'E2E 1126 홈 배치 기한 지남', assigneeId: ctx.ownerId, orgUnitId: ctx.hq, dueDate: y });
  try {
  // ① 데스크톱 1880×1000
  const dc = await browser.newContext({ viewport: { width: 1880, height: 1000 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  try {
    const p = await dc.newPage();
    await p.goto(`${BASE}/`); await p.getByTestId('home-todo').waitFor();
    await p.locator('[data-testid="home-todo-grid"] [data-testid^="home-cell-"], [data-testid="home-todo-empty"]').first().waitFor();
    const r = await rights(p);
    assert.ok(r.todo !== null, '오늘 처리할 것 칸이 있어야 대조 가능');
    assert.ok(Math.abs(r.todo - r.lower) <= 2, `오늘 처리할 것 오른쪽 끝 ${r.todo} ≠ 아래 묶음 ${r.lower}`);
    if (r.company !== null) assert.ok(Math.abs(r.company - r.lower) <= 2, `회사 현황 오른쪽 끝 ${r.company} ≠ 아래 묶음 ${r.lower}`);
    assert.equal(await p.getByTestId('home-new').isVisible(), false, '데스크톱 머리에 [새로 만들기] 없음');
    await p.getByTestId('home-quick').waitFor(); // 빠른 만들기는 그대로
    const long = p.getByTestId('home-clock-status').getByText(/아직 출근 전입니다/);
    if (await long.count()) {
      assert.equal(await long.isVisible(), false, '데스크톱은 긴 문구 숨김');
      assert.match(await p.getByTestId('home-clock-short').innerText(), /^출근 전/);
    }
    await p.locator('#wos-intro').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {}); // 세션 첫 화면 실행 애니메이션(약 1초)이 걷힌 뒤 찍음
    await p.screenshot({ path: `${SHOTS}/1126-home-1880.png` });
  } finally { await dc.close(); }
  // ② 375 폭(앱·휴대폰) — 지금 배치 그대로: 오늘 처리할 것 3칸 · 회사 현황 2칸 · 이번 주 아래에 빠른 만들기 · 긴 출근 문구
  const mc = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, locale: 'ko-KR', timezoneId: 'Asia/Seoul', storageState: await desk.storageState() });
  try {
    const m = await mc.newPage();
    await m.goto(`${BASE}/`); await m.getByTestId('home-todo').waitFor();
    await m.locator('[data-testid="home-todo-grid"] [data-testid^="home-cell-"], [data-testid="home-todo-empty"]').first().waitFor();
    if (await m.getByTestId('home-todo-grid').count()) assert.equal(await cols(m, 'home-todo-grid'), 3, '휴대폰 오늘 처리할 것 3칸');
    if (await m.getByTestId('home-company-grid').count()) assert.equal(await cols(m, 'home-company-grid'), 2, '휴대폰 회사 현황 2칸');
    const [week, quick] = await Promise.all([m.getByTestId('home-week').boundingBox(), m.getByTestId('home-quick').boundingBox()]);
    assert.ok(quick.y >= week.y + week.height - 1, '휴대폰은 빠른 만들기가 이번 주 아래');
    assert.equal(await m.getByTestId('home-clock-short').isVisible().catch(() => false), false, '휴대폰은 짧은 문구 안 씀');
    assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '가로 넘침 없음');
    await m.locator('#wos-intro').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await m.screenshot({ path: `${SHOTS}/1126-home-375.png` });
  } finally { await mc.close(); }
  } finally { await ctx.owner.req('DELETE', `/api/tasks/${made.id ?? made.task?.id}`).catch(() => {}); }
}
