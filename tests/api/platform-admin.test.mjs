// V28-3 슈퍼 계정: 회사 목록·상세, 한도 개별 조정, 사용자 잠금·재설정 메일·2단계 초기화, 지원 모드(동의·읽기 전용·감사·끝내기), 삭제 예약(30일)·영구 삭제
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, sql, ctx, cust, custTenant, custOwnerId;
const form = (o) => ({ password: 'signup-pass-1234', agree: { terms: true, privacy: true, ai: true, marketing: false }, ...o });

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  cust = new Client('cust');
  const r = await cust.ok('POST', '/api/auth/signup', form({ email: 'boss@cust.test', name: '고객대표', mode: 'team', company: '고객회사' }));
  await cust.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await cust.ok('GET', '/api/auth/me');
  custTenant = me.user.tenant; custOwnerId = me.user.id;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('V28-3 슈퍼 계정', () => {
  test('회사 목록·검색·상세 — 플랫폼 운영자만(다른 사람 404)', async () => {
    const l = await ctx.owner.ok('GET', `/api/platform/tenants?q=${encodeURIComponent('고객')}`);
    assert.deepEqual(l.tenants.map((t) => t.id), [custTenant]);
    assert.equal(l.tenants[0].owner_email, 'boss@cust.test');
    assert.equal((await ctx.staffA.client.get('/api/platform/tenants')).status, 404);
    assert.equal((await cust.get('/api/platform/tenants')).status, 404);
    const d = await ctx.owner.ok('GET', `/api/platform/tenants/${custTenant}/detail`);
    assert.equal(d.users[0].email, 'boss@cust.test');
  });

  test('한도 개별 조정(요금제 대신) → 비우면 요금제 값으로', async () => {
    await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/limits`, { users: 2, aiRequests: 999 });
    let u = await cust.ok('GET', '/api/usage');
    assert.equal(u.limits.users, 2); assert.equal(u.limits.aiRequests, 999);
    await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/limits`, { clear: ['users', 'aiRequests'] });
    u = await cust.ok('GET', '/api/usage');
    assert.notEqual(u.limits.users, 2);
  });

  test('사용자 잠금·해제, 재설정 메일(비밀번호는 안 보임), 2단계 초기화, 본인·운영자 계정 보호', async () => {
    await ctx.owner.ok('POST', `/api/platform/users/${custOwnerId}`, { action: 'lock' });
    assert.equal((await cust.get('/api/auth/me')).status, 401, '잠그면 바로 로그아웃');
    assert.equal((await new Client().post('/api/auth/login', { email: 'boss@cust.test', password: 'signup-pass-1234' })).status >= 400, true);
    await ctx.owner.ok('POST', `/api/platform/users/${custOwnerId}`, { action: 'unlock' });
    await cust.ok('POST', '/api/auth/login', { email: 'boss@cust.test', password: 'signup-pass-1234' });
    const r = await ctx.owner.ok('POST', `/api/platform/users/${custOwnerId}`, { action: 'reset_password' });
    assert.equal(r.sentTo, 'boss@cust.test'); assert.match(r.devLink, /^\/reset\//); assert.ok(!JSON.stringify(r).includes('signup-pass'));
    await ctx.owner.ok('POST', `/api/platform/users/${custOwnerId}`, { action: 'reset_2fa' });
    await cust.ok('POST', '/api/auth/login', { email: 'boss@cust.test', password: 'signup-pass-1234' });
    assert.equal((await ctx.owner.post(`/api/platform/users/${ctx.ownerId}`, { action: 'lock' })).status, 400, '본인 계정은 안 됨');
    assert.equal((await ctx.staffA.client.post(`/api/platform/users/${custOwnerId}`, { action: 'lock' })).status, 404);
    assert.ok((await sql`select count(*)::int n from audit_logs where action like 'platform.user_%'`)[0].n >= 4);
  });

  test('지원 모드: 동의 없으면 403 → 동의 후 읽기 전용(쓰기 403·운영 화면 404)·모든 요청 감사 → 끝내기·동의 끄면 즉시 종료', async () => {
    assert.equal((await ctx.owner.post(`/api/platform/tenants/${custTenant}/support`, { reason: '문의 #1' })).status, 403);
    assert.equal((await ctx.staffA.client.req('PUT', '/api/account/support-consent', { on: true })).status, 403, '대표만');
    await cust.ok('PUT', '/api/account/support-consent', { on: true });
    const p = new Client('platform'); await p.ok('POST', '/api/auth/login', { email: 'ceo@dagym.test', password: 'owner-pass-1234' });
    const s = await p.req('POST', `/api/platform/tenants/${custTenant}/support`, { reason: '문의 #1' });
    assert.equal(s.status, 200);
    const sc = (s.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('wos_support='));
    assert.ok(sc && /HttpOnly/i.test(sc));
    p.cookie += '; ' + sc.split(';')[0];
    const me = await p.ok('GET', '/api/auth/me');
    assert.equal(me.user.id, custOwnerId); assert.equal(me.user.tenant, custTenant);
    await p.ok('GET', '/api/tasks');
    assert.equal((await p.post('/api/tasks', { title: '지원 모드에서 쓰기' })).status, 403);
    assert.equal((await p.get('/api/platform/tenants')).status, 404, '지원 모드 중 운영 화면 막음');
    assert.ok((await sql`select count(*)::int n from audit_logs where action = 'support.request' and actor_id = ${ctx.ownerId}`)[0].n >= 3);
    await p.ok('DELETE', '/api/platform/support');
    p.cookie = p.cookie.replace(/; wos_support=[^;]*/, '');
    assert.equal((await p.ok('GET', '/api/auth/me')).user.id, ctx.ownerId);
    // 다시 시작했다가 고객이 허용을 끄면 바로 끝남
    const s2 = await p.req('POST', `/api/platform/tenants/${custTenant}/support`, { reason: '문의 #2' });
    p.cookie += '; ' + (s2.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('wos_support=')).split(';')[0];
    assert.equal((await p.ok('GET', '/api/auth/me')).user.id, custOwnerId);
    await cust.ok('PUT', '/api/account/support-consent', { on: false });
    assert.equal((await p.ok('GET', '/api/auth/me')).user.id, ctx.ownerId, '허용을 끄면 지원 모드 즉시 종료');
  });

  test('삭제 예약(이름 확인·30일 유예) → 취소 → 예약일 지나면 영구 삭제, 기본 회사는 불가', async () => {
    assert.equal((await ctx.owner.post(`/api/platform/tenants/${custTenant}/delete`, { action: 'schedule', confirmName: '틀린이름' })).status, 400);
    await ctx.owner.ok('POST', `/api/platform/tenants/${custTenant}/delete`, { action: 'schedule', confirmName: '고객회사' });
    assert.ok((await sql`select delete_scheduled_at from tenants where id = ${custTenant}`)[0].delete_scheduled_at);
    assert.equal((await ctx.owner.post(`/api/platform/tenants/${custTenant}/delete`, { action: 'execute', confirmName: '고객회사' })).status, 400, '30일 전에는 실행 불가');
    await ctx.owner.ok('POST', `/api/platform/tenants/${custTenant}/delete`, { action: 'cancel' });
    assert.equal((await sql`select delete_scheduled_at from tenants where id = ${custTenant}`)[0].delete_scheduled_at, null);
    await ctx.owner.ok('POST', `/api/platform/tenants/${custTenant}/delete`, { action: 'schedule', confirmName: '고객회사' });
    await sql`update tenants set delete_scheduled_at = now() - interval '1 minute' where id = ${custTenant}`;
    await ctx.owner.ok('POST', `/api/platform/tenants/${custTenant}/delete`, { action: 'execute', confirmName: '고객회사' });
    assert.equal((await sql`select status from tenants where id = ${custTenant}`)[0].status, 'deleted');
    assert.equal((await cust.get('/api/auth/me')).status, 401);
    assert.equal((await ctx.owner.post('/api/platform/tenants/default/delete', { action: 'schedule', confirmName: 'x' })).status, 400);
  });
});
