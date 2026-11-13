// 407차 범용화 '감사 기록 회사별'(대표 11/14 결정 '가안' — "추천대로 빼 주세요. 슈퍼관리자 계정에서만 타 회사 요금제 등 정보 확인할 수 있도록"):
// · 회사의 [감사 기록] 화면 = 그 회사 계정의 기록만(다짐도 다짐 것만 — 다짐 화면이 달라지는 유일한 예외로 대표 승인)
// · 플랫폼 운영 행위(고객사 메모·요금제·지원 접속 등)와 누구 것인지 알 수 없는 기록(없는 메일로 로그인 실패)은 어느 회사 화면에도 안 보이고 플랫폼 운영 화면에만
// · 행위자 없는 기록: 대상이 사람 → 그 사람의 회사 · 대상이 회사 → 그 회사 · 현장 매출 → 기본 회사
// · 플랫폼 운영 화면(대표 계정 전용): 모든 회사 감사 기록 — 회사 열·회사 거름
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T, mate, admin;
const j = (x) => JSON.stringify(x);
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  // 다짐 본사 관리자(플랫폼 운영자 아님)
  const hq = ctx.hq;
  const invA = await ctx.owner.ok('POST', '/api/admin/users', { email: 'hqadmin@dagym.test', name: '본사관리', role: 'admin', orgUnitIds: [hq] });
  admin = new Client('hqadmin'); await admin.ok('POST', `/api/invitations/${invA.path.split('/').pop()}/accept`, { password: 'admin-pass-1234' });
  // 다른 회사(대표 + 직원)
  const c = new Client('ceo@other-audit.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@other-audit.test', password: 'signup-pass-1234', name: '박대표', mode: 'team', company: '튼튼상사', industry: '유통·판매', industries: [], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, id: me.user.id, tenant: me.user.tenant };
  const units = (await c.ok('GET', '/api/admin/org-units')).units;
  const inv = await c.ok('POST', '/api/admin/users', { email: 'staff@other-audit.test', name: '김사원', role: 'staff', orgUnitIds: [units[0].id] });
  mate = new Client('staff@other-audit.test'); await mate.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'mate-pass-1234' });
  // 기록 만들기: 플랫폼 운영 행위(다짐 대표 → 튼튼상사) · 로그인 실패 3종(다짐 직원 · 튼튼상사 대표 · 없는 메일)
  await ctx.owner.ok('PUT', `/api/platform/tenants/${T.tenant}/memo`, { memo: '계약 12월' });
  for (const email of ['staffA@dagym.test', 'ceo@other-audit.test', 'nobody@nowhere.test']) await new Client().req('POST', '/api/auth/login', { email, password: 'wrong-password-000' });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

