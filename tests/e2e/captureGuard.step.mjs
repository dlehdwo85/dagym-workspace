// #626 캡처 차단(대표 10/25 20:05): 외부 고객사 로그인 → 워터마크 레이어(회사·이름)·인쇄 차단 표시(html.capture-block)·Ctrl+P 안내·창 이탈 가림·자동화 판정 함수(시험 서버는 감지만 끔) → 사건 기록 / 우리 회사(내부)는 아무것도 없음
import assert from 'node:assert/strict';

export async function captureGuard({ browser, BASE, SHOTS, sql, Client, owner }) {
  const form = (o) => ({ password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false }, ...o });
  const c = new Client('cust-capture-e2e');
  const r = await c.ok('POST', '/api/auth/signup', form({ email: 'boss@capture-e2e.test', name: '캡처대표', mode: 'team', company: '캡처고객사' }));
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const p = await ctx.newPage();
  try {
    await p.goto(BASE + '/login');
    await p.getByLabel('이메일', { exact: true }).fill('boss@capture-e2e.test'); await p.getByLabel('비밀번호').fill('signup-pass-1234');
    await p.getByRole('button', { name: '로그인' }).click();
    const wm = p.getByTestId('capture-watermark'); await wm.waitFor({ state: 'attached', timeout: 60_000 });
    const bg = decodeURIComponent(await wm.evaluate((el) => getComputedStyle(el).backgroundImage));
    assert.ok(/data:image\/svg\+xml/.test(bg) && bg.includes('캡처고객사') && bg.includes('캡처대표'), `워터마크에 회사·이름 ${bg.slice(0, 120)}`);
    assert.ok(await p.evaluate(() => document.documentElement.classList.contains('capture-block')), 'html.capture-block(인쇄 차단 CSS)');
    const signals = await p.evaluate(() => window.__wosCaptureSignals?.());
    assert.ok(Array.isArray(signals) && signals.some((x) => x === 'webdriver' || x === 'headless_ua'), `Playwright = 자동화 흔적(웹드라이버·헤드리스 UA, 시험 서버는 판정만 노출) ${JSON.stringify(signals)}`);
    await p.keyboard.press('Control+KeyP');
    await p.getByText('이 화면은 인쇄할 수 없습니다.').first().waitFor({ timeout: 10_000 });
    await p.evaluate(() => window.dispatchEvent(new Event('blur')));
    await p.getByTestId('capture-away').waitFor({ timeout: 10_000 });
    await p.screenshot({ path: `${SHOTS}/301-capture-guard-away.png` });
    await p.getByTestId('capture-away').click();
    await p.getByTestId('capture-away').waitFor({ state: 'detached', timeout: 10_000 });
    await p.screenshot({ path: `${SHOTS}/300-capture-guard.png` });
    let rec = [];
    for (let i = 0; i < 25 && !rec.length; i++) { rec = await sql`select detail from audit_logs where action = 'security.capture_event' and detail->>'kind' = 'print'`; if (!rec.length) await new Promise((r) => setTimeout(r, 200)); }
    assert.equal(rec.length, 1, '인쇄 시도 기록(경로만)'); assert.equal(rec[0].detail.path, '/');
    // 우리 회사(내부)·슈퍼관리자: 워터마크 없음
    await owner.goto(BASE + '/'); await owner.getByTestId('home-today').waitFor({ timeout: 30_000 }).catch(() => {});
    assert.equal(await owner.getByTestId('capture-watermark').count(), 0, '내부 테넌트는 워터마크 없음');
    assert.ok(!(await owner.evaluate(() => document.documentElement.classList.contains('capture-block'))), '내부 테넌트는 인쇄 차단 없음');
  } finally { await ctx.close(); }
}
