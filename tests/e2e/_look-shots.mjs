// 화면 비교용 사진(개발 도구, 시험 아님): 같은 시험 자료로 주요 8화면 × 390·768·1440 — node tests/e2e/_look-shots.mjs <출력 폴더> <before|after>
import { chromium } from 'playwright';
import { bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';
const [out, phase] = process.argv.slice(2);
await resetDb(); const srv = await startServer(); const ctx = await bootstrap(); const sql = testDb();
await sql`update tenants set spaces = array['work','sales','marketing'] where id = 'default'`;
const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '현장 점검 보고서 정리', assigneeId: ctx.staffA.id, dueDate: new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10) })).id;
await ctx.owner.ok('POST', '/api/tasks', { title: '월간 회의 자료 준비', assigneeId: ctx.ownerId });
const b = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
const pages = [['home', '/'], ['tasks', '/tasks'], ['task', `/tasks/${t}`], ['approvals', '/approvals'], ['sales', '/s/sales'], ['marketing', '/s/marketing'], ['branch', '/branch-reports'], ['settings', '/settings']];
for (const w of [1440, 768, 390]) {
  const c = await b.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  await c.addCookies([{ name: 'wos_session', value: ctx.owner.cookie.split('=').slice(1).join('='), url: BASE }]);
  await c.addInitScript(() => { try { localStorage.setItem('wos_tour_done', '1'); localStorage.setItem('wos-perm-intro-done', '1'); } catch {} });
  const p = await c.newPage();
  for (const [n, path] of pages) {
    await p.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/${phase}-${n}-${w}.png`, fullPage: true });
  }
  await c.close();
}
await b.close(); srv.proc.kill(); await sql.end(); console.log('shots done');