describe('407차 감사 기록 회사별', () => {
  test('다짐 [감사 기록]: 다짐 계정의 기록만 — 다른 회사 사람·플랫폼 운영 행위·회사 미상 기록은 안 보임(본사 관리자도 같음)', async () => {
    for (const who of [ctx.owner, admin]) {
      const { logs } = await who.ok('GET', '/api/admin/audit');
      const s = j(logs);
      assert.ok(logs.length > 0);
      assert.ok(logs.some((l) => l.action === 'user.invite' && l.actor_name === '김대표'), '다짐 대표의 직원 초대');
      assert.ok(logs.some((l) => l.action === 'auth.login_failed' && l.detail.email === 'staffa@dagym.test'), '다짐 직원의 로그인 실패(행위자 없음 → 대상의 회사)'); // 메일은 소문자로 기록
      assert.ok(!logs.some((l) => l.actor_name === '박대표' || l.actor_name === '김사원'), '다른 회사 사람의 기록 없음');
      assert.ok(!s.includes('other-audit.test') && !s.includes('nowhere.test'), '다른 회사·없는 메일의 로그인 실패 없음');
      assert.ok(!logs.some((l) => String(l.action).startsWith('platform.')) && !s.includes(T.tenant), '플랫폼 운영 행위(고객사 메모) 없음 — 고객사 id 도 없음');
    }
    // DB: 다짐 화면에 나온 줄은 모두 tenant = default
    const [{ n }] = await sql`select count(*)::int n from audit_logs where tenant = 'default'`;
    assert.ok(n > 0);
  });

  test('다른 회사 [감사 기록]: 대표는 자기 회사 기록만(예전 404 → 열림) · 직원은 메뉴 없음 · 다짐 기록·운영자가 한 일은 안 보임', async () => {
    const { logs } = await T.c.ok('GET', '/api/admin/audit');
    const s = j(logs);
    assert.ok(logs.some((l) => l.action === 'user.invite' && l.actor_name === '박대표'), s.slice(0, 300));
    assert.ok(logs.some((l) => l.action === 'user.accept_invite'), '직원 초대 수락');
    assert.ok(logs.some((l) => l.action === 'auth.login_failed' && l.detail.email === 'ceo@other-audit.test'), '자기 회사 계정의 로그인 실패');
    assert.ok(!logs.some((l) => ['김대표', '본사관리', '이직원'].includes(l.actor_name)) && !s.includes('dagym.test') && !s.includes('nowhere.test'));
    assert.ok(!logs.some((l) => String(l.action).startsWith('platform.')), '운영자가 남긴 메모 기록은 고객사 화면에 없음');
    assert.ok([403, 404].includes((await mate.get('/api/admin/audit')).status), '직원은 권한 없음');
    // 화면 입구: 다른 회사 대표도 감사 기록 화면이 열림 · 운영 상태(서버 운영)는 예전처럼 권한 없음
    const page = async (c, path) => { const r = await c.get(path); return { status: r.status, blocked: String(r.body).includes('admin-no-access') }; };
    assert.deepEqual(await page(T.c, '/admin/audit'), { status: 200, blocked: false });
    assert.deepEqual(await page(T.c, '/admin/ops'), { status: 200, blocked: true });
    assert.deepEqual(await page(ctx.owner, '/admin/audit'), { status: 200, blocked: false });
    assert.deepEqual(await page(mate, '/admin/audit'), { status: 200, blocked: true });
  });

  test('플랫폼 운영 화면(대표 계정 전용): 모든 회사 감사 기록 — 회사 열·거름 · 본사 관리자·고객사 대표는 404', async () => {
    const all = await ctx.owner.ok('GET', '/api/platform/audit');
    assert.ok(all.tenants.some((t) => t.id === T.tenant && t.name === '튼튼상사') && all.tenants[0].id === 'default');
    assert.ok(all.logs.some((l) => l.tenant === 'default') && all.logs.some((l) => l.tenant === T.tenant && l.tenant_name === '튼튼상사') && all.logs.some((l) => l.tenant === null));
    const none = await ctx.owner.ok('GET', '/api/platform/audit?scope=none');
    assert.ok(none.logs.every((l) => l.tenant === null));
    const memo = none.logs.find((l) => l.action === 'platform.tenant_memo');
    assert.deepEqual([memo.about, memo.about_name, memo.actor_name], [T.tenant, '튼튼상사', '김대표'], '운영 행위: 어느 회사 일인지 표시');
    assert.ok(none.logs.some((l) => l.action === 'auth.login_failed' && l.detail.email === 'nobody@nowhere.test' && l.about === null), '없는 메일 로그인 실패 = 회사 미상');
    const one = await ctx.owner.ok('GET', `/api/platform/audit?scope=${T.tenant}`);
    assert.ok(one.logs.length > 0 && one.logs.every((l) => l.tenant === T.tenant));
    const older = await ctx.owner.ok('GET', `/api/platform/audit?before=${all.logs.at(-1).id}`);
    assert.ok(older.logs.every((l) => Number(l.id) < Number(all.logs.at(-1).id)));
    assert.equal((await admin.get('/api/platform/audit')).status, 404, '다짐 본사 관리자(운영자 아님)');
    assert.equal((await T.c.get('/api/platform/audit')).status, 404, '고객사 대표');
    // 회사별 보기(예전부터 있던 것)에도 그 회사 계정의 로그인 실패·운영 행위가 같이 보임
    const per = await ctx.owner.ok('GET', `/api/platform/tenants/${T.tenant}/audit`);
    assert.ok(per.logs.some((l) => l.action === 'platform.tenant_memo') && per.logs.some((l) => l.action === 'auth.login_failed'));
  });

  test('회사 판정 규칙(audit_scope — 새 기록·과거 기록이 같은 함수): 운영 행위·다른 회사를 다룬 일 = 없음, 행위자 없는 기록은 대상의 회사', async () => {
    const scope = async (actor, action, tt, tid, detail = {}) => (await sql`select audit_scope(${actor}::uuid, ${action}, ${tt}, ${tid}, ${sql.json(detail)}::jsonb) as t`)[0].t;
    assert.equal(await scope(ctx.ownerId, 'user.invite', 'user', null), 'default');
    assert.equal(await scope(T.id, 'user.invite', 'user', null), T.tenant);
    assert.equal(await scope(ctx.ownerId, 'platform.plan', 'tenant', T.tenant), null, 'platform.*');
    assert.equal(await scope(ctx.ownerId, 'support.request', 'tenant', null, { tenant: T.tenant }), null, '지원 모드 접속');
    assert.equal(await scope(ctx.ownerId, 'signup.approve', 'tenant', null, { tenant: T.tenant }), null, '다른 회사를 다룬 일(detail.tenant)');
    assert.equal(await scope(ctx.ownerId, 'tenant.block', 'tenant', T.tenant), null, '다른 회사를 다룬 일(대상 회사)');
    assert.equal(await scope(ctx.ownerId, 'user.update', 'user', T.id), null, '다른 회사 사람을 다룬 일');
    assert.equal(await scope(ctx.ownerId, 'mkt.trash', 'tenant', 'default'), 'default', '자기 회사를 다룬 일은 자기 회사');
    assert.equal(await scope(T.id, 'support.consent_on', 'tenant', T.tenant), T.tenant, '고객사가 스스로 한 지원 동의');
    assert.equal(await scope(null, 'auth.login_failed', 'user', T.id, { email: 'x' }), T.tenant);
    assert.equal(await scope(null, 'auth.login_failed', 'user', null, { email: 'x' }), null);
    assert.equal(await scope(null, 'mkt.trash_purge', 'tenant', T.tenant), T.tenant);
    assert.equal(await scope(null, 'sales.bid_result', 'sales_bid', 'B1', { tenant: T.tenant }), T.tenant, '자동 입찰 결과(detail.tenant)');
    assert.equal(await scope(null, 'revenue.gpt_import', 'api_token', 'x'), 'default', '현장 매출은 기본 회사');
    assert.equal(await scope(null, 'mkt_publish.meta_data_deletion', 'mkt_publish_account', null), null);
    assert.equal(await scope(null, 'x.y', 'user', 'not-a-uuid'), null, '깨진 id 에도 오류 없이');
    assert.equal(await scope(null, 'x.y', 'tenant', 'nope', { tenant: 'nope' }), null, '없는 회사');
    // 과거 기록 채우기: 칸을 비운 뒤 마이그레이션과 같은 문장으로 다시 채우면 화면 결과가 같다
    const before = (await ctx.owner.ok('GET', '/api/admin/audit')).logs.map((l) => l.id);
    await sql`alter table audit_logs disable trigger audit_logs_scope`;
    try {
      await sql`update audit_logs set tenant = null`;
      assert.equal((await sql`select count(*)::int n from audit_logs where tenant is not null`)[0].n, 0);
      await sql`update audit_logs set tenant = audit_scope(actor_id, action, target_type, target_id, detail) where tenant is null`;
    } finally { await sql`alter table audit_logs enable trigger audit_logs_scope`; }
    assert.deepEqual((await ctx.owner.ok('GET', '/api/admin/audit')).logs.map((l) => l.id).filter((id) => before.includes(id)), before);
  });
});
