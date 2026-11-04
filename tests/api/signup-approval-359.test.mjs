// 359차(대표 11/04 저녁 결정 #965): 승인제 가입 — 이메일·소셜 가입 → 회사 '승인 대기'(체험 아직 시작 안 함) → 슈퍼관리자 알림·메일
// → 승인 대기 회사는 쓰기·초대 막힘(보기·알림·계정은 됨) → [승인] = 14일 체험 시작·환영 메일 / [거절](사유) = 안내 메일·보기도 막힘
// 그대로: 초대받은 직원 가입 · 이미 승인된 회사 · 스위치 SIGNUP_APPROVAL=0 이면 예전처럼 바로 시작(다른 가입 시험들이 이 경로)
// 메일은 가짜 발송 서버로 받아 제목·본문 확인(실제 발송은 운영에서 확인 — 구조 시험)
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, bootstrap, resetDb, startServer, testDb, BASE } from '../helpers.mjs';

const RESEND_PORT = 3359, OAUTH_PORT = 3360, FAKE = `http://localhost:${OAUTH_PORT}`;
let srv, sql, ctx, mailSrv, oauthSrv;
const mails = [];
const agree = { terms: true, age14: true, privacy: true };
const mailTo = (to, re) => mails.filter((m) => m.to.includes(to) && re.test(m.subject));
const verifyToken = (to) => { const m = mailTo(to, /이메일 확인/).at(-1); assert.ok(m, `${to} 확인 메일`); return m.text.match(/\/verify\/([A-Za-z0-9_-]+)/)[1]; };

function fakeProvider() {
  return http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const j = (o, s = 200) => { res.statusCode = s; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      const [, , p, step] = req.url.split('?')[0].split('/');
      if (step === 'token') { const f = new URLSearchParams(body); return j({ access_token: f.get('code'), token_type: 'bearer' }); }
      if (step === 'me') {
        const prof = JSON.parse(Buffer.from((req.headers.authorization ?? '').slice(7), 'base64url').toString());
        if (p === 'google') return j({ sub: prof.sub, email: prof.email, email_verified: true, name: prof.name });
        if (p === 'kakao') return j({ id: Number(prof.sub), kakao_account: { email: prof.email, is_email_valid: true, is_email_verified: true, profile: { nickname: prof.name } } });
        return j({ resultcode: '00', response: { id: prof.sub, email: prof.email, name: prof.name } });
      }
      j({ error: 'nope' }, 404);
    });
  }).listen(OAUTH_PORT);
}
async function social(c, p, prof) {
  const s = await c.req('GET', `/api/auth/oauth/${p}/start?utm_source=meta&utm_campaign=trial`);
  assert.equal(s.status, 303);
  const auth = new URL(s.headers.get('location'));
  const st = (s.headers.getSetCookie?.() ?? []).find((x) => x.startsWith('wos_oauth=')).split(';')[0];
  const keep = c.cookie; c.cookie = keep ? `${keep}; ${st}` : st;
  const r = await c.req('GET', `/api/auth/oauth/${p}/callback?code=${Buffer.from(JSON.stringify(prof)).toString('base64url')}&state=${auth.searchParams.get('state')}`);
  if (c.cookie.includes('wos_oauth=')) c.cookie = keep;
  assert.equal(r.status, 303);
  return new URL(r.headers.get('location'), BASE);
}

before(async () => {
  mailSrv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { mails.push(JSON.parse(b)); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ id: `re_${mails.length}` })); }); }).listen(RESEND_PORT);
  oauthSrv = fakeProvider();
  await resetDb();
  srv = await startServer({ SIGNUP_APPROVAL: '1', PUBLIC_SIGNUP: '1', RESEND_API_KEY: 're_test_key', MAIL_FROM: '워크인 <no-reply@mail.work-in.test>', RESEND_API_BASE: `http://localhost:${RESEND_PORT}`,
    OAUTH_TEST_BASE: FAKE, GOOGLE_LOGIN_CLIENT_ID: 'g-id', GOOGLE_LOGIN_CLIENT_SECRET: 'g-secret', KAKAO_REST_KEY: 'k-id', NAVER_CLIENT_ID: 'n-id', NAVER_CLIENT_SECRET: 'n-secret' });
  sql = testDb(); ctx = await bootstrap();
  await sql`update users set platform_admin = true where id = ${ctx.ownerId}`; // 슈퍼관리자(시험 서버는 SUPER_ADMIN_EMAILS 비어 있음 = platform_admin 전원)
});
after(async () => { srv?.proc.kill(); mailSrv?.close(); oauthSrv?.close(); await sql?.end(); });

