// #1139(대표 11/24 '업무관리는 상담 없이, 영업·마케팅은 문의 → 상담 후 사용(잠금 표기)'):
// ① 새로 가입한 회사: 영업·마케팅 잠김(lockedSpaces) · 서버도 막힘(영업 API 404) · 회사 관리자가 직접 켜기 403
// ② [상담 신청](관리자) → 플랫폼 운영자 알림 · 같은 공간은 중복 신청 없음 · 직원은 신청 못 함
// ③ 플랫폼 운영자가 회사 상세에서 열면 → 상담 신청 '열림' · 회사 관리자 알림 · 영업 API 열림
// ④ 우리 회사(default)·검수용 시험 회사는 예전처럼 관리자가 직접 켬
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx, T;
before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SPACES_SELF_SERVE: '0' }); sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`;
  const c = new Client('ceo@consult-1139.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@consult-1139.test', password: 'signup-pass-1234', name: '최대표', mode: 'team', company: '상담상사', industry: '운동·피트니스', industries: ['운동·피트니스'], agree: { terms: true, age14: true, privacy: true, ai: true } });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const me = await c.ok('GET', '/api/auth/me');
  T = { c, id: me.user.id, tenant: me.user.tenant };
  await sql`update tenants set signup_status = 'approved' where id = ${T.tenant}`;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('새 회사: 영업·마케팅 잠김 · 서버 막힘 · 관리자 직접 켜기 403 · 상담 신청(중복 없음) → 운영자가 열면 열림·알림', async () => {
  const v = await T.c.ok('GET', '/api/spaces/consult');
  assert.deepEqual([v.locked, v.canRequest, v.free, v.requested.length], [['sales', 'marketing'], true, false, 0]);
  assert.equal(v.contact.email, 'ceo@consult-1139.test', '연락처 미리 채움');
  assert.equal((await T.c.req('GET', '/api/sales/award-stats')).status, 404, '잠긴 공간 API 는 서버가 막음');
  const put = await T.c.req('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  assert.equal(put.status, 403, '회사 관리자는 직접 켜지 못함');
  assert.match(JSON.stringify(put.body ?? put.data ?? ''), /상담/);

  const a = await T.c.ok('POST', '/api/spaces/consult', { spaces: ['sales'], name: '최대표', phone: '010-1234-5678', email: 'ceo@consult-1139.test', memo: '입찰 공고 모아 보기' });
  assert.equal(a.already, false);
  const b = await T.c.ok('POST', '/api/spaces/consult', { spaces: ['sales'], name: '최대표', email: 'ceo@consult-1139.test' });
  assert.deepEqual([b.already, b.id], [true, a.id], '같은 공간은 중복 신청 없음');
  assert.equal((await sql`select count(*)::int n from space_consults where tenant = ${T.tenant}`)[0].n, 1);
  const [n] = await sql`select title from notifications where user_id = ${ctx.ownerId} and type = 'signup_request' and title like '상담 신청%' order by created_at desc limit 1`;
  assert.match(n.title, /상담 신청: 상담상사 — 영업/, '플랫폼 운영자 알림');
  assert.deepEqual((await T.c.ok('GET', '/api/spaces/consult')).requested.map((r) => r.spaces), [['sales']]);

  // 플랫폼 운영자: 회사 상세에 상담 신청 → 영업 열기
  const d = await ctx.owner.ok('GET', `/api/platform/tenants/${T.tenant}/detail`);
  assert.equal(d.consults[0].status, 'requested'); assert.equal(d.consults[0].phone, '010-1234-5678');
  await ctx.owner.ok('PUT', `/api/platform/tenants/${T.tenant}/spaces`, { spaces: ['sales'] });
  assert.equal((await sql`select status from space_consults where id = ${a.id}`)[0].status, 'opened');
  const [n2] = await sql`select title from notifications where user_id = ${T.id} order by created_at desc limit 1`;
  assert.equal(n2.title, '영업 공간을 열었습니다');
  const v2 = await T.c.ok('GET', '/api/spaces/consult');
  assert.deepEqual(v2.locked, ['marketing']);
  assert.notEqual((await T.c.req('GET', '/api/sales/award-stats')).status, 404, '열리면 영업 API 사용');
  const [au] = await sql`select detail from audit_logs where action = 'platform.tenant_spaces' order by id desc limit 1`;
  assert.deepEqual(au.detail.spaces, ['sales']);
});

test('우리 회사(default)·검수용 시험 회사는 관리자가 직접 켬 · 직원은 상담 신청 못 함', async () => {
  const v = await ctx.owner.ok('GET', '/api/spaces/consult');
  assert.equal(v.free, true);
  await ctx.owner.ok('PUT', '/api/admin/spaces', { space: 'sales', on: true });
  assert.equal((await ctx.staffA.client.req('POST', '/api/spaces/consult', { spaces: ['marketing'], name: '직원', email: 'a@x.test' })).status, 403);
  await sql`update tenants set is_test = true where id = ${T.tenant}`;
  await T.c.ok('PUT', '/api/admin/spaces', { space: 'marketing', on: true });
  assert.deepEqual((await T.c.ok('GET', '/api/spaces/consult')).locked, []);
});

test('#1139 2부 [설계 파트너로 지정]: 운영자만 · 우리 회사·검수용 시험 회사는 안 됨 · 기간(일)·체험·파트너 기본값 · 감사 기록', async () => {
  await sql`update tenants set is_test = false where id = ${T.tenant}`;
  assert.equal((await T.c.req('PUT', `/api/platform/tenants/${T.tenant}/partner`, { days: 30 })).status, 404, '운영자가 아니면 없는 화면처럼');
  assert.equal((await ctx.owner.req('PUT', '/api/platform/tenants/default/partner', { days: 30 })).status, 400, '우리 회사는 안 됨');
  await sql`update tenants set is_test = true where id = ${T.tenant}`;
  assert.equal((await ctx.owner.req('PUT', `/api/platform/tenants/${T.tenant}/partner`, { days: 30 })).status, 400, '검수용 시험 회사는 표시를 풀어야');
  await sql`update tenants set is_test = false where id = ${T.tenant}`;
  await ctx.owner.ok('PUT', `/api/platform/tenants/${T.tenant}/partner`, { days: 30 });
  const [t] = await sql`select t.segment, s.status, (s.trial_ends_at::date - current_date) as d from tenants t join tenant_subscriptions s on s.tenant = t.id where t.id = ${T.tenant}`;
  assert.deepEqual([t.segment, t.status], ['partner', 'trial']); assert.ok(t.d >= 29 && t.d <= 30);
  const d = await ctx.owner.ok('GET', `/api/platform/tenants/${T.tenant}/detail`);
  assert.ok(d.partner, '회사 상세에 설계 파트너 칸');
  assert.equal((await ctx.owner.req('PUT', `/api/platform/tenants/${T.tenant}/partner`, { days: 30 })).status, 400, '두 번은 안 됨');
  const [au] = await sql`select detail from audit_logs where action = 'platform.partner_set' order by id desc limit 1`;
  assert.equal(au.detail.days, 30);
});

test('상용화 A1: 고객 회사 관리자는 마케팅 요금제·크레딧·AI 한도를 바꾸지 못함(다른 설정은 됨) · 화면은 보기만', async () => {
  await sql`update tenants set is_test = false, spaces = array['work', 'marketing'] where id = ${T.tenant}`;
  const r = await T.c.req('PUT', '/api/marketing/auto', { monthlyCredits: 999 });
  assert.equal(r.status, 403); assert.match(JSON.stringify(r.body), /운영자/);
  assert.equal((await T.c.req('PUT', '/api/marketing/auto', { videoMonthly: 50 })).status, 403);
  await T.c.ok('PUT', '/api/marketing/auto', { quietStart: 22 });
  const v = await T.c.ok('GET', '/api/marketing/plan');
  assert.deepEqual([v.canEdit, v.canEditPlan], [true, false], '요금제 화면은 보기만');
});
