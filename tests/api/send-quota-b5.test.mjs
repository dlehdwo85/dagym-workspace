// 상용화 B5(대표 위임 11/24): 회사별 하루 발송 상한 — 회사 행동으로 워크인이 대신 보내는 메일·알림톡.
// ① 상한(시험 2통)까지는 초대 메일이 가고, 넘으면 메일 없이 초대만(링크 직접 전달) · 못 보낸 이유가 초대 줄에 남음
// ② 처음 넘은 날 감사 기록·플랫폼 운영자 알림 1번(더 넘어도 다시 안 옴) · ③ 우리 회사(default)는 상한 없음
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SEND_CAP_MAIL: '2' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const c = new Client('ceo@quota-b5.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@quota-b5.test', password: 'signup-pass-1234', name: '한대표', mode: 'team', company: '발송상사', industry: '운동·피트니스', industries: ['운동·피트니스'], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, tenant: me.user.tenant };
  await sql`update tenants set signup_status = 'approved' where id = ${T.tenant}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('하루 메일 상한: 2통까지 초대 메일 · 3통째부터 메일 없이 초대만(이유 기록) · 운영자 알림 1번 · 우리 회사는 상한 없음', async () => {
  const res = [];
  for (const k of [1, 2, 3, 4]) res.push(await T.c.ok('POST', '/api/admin/users', { email: `staff${k}@quota-b5.test`, name: `직원${k}`, role: 'staff' }));
  assert.deepEqual(res.map((r) => r.mail), ['dev', 'dev', 'failed', 'failed']);
  assert.ok(res.every((r) => r.path.startsWith('/invite/')), '초대 링크는 그대로');
  const [inv] = await sql`select mail_status, mail_error from invitations where email = 'staff3@quota-b5.test'`;
  assert.equal(inv.mail_status, 'failed'); assert.match(inv.mail_error, /오늘 회사 메일 발송 한도\(2통\)/);
  assert.equal((await sql`select n from send_quota where tenant = ${T.tenant} and channel = 'mail'`)[0].n, 4);
  assert.equal((await sql`select count(*)::int n from audit_logs where action = 'send.daily_cap'`)[0].n, 1, '처음 넘은 날 한 번만');
  const ns = await sql`select title from notifications where user_id = ${ctx.ownerId} and title like '하루 메일 발송 한도 도달%'`;
  assert.equal(ns.length, 1); assert.match(ns[0].title, /발송상사/);

  for (const k of [1, 2, 3]) assert.equal((await ctx.owner.ok('POST', '/api/admin/users', { email: `ours${k}@dagym.test`, name: `우리${k}`, role: 'staff' })).mail, 'dev', '우리 회사는 상한 없음');
  assert.equal((await sql`select count(*)::int n from send_quota where tenant = 'default'`)[0].n, 0);
});