describe('359차 승인제 가입', () => {
  let tenant, boss;
  test('이메일 가입: 연락처 필수 → 승인 대기 회사(체험 전) → 확인 링크 뒤 슈퍼관리자 알림·메일 한 번', async () => {
    assert.equal((await new Client().ok('GET', '/api/auth/signup')).approval, true, '가입 화면이 승인제 문구를 씀');
    boss = new Client('boss');
    const base = { email: 'boss@approval.test', name: '신청대표', password: 'signup-pass-1234', mode: 'team', company: '승인상사', size: '2-10', industry: '제조', agree };
    const no = await boss.post('/api/auth/signup', base);
    assert.equal(no.status, 400); assert.match(no.body.error.message, /전화번호/);
    assert.equal((await boss.post('/api/auth/signup', { ...base, contact: '12345' })).status, 400, '전화번호 모양 확인');
    const r = await boss.ok('POST', '/api/auth/signup', { ...base, contact: '010 1234 5678', utm: { source: 'meta', campaign: 'trial' } });
    assert.equal(r.approval, true); assert.equal(r.devLink, undefined, '실제 메일로 감');
    [{ tenant }] = await sql`select tenant from users where email = 'boss@approval.test'`;
    const [t] = await sql`select t.signup_status, t.signup_info, t.signup_notified_at, s.trial_ends_at, s.period_end from tenants t join tenant_subscriptions s on s.tenant = t.id where t.id = ${tenant}`;
    assert.equal(t.signup_status, 'pending');
    assert.equal(t.trial_ends_at, null, '체험은 승인 때 시작'); assert.equal(t.period_end, null);
    assert.equal(t.signup_info.contact, '010-1234-5678'); assert.equal(t.signup_info.via, 'email');
    assert.deepEqual([t.signup_info.company, t.signup_info.name, t.signup_info.size, t.signup_info.industry], ['승인상사', '신청대표', '2-10', '제조']);
    assert.equal(t.signup_notified_at, null, '확인 링크 전에는 알리지 않음');
    assert.equal((await sql`select count(*)::int n from notifications where type = 'signup_request'`)[0].n, 0);

    await boss.ok('POST', '/api/auth/verify', { token: verifyToken('boss@approval.test') });
    const ns = await sql`select user_id, title, link from notifications where type = 'signup_request'`;
    assert.equal(ns.length, 1); assert.equal(ns[0].user_id, ctx.ownerId);
    assert.match(ns[0].title, /새 체험 신청: 승인상사 · 신청대표 · 2-10명 · 제조/); assert.equal(ns[0].link, '/platform?tab=company#signup-requests');
    const [adm] = await sql`select email from users where id = ${ctx.ownerId}`;
    const am = mailTo(adm.email, /새 체험 신청 — 승인상사/);
    assert.equal(am.length, 1);
    assert.match(am[0].text, /연락처: 010-1234-5678/); assert.match(am[0].text, /가입 경로: email · 유입 source=meta campaign=trial/);
    assert.match(am[0].text, /24시간 안에 연락드린다고 안내했습니다/);
    assert.equal(mailTo('boss@approval.test', /승인/).length, 0, '신청자에게는 아직 승인 메일 없음');
    // 같은 회사 다시 알리지 않음(로그인 다시 해도)
    await boss.ok('POST', '/api/auth/login', { email: 'boss@approval.test', password: 'signup-pass-1234' });
    assert.equal((await sql`select count(*)::int n from notifications where type = 'signup_request'`)[0].n, 1);
  });

  test('승인 대기: 쓰기·초대·결제 막힘(403 signup_pending), 보기·알림·계정은 됨 · 플랫폼 운영은 슈퍼관리자만', async () => {
    const [hq] = await sql`select id from org_units where tenant = ${tenant} and type = 'hq'`;
    const w = await boss.post('/api/tasks', { title: '승인 전 업무', orgUnitId: hq.id, approvalRequired: false });
    assert.equal(w.status, 403); assert.equal(w.body.error.code, 'signup_pending'); assert.match(w.body.error.message, /24시간 안에 연락드립니다/);
    const inv = await boss.post('/api/admin/users', { email: 'early@approval.test', name: '먼저초대', role: 'staff', orgUnitIds: [hq.id] });
    assert.equal(inv.status, 403); assert.equal(inv.body.error.code, 'signup_pending', '동료 초대도 승인 뒤');
    assert.equal((await boss.req('GET', '/api/tasks')).status, 200, '보기는 됨');
    assert.equal((await boss.req('GET', '/api/notifications')).status, 200);
    const me = await boss.ok('GET', '/api/auth/me');
    assert.equal(me.user.email, 'boss@approval.test');
    // 신청자는 플랫폼 운영(가입 신청 목록·승인) 못 봄
    assert.equal((await boss.req('GET', '/api/platform/signups')).status, 404);
    assert.ok([403, 404].includes((await boss.post(`/api/platform/signups/${tenant}/approve`, {})).status), '스스로 승인 못 함(승인 대기 쓰기 막힘 403 또는 플랫폼 404)');
    assert.equal((await sql`select signup_status from tenants where id = ${tenant}`)[0].signup_status, 'pending');
    assert.equal((await ctx.staffA.client.post(`/api/platform/signups/${tenant}/approve`, {})).status, 404, '플랫폼 운영자가 아니면 404');
    // 목록: 승인 대기 맨 위 + 신청 정보
    const list = await ctx.owner.ok('GET', '/api/platform/signups');
    assert.equal(list.approval, true);
    const row = list.tenants[0];
    assert.equal(row.id, tenant); assert.equal(row.signup_status, 'pending');
    assert.equal(row.signup_info.contact, '010-1234-5678'); assert.equal(row.owner_name, '신청대표');
  });

  test('[승인] → 14일 체험 시작(승인 시각부터)·환영 메일 · 바로 쓰기·초대 됨 · 두 번 승인은 409', async () => {
    await sql`update tenants set created_at = now() - interval '3 days' where id = ${tenant}`; // 가입 3일 뒤 승인해도 14일은 승인 때부터
    const r = await ctx.owner.ok('POST', `/api/platform/signups/${tenant}/approve`, {});
    assert.equal(r.ok, true); assert.equal(r.mailed, true);
    const [t] = await sql`select t.signup_status, t.signup_decided_by, s.status, s.trial_ends_at, s.period_end from tenants t join tenant_subscriptions s on s.tenant = t.id where t.id = ${tenant}`;
    assert.equal(t.signup_status, 'approved'); assert.equal(t.signup_decided_by, ctx.ownerId); assert.equal(t.status, 'trial');
    const days = (new Date(t.trial_ends_at) - Date.now()) / 864e5;
    assert.ok(days > 13.9 && days <= 14, `체험 끝 = 승인 + 14일 (${days})`);
    const wm = mailTo('boss@approval.test', /체험 신청이 승인됐습니다/);
    assert.equal(wm.length, 1); assert.match(wm[0].text, /14일 동안 모든 기능/); assert.match(wm[0].html, /워크인 시작하기/);
    const [hq] = await sql`select id from org_units where tenant = ${tenant} and type = 'hq'`;
    await boss.ok('POST', '/api/tasks', { title: '승인 뒤 첫 업무', orgUnitId: hq.id, approvalRequired: false });
    const inv = await boss.ok('POST', '/api/admin/users', { email: 'staff@approval.test', name: '초대직원', role: 'staff', orgUnitIds: [hq.id] });
    // 초대받은 직원 가입은 그대로(승인 대기 없음 — 이미 승인된 회사)
    const s = new Client('staff');
    await s.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'staff-pass-1234' });
    assert.equal((await s.req('GET', '/api/tasks')).status, 200);
    assert.equal((await ctx.owner.post(`/api/platform/signups/${tenant}/approve`, {})).status, 409);
    assert.equal((await ctx.owner.post(`/api/platform/signups/${tenant}/reject`, { reason: '이미 승인됨' })).status, 409, '승인된 회사는 거절 못 함');
    assert.equal((await ctx.owner.post('/api/platform/signups/t_nothere123/approve', {})).status, 404);
  });

  test('소셜 가입(구글): 연락처 필수 → 승인 대기 · 바로 슈퍼관리자 알림 → [거절](사유) = 안내 메일·보기도 막힘 → 다시 [승인] 가능', async () => {
    const c = new Client('g1');
    const to = await social(c, 'google', { sub: 'g-359', email: 'social@approval.test', name: '소셜신청' });
    assert.equal(to.pathname, '/signup/social');
    const t = to.searchParams.get('t');
    const body = { token: t, name: '소셜신청', mode: 'team', company: '소셜승인', size: '11-30', agree };
    const no = await c.post('/api/auth/oauth/complete', body);
    assert.equal(no.status, 400); assert.match(no.body.error.message, /전화번호/);
    const done = await c.ok('POST', '/api/auth/oauth/complete', { ...body, contact: '02-555-1234' });
    assert.equal(done.pendingApproval, true);
    const [{ tenant: st }] = await sql`select tenant from users where email = 'social@approval.test'`;
    const [row] = await sql`select t.signup_status, t.signup_info, s.trial_ends_at from tenants t join tenant_subscriptions s on s.tenant = t.id where t.id = ${st}`;
    assert.equal(row.signup_status, 'pending'); assert.equal(row.trial_ends_at, null);
    assert.equal(row.signup_info.via, 'google'); assert.equal(row.signup_info.contact, '02-555-1234');
    assert.equal(row.signup_info.utm?.source, 'meta', '소셜도 유입 기록');
    const ns = await sql`select title from notifications where type = 'signup_request' order by created_at`;
    assert.equal(ns.length, 2); assert.match(ns[1].title, /소셜승인 · 소셜신청 · 11-30명 · google 가입/);
    assert.equal((await c.post('/api/tasks', { title: 'x' })).status, 403);

    assert.equal((await ctx.owner.post(`/api/platform/signups/${st}/reject`, { reason: '' })).status, 400, '거절 사유 필수');
    const rj = await ctx.owner.ok('POST', `/api/platform/signups/${st}/reject`, { reason: '연락이 닿지 않았습니다' });
    assert.equal(rj.mailed, true);
    const rm = mailTo('social@approval.test', /체험 신청 결과를 알려 드립니다/);
    assert.equal(rm.length, 1); assert.match(rm[0].text, /사유: 연락이 닿지 않았습니다/); assert.match(rm[0].text, /\[문의하기\]/);
    const blocked = await c.req('GET', '/api/tasks');
    assert.equal(blocked.status, 403); assert.equal(blocked.body.error.code, 'signup_rejected', '거절된 회사는 보기도 막힘');
    assert.equal((await c.req('GET', '/api/auth/me')).status, 200, '로그인 정보(안내 화면용)는 됨');
    const [rr] = await sql`select signup_status, signup_reason from tenants where id = ${st}`;
    assert.deepEqual([rr.signup_status, rr.signup_reason], ['rejected', '연락이 닿지 않았습니다']);
    // 다시 승인할 수 있음(연락이 닿은 경우)
    await ctx.owner.ok('POST', `/api/platform/signups/${st}/approve`, {});
    assert.equal((await c.req('GET', '/api/tasks')).status, 200);
    const [ra] = await sql`select t.signup_reason, s.trial_ends_at from tenants t join tenant_subscriptions s on s.tenant = t.id where t.id = ${st}`;
    assert.equal(ra.signup_reason, null); assert.ok(ra.trial_ends_at);
  });

  test('플랫폼 [고객사 추가]로 만든 회사·기존 회사는 승인 대기 없음', async () => {
    const rows = await sql`select id, signup_status from tenants where id in ('default', 'demo') or kind is distinct from 'self'`;
    for (const r of rows.filter((x) => x.id === 'default')) assert.equal(r.signup_status, 'approved');
    assert.equal((await ctx.owner.req('GET', '/api/tasks')).status, 200);
  });
});
