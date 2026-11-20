// #626 캡처 차단(대표 10/25 20:05, docs/research/CAPTURE_BLOCK_DESIGN_2026-10-25.md): 정책 = 우리 회사(내부)·체험·슈퍼관리자 끔 / 외부 고객사 켬(시험 서버 CAPTURE_BLOCK=noauto 는 자동화 감지만 끔)
// · 플랫폼 운영 회사별 스위치(슈퍼관리자만·사유·감사) · 캡처 사건 기록(종류·경로만, 10분 1건) · 봇 UA 로그인 거부(전부 켠 서버에서, 외부 고객사만)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, bootstrap, resetDb, startServer, testDb } from '../helpers.mjs';

let srv, ctx, sql, cust, custTenant;
const form = (o) => ({ password: 'signup-pass-1234', agree: { terms: true, age14: true, privacy: true, ai: true, marketing: false }, ...o });
before(async () => {
  await resetDb(); srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1' }); sql = testDb(); ctx = await bootstrap();
  cust = new Client('cust-capture');
  const r = await cust.ok('POST', '/api/auth/signup', form({ email: 'boss@capture.test', name: '캡처대표', mode: 'team', company: '캡처회사' }));
  await cust.ok('POST', '/api/auth/verify', { token: r.devLink.split('/').pop() });
  custTenant = (await cust.ok('GET', '/api/auth/me')).user.tenant;
});
after(async () => { srv?.proc.kill(); await sql?.end(); });

test('정책: 우리 회사(내부)·직원은 꺼짐, 외부 고객사는 켜짐(시험 서버 noauto = 자동화 감지만 끔)', async () => {
  assert.deepEqual((await ctx.owner.ok('GET', '/api/auth/me')).capture, { block: false, automation: false, reason: 'internal', watermark: false });
  // 대표 11/20: 체험 중인 회사는 물표시(watermark)만 끔 — 나머지 차단(block)은 그대로
  assert.deepEqual((await cust.ok('GET', '/api/auth/me')).capture, { block: true, automation: false, reason: 'on', watermark: false }, '새로 가입한 회사 = 체험 중');
  assert.equal((await ctx.staffA.client.ok('GET', '/api/auth/me')).capture.block, false);
});

test('플랫폼 운영 스위치: 슈퍼관리자만(고객사 404) · 끄면 사유와 함께 감사 기록 · 회사 상세에 상태·30일 사건 수 · 없는 회사 404', async () => {
  assert.equal((await cust.req('PUT', `/api/platform/tenants/${custTenant}/capture`, { on: false, note: '화면 공유 회의' })).status, 404);
  const off = await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/capture`, { on: false, note: '화면 공유 회의' });
  assert.deepEqual(off, { tenant: custTenant, captureBlock: false, note: '화면 공유 회의' });
  assert.equal((await cust.ok('GET', '/api/auth/me')).capture.reason, 'tenant_off');
  const d = await ctx.owner.ok('GET', `/api/platform/tenants/${custTenant}/detail`);
  assert.equal(d.tenant.capture_block, false); assert.equal(d.tenant.capture_note, '화면 공유 회의'); assert.equal(d.captureEvents30d, 0);
  const [a] = await sql`select detail from audit_logs where action = 'platform.capture_block' order by created_at desc limit 1`;
  assert.deepEqual(a.detail, { tenant: custTenant, on: false, note: '화면 공유 회의' });
  const on = await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/capture`, { on: true });
  assert.deepEqual(on, { tenant: custTenant, captureBlock: true, note: null });
  assert.equal((await cust.ok('GET', '/api/auth/me')).capture.block, true);
  assert.equal((await ctx.owner.req('PUT', '/api/platform/tenants/nope/capture', { on: false })).status, 404);
});

test('캡처 사건 기록: 종류·경로(쿼리 제외)만 · 같은 사람 같은 종류 10분 1건 · 정책 꺼진 내부 테넌트는 기록 안 함 · 모르는 종류 400', async () => {
  assert.deepEqual(await cust.ok('POST', '/api/security/capture-events', { kind: 'print', path: '/tasks?id=1&x=2' }), { recorded: true });
  assert.deepEqual(await cust.ok('POST', '/api/security/capture-events', { kind: 'print', path: '/tasks' }), { recorded: false, skipped: 'recent' });
  assert.deepEqual(await cust.ok('POST', '/api/security/capture-events', { kind: 'printscreen' }), { recorded: true });
  const rows = await sql`select detail from audit_logs where action = 'security.capture_event' order by created_at`;
  assert.deepEqual(rows.map((r) => [r.detail.kind, r.detail.path, r.detail.tenant]), [['print', '/tasks', custTenant], ['printscreen', null, custTenant]]);
  assert.deepEqual(await ctx.owner.ok('POST', '/api/security/capture-events', { kind: 'print', path: '/' }), { recorded: false, skipped: 'off' });
  assert.equal((await cust.req('POST', '/api/security/capture-events', { kind: 'hack' })).status, 400);
  assert.equal((await ctx.owner.ok('GET', `/api/platform/tenants/${custTenant}/detail`)).captureEvents30d, 2);
});

