// V28-3 슈퍼 계정: 회사 목록·상세, 한도 개별 조정, 사용자 잠금·재설정 메일·2단계 초기화, 지원 모드(동의·읽기 전용·감사·끝내기), 삭제 예약(30일)·영구 삭제
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

let srv, sql, ctx, cust, custTenant, custOwnerId;
const form = (o) => ({ password: 'signup-pass-1234', agree: { terms: true, privacy: true, ai: true, marketing: false }, ...o });

before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', FUNNEL_STATS_TOKEN: 'funnel-token-0123456789' }); sql = testDb(); ctx = await bootstrap();
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

  test('가입 퍼널: UTM 출처별 가입 → 팀 초대(2명+) → 실사용(3일 접속), 운영자 화면·읽기 전용 토큰 API(숫자만)', async () => {
    const m = new Client('meta');
    const r = await m.ok('POST', '/api/auth/signup', form({ email: 'boss@meta.test', name: '메타대표', mode: 'team', company: '메타유입', utm: { source: 'meta', medium: 'paid', campaign: 'launch' } }));
    await m.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
    const me = await m.ok('GET', '/api/auth/me');
    const [t] = await sql`select signup_utm from tenants where id = ${me.user.tenant}`;
    assert.equal(t.signup_utm.source, 'meta');
    assert.ok((await sql`select count(*)::int n from user_active_days where user_id = ${me.user.id}`)[0].n >= 1, '접속한 날 기록');
    let f = await ctx.owner.ok('GET', '/api/platform/funnel');
    const src = (w) => Object.fromEntries(f.byWeek.flatMap((x) => x.bySource).map((s) => [s.source, s]));
    assert.equal(src().meta.signups, 1); assert.equal(src().meta.invited, 0); assert.equal(src().meta.active, 0);
    assert.equal(src().direct.signups, 1, 'UTM 없으면 direct');
    // 동료 1명 합류 + 3일 접속 → 초대 완료·실사용
    await sql`insert into users (email, name, role, password_hash, tenant) select 'mate@meta.test', '동료', 'staff', password_hash, tenant from users where id = ${me.user.id}`;
    await sql`insert into user_active_days (user_id, tenant, day) select ${me.user.id}, ${me.user.tenant}, (now() at time zone 'Asia/Seoul')::date + k from generate_series(1, 2) k on conflict do nothing`;
    f = await ctx.owner.ok('GET', '/api/platform/funnel');
    assert.equal(src().meta.invited, 1); assert.equal(src().meta.active, 1);
    assert.equal((await ctx.staffA.client.get('/api/platform/funnel')).status, 404);
    // 토큰 API: 없거나 틀리면 401, 맞으면 같은 숫자 — 이메일·회사 이름 없음
    assert.equal((await new Client().get('/api/public/funnel')).status, 401);
    const bad = await fetch(`${BASE}/api/public/funnel`, { headers: { authorization: 'Bearer wrong-token-0123456789x' } });
    assert.equal(bad.status, 401);
    const ok = await fetch(`${BASE}/api/public/funnel?weeks=4`, { headers: { authorization: 'Bearer funnel-token-0123456789' } });
    assert.equal(ok.status, 200);
    const pub = await ok.json();
    assert.equal(pub.total.signups, f.total.signups); assert.equal(pub.total.active, f.total.active);
    const txt = JSON.stringify(pub); assert.ok(!txt.includes('@') && !txt.includes('메타유입') && !txt.includes(me.user.tenant), '개인정보·회사 식별값 없음');
  });

  test('V29 업무 총량 한도(완료·휴지통 포함): 다 차면 새 업무만 429 → 보관 파일(CSV) → 정리하면 다시 만들 수 있음', async () => {
    await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/limits`, { tasksTotal: 3 });
    const a = await cust.ok('POST', '/api/tasks', { title: '총량 1' });
    const b = await cust.ok('POST', '/api/tasks', { title: '총량 2' });
    await cust.ok('DELETE', `/api/tasks/${b.id}`);
    await cust.ok('POST', '/api/tasks', { title: '총량 3' });
    const full = await cust.post('/api/tasks', { title: '총량 4' });
    assert.equal(full.status, 429, '휴지통 업무도 셈');
    let u = await cust.ok('GET', '/api/usage');
    assert.equal(u.usage.tasks, 3); assert.equal(u.limits.tasksTotal, 3);
    await cust.ok('GET', `/api/tasks/${a.id}`);
    await sql`update tasks set status = 'done', completed_at = now() - interval '100 days' where id = ${a.id}`;
    const day = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    assert.equal((await cust.ok('GET', `/api/usage/tasks-cleanup?before=${day}`)).count, 1);
    const csv = await cust.get(`/api/usage/tasks-cleanup?before=${day}&format=csv`);
    assert.equal(csv.status, 200); assert.match(csv.body, /총량 1/);
    assert.equal((await ctx.staffA.client.post('/api/usage/tasks-cleanup', { before: day })).status >= 400, true);
    const r = await cust.ok('POST', '/api/usage/tasks-cleanup', { before: day });
    assert.equal(r.purged, 1); assert.equal(r.total, 2);
    assert.equal((await cust.get(`/api/tasks/${a.id}`)).status, 404, '정리한 업무는 화면에서 빠짐');
    assert.ok(!(await cust.ok('GET', '/api/tasks/trash')).tasks.some((x) => x.id === a.id), '휴지통에도 없음');
    await cust.ok('POST', '/api/tasks', { title: '총량 다시' });
    assert.ok((await sql`select count(*)::int n from audit_logs where action = 'tasks.cleanup'`)[0].n >= 1);
    await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/limits`, { clear: ['tasksTotal'] });
    u = await cust.ok('GET', '/api/usage'); assert.equal(u.limits.tasksTotal, null);
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
