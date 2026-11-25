// #1176(대표 11/26 "요금제를 구매한 회사가 직원을 초대할지, 직원이 가입하게 할지"): 회사 초대 링크(가입 신청 → 관리자 승인) · 회사 메일 도메인 합류(DB 288)
// ① 링크 만들기·다시 만들기·끄기·신청 수 상한 ② 이메일 신청 → 메일 확인 → 관리자 알림 → 승인(역할) → 그 비밀번호로 로그인 ③ 메일 확인 전 승인 막힘 · 거절
// ④ 직원·다른 회사는 못 봄(403·404) ⑤ 도메인: 내 메일 도메인만·공용 메일 막음 → 그 도메인으로 가입하면 409 domain_join → 합류 신청
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, BASE, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, sql, ctx;
before(async () => { await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap(); });
after(async () => { srv?.proc.kill(); await sql?.end(); });

const agree = { terms: true, age14: true, privacy: true, ai: true };
const tokenOf = (url) => url.split('/join/')[1];
async function verify(devVerify) { const r = await fetch(BASE + devVerify, { redirect: 'manual' }); assert.equal(r.status, 303); return r.headers.get('location'); }

test('링크 → 이메일 신청 → 메일 확인 → 승인 → 로그인 · 거절 · 상한 · 끄기 · 권한', async () => {
  assert.equal((await ctx.staffA.client.req('GET', '/api/admin/join')).status, 403, '직원은 못 봄');
  const mk = await ctx.owner.ok('POST', '/api/admin/join', { action: 'link', days: 30, maxUses: 3 });
  const token = tokenOf(mk.url);
  const v = await ctx.owner.ok('GET', '/api/admin/join');
  assert.equal(v.link.url, mk.url, '관리자가 다시 복사할 수 있음'); assert.equal(v.link.maxUses, 3); assert.equal(v.link.live, true);
  const pub = new Client();
  const info = await pub.ok('GET', `/api/join/${token}`);
  assert.equal(info.ok, true); assert.ok(info.company);

  // ② 이메일 신청 — 메일 확인 전에는 승인 못 함
  const r1 = await pub.ok('POST', `/api/join/${token}`, { email: 'new1@join-1176.test', name: '새직원', password: 'join-pass-1234', agree });
  assert.ok(r1.devVerify, '개발 환경 확인 링크');
  const [q1] = await sql`select id, status, email_verified_at from join_requests where email = 'new1@join-1176.test'`;
  assert.equal(q1.status, 'pending'); assert.equal(q1.email_verified_at, null);
  assert.equal((await ctx.owner.req('POST', `/api/admin/join/${q1.id}`, { action: 'approve', role: 'staff' })).status, 400, '메일 확인 전 승인 막힘');
  assert.match(await verify(r1.devVerify), /\/join\/sent\?verified=1/);
  assert.equal((await sql`select count(*)::int n from notifications where user_id = ${ctx.ownerId} and type = 'join_request'`)[0].n, 1, '관리자에게 알림');
  const pv = await ctx.owner.ok('GET', `/api/admin/join/${q1.id}`);
  assert.equal(typeof pv.people, 'number'); assert.equal(typeof pv.bandChanges, 'boolean');
  const ap = await ctx.owner.ok('POST', `/api/admin/join/${q1.id}`, { action: 'approve', role: 'staff' });
  const [u] = await sql`select status, role, email_verified_at, tenant from users where id = ${ap.userId}`;
  assert.equal(u.status, 'active'); assert.equal(u.role, 'staff'); assert.ok(u.email_verified_at); assert.equal(u.tenant, 'default');
  assert.equal((await sql`select count(*)::int n from consents where user_id = ${ap.userId}`)[0].n >= 3, true, '동의 기록');
  const me = new Client('new1');
  assert.equal((await me.req('POST', '/api/auth/login', { email: 'new1@join-1176.test', password: 'join-pass-1234' })).status, 200, '신청한 비밀번호로 로그인');
  assert.equal((await ctx.owner.req('POST', `/api/admin/join/${q1.id}`, { action: 'approve', role: 'staff' })).status, 400, '두 번 승인 안 됨');
  const acts = (await sql`select action from audit_logs where action like 'join.%'`).map((x) => x.action);
  assert.ok(acts.includes('join.link_create') && acts.includes('join.approve'), acts.join(','));

  // ③ 거절
  const r2 = await pub.ok('POST', `/api/join/${token}`, { email: 'new2@join-1176.test', name: '거절될사람', password: 'join-pass-1234', agree });
  await verify(r2.devVerify);
  const [q2] = await sql`select id from join_requests where email = 'new2@join-1176.test'`;
  await ctx.owner.ok('POST', `/api/admin/join/${q2.id}`, { action: 'reject', reason: '외부인' });
  const [q2b] = await sql`select status, password_hash from join_requests where id = ${q2.id}`;
  assert.equal(q2b.status, 'rejected'); assert.equal(q2b.password_hash, null, '거절하면 비밀번호 해시 지움');
  assert.equal((await sql`select count(*)::int n from users where email = 'new2@join-1176.test'`)[0].n, 0);

  // ① 상한(3건) — 세 번째까지 받고 네 번째는 막힘
  await pub.ok('POST', `/api/join/${token}`, { email: 'new3@join-1176.test', name: '셋째', password: 'join-pass-1234', agree });
  assert.equal((await pub.req('POST', `/api/join/${token}`, { email: 'new4@join-1176.test', name: '넷째', password: 'join-pass-1234', agree })).status, 400, '신청 수 상한');
  assert.match((await pub.ok('GET', `/api/join/${token}`)).problem, /다 찼습니다/);
  // 다시 만들기 → 예전 링크 꺼짐 · 끄기
  const mk2 = await ctx.owner.ok('POST', '/api/admin/join', { action: 'link', days: 7, maxUses: null });
  assert.match((await pub.ok('GET', `/api/join/${token}`)).problem, /끈 초대 링크/);
  assert.equal((await pub.ok('GET', `/api/join/${tokenOf(mk2.url)}`)).ok, true);
  await ctx.owner.ok('POST', '/api/admin/join', { action: 'disable' });
  assert.equal((await pub.ok('GET', `/api/join/${tokenOf(mk2.url)}`)).ok, false);
  assert.equal((await pub.ok('GET', '/api/join/no-such-token')).company, null, '없는 링크는 회사 이름도 안 보임');
});

