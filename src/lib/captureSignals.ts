// #626 자동화 브라우저(웹드라이버·헤드리스·스크립트 주입) 흔적 — 클라이언트에서 가볍게(수 ms). 위장 자동화(stealth)는 못 잡는다(정직하게 §2-2 D).
// 순수 함수라 서버·시험(가짜 navigator)에서도 부를 수 있다.
export function automationSignals(
  nav: { webdriver?: boolean; userAgent?: string; languages?: readonly string[] | null } | null | undefined,
  win?: Record<string, unknown> | null,
): string[] {
  const s: string[] = [];
  if (!nav) return s;
  if (nav.webdriver) s.push('webdriver');
  if (/HeadlessChrome|PhantomJS|Puppeteer|Playwright|Selenium|SlimerJS|Nightmare/i.test(String(nav.userAgent ?? ''))) s.push('headless_ua');
  if (Array.isArray(nav.languages) && nav.languages.length === 0) s.push('no_languages');
  const keys = ['__playwright', '__pw_manual', '__puppeteer_evaluation_script__', 'callPhantom', '_phantom', '__nightmare', '__selenium_unwrapped', '__webdriver_evaluate', '__driver_evaluate', 'domAutomation', 'domAutomationController', '_Selenium_IDE_Recorder', 'cdc_adoQpoasnfa76pfcZLmcfl_Array'];
  if (win && keys.some((k) => k in win)) s.push('automation_globals');
  return s;
}