test('봇·헤드리스 UA 로그인 거부(CAPTURE_BLOCK 전부 켠 서버): 외부 고객사만 401 + 감사, 브라우저 UA·우리 회사는 그대로', async () => {
  srv.proc.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 800));
  srv = await startServer({ PUBLIC_SIGNUP: '1', MAIL_DEV: '1', CAPTURE_BLOCK: '1' });
  const bot = { 'user-agent': 'python-requests/2.31.0' };
  const chrome = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' };
  const c2 = new Client('cust-bot');
  const r = await c2.req('POST', '/api/auth/login', { email: 'boss@capture.test', password: 'signup-pass-1234' }, bot);
  assert.equal(r.status, 401); assert.equal(r.body.error.code, 'automation_blocked');
  const [a] = await sql`select detail from audit_logs where action = 'auth.login_blocked' order by created_at desc limit 1`; assert.equal(a.detail.automation, true);
  assert.equal((await c2.req('POST', '/api/auth/login', { email: 'boss@capture.test', password: 'signup-pass-1234' }, chrome)).status, 200);
  assert.equal((await c2.ok('GET', '/api/auth/me')).capture.automation, true, '전부 켠 서버는 자동화 감지도 켬');
  const o2 = new Client('owner-bot');
  assert.equal((await o2.req('POST', '/api/auth/login', { email: 'ceo@dagym.test', password: 'owner-pass-1234' }, bot)).status, 200, '우리 회사는 자동화 접속 허용');
});

test('체험 중 물표시(대표 11/20): 체험 중 = 끔 → 유료가 되면 켬 · 체험이 끝나도(읽기 전용) 켬 · 스위치를 직접 켠 회사는 체험 중에도 켬 · 끈 회사는 전부 끔', async () => {
  // 앞 시험이 서버를 '전부 켠' 설정으로 다시 띄웠을 수 있어 automation 값은 보지 않음(차단·까닭·물표시만)
  const wm = async () => { const c = (await cust.ok('GET', '/api/auth/me')).capture; return { block: c.block, reason: c.reason, watermark: c.watermark }; };
  await sql`update tenants set capture_block = null where id = ${custTenant}`;
  const sub = async (status, ends) => { await sql`update tenant_subscriptions set status = ${status}, trial_ends_at = ${ends} where tenant = ${custTenant}`; };
  const [orig] = await sql`select status, trial_ends_at from tenant_subscriptions where tenant = ${custTenant}`;
  assert.equal(orig.status, 'trial', '가입 직후는 체험');
  assert.deepEqual(await wm(), { block: true, reason: 'on', watermark: false }, '체험 중: 물표시만 끔');
  await sub('active', orig.trial_ends_at);
  assert.deepEqual(await wm(), { block: true, reason: 'on', watermark: true }, '유료: 기본값(켬)');
  await sub('trial', new Date(Date.now() - 86_400_000));
  assert.equal((await wm()).watermark, true, '체험 기간이 지남: 켬');
  await sub('expired', new Date(Date.now() - 86_400_000));
  assert.equal((await wm()).watermark, true, '체험 끝(읽기 전용): 켬');
  await sub('trial', new Date(Date.now() + 5 * 86_400_000));
  assert.equal((await wm()).watermark, false, '다시 체험 중: 끔');
  await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/capture`, { on: true });
  assert.equal((await wm()).watermark, true, '플랫폼 운영에서 직접 켠 회사는 체험 중에도 보임');
  await ctx.owner.ok('PUT', `/api/platform/tenants/${custTenant}/capture`, { on: false, note: '화면 공유' });
  assert.deepEqual(await wm(), { block: false, reason: 'tenant_off', watermark: false }, '끈 회사는 전부 끔');
  await sql`update tenants set capture_block = null where id = ${custTenant}`; await sub(orig.status, orig.trial_ends_at);
});

