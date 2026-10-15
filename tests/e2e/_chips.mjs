// V14 42 측정용: 412px 업무 보기 칩 캡처 (node tests/e2e/_chips.mjs)
import { chromium } from 'playwright';
import { bootstrap, resetDb, startServer, BASE, addDays, seoulToday } from '../helpers.mjs';
await resetDb(); const srv = await startServer(); const ctx = await bootstrap();
for (let i = 0; i < 19; i++) await ctx.owner.ok('POST', '/api/tasks', { title: `지시 ${i}`, assigneeId: ctx.staffA.id, dueDate: addDays(seoulToday(), i - 3), approvalRequired: false });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const c = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, locale: 'ko-KR' });
const p = await c.newPage();
await p.goto(BASE + '/login'); await p.getByLabel('이메일', { exact: true }).fill('ceo@dagym.test'); await p.getByLabel('비밀번호').fill('owner-pass-1234'); await p.getByRole('button', { name: '로그인' }).click(); await p.waitForURL(BASE + '/');
await p.goto(BASE + '/tasks'); await p.getByTestId('view-chips').locator('[data-count="requested"]').waitFor();
console.log(await p.getByTestId('view-chips').evaluate((el) => [...el.querySelectorAll('button')].map((x) => `${x.innerText.replace(/\n/g, ' ')}:${x.scrollWidth > x.clientWidth ? 'CUT' : 'ok'}`).join(' | ')));
await p.screenshot({ path: 'test-results/chips.png', clip: { x: 0, y: 0, width: 412, height: 300 } });
await b.close(); srv.proc.kill(); process.exit(0);
