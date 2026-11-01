// 302차 #862(대표 11/01 '앱결제 없이 웹에서 결제하도록 앱에서 안내할 때 편리할 수 있도록'): 앱 화면·알림에는 결제 권유 없이(관리자에게 문의만),
// 결제 안내는 관리자 이메일로 — HTML 메일(회사·인원·추천 요금제·월 금액·[결제하기]) · 체험 7일 전 메일 추가 · 로그인 안 된 채 [결제하기] → 로그인 뒤 결제 화면으로
// (구조 시험 — 메일은 가짜 Resend 로 받음. 실제 메일 도착·휴대폰 나이스페이 결제는 운영 확인)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BASE, Client, bootstrap, resetDb, startServer, testDb, tick } from '../helpers.mjs';

let srv, sql, ctx, mailSrv; const mails = []; const N = {};
const APP_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 WorkInApp';

before(async () => {
  mailSrv = createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { try { mails.push(JSON.parse(b)); } catch { /* 무시 */ } res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"id":"t"}'); }); });
  await new Promise((r) => mailSrv.listen(0, '127.0.0.1', r));
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', RESEND_API_KEY: 'test-key', MAIL_FROM: '워크인 <no-reply@work.test>', RESEND_API_BASE: `http://127.0.0.1:${mailSrv.address().port}` });
  sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const c = await ctx.owner.ok('POST', '/api/platform/tenants', { company: '결제안내회사', industries: [], size: '2-10', ownerName: '김대표', ownerEmail: 'boss@pay862.test', segment: 'customer', trialDays: 14 });
  N.t = c.tenant;
  N.boss = new Client('pay-boss');
  await N.boss.ok('POST', `/api/invitations/${c.inviteLink.split('/').pop()}/accept`, { password: 'pay-boss-1234' });
});
after(async () => { srv?.proc.kill(); mailSrv?.close(); await sql?.end(); });

test('체험 7일 전: 관리자에게 HTML 결제 안내 메일 1통(회사·인원·추천 요금제·월 금액·[결제하기] → /admin/usage?pay=1&plan=) · 알림함은 결제 권유 없이 · 같은 단계는 한 번만', async () => {
  await sql`update tenant_subscriptions set trial_ends_at = (date_trunc('day', now() at time zone 'Asia/Seoul') + interval '6 days 12 hours') at time zone 'Asia/Seoul', trial_notified = '{}'::jsonb where tenant = ${N.t}`;
  mails.length = 0;
  await tick();
  const mine = mails.filter((m) => m.to?.includes('boss@pay862.test'));
  assert.equal(mine.length, 1, JSON.stringify(mails.map((m) => [m.to, m.subject])));
  const m = mine[0];
  assert.equal(m.subject, '[워크인] 무료 체험이 6일 남았습니다');
  assert.match(m.html, /data-pay-button="1"/); assert.match(m.html, /결제하기/);
  const href = /href="([^"]+)" data-pay-button/.exec(m.html)[1].replace(/&amp;/g, '&');
  const u = new URL(href);
  assert.equal(u.pathname, '/admin/usage'); assert.equal(u.searchParams.get('pay'), '1'); assert.ok(u.searchParams.get('plan'), href);
  assert.match(m.html, /결제안내회사/); assert.match(m.html, /사용 인원/); assert.match(m.html, /추천 요금제/); assert.match(m.html, /월 금액[\s\S]*원 \(부가세 포함\)/);
  assert.match(m.text, /^무료 체험이 6일 남았습니다/); assert.match(m.text, /결제하기: http/); assert.match(m.text, /끝나는 때:/);
  const [s] = await sql`select trial_notified from tenant_subscriptions where tenant = ${N.t}`;
  assert.equal(s.trial_notified.d7, true);
  const [n] = await sql`select n.body from notifications n join users u on u.id = n.user_id where u.email = 'boss@pay862.test' and n.title like '무료 체험이%' order by n.created_at desc limit 1`;
  assert.ok(n && !/결제|요금|원/.test(n.body), `알림함 본문에 결제 권유 없음: ${n?.body}`);
  mails.length = 0; await tick();
  assert.equal(mails.filter((x) => x.to?.includes('boss@pay862.test')).length, 0, '같은 단계는 다시 안 보냄');
});

test('로그인 안 된 채 [결제하기] 주소 → 로그인 화면(next=결제 화면 주소) · 로그인하면 그 주소로', async () => {
  const r = await fetch(`${BASE}/admin/usage?pay=1&plan=w_basic`, { redirect: 'manual' });
  assert.ok([302, 303, 307, 308].includes(r.status), String(r.status));
  const loc = new URL(r.headers.get('location'), BASE);
  assert.equal(loc.pathname, '/login'); assert.equal(loc.searchParams.get('next'), '/admin/usage?pay=1&plan=w_basic');
  const home = await fetch(`${BASE}/tasks`, { redirect: 'manual' });
  assert.equal(new URL(home.headers.get('location'), BASE).searchParams.get('next'), '/tasks');
});

test('체험이 끝난 읽기 전용: 앱(WorkInApp)에서 쓰기 = "보기 전용 상태입니다. 회사 관리자에게 문의하세요."(요금·결제 말 없음) · 웹은 지금처럼 요금제 안내', async () => {
  await sql`update tenant_subscriptions set trial_ends_at = now() - interval '1 hour' where tenant = ${N.t}`;
  await tick();
  const app = await N.boss.req('POST', '/api/tasks', { title: '앱에서 쓰기 시험' }, { 'user-agent': APP_UA });
  assert.equal(app.status, 402); assert.equal(app.body.error.message, '보기 전용 상태입니다. 회사 관리자에게 문의하세요.');
  const web = await N.boss.req('POST', '/api/tasks', { title: '웹에서 쓰기 시험' });
  assert.equal(web.status, 402); assert.match(web.body.error.message, /요금제를 선택하면/);
  assert.equal((await N.boss.req('GET', '/api/tasks', undefined, { 'user-agent': APP_UA })).status, 200, '보기는 그대로');
});
