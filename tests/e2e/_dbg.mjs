import { chromium } from 'playwright';
import { bootstrap, resetDb, startServer, BASE, testDb } from '../helpers.mjs';
await resetDb(); const srv = await startServer(); const ctx = await bootstrap(); const sql = testDb();
const t = (await ctx.owner.ok('POST', '/api/tasks', { title: '해지시험', orgUnitId: ctx.hq, assigneeId: ctx.ownerId, approvalRequired: false })).id;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const c = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ko-KR' }); const p = await c.newPage();
p.on('console', (m) => m.type() === 'error' && console.log('console', m.text()));
await p.goto(BASE + '/login'); await p.getByLabel('이메일', { exact: true }).fill('ceo@dagym.test'); await p.getByLabel('비밀번호').fill('owner-pass-1234'); await p.getByRole('button', { name: '로그인' }).click(); await p.waitForURL(BASE + '/');
await p.goto(BASE + '/tasks');
const row = p.locator(`[data-row="${t}"]`);
await row.getByTestId('check-circle').click(); await p.waitForTimeout(1200);
console.log('after complete', (await sql`select status from tasks where id=${t}`)[0].status, 'row visible', await row.count());
// 완료 보기
await p.goto(BASE + '/tasks?view=done'); await p.waitForTimeout(1500);
const r2 = p.locator(`[data-row="${t}"]`);
console.log('done view rows', await r2.count(), 'disabled', await r2.getByTestId('check-circle').isDisabled().catch((e) => e.message));
await r2.getByTestId('check-circle').click().catch((e) => console.log('click err', e.message.slice(0, 200)));
await p.waitForTimeout(1500);
console.log('after undo (list)', (await sql`select status from tasks where id=${t}`)[0].status);
// 상세
await sql`update tasks set status='done', completed_at=now() where id=${t}`;
await p.goto(`${BASE}/tasks/${t}`); await p.waitForTimeout(1000);
await p.getByRole('button', { name: '다시 진행' }).click().catch((e) => console.log('detail err', e.message.slice(0, 200)));
await p.waitForTimeout(1500);
console.log('after undo (detail)', (await sql`select status from tasks where id=${t}`)[0].status);
await b.close(); srv.proc.kill(); await sql.end(); process.exit(0);
