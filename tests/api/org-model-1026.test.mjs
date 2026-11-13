// 405차 #1026 범용화 조직 모델(대표 11/13 밤 확정): 표·권한 구조는 그대로, 다른 회사는 '부서·팀'만 — "지점이 여러 곳"을 켠 회사만 조직(지점)을 나눠 쓴다
// 다짐(기본 회사): 늘 여러 곳(바꿀 수 없음) · 다른 회사: 기본 끔 → 초대하면 가입 때 만든 조직 1곳에 자동 소속 · 켜면 조직 추가 가능 · 조직이 2곳 이상이면 끌 수 없음
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T;
const msg = (r) => String(r.body?.error?.message ?? JSON.stringify(r.body));
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  const c = new Client('ceo@other-org.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@other-org.test', password: 'signup-pass-1234', name: '최사장', mode: 'team', company: '동네카페', industry: '기타', industries: [], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, id: me.user.id, tenant: me.user.tenant };
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('405차 조직 모델', () => {
  test('다짐(기본 회사): 늘 지점 여러 곳 · 바꾸기 400 · 설정 칸을 읽지 않음', async () => {
    const v = await ctx.owner.ok('GET', '/api/org/model');
    assert.deepEqual([v.multiSite, v.fixed], [true, true]); assert.ok(v.units >= 3, '본사·강남점·판교 현장');
    const r = await ctx.owner.req('PUT', '/api/org/model', { multiSite: false });
    assert.equal(r.status, 400); assert.match(msg(r), /바꾸지 않습니다/);
    await sql`update tenants set multi_site = false where id = 'default'`;
    assert.equal((await ctx.owner.ok('GET', '/api/org/model')).multiSite, true, '칸에 무엇이 있어도 기본 회사는 여러 곳');
    await sql`update tenants set multi_site = null where id = 'default'`;
  });

  test('다른 회사: 기본은 한 곳 — 초대하면 조직을 안 골라도 가입 때 만든 조직에 자동 소속', async () => {
    const v = await T.c.ok('GET', '/api/org/model');
    assert.deepEqual([v.multiSite, v.fixed, v.units], [false, false, 1]);
    const [hq] = await sql`select id, name from org_units where tenant = ${T.tenant}`;
    const inv = await T.c.ok('POST', '/api/admin/users', { email: 'barista@other-org.test', name: '김바리', role: 'staff' });
    const mate = new Client('barista@other-org.test');
    await mate.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'mate-pass-1234' });
    const me = await mate.ok('GET', '/api/auth/me');
    const ms = await sql`select org_unit_id from memberships where user_id = ${me.user.id}`;
    assert.deepEqual(ms.map((m) => m.org_unit_id), [hq.id], '그 회사의 조직 1곳에 자동 소속');
    // 직원은 설정을 바꿀 수 없음(회사 정보 메뉴 없음)
    assert.equal((await mate.req('PUT', '/api/org/model', { multiSite: true })).status, 404);
    assert.equal((await mate.ok('GET', '/api/org/model')).multiSite, false, '조회는 누구나(화면 표시용)');
    // 업무는 조직을 고르지 않아도 그 조직으로 만들어짐
    const t = await mate.ok('POST', '/api/tasks', { title: '원두 주문', orgUnitId: hq.id });
    assert.ok(t.id);
  });

  test('"지점이 여러 곳" 켜기 → 조직 추가 → 조직이 2곳 이상이면 끌 수 없음 → 하나로 정리하면 끌 수 있음 · 다짐에는 영향 없음', async () => {
    const on = await T.c.ok('PUT', '/api/org/model', { multiSite: true });
    assert.equal(on.multiSite, true);
    const [hq] = await sql`select id from org_units where tenant = ${T.tenant}`;
    const u2 = await T.c.ok('POST', '/api/admin/org-units', { name: '동네카페 2호점', type: 'branch', parentId: hq.id });
    const off = await T.c.req('PUT', '/api/org/model', { multiSite: false });
    assert.equal(off.status, 400); assert.match(msg(off), /사용 중인 조직이 2곳/);
    await T.c.ok('PATCH', `/api/admin/org-units/${u2.id}`, { active: false });
    assert.equal((await T.c.ok('PUT', '/api/org/model', { multiSite: false })).multiSite, false);
    assert.equal((await sql`select multi_site from tenants where id = ${T.tenant}`)[0].multi_site, false);
    assert.equal((await ctx.owner.ok('GET', '/api/org/model')).multiSite, true);
    assert.equal((await sql`select multi_site from tenants where id = 'default'`)[0].multi_site, null, '다짐 칸은 건드리지 않음');
    assert.equal((await fetch(`${BASE}/api/org/model`)).status, 401);
  });
});