test('다른 회사는 신청을 못 보고 못 승인 · 회사 메일 도메인 합류(공용 메일 막음)', async () => {
  // 다른 회사 대표
  const c = new Client('ceo@other-1176.test');
  const r = await c.ok('POST', '/api/auth/signup', { email: 'ceo@other-1176.test', password: 'signup-pass-1234', name: '다른대표', mode: 'team', company: '다른상사', agree });
  await c.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  const [t] = await sql`select tenant from users where email = 'ceo@other-1176.test'`;
  await sql`update tenants set signup_status = 'approved' where id = ${t.tenant}`;
  const [q] = await sql`select id from join_requests where tenant = 'default' and status = 'pending' limit 1`;
  assert.ok(q, '앞 시험의 대기 신청');
  assert.equal((await c.req('GET', `/api/admin/join/${q.id}`)).status, 404, '다른 회사 신청은 404');
  assert.equal((await c.req('POST', `/api/admin/join/${q.id}`, { action: 'approve', role: 'staff' })).status, 404);
  assert.equal((await c.ok('GET', '/api/admin/join')).requests.length, 0, '우리 회사 신청은 안 보임');

  // 도메인: 내 메일 도메인만 · 공용 메일 막음 · 한 도메인은 한 회사
  assert.equal((await ctx.owner.req('POST', '/api/admin/join', { action: 'domain', domain: 'gmail.com' })).status, 400, '공용 메일 막음');
  assert.equal((await ctx.owner.req('POST', '/api/admin/join', { action: 'domain', domain: 'other-1176.test' })).status, 400, '내 메일 도메인만');
  await ctx.owner.ok('POST', '/api/admin/join', { action: 'domain', domain: 'dagym.test' });
  assert.equal((await ctx.owner.ok('GET', '/api/admin/join')).domain.value, 'dagym.test');
  // 그 도메인으로 가입하면 합류를 권함 → 합류 신청
  const g = new Client();
  const s1 = await g.req('POST', '/api/auth/signup', { email: 'newbie@dagym.test', password: 'signup-pass-1234', name: '도메인직원', mode: 'team', company: '새회사', agree });
  assert.equal(s1.status, 409); assert.equal(s1.body.error.code, 'domain_join'); assert.ok(s1.body.error.detail.company);
  const dj = await g.ok('POST', '/api/join/domain', { email: 'newbie@dagym.test', name: '도메인직원', password: 'signup-pass-1234', agree });
  assert.ok(dj.devVerify);
  const [dq] = await sql`select via, tenant from join_requests where email = 'newbie@dagym.test'`;
  assert.equal(dq.via, 'domain'); assert.equal(dq.tenant, 'default');
  // '새 회사로 가입'도 고를 수 있음
  const s2 = await g.req('POST', '/api/auth/signup', { email: 'own@dagym.test', password: 'signup-pass-1234', name: '독립', mode: 'team', company: '독립회사', agree, newCompany: true });
  assert.equal(s2.status, 200);
  await ctx.owner.ok('POST', '/api/admin/join', { action: 'domain', domain: null });
  assert.equal((await g.req('POST', '/api/auth/signup', { email: 'later@dagym.test', password: 'signup-pass-1234', name: '나중', mode: 'team', company: '나중회사', agree })).status, 200, '끄면 그냥 가입');
});
