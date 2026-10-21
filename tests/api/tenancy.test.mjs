// V15 공개 가입 · 회사(tenant) 분리 시험: 가입한 다른 회사·개인 공간에서 기존 회사 데이터가 절대 보이지 않아야 한다
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb, seoulToday, addDays, BASE, tick } from '../helpers.mjs';

let srv, ctx, sql;
const today = seoulToday();
const D = { task: null, event: null, proj: null, room: null, companyCal: null };

before(async () => {
  await resetDb();
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', SIGNUP_IP_PER_DAY: '3' });
  sql = testDb();
  ctx = await bootstrap();
  // 기존 회사(default) 데이터
  D.task = (await ctx.owner.ok('POST', '/api/tasks', { title: '기본회사 비밀 업무', orgUnitId: ctx.siteA, dueDate: addDays(today, 2) })).id;
  const cals = (await ctx.owner.ok('GET', '/api/calendars')).calendars;
  D.companyCal = cals.find((c) => c.type === 'company')?.id;
  D.event = (await ctx.owner.ok('POST', '/api/events', { calendarId: D.companyCal, title: '기본회사 비밀 회의', start: `${addDays(today, 1)}T10:00:00+09:00`, end: `${addDays(today, 1)}T11:00:00+09:00` })).id;
  D.proj = (await ctx.owner.ok('POST', '/api/projects', { name: '기본회사 비밀 프로젝트', orgUnitId: ctx.siteA })).id;
  D.room = (await ctx.owner.ok('POST', '/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).id;
  await ctx.owner.ok('POST', '/api/templates', { name: '기본회사 전사 템플릿', payload: { title: '전사' } });
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

const form = (o) => ({ password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false }, ...o });
async function join(o) {
  const c = new Client(o.email);
  const r = await c.ok('POST', '/api/auth/signup', form(o));
  assert.ok(r.devLink, '개발·시험에서는 확인 링크를 돌려준다');
  return { c, link: r.devLink };
}

let P, T;
describe('V15 공개 가입 → 이메일 확인 → 로그인', () => {
  test('개인으로 시작: 확인 전 로그인 불가, 링크 누르면 로그인, 관리 메뉴 숨김', async () => {
    const { c, link } = await join({ email: 'solo@example.com', name: '혼자씨', mode: 'personal' });
    const bad = await new Client().post('/api/auth/login', { email: 'solo@example.com', password: 'signup-pass-1234' });
    assert.equal(bad.status, 403); assert.equal(bad.body.error.code, 'email_unverified');
    await c.ok('POST', '/api/auth/verify', { token: link.split('/').pop() });
    const me = await c.ok('GET', '/api/auth/me');
    assert.equal(me.user.role, 'owner'); assert.equal(me.user.personal, true); assert.match(me.user.tenant, /^t_/);
    // 같은 링크 재사용 불가
    assert.equal((await new Client().post('/api/auth/verify', { token: link.split('/').pop() })).status, 400);
    assert.equal((await c.get('/api/admin/users')).status, 404, '개인 공간: 사용자 관리 메뉴 없음');
    // 업무 만들기: 요청자 = 본인
    const t = await c.ok('POST', '/api/tasks', { title: '내 첫 업무', orgUnitId: me.orgUnits[0].id });
    const got = await c.ok('GET', `/api/tasks/${t.id}`);
    assert.equal((got.task ?? got).requested_by ?? (got.task ?? got).created_by, me.user.id);
    P = { c, me };
  });
  test('팀으로 시작: 회사 이름 필수, 동의 필수, 봇(숨은 칸)은 아무것도 안 만듦', async () => {
    const c = new Client();
    assert.equal((await c.post('/api/auth/signup', form({ email: 'x@example.com', name: 'x', mode: 'team' }))).status, 400);
    assert.equal((await c.post('/api/auth/signup', { ...form({ email: 'x@example.com', name: 'x', mode: 'personal' }), agree: { terms: true, age14: true, privacy: false } })).status, 400);
    const u14 = await c.post('/api/auth/signup', { ...form({ email: 'kid@example.com', name: 'x', mode: 'personal' }), agree: { terms: true, age14: false, privacy: true } });
    assert.equal(u14.status, 400, 'V34-B 만 14세 확인 필수'); assert.match(JSON.stringify(u14.body), /만 14세/);
    const bot = await c.ok('POST', '/api/auth/signup', form({ email: 'bot@example.com', name: 'bot', mode: 'personal', website: 'http://spam' }));
    assert.ok(!bot.devLink);
    assert.equal((await sql`select 1 from users where email = 'bot@example.com'`).length, 0);
    const { c: tc, link } = await join({ email: 'boss@other.test', name: '남사장', mode: 'team', company: '남의상사' });
    await tc.ok('POST', '/api/auth/verify', { token: link.split('/').pop() });
    const me = await tc.ok('GET', '/api/auth/me');
    assert.equal(me.user.personal, false);
    T = { c: tc, me };
    // 우리 회사 공용 캘린더에 일정 등록 가능(회사별 1개)
    const cc = (await tc.ok('GET', '/api/calendars')).calendars.find((x) => x.type === 'company');
    assert.ok(cc && cc.id !== D.companyCal);
    await tc.ok('POST', '/api/events', { calendarId: cc.id, title: '남의상사 회의', start: `${today}T15:00:00+09:00`, end: `${today}T16:00:00+09:00` });
    const own = (await ctx.owner.ok('GET', `/api/events?from=${today}T00:00:00Z&to=${addDays(today, 2)}T00:00:00Z`)).events;
    assert.ok(!own.some((e) => e.title === '남의상사 회의'), '기존 회사에는 안 보임');
    // 이미 있는 이메일로 가입해도 같은 안내(가입 여부 드러내지 않음), 계정은 새로 안 생김
    const dup = await new Client().ok('POST', '/api/auth/signup', form({ email: 'ceo@dagym.test', name: '사칭', mode: 'personal' }));
    assert.ok(!dup.devLink);
    assert.equal((await sql`select count(*)::int n from users where lower(email) = 'ceo@dagym.test'`)[0].n, 1);
  });
  test('같은 IP 하루 가입 수 제한', async () => {
    await join({ email: 'third@example.com', name: '셋째', mode: 'personal' });
    const r = await new Client().post('/api/auth/signup', form({ email: 'fourth@example.com', name: '넷째', mode: 'personal' }));
    assert.equal(r.status, 429);
  });
});

describe('V15 회사 간 분리 — 다른 회사 데이터는 404·빈 목록', () => {
  test('가입한 회사 대표에게 기존 회사 업무·일정·프로젝트·사람·조직·대화가 안 보인다', async () => {
    for (const X of [T, P]) {
      const c = X.c;
      assert.equal((await c.get(`/api/tasks/${D.task}`)).status, 404);
      assert.equal((await c.get(`/api/events/${D.event}`)).status, 404);
      assert.ok((await c.get(`/api/projects/${D.proj}`)).status >= 403);
      const tasks = (await c.ok('GET', '/api/tasks')).tasks;
      assert.ok(!tasks.some((t) => t.id === D.task));
      const evs = (await c.ok('GET', `/api/events?from=${today}T00:00:00Z&to=${addDays(today, 5)}T00:00:00Z`)).events;
      assert.ok(!evs.some((e) => e.id === D.event || /기본회사/.test(e.title)));
      const cals = (await c.ok('GET', '/api/calendars')).calendars;
      assert.ok(!cals.some((x) => x.id === D.companyCal));
      const projs = (await c.ok('GET', '/api/projects')).projects;
      assert.ok(!projs.some((p) => p.id === D.proj));
      const org = await c.ok('GET', '/api/org');
      assert.deepEqual(org.users.map((u) => u.id), [X.me.user.id], '디렉터리에는 우리 회사 사람만');
      assert.ok(org.orgUnits.every((o) => X.me.orgUnits.some((m) => m.id === o.id)));
      const s = await c.ok('GET', `/api/search?q=${encodeURIComponent('기본회사')}`);
      assert.equal(JSON.stringify(s).includes('기본회사'), false, '검색에도 안 나옴');
      const rooms = await c.ok('GET', '/api/chat/rooms');
      assert.ok(!JSON.stringify(rooms).includes(D.room));
      const tpl = await c.ok('GET', '/api/templates');
      assert.ok(!JSON.stringify(tpl).includes('기본회사'));
      assert.equal((await c.get(`/api/chat/messages?roomId=${D.room}`)).status >= 400, true);
      // 기본 회사 전용 메뉴
      assert.equal((await c.get('/api/revenue?year=2026')).status, 404);
      assert.equal((await c.get('/api/admin/ops')).status, 404);
      assert.equal((await c.get('/api/admin/audit')).status, 404);
    }
  });
  test('다른 회사 사람·조직을 배정·수정할 수 없다', async () => {
    const c = T.c; const unit = T.me.orgUnits[0].id;
    assert.equal((await c.post('/api/tasks', { title: 'x', orgUnitId: unit, assigneeId: ctx.staffA.id })).status, 400);
    assert.ok((await c.post('/api/tasks', { title: 'x', orgUnitId: ctx.siteA })).status >= 403);
    assert.equal((await c.patch(`/api/admin/users/${ctx.staffA.id}`, { status: 'disabled' })).status, 404);
    assert.equal((await c.patch(`/api/admin/org-units/${ctx.siteA}`, { name: '탈취' })).status, 404);
    assert.equal((await c.post('/api/admin/users', { email: 'staffA@dagym.test', name: '빼오기', role: 'staff', orgUnitIds: [unit] })).status, 409);
    const users = (await c.ok('GET', '/api/admin/users')).users;
    assert.deepEqual(users.map((u) => u.email), ['boss@other.test']);
    const units = (await c.ok('GET', '/api/admin/org-units')).units;
    assert.deepEqual(units.map((u) => u.id), [unit]);
    assert.equal((await c.post('/api/chat/rooms', { kind: 'dm', userId: ctx.staffA.id })).status >= 400, true);
    assert.equal((await c.post('/api/events', { calendarId: D.companyCal, title: 'x', start: `${today}T10:00:00+09:00`, end: `${today}T11:00:00+09:00` })).status >= 403, true);
  });
  test('메뉴 권한 등급표는 회사별: 남의 회사가 바꿔도 기본 회사는 그대로', async () => {
    await T.c.ok('PUT', '/api/admin/menu-perms', { menu: 'assistant', role: 'staff', level: 'none' });
    const m = await ctx.owner.ok('GET', '/api/admin/menu-perms');
    assert.equal(m.matrix.assistant.staff, 'use');
    const mt = await T.c.ok('GET', '/api/admin/menu-perms');
    assert.equal(mt.matrix.assistant.staff, 'none');
  });
  test('기존 회사 대표에게도 가입한 회사 사람·데이터가 안 보인다', async () => {
    const users = (await ctx.owner.ok('GET', '/api/admin/users')).users;
    assert.ok(!users.some((u) => /other\.test|example\.com/.test(u.email)));
    const org = await ctx.owner.ok('GET', '/api/org');
    assert.ok(!org.users.some((u) => u.id === T.me.user.id || u.id === P.me.user.id));
    const pt = (await P.c.ok('GET', '/api/tasks')).tasks[0];
    assert.equal((await ctx.owner.get(`/api/tasks/${pt.id}`)).status, 404);
  });
  test('팀 회사는 직원 초대 가능, 초대된 직원도 자기 회사만', async () => {
    const unit = T.me.orgUnits[0].id;
    const inv = await T.c.ok('POST', '/api/admin/users', { email: 'emp@other.test', name: '남직원', role: 'staff', orgUnitIds: [unit] });
    const e = new Client('emp');
    await e.ok('POST', `/api/invitations/${inv.path.split('/').pop()}/accept`, { password: 'emp-pass-12345' });
    const org = await e.ok('GET', '/api/org');
    assert.deepEqual(org.users.map((u) => u.name).sort(), ['남사장', '남직원']);
    assert.equal((await e.get(`/api/tasks/${D.task}`)).status, 404);
    const [{ tenant }] = await sql`select tenant from users where email = 'emp@other.test'`;
    assert.equal(tenant, T.me.user.tenant);
  });
});

describe('V15 계정 관리·플랫폼 운영', () => {
  test('온보딩 끝내기 · 내 데이터 내려받기 · 개인 → 팀 전환', async () => {
    await P.c.ok('POST', '/api/onboarding', { name: '혼자씨', title: '프리랜서', done: true });
    assert.ok((await sql`select onboarded_at from tenants where id = ${P.me.user.tenant}`)[0].onboarded_at);
    const r = await P.c.get('/api/account/export');
    assert.equal(r.status, 200); assert.match(r.headers.get('content-disposition'), /attachment/);
    assert.ok(r.body.tasks.some((t) => t.title === '내 첫 업무')); assert.equal(r.body.profile.title, '프리랜서');
    assert.ok(!JSON.stringify(r.body).includes('기본회사'));
    assert.equal((await T.c.post('/api/account/upgrade', { company: 'x' })).status, 403, '이미 팀이면 불가');
    await P.c.ok('POST', '/api/account/upgrade', { company: '혼자상사' });
    const me = await P.c.ok('GET', '/api/auth/me');
    assert.equal(me.user.personal, false);
    assert.equal((await sql`select plan_code from tenant_subscriptions where tenant = ${P.me.user.tenant}`)[0].plan_code, 'trial', '17차: 체험 중에는 팀으로 바꿔도 체험 그대로');
  });
  test('기본 회사 직원은 스스로 탈퇴 불가 · 비밀번호 틀리면 불가 · 대표 혼자면 탈퇴 시 공간도 삭제, 같은 이메일 재가입 가능', async () => {
    assert.equal((await ctx.staffA.client.post('/api/account/delete', { password: ctx.staffA.password, confirm: '탈퇴합니다' })).status, 403);
    assert.equal((await P.c.post('/api/account/delete', { password: 'wrong-pass', confirm: '탈퇴합니다' })).status, 400);
    await P.c.ok('POST', '/api/account/delete', { password: 'signup-pass-1234', confirm: '탈퇴합니다' });
    assert.equal((await P.c.get('/api/auth/me')).status, 401);
    assert.equal((await sql`select status from tenants where id = ${P.me.user.tenant}`)[0].status, 'deleted');
    assert.equal((await sql`select count(*)::int n from users where email = 'solo@example.com'`)[0].n, 0, '이메일 지움');
  });
  test('구성원이 있는 팀 대표는 바로 탈퇴 불가 → 공간 삭제는 이름 확인', async () => {
    assert.equal((await T.c.post('/api/account/delete', { password: 'signup-pass-1234', confirm: '탈퇴합니다' })).status, 400);
    assert.equal((await T.c.req('DELETE', '/api/account/space', { password: 'signup-pass-1234', confirmName: '틀린이름' })).status, 400);
  });
  test('플랫폼 운영: 신규 가입 목록, 차단하면 즉시 로그아웃·로그인 불가, 해제', async () => {
    const s = await ctx.owner.ok('GET', '/api/platform/signups');
    assert.ok(s.tenants.some((t) => t.id === T.me.user.tenant && t.owner_email === 'boss@other.test'));
    assert.ok(!s.tenants.some((t) => t.id === 'default'));
    assert.equal((await T.c.get('/api/platform/signups')).status, 404, '가입한 회사 대표는 플랫폼 화면 없음');
    await ctx.owner.ok('PUT', `/api/platform/tenants/${T.me.user.tenant}/status`, { status: 'blocked' });
    assert.equal((await T.c.get('/api/auth/me')).status, 401);
    const l = await new Client().post('/api/auth/login', { email: 'boss@other.test', password: 'signup-pass-1234' });
    assert.equal(l.status, 403); assert.equal(l.body.error.code, 'tenant_blocked');
    assert.equal((await ctx.owner.req('PUT', '/api/platform/tenants/default/status', { status: 'blocked' })).status, 400);
    await ctx.owner.ok('PUT', `/api/platform/tenants/${T.me.user.tenant}/status`, { status: 'active' });
    const c = new Client(); await c.ok('POST', '/api/auth/login', { email: 'boss@other.test', password: 'signup-pass-1234' });
    await c.ok('DELETE', '/api/account/space', { password: 'signup-pass-1234', confirmName: '남의상사' });
    assert.equal((await new Client().post('/api/auth/login', { email: 'emp@other.test', password: 'emp-pass-12345' })).status, 401, '공간 삭제 → 구성원도 로그인 불가');
  });
});

describe('V15 첫 주소(/) 비로그인 → 랜딩, 앱은 로그인', () => {
  test('웹 비로그인은 랜딩, 앱(WebView)은 로그인 화면, 로그인한 사람은 홈', async () => {
    const web = await fetch(BASE + '/', { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/141 Safari/537.36' } });
    assert.equal(web.status, 200); assert.match(await web.text(), /한 화면에서/); // 대표 10/20 16:45 소개 사이트 H1 "업무도, 영업도, 마케팅도 한 화면에서"
    for (const ua of ['Mozilla/5.0 (Linux; Android 15; SM-S921N Build/AP3A; wv) AppleWebKit/537.36 Chrome/141 Mobile Safari/537.36', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148']) {
      const app = await fetch(BASE + '/', { redirect: 'manual', headers: { 'user-agent': ua } });
      assert.equal(app.status, 307); assert.match(app.headers.get('location'), /\/login/);
    }
    const me = await ctx.owner.req('GET', '/');
    assert.equal(me.status, 200); assert.doesNotMatch(String(me.body), /무료로 시작/);
  });
});

describe('17차 14일 무료 체험 · 끝나면 읽기 전용', () => {
  let c, tid, owner;
  test('가입하면 14일 체험(비즈니스 기능, 10명·20GB·AI 300), 무료 요금제 없음', async () => {
    await sql`delete from signup_attempts`; // 이 서버는 IP 하루 3회 제한으로 띄움
    const r = await join({ email: 'trial@example.com', name: '체험씨', mode: 'team', company: '체험상사' });
    c = r.c; await c.ok('POST', '/api/auth/verify', { token: r.link.split('/').pop() });
    await c.ok('POST', '/api/auth/login', { email: 'trial@example.com', password: 'signup-pass-1234' });
    owner = (await c.ok('GET', '/api/auth/me')).user; tid = owner.tenant;
    const [s] = await sql`select plan_code, status, trial_ends_at from tenant_subscriptions where tenant = ${tid}`;
    assert.equal(s.plan_code, 'trial'); assert.equal(s.status, 'trial');
    const days = (new Date(s.trial_ends_at).getTime() - Date.now()) / 86400000;
    assert.ok(days > 13.9 && days <= 14, '14일');
    const u = await c.ok('GET', '/api/usage');
    assert.equal(u.limits.users, 10); assert.equal(u.limits.storageGb, 20); assert.equal(u.limits.aiRequests, 300);
    await c.ok('POST', '/api/tasks', { title: '체험 중 업무' });
  });
  test('종료 3·1·0일 전 알림(한 번씩), 끝나면 expired → 쓰기 402·보기·내보내기·요금제 신청은 됨', async () => {
    await sql`update tenant_subscriptions set trial_ends_at = now() + interval '2 days' where tenant = ${tid}`;
    await tick(); await tick();
    const n = await sql`select title from notifications where user_id = ${owner.id} and title like '무료 체험%'`;
    assert.equal(n.length, 1); assert.match(n[0].title, /2일 남았습니다/);
    await sql`update tenant_subscriptions set trial_ends_at = now() - interval '1 minute' where tenant = ${tid}`;
    await tick();
    assert.equal((await sql`select status from tenant_subscriptions where tenant = ${tid}`)[0].status, 'expired');
    const w = await c.post('/api/tasks', { title: '막혀야 함' });
    assert.equal(w.status, 402); assert.equal(w.body.error.code, 'read_only');
    assert.ok((await c.ok('GET', '/api/tasks')).tasks.some((t) => t.title === '체험 중 업무'), '보기는 됨');
    assert.equal((await c.get('/api/account/export')).status, 200, '내보내기는 됨');
    await c.ok('POST', '/api/usage/request', { planCode: 'w_standard', note: '팀으로 할게요' });
    assert.equal((await sql`select chosen_plan from tenant_subscriptions where tenant = ${tid}`)[0].chosen_plan, 'w_standard');
    const me = await c.ok('GET', '/api/auth/me');
    assert.ok(me.user);
  });
  test('플랫폼 운영: +7일 연장 → 다시 쓰기 가능, 유료 전환, 플랫폼 운영자 아니면 404', async () => {
    const platform = (await sql`select email from users where platform_admin limit 1`)[0];
    const p = new Client('platform');
    await p.ok('POST', '/api/auth/login', { email: platform.email, password: 'owner-pass-1234' });
    assert.ok([402, 404].includes((await c.post(`/api/platform/tenants/${tid}/trial`, { action: 'extend', days: 7 })).status), '플랫폼 운영자만(읽기 전용이면 먼저 402)');
    const r = await p.ok('POST', `/api/platform/tenants/${tid}/trial`, { action: 'extend', days: 7 });
    assert.equal(r.trial.trial, true); assert.ok(r.trial.daysLeft >= 6);
    await c.ok('POST', '/api/tasks', { title: '연장 뒤 업무' });
    await p.ok('POST', `/api/platform/tenants/${tid}/trial`, { action: 'end' });
    assert.equal((await c.post('/api/tasks', { title: 'x' })).status, 402);
    await p.ok('POST', `/api/platform/tenants/${tid}/trial`, { action: 'convert' });
    const [s] = await sql`select plan_code, status from tenant_subscriptions where tenant = ${tid}`;
    assert.deepEqual({ ...s }, { plan_code: 'w_standard', status: 'active' });
    await c.ok('POST', '/api/tasks', { title: '유료 전환 뒤 업무' });
    assert.equal((await p.req('POST', `/api/platform/tenants/${tid}/trial`, { action: 'convert', planCode: 'team_free' })).status, 400);
  });
});
